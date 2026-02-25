#!/usr/bin/env python3
"""
Brain Web Incident Loop (read-only triage)

Polls multiple observability surfaces and emits a unified stream of "incidents"
you can feed into an autonomous fix agent.

Providers:
  - Loki (Hetzner container logs via Grafana Loki)
  - Sentry (browser + Vercel runtime errors)

Recommended architecture:
  - Backend + infra logs → Loki (Promtail)
  - Vercel logs → Backend `/observability/vercel/logs` (Log Drain) → Loki
  - Browser + Vercel runtime errors → Sentry (already in this repo)

Usage:
  python scripts/incident_loop.py --once
  python scripts/incident_loop.py --watch

Env vars:
  # Loki
  LOKI_BASE_URL=http://127.0.0.1:3100
  LOKI_QUERY={job="docker"} |= "unhandled_exception"
  LOKI_LIMIT=200

  # Sentry
  SENTRY_BASE_URL=https://sentry.io
  SENTRY_ORG=your-org
  SENTRY_PROJECT=your-project
  SENTRY_AUTH_TOKEN=sntrys_...
  SENTRY_QUERY=  (optional)
  SENTRY_LIMIT=100

  # State/output
  INCIDENT_LOOP_DB=/tmp/brainweb_incident_loop.sqlite
  INCIDENT_LOOP_OUTBOX=ops/incident_loop/outbox
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8", errors="ignore")).hexdigest()


def _http_get_json(url: str, headers: Optional[Dict[str, str]] = None, timeout_s: float = 12.0) -> Any:
    req = urllib.request.Request(url, headers=headers or {}, method="GET")
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8", errors="replace"))


def _load_dotenv_best_effort() -> None:
    """
    Mirror backend env resolution:
      1) backend/.env (lowest)
      2) repo_root/.env
      3) repo_root/.env.local (highest)
    """
    repo_root = Path(__file__).parent.parent
    backend_dir = repo_root / "backend"

    env_local = repo_root / ".env.local"
    env_file = repo_root / ".env"
    backend_env = backend_dir / ".env"

    try:
        from dotenv import load_dotenv  # type: ignore
    except Exception:
        return

    if backend_env.exists():
        load_dotenv(dotenv_path=backend_env, override=False)
    if env_file.exists():
        load_dotenv(dotenv_path=env_file, override=True)
    if env_local.exists():
        load_dotenv(dotenv_path=env_local, override=True)


class IncidentStore:
    def __init__(self, path: str) -> None:
        self.path = path
        self._conn = sqlite3.connect(self.path)
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS incidents (
              source TEXT NOT NULL,
              fingerprint TEXT NOT NULL,
              first_seen_ms INTEGER NOT NULL,
              last_seen_ms INTEGER NOT NULL,
              count INTEGER NOT NULL,
              payload_json TEXT NOT NULL,
              PRIMARY KEY (source, fingerprint)
            )
            """
        )
        self._conn.commit()

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:
            pass

    def record(self, *, source: str, fingerprint: str, payload: Dict[str, Any], now_ms: int) -> bool:
        """
        Returns True if this is the first time we've seen (source,fingerprint).
        """
        payload_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        cur = self._conn.cursor()
        cur.execute(
            "SELECT count FROM incidents WHERE source=? AND fingerprint=?",
            (source, fingerprint),
        )
        row = cur.fetchone()
        if row is None:
            cur.execute(
                "INSERT INTO incidents (source,fingerprint,first_seen_ms,last_seen_ms,count,payload_json) VALUES (?,?,?,?,?,?)",
                (source, fingerprint, now_ms, now_ms, 1, payload_json),
            )
            self._conn.commit()
            return True

        prev_count = int(row[0] or 0)
        cur.execute(
            "UPDATE incidents SET last_seen_ms=?, count=?, payload_json=? WHERE source=? AND fingerprint=?",
            (now_ms, prev_count + 1, payload_json, source, fingerprint),
        )
        self._conn.commit()
        return False


@dataclass(frozen=True)
class Incident:
    source: str
    fingerprint: str
    severity: str
    title: str
    occurred_at: Optional[str]
    payload: Dict[str, Any]


