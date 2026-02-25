from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parents[1]
CLAWDBOT_DIR = REPO_ROOT / '.clawdbot'
TASKS_PATH = CLAWDBOT_DIR / 'active-tasks.json'
IDEAS_PATH = CLAWDBOT_DIR / 'ideas.json'


def _read_json(path: Path, default):
    try:
        if not path.exists():
            return default
        return json.loads(path.read_text())
    except Exception:
        return default


def list_runs() -> List[Dict[str, Any]]:
    data = _read_json(TASKS_PATH, [])
    return data if isinstance(data, list) else []


def list_ideas() -> List[Dict[str, Any]]:
    data = _read_json(IDEAS_PATH, [])
    return data if isinstance(data, list) else []


def spawn_task(title: str, scope: str, desc: str = '', lane: str = 'A') -> Dict[str, Any]:
    script = CLAWDBOT_DIR / 'scripts' / 'submit-task.sh'
    proc = subprocess.run(
        [
            str(script),
            '--title',
            title,
            '--scope',
            scope,
            '--desc',
            desc,
            '--lane',
            lane,
        ],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    return {
        'ok': proc.returncode == 0,
        'code': proc.returncode,
        'stdout': proc.stdout[-2000:],
        'stderr': proc.stderr[-2000:],
    }


def steer_run(tmux_session: str, message: str) -> Dict[str, Any]:
    proc = subprocess.run(
        ['tmux', 'send-keys', '-t', tmux_session, message, 'Enter'],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    return {'ok': proc.returncode == 0, 'code': proc.returncode, 'stderr': proc.stderr[-1000:]}


def kill_run(tmux_session: str) -> Dict[str, Any]:
    proc = subprocess.run(
        ['tmux', 'kill-session', '-t', tmux_session],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    return {'ok': proc.returncode == 0, 'code': proc.returncode, 'stderr': proc.stderr[-1000:]}


def run_tick() -> Dict[str, Any]:
    script = CLAWDBOT_DIR / 'scripts' / 'swarm-start.sh'
    proc = subprocess.run([str(script)], cwd=str(REPO_ROOT), capture_output=True, text=True)
    return {
        'ok': proc.returncode == 0,
        'code': proc.returncode,
        'stdout': proc.stdout[-2000:],
        'stderr': proc.stderr[-2000:],
    }
