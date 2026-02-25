from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

from .config import MonitorConfig
from .types import ActionResult, CheckResult, MonitorRunResult

logger = logging.getLogger("brain_web")

CheckFn = Callable[[], CheckResult]
ActionFn = Callable[[], ActionResult]


@dataclass(frozen=True)
class MonitorPolicy:
    """
    Declarative mapping from check_id -> list[action_id].
    """

    remediation_by_check: Dict[str, list[str]]


class SelfHealingMonitor:
    def __init__(
        self,
        *,
        config: MonitorConfig,
        checks: Dict[str, CheckFn],
        actions: Dict[str, ActionFn],
        policy: MonitorPolicy,
    ) -> None:
        self._config = config
        self._checks = checks
        self._actions = actions
        self._policy = policy

        self._lock = asyncio.Lock()
        self._last_run: Optional[MonitorRunResult] = None

        # Cooldown keyed by (check_id, action_id) so one failing check doesn't
        # block the same action for different checks.
        self._last_action_at_s: dict[tuple[str, str], float] = {}

        self._task: Optional[asyncio.Task] = None
        self._stopping = asyncio.Event()

    @property
    def config(self) -> MonitorConfig:
        return self._config

    def snapshot(self) -> Dict[str, Any]:
        last = self._last_run.to_dict() if self._last_run else None
        return {
            "enabled": bool(self._config.enabled),
            "mode": self._config.mode,
            "interval_seconds": self._config.interval_seconds,
            "last_run": last,
        }

    def _check_enabled(self, check_id: str) -> bool:
        if check_id in self._config.disabled_checks:
            return False
        if self._config.enabled_checks and check_id not in self._config.enabled_checks:
            return False
        return True

    def _action_enabled(self, action_id: str) -> bool:
        return action_id not in self._config.disabled_actions

    async def _run_check(self, check_id: str, fn: CheckFn) -> CheckResult:
        timeout_s = max(0.1, float(self._config.check_timeout_seconds))
        start = time.perf_counter()
        try:
            result: CheckResult = await asyncio.wait_for(asyncio.to_thread(fn), timeout=timeout_s)
            duration_ms = int((time.perf_counter() - start) * 1000)
            if result.duration_ms is None:
                return CheckResult(
                    check_id=result.check_id,
                    status=result.status,
                    summary=result.summary,
                    checked_at_ms=result.checked_at_ms,
                    duration_ms=duration_ms,
                    details=result.details,
                    error=result.error,
                )
            return result
        except asyncio.TimeoutError:
            duration_ms = int((time.perf_counter() - start) * 1000)
            return CheckResult(
                check_id=check_id,
                status="unhealthy",
                summary=f"check timed out after {timeout_s:.1f}s",
                duration_ms=duration_ms,
                details={"timeout_seconds": timeout_s},
                error="timeout",
            )
        except Exception as e:
            duration_ms = int((time.perf_counter() - start) * 1000)
            return CheckResult(
                check_id=check_id,
                status="unhealthy",
                summary="check raised exception",
                duration_ms=duration_ms,
                details={},
                error=str(e),
            )

    async def _run_action(self, check_id: str, action_id: str, fn: ActionFn) -> ActionResult:
        timeout_s = max(0.1, float(self._config.action_timeout_seconds))
        start = time.perf_counter()
        try:
            result: ActionResult = await asyncio.wait_for(asyncio.to_thread(fn), timeout=timeout_s)
            duration_ms = int((time.perf_counter() - start) * 1000)
            payload = result.to_dict()
            payload["duration_ms"] = payload.get("duration_ms") or duration_ms
            payload["check_id"] = payload.get("check_id") or check_id
            return ActionResult(
                action_id=payload["action_id"],
                ok=bool(payload["ok"]),
                summary=str(payload["summary"]),
                acted_at_ms=int(payload["acted_at_ms"]),
                duration_ms=int(payload["duration_ms"]),
                details=dict(payload.get("details") or {}),
                error=payload.get("error"),
                check_id=payload.get("check_id"),
            )
        except asyncio.TimeoutError:
            duration_ms = int((time.perf_counter() - start) * 1000)
            return ActionResult(
                action_id=action_id,
                ok=False,
                summary=f"action timed out after {timeout_s:.1f}s",
                duration_ms=duration_ms,
                details={"timeout_seconds": timeout_s},
                error="timeout",
                check_id=check_id,
            )
        except Exception as e:
            duration_ms = int((time.perf_counter() - start) * 1000)
            return ActionResult(
                action_id=action_id,
                ok=False,
                summary="action raised exception",
                duration_ms=duration_ms,
                details={},
                error=str(e),
                check_id=check_id,
            )

    def _cooldown_remaining_s(self, *, check_id: str, action_id: str, now_s: float) -> float:
        cooldown_s = max(0.0, float(self._config.action_cooldown_seconds))
        last = self._last_action_at_s.get((check_id, action_id))
        if last is None:
            return 0.0
        remaining = (last + cooldown_s) - now_s
        return remaining if remaining > 0 else 0.0

    async def run_once(self, *, heal: Optional[bool] = None) -> MonitorRunResult:
        """
        Run enabled checks once, optionally performing remediations.

        This method is safe to call concurrently; runs are serialized.
        """
        async with self._lock:
            started_at_ms = int(time.time() * 1000)
            t0 = time.perf_counter()
            mode = "heal" if (heal if heal is not None else self._config.heal_enabled) else "observe"

            enabled_checks = {k: v for k, v in self._checks.items() if self._check_enabled(k)}
            checks: list[CheckResult] = []
            actions: list[ActionResult] = []

            # Run checks sequentially to keep dependency load predictable.
            for check_id, fn in enabled_checks.items():
                result = await self._run_check(check_id, fn)
                checks.append(result)

            actions_budget = int(self._config.max_actions_per_run)
            now_s = time.monotonic()

            if mode == "heal" and actions_budget > 0:
                for check in checks:
                    if check.status == "healthy":
                        continue
                    for action_id in self._policy.remediation_by_check.get(check.check_id, []):
                        if actions_budget <= 0:
                            break
                        if not self._action_enabled(action_id):
                            continue
                        action_fn = self._actions.get(action_id)
                        if action_fn is None:
                            continue

                        remaining_s = self._cooldown_remaining_s(
                            check_id=check.check_id, action_id=action_id, now_s=now_s
                        )
                        if remaining_s > 0:
                            continue

                        action_res = await self._run_action(check.check_id, action_id, action_fn)
                        actions.append(action_res)
                        self._last_action_at_s[(check.check_id, action_id)] = time.monotonic()
                        actions_budget -= 1

            duration_ms = int((time.perf_counter() - t0) * 1000)
            ok = all(c.status == "healthy" for c in checks)
            run = MonitorRunResult(
                ok=ok,
                mode=mode,
                started_at_ms=started_at_ms,
                duration_ms=duration_ms,
                checks=checks,
                actions=actions,
            )
            self._last_run = run

            try:
                # Structured-ish log to support quick grepping.
                logger.info(
                    "[SelfHeal] run ok=%s mode=%s checks=%s actions=%s duration_ms=%s",
                    ok,
                    mode,
                    ",".join(f"{c.check_id}:{c.status}" for c in checks),
                    ",".join(f"{a.action_id}:{'ok' if a.ok else 'fail'}" for a in actions) or "-",
                    duration_ms,
                )
            except Exception:
                pass

            return run

    async def _loop(self) -> None:
        interval_s = max(1, int(self._config.interval_seconds))
        # Startup delay to avoid competing with app boot.
        await asyncio.sleep(min(5, interval_s))
        while not self._stopping.is_set():
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error("[SelfHeal] loop error: %s", e, exc_info=True)
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=interval_s)
            except asyncio.TimeoutError:
                continue

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stopping.clear()
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._stopping.set()
        task = self._task
        if task is None:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        self._task = None

