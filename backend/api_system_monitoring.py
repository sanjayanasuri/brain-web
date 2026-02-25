from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from auth import require_auth
from system_monitoring import MonitorConfig, build_default_monitor

router = APIRouter(prefix="/admin/system-monitoring", tags=["system-monitoring"])


def _get_or_build_monitor(request: Request):
    monitor = getattr(request.app.state, "self_healing_monitor", None)
    if monitor is not None:
        return monitor
    cfg = MonitorConfig.from_env()
    return build_default_monitor(config=cfg)


@router.get("/status")
async def get_monitor_status(request: Request, auth: dict = Depends(require_auth)):
    monitor = getattr(request.app.state, "self_healing_monitor", None)
    if monitor is None:
        cfg = MonitorConfig.from_env()
        return {"enabled": False, "mode": cfg.mode, "interval_seconds": cfg.interval_seconds, "last_run": None}
    return monitor.snapshot()


@router.post("/run")
async def run_monitor_once(
    request: Request,
    heal: bool | None = None,
    auth: dict = Depends(require_auth),
):
    monitor = _get_or_build_monitor(request)
    try:
        res = await monitor.run_once(heal=heal)
        return res.to_dict()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

