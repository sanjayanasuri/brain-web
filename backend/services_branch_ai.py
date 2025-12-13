from __future__ import annotations

import json
from typing import Any, Dict, Optional

from openai import OpenAI

from config import OPENAI_API_KEY


_client: Optional[OpenAI] = None
if OPENAI_API_KEY:
    cleaned_key = OPENAI_API_KEY.strip().strip('"').strip("'")
    if cleaned_key and cleaned_key.startswith("sk-"):
        try:
            _client = OpenAI(api_key=cleaned_key)
        except Exception:
            _client = None


def llm_compare_branches(
    *,
    branch_a_graph: Dict[str, Any],
    branch_b_graph: Dict[str, Any],
    question: Optional[str] = None,
) -> Dict[str, Any]:
    if not _client:
        raise RuntimeError("OpenAI client not configured (set OPENAI_API_KEY)")

    # Keep payload bounded.
    def compress(g: Dict[str, Any]) -> Dict[str, Any]:
        nodes = g.get("nodes", [])
        links = g.get("links", [])
        nodes_small = [
            {
                "node_id": n.get("node_id"),
                "name": n.get("name"),
                "domain": n.get("domain"),
                "type": n.get("type"),
            }
            for n in nodes[:250]
        ]
        links_small = [
            {
                "source_id": l.get("source_id"),
                "predicate": l.get("predicate"),
                "target_id": l.get("target_id"),
            }
            for l in links[:400]
        ]
        return {"nodes": nodes_small, "links": links_small}

    payload = {
        "question": question or "Compare these branches.",
        "branch_a": compress(branch_a_graph),
        "branch_b": compress(branch_b_graph),
    }

    system = (
        "You compare two knowledge-graph branches and return a structured diff. "
        "Return ONLY valid JSON with keys: similarities, differences, contradictions, missing_steps, recommendations. "
        "Each value must be an array of short strings."
    )

    resp = _client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload)},
        ],
        temperature=0.2,
        max_tokens=500,
    )

    content = (resp.choices[0].message.content or "").strip()
    # Strip markdown fences if present.
    if content.startswith("```"):
        parts = content.split("```")
        content = parts[1] if len(parts) > 1 else content
        content = content.replace("json", "", 1).strip()

    data = json.loads(content)
    # normalize
    for k in ["similarities", "differences", "contradictions", "missing_steps", "recommendations"]:
        if k not in data or not isinstance(data[k], list):
            data[k] = []
    return data