class LokiProvider:
    def __init__(self, *, base_url: str, query: str, limit: int = 200) -> None:
        self.base_url = base_url.rstrip("/")
        self.query = query
        self.limit = int(limit)

    def _build_url(self, *, start_ns: int, end_ns: int) -> str:
        params = {
            "query": self.query,
            "start": str(start_ns),
            "end": str(end_ns),
            "limit": str(self.limit),
            "direction": "forward",
        }
        return f"{self.base_url}/loki/api/v1/query_range?{urllib.parse.urlencode(params)}"

    def _iter_values(self, result: Dict[str, Any]) -> Iterable[Tuple[int, Dict[str, str], str]]:
        data = (result or {}).get("data") or {}
        for stream in data.get("result") or []:
            labels = stream.get("stream") or {}
            for ts_ns_str, line in stream.get("values") or []:
                try:
                    ts_ns = int(ts_ns_str)
                except Exception:
                    continue
                yield (ts_ns, labels, line)

    def fetch(self, *, start: datetime, end: datetime) -> List[Incident]:
        start_ns = int(start.timestamp() * 1_000_000_000)
        end_ns = int(end.timestamp() * 1_000_000_000)
        url = self._build_url(start_ns=start_ns, end_ns=end_ns)
        data = _http_get_json(url)

        incidents: List[Incident] = []
        for ts_ns, labels, line in self._iter_values(data):
            occurred_at = _iso(datetime.fromtimestamp(ts_ns / 1_000_000_000, tz=timezone.utc))
            parsed: Optional[Dict[str, Any]]
            try:
                parsed = json.loads(line)
            except Exception:
                parsed = None

            if isinstance(parsed, dict) and parsed.get("event") in (
                "unhandled_exception",
                "dependency_unreachable",
                "http_exception",
                "vercel_log",
            ):
                event = str(parsed.get("event"))
                if event == "http_exception" and int(parsed.get("status") or 0) < 500:
                    continue

                title = f"{event}: {parsed.get('error') or parsed.get('detail') or parsed.get('dependency') or ''}".strip()
                severity = "error" if event == "unhandled_exception" else "warn"
                fp_base = (
                    f"{event}|{parsed.get('exc_type') or ''}|{parsed.get('dependency') or ''}|"
                    f"{parsed.get('status') or ''}|{parsed.get('route') or ''}|"
                    f"{parsed.get('error') or parsed.get('detail') or ''}"
                )
                incidents.append(
                    Incident(
                        source="loki",
                        fingerprint=_sha256(fp_base),
                        severity=severity,
                        title=title[:180],
                        occurred_at=occurred_at,
                        payload={"labels": labels, "log": parsed},
                    )
                )
                continue

            raw = line or ""
            if "Traceback" in raw or "ERROR" in raw or "Exception" in raw:
                incidents.append(
                    Incident(
                        source="loki",
                        fingerprint=_sha256(raw[:2048]),
                        severity="warn",
                        title=(raw.strip().splitlines()[0] if raw.strip() else "log error")[:180],
                        occurred_at=occurred_at,
                        payload={"labels": labels, "log_raw": raw},
                    )
                )

        return incidents


