from __future__ import annotations

import os
from dataclasses import dataclass


def _truthy(value: str) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _csv_set(value: str) -> set[str]:
    items = []
    for raw in (value or "").split(","):
        item = raw.strip()
        if item:
            items.append(item)
    return set(items)


@dataclass(frozen=True)
class MonitorConfig:
    enabled: bool
    interval_seconds: int
    mode: str  # "observe" | "heal"

    check_timeout_seconds: float
    action_timeout_seconds: float
    action_cooldown_seconds: float
    max_actions_per_run: int

    enabled_checks: set[str]
    disabled_checks: set[str]
    disabled_actions: set[str]

    cache_memory_warn_entries: int
    cache_memory_max_entries: int
    cache_memory_target_entries: int

    @property
    def heal_enabled(self) -> bool:
        return self.mode.strip().lower() == "heal"

    @classmethod
    def from_env(cls) -> "MonitorConfig":
        enabled = _truthy(os.getenv("ENABLE_SELF_HEALING_MONITORING", "false"))
        interval_seconds = max(5, int(os.getenv("SELF_HEALING_MONITOR_INTERVAL_SECONDS", "30") or 30))
        mode = (os.getenv("SELF_HEALING_MODE", "heal") or "heal").strip().lower()
        if mode not in {"observe", "heal"}:
            mode = "heal"

        check_timeout_seconds = float(os.getenv("SELF_HEALING_CHECK_TIMEOUT_SECONDS", "5") or 5)
        action_timeout_seconds = float(os.getenv("SELF_HEALING_ACTION_TIMEOUT_SECONDS", "10") or 10)
        action_cooldown_seconds = float(os.getenv("SELF_HEALING_ACTION_COOLDOWN_SECONDS", "300") or 300)
        max_actions_per_run = max(0, int(os.getenv("SELF_HEALING_MAX_ACTIONS_PER_RUN", "2") or 2))

        enabled_checks = _csv_set(os.getenv("SELF_HEALING_ENABLED_CHECKS", ""))
        disabled_checks = _csv_set(os.getenv("SELF_HEALING_DISABLED_CHECKS", ""))
        disabled_actions = _csv_set(os.getenv("SELF_HEALING_DISABLED_ACTIONS", ""))

        cache_memory_warn_entries = max(0, int(os.getenv("SELF_HEALING_CACHE_MEMORY_WARN_ENTRIES", "5000") or 5000))
        cache_memory_max_entries = max(0, int(os.getenv("SELF_HEALING_CACHE_MEMORY_MAX_ENTRIES", "15000") or 15000))
        cache_memory_target_entries = max(
            0,
            int(os.getenv("SELF_HEALING_CACHE_MEMORY_TARGET_ENTRIES", "2500") or 2500),
        )

        return cls(
            enabled=enabled,
            interval_seconds=interval_seconds,
            mode=mode,
            check_timeout_seconds=check_timeout_seconds,
            action_timeout_seconds=action_timeout_seconds,
            action_cooldown_seconds=action_cooldown_seconds,
            max_actions_per_run=max_actions_per_run,
            enabled_checks=enabled_checks,
            disabled_checks=disabled_checks,
            disabled_actions=disabled_actions,
            cache_memory_warn_entries=cache_memory_warn_entries,
            cache_memory_max_entries=cache_memory_max_entries,
            cache_memory_target_entries=cache_memory_target_entries,
        )

