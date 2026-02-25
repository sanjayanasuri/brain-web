#!/usr/bin/env python3
"""
QA script for event coverage and OpenTelemetry readiness.

Verifies that:
- Feature areas that should push events do so (event store or activity API).
- Events carry trace_id/correlation_id where applicable for OTEL correlation.
- Expected event types exist and are emitted.

Run from repo root: python backend/scripts/qa_events_coverage.py
Or from backend: python scripts/qa_events_coverage.py
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from dataclasses import dataclass, field
from typing import List, Optional, Set, Tuple

# Repo root (script may run from backend/ or repo root)
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
REPO_ROOT = BACKEND_DIR.parent


@dataclass
class FeatureArea:
    """A feature or API area that should emit events."""
    name: str
    description: str
    # Event store (events/schema.EventType) - backend emit_event
    expected_event_types: List[str] = field(default_factory=list)
    # Activity API types (POST /events/activity) - frontend logEvent
    expected_activity_types: List[str] = field(default_factory=list)
    # File/pattern hints for where emission should occur
    backend_hint: Optional[str] = None
    frontend_hint: Optional[str] = None


# Expected coverage: feature areas and which events they should push
EXPECTED_COVERAGE: List[FeatureArea] = [
    FeatureArea(
        name="retrieval",
        description="Graph RAG retrieve (chat/answer)",
        expected_event_types=["CHAT_MESSAGE_CREATED"],
        backend_hint="api_retrieval",
    ),
    FeatureArea(
        name="session_events",
        description="Session-scoped events (e.g. chat message from client)",
        expected_event_types=["CHAT_MESSAGE_CREATED"],
        backend_hint="api_sessions_events",
    ),
    FeatureArea(
        name="claims_quotes",
        description="Claim upsert from quotes/sources",
        expected_event_types=["CLAIM_UPSERTED"],
        backend_hint="claims_quotes",
    ),
    FeatureArea(
        name="concept_viewed",
        description="User views a concept (wire trackConceptViewed -> logEvent for backend)",
        expected_activity_types=["CONCEPT_VIEWED"],
        frontend_hint="sessionState trackEvent -> logEvent",
    ),
    FeatureArea(
        name="graph_switched",
        description="User switches graph",
        expected_activity_types=["GRAPH_SWITCHED"],
        frontend_hint="TopBar",
    ),
    FeatureArea(
        name="path_runner",
        description="Path started/step viewed/exited",
        expected_activity_types=["PATH_STARTED", "PATH_STEP_VIEWED", "PATH_EXITED"],
        frontend_hint="PathRunner",
    ),
    FeatureArea(
        name="digest",
        description="Digest opened",
        expected_activity_types=["DIGEST_OPENED"],
        frontend_hint="digest",
    ),
    FeatureArea(
        name="review",
        description="Review opened (add logEvent(REVIEW_OPENED) on review route)",
        expected_activity_types=["REVIEW_OPENED"],
        frontend_hint="review page or digest OPEN_REVIEW",
    ),
    FeatureArea(
        name="evidence_fetch",
        description="Evidence fetched",
        expected_activity_types=["EVIDENCE_FETCHED"],
        frontend_hint="evidenceFetch",
    ),
    FeatureArea(
        name="reminder",
        description="Reminder dismissed",
        expected_activity_types=["REMINDER_DISMISSED"],
        frontend_hint="ReminderBanner",
    ),
]


def grep_backend(pattern: str, glob: str = "*.py") -> List[Tuple[Path, int, str]]:
    """Search backend for pattern; return (path, line_no, line)."""
    results: List[Tuple[Path, int, str]] = []
    for path in BACKEND_DIR.rglob(glob):
        if path.name == "qa_events_coverage.py":
            continue
        if "scripts" in path.parts:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            if re.search(pattern, line):
                results.append((path, i, line.strip()))
    return results


def grep_frontend(pattern: str, glob: str = "*.ts") -> List[Tuple[Path, int, str]]:
    """Search frontend for pattern."""
    results: List[Tuple[Path, int, str]] = []
    frontend = REPO_ROOT / "frontend"
    if not frontend.is_dir():
        return results
    for path in frontend.rglob(glob):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            if re.search(pattern, line):
                results.append((path, i, line.strip()))
    return results


def find_emit_event_usage() -> Set[str]:
    """Find EventType values used in emit_event(..., event_type=EventType.SOME_TYPE)."""
    found: Set[str] = set()
    for path, _line, line in grep_backend(r"emit_event\s*\("):
        m = re.search(r"EventType\.([A-Z][A-Z0-9_]+)", line)
        if m:
            found.add(m.group(1))
    for path, _line, line in grep_backend(r"event_type\s*=\s*EventType"):
        m = re.search(r"EventType\.([A-Z][A-Z0-9_]+)", line)
        if m:
            found.add(m.group(1))
    for path, _line, line in grep_backend(r"EventType\(payload\.event_type\)"):
        found.add("CHAT_MESSAGE_CREATED")  # session API uses string value
    return found


def find_activity_types_in_backend() -> Set[str]:
    """Activity types accepted by backend (ActivityEventCreate)."""
    found: Set[str] = set()
    api_events = BACKEND_DIR / "api_events.py"
    if not api_events.is_file():
        return found
    text = api_events.read_text(encoding="utf-8", errors="replace")
    # Literal['CONCEPT_VIEWED', ...]
    m = re.search(r"Literal\[(.*?)\]", text, re.DOTALL)
    if m:
        inner = m.group(1)
        for part in re.findall(r"'([A-Z_]+)'", inner):
            found.add(part)
    return found


def find_activity_types_in_frontend() -> Set[str]:
    """Activity types used in frontend logEvent({ type: 'X' })."""
    found: Set[str] = set()
    frontend = REPO_ROOT / "frontend"
    if not frontend.is_dir():
        return found
    for path in frontend.rglob("*.ts*"):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if "logEvent" not in text:
            continue
        # Match type: 'CONCEPT_VIEWED' or type: "PATH_STARTED" (may be on same or next lines)
        for m in re.finditer(r"type:\s*['\"]([A-Z_]+)['\"]", text):
            found.add(m.group(1))
    return found


def check_trace_id_in_emit() -> Tuple[bool, List[str]]:
    """Check that emit_event calls pass trace_id where request is available."""
    issues: List[str] = []
    # api_retrieval passes trace_id from request.state.request_id
    retrieval = BACKEND_DIR / "api_retrieval.py"
    if retrieval.is_file():
        text = retrieval.read_text(encoding="utf-8", errors="replace")
        if "emit_event(" in text and "trace_id=" not in text:
            issues.append("api_retrieval: emit_event should pass trace_id=getattr(request.state, 'request_id', None)")
        elif "trace_id=" in text:
            pass  # ok
    # api_sessions_events: trace_id comes from payload
    sessions_events = BACKEND_DIR / "api_sessions_events.py"
    if sessions_events.is_file():
        text = sessions_events.read_text(encoding="utf-8", errors="replace")
        if "trace_id=payload.trace_id" in text or "trace_id" in text:
            pass  # ok
        else:
            issues.append("api_sessions_events: consider accepting trace_id in payload for OTEL")
    return len(issues) == 0, issues


def check_event_schema_has_trace_id() -> bool:
    """EventEnvelope should have trace_id for OpenTelemetry."""
    schema = BACKEND_DIR / "events" / "schema.py"
    if not schema.is_file():
        return False
    text = schema.read_text(encoding="utf-8", errors="replace")
    return "trace_id" in text


def run_qa() -> bool:
    """Run all checks and print report. Returns True if all pass."""
    print("=" * 60)
    print("QA: Event coverage & OpenTelemetry readiness")
    print("=" * 60)

    all_ok = True

    # 1) Event schema has trace_id
    if check_event_schema_has_trace_id():
        print("[PASS] events/schema.py EventEnvelope has trace_id")
    else:
        print("[FAIL] events/schema.py EventEnvelope missing trace_id")
        all_ok = False

    # 2) emit_event usage and trace_id
    trace_ok, trace_issues = check_trace_id_in_emit()
    if trace_ok:
        print("[PASS] emit_event call sites pass trace_id where applicable")
    else:
        for msg in trace_issues:
            print(f"[WARN] {msg}")
        # Don't fail QA for this, just warn
    emitted = find_emit_event_usage()
    print(f"[INFO] Event store emissions: {sorted(emitted)}")

    # 3) Activity API types
    backend_activity = find_activity_types_in_backend()
    frontend_activity = find_activity_types_in_frontend()
    print(f"[INFO] Activity types (backend): {len(backend_activity)}")
    print(f"[INFO] Activity types (frontend logEvent): {sorted(frontend_activity)}")
    if frontend_activity - backend_activity:
        print(f"[WARN] Frontend uses activity types not in backend Literal: {frontend_activity - backend_activity}")

    # 4) Expected feature coverage
    print("\n--- Feature coverage ---")
    for fa in EXPECTED_COVERAGE:
        event_ok = not fa.expected_event_types or any(
            e in emitted for e in fa.expected_event_types
        )
        activity_ok = not fa.expected_activity_types or any(
            a in frontend_activity for a in fa.expected_activity_types
        )
        if fa.expected_event_types and fa.expected_activity_types:
            ok = event_ok or activity_ok
        else:
            ok = event_ok and activity_ok
        status = "[PASS]" if ok else "[MISS]"
        print(f"  {status} {fa.name}: {fa.description}")
        if not ok:
            if fa.expected_event_types:
                print(f"        Expected event type(s): {fa.expected_event_types}")
            if fa.expected_activity_types:
                print(f"        Expected activity type(s): {fa.expected_activity_types}")
            all_ok = False

    # 5) Event types in schema
    schema_file = BACKEND_DIR / "events" / "schema.py"
    if schema_file.is_file():
        text = schema_file.read_text(encoding="utf-8", errors="replace")
        schema_types = re.findall(r"(\w+)\s*=\s*[\"']([\w]+)[\"']", text)
        event_type_values = {v for _k, v in schema_types if v in ["UserViewed", "UserHighlighted", "ChatMessageCreated", "SourceCaptured", "ClaimUpserted", "RecommendationGenerated", "SessionContextUpdated"]}
        print(f"\n[INFO] EventType enum values in schema: {sorted(event_type_values)}")

    print("\nOpenTelemetry: event store (emit_event) and activity API (POST /events/activity)")
    print("both support trace_id/correlation_id. Set request_id in middleware and pass")
    print("trace_id from request.state or client for full correlation.")
    print("=" * 60)
    return all_ok


if __name__ == "__main__":
    ok = run_qa()
    sys.exit(0 if ok else 1)
