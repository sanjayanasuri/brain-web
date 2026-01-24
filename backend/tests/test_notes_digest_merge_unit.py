"""Unit tests for notes digest merge/refinement helpers."""
from datetime import datetime

from models_notes_digest import NotesEntry, NotesSection
from services_notes_digest import _find_similar_entry, _merge_ids


def _make_entry(entry_id: str, summary_text: str, concept_label: str = None) -> NotesEntry:
    now = datetime.utcnow()
    return NotesEntry(
        id=entry_id,
        section_id="section-1",
        chat_id="chat-1",
        source_type="main_chat",
        source_message_ids=["event-1"],
        related_branch_id=None,
        related_anchor_ids=None,
        summary_text=summary_text,
        confidence_level=0.7,
        concept_label=concept_label,
        created_at=now,
        updated_at=now,
    )


def _make_section(entries):
    now = datetime.utcnow()
    return NotesSection(
        id="section-1",
        digest_id="digest-1",
        title="Concepts Clarified",
        position=0,
        entries=entries,
        created_at=now,
        updated_at=now,
    )


def test_find_similar_entry_by_concept_label():
    entry = _make_entry("entry-1", "Organelles are structures in cells.", concept_label="Organelles")
    section = _make_section([entry])

    match = _find_similar_entry(section, "organelles", "Completely different text.")

    assert match is not None
    assert match.id == entry.id


def test_find_similar_entry_by_summary_similarity():
    entry = _make_entry("entry-1", "Mitochondria produce ATP in cells.")
    section = _make_section([entry])

    match = _find_similar_entry(section, None, "Mitochondria produce ATP in cells.")

    assert match is not None
    assert match.id == entry.id


def test_find_similar_entry_none_when_unrelated():
    entry = _make_entry("entry-1", "Mitochondria produce ATP in cells.")
    section = _make_section([entry])

    match = _find_similar_entry(section, None, "Chloroplasts enable photosynthesis.")

    assert match is None


def test_merge_ids_deduplicates_and_preserves_order():
    merged = _merge_ids(["id-1", "id-2"], ["id-2", "id-3"])

    assert merged == ["id-1", "id-2", "id-3"]