class SentryProvider:
    def __init__(
        self,
        *,
        base_url: str,
        org: str,
        project: str,
        token: str,
        query: str = "",
        limit: int = 100,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.org = org
        self.project = project
        self.token = token
        self.query = query
        self.limit = int(limit)

    def _build_url(self, *, start: datetime, end: datetime) -> str:
        params = {
            "start": _iso(start),
            "end": _iso(end),
            "per_page": str(self.limit),
        }
        if self.query:
            params["query"] = self.query
        qs = urllib.parse.urlencode(params)
        return f"{self.base_url}/api/0/projects/{urllib.parse.quote(self.org)}/{urllib.parse.quote(self.project)}/events/?{qs}"

    def fetch(self, *, start: datetime, end: datetime) -> List[Incident]:
        url = self._build_url(start=start, end=end)
        headers = {"Authorization": f"Bearer {self.token}"}
        events = _http_get_json(url, headers=headers)
        if not isinstance(events, list):
            return []

        incidents: List[Incident] = []
        for ev in events:
            if not isinstance(ev, dict):
                continue
            event_id = ev.get("eventID") or ev.get("id") or ""
            if not event_id:
                continue

            title = ev.get("title") or ev.get("message") or "Sentry event"
            occurred_at = ev.get("dateCreated") or ev.get("datetime") or None
            incidents.append(
                Incident(
                    source="sentry",
                    fingerprint=_sha256(f"sentry|{event_id}"),
                    severity=str(ev.get("level") or "error"),
                    title=str(title)[:180],
                    occurred_at=str(occurred_at) if occurred_at else None,
                    payload={"sentry_event": ev},
                )
            )

        return incidents


def _write_outbox(outbox_dir: Path, incident: Incident, now: datetime) -> Optional[Path]:
    try:
        outbox_dir.mkdir(parents=True, exist_ok=True)
        ts = now.strftime("%Y%m%d_%H%M%S")
        name = f"{ts}_{incident.source}_{incident.fingerprint[:10]}.json"
        path = outbox_dir / name
        payload = {
            "schema": "brainweb.incident.v1",
            "observed_at": _iso(now),
            "source": incident.source,
            "fingerprint": incident.fingerprint,
            "severity": incident.severity,
            "title": incident.title,
            "occurred_at": incident.occurred_at,
            "payload": incident.payload,
        }
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return path
    except Exception:
        return None


def main() -> int:
    _load_dotenv_best_effort()

    parser = argparse.ArgumentParser(description="Brain Web incident triage loop (Loki + Sentry).")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true", help="Run a single poll and exit.")
    mode.add_argument("--watch", action="store_true", help="Poll forever.")
    parser.add_argument(
        "--interval",
        type=float,
        default=float(os.getenv("INCIDENT_LOOP_INTERVAL_S", "10")),
        help="Poll interval (seconds) in --watch mode.",
    )
    parser.add_argument(
        "--lookback",
        type=float,
        default=float(os.getenv("INCIDENT_LOOP_LOOKBACK_S", "90")),
        help="Lookback window per poll (seconds).",
    )
    args = parser.parse_args()

    outbox_dir = Path(os.getenv("INCIDENT_LOOP_OUTBOX", "ops/incident_loop/outbox"))
    db_path = os.getenv("INCIDENT_LOOP_DB", "/tmp/brainweb_incident_loop.sqlite")

    providers: List[Any] = []

    loki_base = os.getenv("LOKI_BASE_URL", "").strip()
    loki_query = os.getenv("LOKI_QUERY", '{job="docker"} |= "unhandled_exception"').strip()
    loki_limit = int(os.getenv("LOKI_LIMIT", "200"))
    if loki_base:
        providers.append(LokiProvider(base_url=loki_base, query=loki_query, limit=loki_limit))

    sentry_token = os.getenv("SENTRY_AUTH_TOKEN", "").strip()
    sentry_org = os.getenv("SENTRY_ORG", "").strip()
    sentry_project = os.getenv("SENTRY_PROJECT", "").strip()
    sentry_base = os.getenv("SENTRY_BASE_URL", "https://sentry.io").strip()
    sentry_query = os.getenv("SENTRY_QUERY", "").strip()
    sentry_limit = int(os.getenv("SENTRY_LIMIT", "100"))
    if sentry_token and sentry_org and sentry_project:
        providers.append(
            SentryProvider(
                base_url=sentry_base,
                org=sentry_org,
                project=sentry_project,
                token=sentry_token,
                query=sentry_query,
                limit=sentry_limit,
            )
        )

    if not providers:
        print("[incident_loop] No providers configured. Set LOKI_BASE_URL and/or SENTRY_* env vars.")
        return 2

    store = IncidentStore(db_path)
    try:
        while True:
            now = _utc_now()
            start = now - timedelta(seconds=float(args.lookback))

            now_ms = int(time.time() * 1000)
            new_count = 0
            for provider in providers:
                try:
                    incidents = provider.fetch(start=start, end=now)
                except Exception as e:
                    print(f"[incident_loop] Provider {provider.__class__.__name__} error: {e}")
                    continue

                for inc in incidents:
                    is_new = store.record(
                        source=inc.source,
                        fingerprint=inc.fingerprint,
                        payload=inc.payload,
                        now_ms=now_ms,
                    )
                    if not is_new:
                        continue
                    new_count += 1
                    out_path = _write_outbox(outbox_dir, inc, now)
                    where = f" -> {out_path}" if out_path else ""
                    when = f" @ {inc.occurred_at}" if inc.occurred_at else ""
                    print(f"[NEW] [{inc.source}] {inc.severity} {inc.title}{when}{where}")

            if args.once:
                print(f"[incident_loop] Done. New incidents: {new_count}. State DB: {db_path}")
                return 0

            time.sleep(float(args.interval))
    finally:
        store.close()


if __name__ == "__main__":
    sys.exit(main())

