"""Minimal assistant action router for in-product chat actions."""
from __future__ import annotations

from typing import Any, Dict, List


def plan_actions(*, message: str, answer: str | None = None) -> List[Dict[str, Any]]:
    text = (message or "").lower()
    actions: List[Dict[str, Any]] = []

    if any(k in text for k in ["look this up", "search", "find", "research"]):
      q = message.strip()
      actions.append({
          "type": "web_search",
          "label": "Search web",
          "query": q,
      })

    if any(k in text for k in ["save this", "remember this", "note this"]):
      actions.append({
          "type": "save_note",
          "label": "Save to notes",
      })

    if any(k in text for k in ["remind me", "later", "tomorrow"]):
      actions.append({
          "type": "set_reminder",
          "label": "Create reminder",
      })

    if answer and len(answer.strip()) > 120:
      actions.append({
          "type": "summarize_answer",
          "label": "Summarize",
      })

    # Keep minimal/noisy-free.
    return actions[:3]
