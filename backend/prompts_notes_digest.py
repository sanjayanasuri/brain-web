"""Prompt templates for Learning Notes Digest updates."""

INCREMENTAL_NOTES_DIGEST_PROMPT = """
You are maintaining an incremental Learning Notes Digest for a single chat session.

Goal: Update the existing digest with ONLY the new information provided.
This is a concept-oriented learning summary, not a transcript.

Strict constraints:
- Do NOT rewrite the entire digest.
- Only add new entries or refine specific existing entries.
- Preserve earlier phrasing when still valid; only adjust when new info clarifies or corrects it.
- Prefer the user's language and phrasing when possible.
- Be concise and study-friendly.
- Never introduce concepts that do not appear in the source material.
- If no updates are needed, return empty arrays.
- Always include source_message_ids from the new material that supports each entry.

You will receive:
- existing_digest: current sections and entries (with IDs).
- new_material: new main chat messages, branch chat messages, and bridging hints.

Anchor guidance:
- When a branch message or hint includes a selected_text_hash, use it in related_anchor_ids.

Return ONLY valid JSON with this schema:
{
  "add_entries": [
    {
      "section_title": "Section Title",
      "concept_label": "short concept label",
      "summary_text": "concise note",
      "source_type": "main_chat | branch_chat | bridging_hint",
      "source_message_ids": ["id1", "id2"],
      "related_branch_id": "branch-..." | null,
      "related_anchor_ids": ["anchor_hash"] | null,
      "confidence_level": 0.0-1.0
    }
  ],
  "refine_entries": [
    {
      "entry_id": "existing-entry-id",
      "summary_text": "refined note text (preserve earlier phrasing when still valid)",
      "confidence_level": 0.0-1.0,
      "source_message_ids": ["id1", "id2"],
      "related_branch_id": "branch-..." | null,
      "related_anchor_ids": ["anchor_hash"] | null
    }
  ],
  "new_sections": [
    {
      "title": "Optional New Section",
      "position": 0
    }
  ]
}
""".strip()


CONSOLIDATE_NOTES_PROMPT = """
You are consolidating an existing Learning Notes Digest.

Goal: Merge duplicate or overlapping entries by concept similarity without losing information.

Strict constraints:
- Do NOT rewrite the entire digest.
- Preserve earlier phrasing where possible.
- Merge only when two entries cover the same concept and intent.
- If no merges are needed, return an empty list.

Return ONLY valid JSON with this schema:
{
  "merges": [
    {
      "keep_entry_id": "entry-id",
      "remove_entry_ids": ["entry-id-2"],
      "merged_summary_text": "combined concise note",
      "confidence_level": 0.0-1.0
    }
  ]
}
""".strip()


REFINE_NOTES_PROMPT = """
You are refining existing entries using clarifications from new material.

Goal: Improve accuracy or clarity while preserving earlier phrasing when still valid.

Strict constraints:
- Do NOT rewrite the entire digest.
- Only refine entries that the new material clearly clarifies or corrects.
- If no refinements are needed, return empty arrays.

Return ONLY valid JSON with this schema:
{
  "refine_entries": [
    {
      "entry_id": "existing-entry-id",
      "summary_text": "refined note text",
      "confidence_level": 0.0-1.0
    }
  ]
}
""".strip()
