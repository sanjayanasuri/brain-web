from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


HealthStatus = str  # "healthy" | "degraded" | "unhealthy"


def _now_ms() -> int:
    import time

    return int(time.time() * 1000)


@dataclass(frozen=True)
class CheckResult:
    check_id: str
    status: HealthStatus
    summary: str
    checked_at_ms: int = field(default_factory=_now_ms)
    duration_ms: Optional[int] = None
    details: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "check_id": self.check_id,
            "status": self.status,
            "summary": self.summary,
            "checked_at_ms": self.checked_at_ms,
            "duration_ms": self.duration_ms,
            "details": self.details,
            "error": self.error,
        }


@dataclass(frozen=True)
class ActionResult:
    action_id: str
    ok: bool
    summary: str
    acted_at_ms: int = field(default_factory=_now_ms)
    duration_ms: Optional[int] = None
    details: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    check_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "action_id": self.action_id,
            "ok": self.ok,
            "summary": self.summary,
            "acted_at_ms": self.acted_at_ms,
            "duration_ms": self.duration_ms,
            "details": self.details,
            "error": self.error,
            "check_id": self.check_id,
        }


@dataclass(frozen=True)
class MonitorRunResult:
    ok: bool
    mode: str
    started_at_ms: int
    duration_ms: int
    checks: list[CheckResult]
    actions: list[ActionResult]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "mode": self.mode,
            "started_at_ms": self.started_at_ms,
            "duration_ms": self.duration_ms,
            "checks": [c.to_dict() for c in self.checks],
            "actions": [a.to_dict() for a in self.actions],
        }

