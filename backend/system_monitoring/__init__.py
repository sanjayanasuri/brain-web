"""Self-healing monitoring (backend/system_monitoring).

This package provides a lightweight, env-gated monitoring loop that can:
- periodically run health checks for key dependencies and background workers
- optionally execute remediation actions with cooldowns (self-healing)

It is intentionally config-driven and safe-by-default: the background loop is
disabled unless `ENABLE_SELF_HEALING_MONITORING=true`.
"""

from .config import MonitorConfig
from .monitor import SelfHealingMonitor
from .catalog import build_default_monitor

__all__ = [
    "MonitorConfig",
    "SelfHealingMonitor",
    "build_default_monitor",
]

