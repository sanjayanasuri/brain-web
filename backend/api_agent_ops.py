from __future__ import annotations

from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_auth
from services_agent_ops import list_runs, list_ideas, spawn_task, steer_run, kill_run, run_tick, update_idea_status

router = APIRouter(prefix='/agent-ops', tags=['agent-ops'])


class SpawnReq(BaseModel):
    title: str = Field(..., min_length=3)
    scope: str = Field(..., min_length=2)
    desc: str = ''
    lane: str = 'A'


class SteerReq(BaseModel):
    tmux_session: str
    message: str = Field(..., min_length=2)


class KillReq(BaseModel):
    tmux_session: str


class IdeaStatusReq(BaseModel):
    status: str = Field(..., pattern='^(approved|denied|deferred|proposed)$')


@router.get('/runs')
def get_runs(_: Any = Depends(require_auth)) -> Dict[str, List[Dict[str, Any]]]:
    return {'runs': list_runs(), 'ideas': list_ideas()}


@router.post('/spawn')
def post_spawn(payload: SpawnReq, _: Any = Depends(require_auth)):
    out = spawn_task(payload.title, payload.scope, payload.desc, payload.lane)
    if not out.get('ok'):
        raise HTTPException(status_code=500, detail=out)
    return out


@router.post('/steer')
def post_steer(payload: SteerReq, _: Any = Depends(require_auth)):
    out = steer_run(payload.tmux_session, payload.message)
    if not out.get('ok'):
        raise HTTPException(status_code=500, detail=out)
    return out


@router.post('/kill')
def post_kill(payload: KillReq, _: Any = Depends(require_auth)):
    out = kill_run(payload.tmux_session)
    if not out.get('ok'):
        raise HTTPException(status_code=500, detail=out)
    return out


@router.post('/tick')
def post_tick(_: Any = Depends(require_auth)):
    out = run_tick()
    if not out.get('ok'):
        raise HTTPException(status_code=500, detail=out)
    return out


@router.post('/ideas/{idea_id}/status')
def post_idea_status(idea_id: str, payload: IdeaStatusReq, _: Any = Depends(require_auth)):
    out = update_idea_status(idea_id, payload.status)
    if not out.get('ok'):
        raise HTTPException(status_code=500, detail=out)
    return out
