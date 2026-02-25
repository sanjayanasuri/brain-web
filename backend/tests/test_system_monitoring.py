from __future__ import annotations

import dataclasses

import pytest

from system_monitoring.config import MonitorConfig
from system_monitoring.monitor import MonitorPolicy, SelfHealingMonitor
from system_monitoring.types import ActionResult, CheckResult


def _cfg(**overrides) -> MonitorConfig:
    base = MonitorConfig(
        enabled=True,
        interval_seconds=30,
        mode="heal",
        check_timeout_seconds=0.5,
        action_timeout_seconds=0.5,
        action_cooldown_seconds=0.0,
        max_actions_per_run=10,
        enabled_checks=set(),
        disabled_checks=set(),
        disabled_actions=set(),
        cache_memory_warn_entries=0,
        cache_memory_max_entries=0,
        cache_memory_target_entries=0,
    )
    return dataclasses.replace(base, **overrides)


@pytest.mark.asyncio
async def test_monitor_no_actions_when_healthy():
    cfg = _cfg()

    checks = {
        "c1": lambda: CheckResult(check_id="c1", status="healthy", summary="ok"),
    }
    calls: list[str] = []

    def _a1():
        calls.append("a1")
        return ActionResult(action_id="a1", ok=True, summary="done")

    actions = {"a1": _a1}
    policy = MonitorPolicy(remediation_by_check={"c1": ["a1"]})
    monitor = SelfHealingMonitor(config=cfg, checks=checks, actions=actions, policy=policy)

    res = await monitor.run_once(heal=True)
    assert res.ok is True
    assert res.actions == []
    assert calls == []


@pytest.mark.asyncio
async def test_monitor_runs_action_on_unhealthy():
    cfg = _cfg()

    checks = {
        "c1": lambda: CheckResult(check_id="c1", status="unhealthy", summary="boom"),
    }
    calls: list[str] = []

    def _a1():
        calls.append("a1")
        return ActionResult(action_id="a1", ok=True, summary="remediated")

    actions = {"a1": _a1}
    policy = MonitorPolicy(remediation_by_check={"c1": ["a1"]})
    monitor = SelfHealingMonitor(config=cfg, checks=checks, actions=actions, policy=policy)

    res = await monitor.run_once(heal=True)
    assert res.ok is False
    assert len(res.actions) == 1
    assert res.actions[0].action_id == "a1"
    assert calls == ["a1"]


@pytest.mark.asyncio
async def test_monitor_respects_action_cooldown():
    cfg = _cfg(action_cooldown_seconds=3600)

    checks = {
        "c1": lambda: CheckResult(check_id="c1", status="unhealthy", summary="boom"),
    }
    calls: list[str] = []

    def _a1():
        calls.append("a1")
        return ActionResult(action_id="a1", ok=True, summary="remediated")

    actions = {"a1": _a1}
    policy = MonitorPolicy(remediation_by_check={"c1": ["a1"]})
    monitor = SelfHealingMonitor(config=cfg, checks=checks, actions=actions, policy=policy)

    await monitor.run_once(heal=True)
    await monitor.run_once(heal=True)

    # Second run is within cooldown window; action runs only once.
    assert calls == ["a1"]


@pytest.mark.asyncio
async def test_monitor_respects_disabled_actions():
    cfg = _cfg(disabled_actions={"a1"})

    checks = {
        "c1": lambda: CheckResult(check_id="c1", status="unhealthy", summary="boom"),
    }
    calls: list[str] = []

    def _a1():
        calls.append("a1")
        return ActionResult(action_id="a1", ok=True, summary="remediated")

    actions = {"a1": _a1}
    policy = MonitorPolicy(remediation_by_check={"c1": ["a1"]})
    monitor = SelfHealingMonitor(config=cfg, checks=checks, actions=actions, policy=policy)

    res = await monitor.run_once(heal=True)
    assert res.actions == []
    assert calls == []


def test_system_monitoring_status_endpoint_requires_auth(client):
    res = client.get("/admin/system-monitoring/status")
    assert res.status_code == 401


def test_system_monitoring_status_endpoint_with_auth(client, auth_headers):
    res = client.get("/admin/system-monitoring/status", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert "enabled" in body
