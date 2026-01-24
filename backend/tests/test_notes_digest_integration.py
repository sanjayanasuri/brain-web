"""
Integration tests for Learning Notes Digest with Postgres and API endpoints.

These tests require TEST_POSTGRES_CONNECTION_STRING to be set.
"""
import json
import os

import pytest

from tests.utils import db_fetchall, db_fetchone, flatten_digest_entries


TEST_DB = os.getenv("TEST_POSTGRES_CONNECTION_STRING")
pytestmark = pytest.mark.skipif(
    not TEST_DB,
    reason="TEST_POSTGRES_CONNECTION_STRING not set - skipping notes digest integration tests",
)


def test_event_ingestion_updates_digest(
    client,
    auth_headers,
    notes_digest_db,
    notes_llm_stub,
    post_session_event,
    chat_session_ids,
    notes_digest_event_log,
    disable_lecture_links,
):
    chat_id, session_id = chat_session_ids

    event1 = post_session_event(
        session_id,
        message="Teach me about organelles.",
        answer="",
    )
    event2 = post_session_event(
        session_id,
        message="How do eukaryotic cells use organelles?",
        answer="Eukaryotic cells rely on organelles for specialized functions.",
    )

    notes_llm_stub.set_responses([{
        "add_entries": [
            {
                "section_title": "Concepts Clarified",
                "concept_label": "Organelles",
                "summary_text": "Organelles are membrane-bound structures that enable specialized functions in eukaryotic cells.",
                "source_type": "main_chat",
                "source_message_ids": [event1["event_id"], event2["event_id"]],
                "related_branch_id": None,
                "related_anchor_ids": None,
                "confidence_level": 0.83,
            }
        ],
        "refine_entries": [],
        "new_sections": [],
    }])

    update_response = client.post(
        f"/chats/{chat_id}/notes/update",
        json={"trigger_source": "manual"},
        headers=auth_headers,
    )
    assert update_response.status_code == 200
    update_body = update_response.json()
    assert update_body["status"] == "updated"
    assert update_body["entries_added"] == 1
    assert update_body["entries_refined"] == 0

    digest_response = client.get(f"/chats/{chat_id}/notes", headers=auth_headers)
    assert digest_response.status_code == 200
    digest_body = digest_response.json()

    entries = flatten_digest_entries(digest_body)
    assert any("Organelles" in entry["summary_text"] for entry in entries)
    assert any(entry["source_type"] == "main_chat" for entry in entries)

    db_entries = db_fetchall(
        notes_digest_db,
        "SELECT * FROM notes_entries WHERE chat_id = %s",
        (chat_id,),
    )
    assert len(db_entries) == 1
    db_entry = db_entries[0]
    assert db_entry["source_type"] == "main_chat"
    assert event1["event_id"] in db_entry["source_message_ids"]
    assert event2["event_id"] in db_entry["source_message_ids"]
    assert db_entry["summary_text"].startswith("Organelles are")

    history_row = db_fetchone(
        notes_digest_db,
        """
        SELECT COUNT(*) AS count
        FROM notes_digest_history h
        JOIN notes_digests d ON d.id = h.digest_id
        WHERE d.chat_id = %s
        """,
        (chat_id,),
    )
    assert history_row["count"] == 1
    assert not any(evt["event_type"] == "notes_update_failed" for evt in notes_digest_event_log)


def test_branch_hint_contributions_update_digest(
    client,
    auth_headers,
    notes_digest_db,
    notes_llm_stub,
    create_branch_with_messages,
    chat_session_ids,
    disable_lecture_links,
):
    chat_id, _session_id = chat_session_ids

    branch_bundle = create_branch_with_messages(
        chat_id=chat_id,
        selected_text="mitochondria",
        messages=[
            ("user", "What do mitochondria do?"),
            ("assistant", "Mitochondria generate ATP for cellular energy."),
        ],
        hints=[
            {"hint_text": "Remember mitochondria are the cell's powerhouse.", "target_offset": 120},
        ],
    )
    branch = branch_bundle["branch"]
    messages = branch_bundle["messages"]
    hints = branch_bundle["hints"]
    anchor_hash = branch_bundle["anchor_hash"]

    notes_llm_stub.set_responses([{
        "add_entries": [
            {
                "section_title": "Key Explanations",
                "concept_label": "Mitochondria",
                "summary_text": "Mitochondria generate ATP, supplying energy for cellular work.",
                "source_type": "branch_chat",
                "source_message_ids": [messages[-1].id],
                "related_branch_id": branch.id,
                "related_anchor_ids": [anchor_hash],
                "confidence_level": 0.86,
            },
            {
                "section_title": "Key Explanations",
                "concept_label": "Mitochondria",
                "summary_text": "Mitochondria are known as the cell's powerhouse in the original answer.",
                "source_type": "bridging_hint",
                "source_message_ids": [hints[0].id],
                "related_branch_id": branch.id,
                "related_anchor_ids": [anchor_hash],
                "confidence_level": 0.77,
            },
        ],
        "refine_entries": [],
        "new_sections": [],
    }])

    update_response = client.post(
        f"/chats/{chat_id}/notes/update",
        json={"trigger_source": "bridging_hints", "branch_id": branch.id},
        headers=auth_headers,
    )
    assert update_response.status_code == 200
    update_body = update_response.json()
    assert update_body["status"] == "updated"
    assert update_body["entries_added"] == 2

    digest_response = client.get(f"/chats/{chat_id}/notes", headers=auth_headers)
    assert digest_response.status_code == 200
    entries = flatten_digest_entries(digest_response.json())

    assert any("ATP" in entry["summary_text"] for entry in entries)
    assert any(entry["source_type"] == "branch_chat" for entry in entries)
    assert any(entry["source_type"] == "bridging_hint" for entry in entries)

    branch_rows = db_fetchall(
        notes_digest_db,
        "SELECT * FROM notes_entries WHERE chat_id = %s AND source_type = 'branch_chat'",
        (chat_id,),
    )
    assert branch_rows
    assert branch_rows[0]["related_branch_id"] == branch.id
    assert anchor_hash in (branch_rows[0]["related_anchor_ids"] or [])

    hint_rows = db_fetchall(
        notes_digest_db,
        "SELECT * FROM notes_entries WHERE chat_id = %s AND source_type = 'bridging_hint'",
        (chat_id,),
    )
    assert hint_rows
    assert hint_rows[0]["related_branch_id"] == branch.id
    assert anchor_hash in (hint_rows[0]["related_anchor_ids"] or [])

    history_row = db_fetchone(
        notes_digest_db,
        """
        SELECT COUNT(*) AS count
        FROM notes_digest_history h
        JOIN notes_digests d ON d.id = h.digest_id
        WHERE d.chat_id = %s
        """,
        (chat_id,),
    )
    assert history_row["count"] == 1


def test_incremental_update_advances_cursor(
    client,
    auth_headers,
    notes_digest_db,
    notes_llm_stub,
    post_session_event,
    chat_session_ids,
    disable_lecture_links,
):
    chat_id, session_id = chat_session_ids

    event1 = post_session_event(
        session_id,
        message="What are organelles?",
        answer="Organelles are specialized structures within cells.",
    )

    notes_llm_stub.set_responses([{
        "add_entries": [
            {
                "section_title": "Concepts Clarified",
                "concept_label": "Organelles",
                "summary_text": "Organelles are specialized structures inside cells.",
                "source_type": "main_chat",
                "source_message_ids": [event1["event_id"]],
                "related_branch_id": None,
                "related_anchor_ids": None,
                "confidence_level": 0.74,
            }
        ],
        "refine_entries": [],
        "new_sections": [],
    }])

    first_update = client.post(
        f"/chats/{chat_id}/notes/update",
        json={"trigger_source": "manual"},
        headers=auth_headers,
    )
    assert first_update.status_code == 200

    digest_row = db_fetchone(
        notes_digest_db,
        "SELECT * FROM notes_digests WHERE chat_id = %s",
        (chat_id,),
    )
    first_processed_at = digest_row["last_processed_at"]
    first_processed_id = digest_row["last_processed_message_id"]
    assert first_processed_id == event1["event_id"]

    event2 = post_session_event(
        session_id,
        message="What is the nucleus?",
        answer="The nucleus stores genetic material.",
    )

    notes_llm_stub.set_responses([{
        "add_entries": [
            {
                "section_title": "Concepts Clarified",
                "concept_label": "Nucleus",
                "summary_text": "The nucleus stores DNA and directs cell activity.",
                "source_type": "main_chat",
                "source_message_ids": [event2["event_id"]],
                "related_branch_id": None,
                "related_anchor_ids": None,
                "confidence_level": 0.79,
            }
        ],
        "refine_entries": [],
        "new_sections": [],
    }])

    second_update = client.post(
        f"/chats/{chat_id}/notes/update",
        json={"trigger_source": "manual"},
        headers=auth_headers,
    )
    assert second_update.status_code == 200
    second_body = second_update.json()
    assert second_body["entries_added"] == 1

    second_digest = db_fetchone(
        notes_digest_db,
        "SELECT * FROM notes_digests WHERE chat_id = %s",
        (chat_id,),
    )
    assert second_digest["last_processed_message_id"] == event2["event_id"]
    assert second_digest["last_processed_at"] > first_processed_at

    entry_rows = db_fetchall(
        notes_digest_db,
        "SELECT summary_text FROM notes_entries WHERE chat_id = %s ORDER BY created_at ASC",
        (chat_id,),
    )
    assert len(entry_rows) == 2
    assert "Organelles" in entry_rows[0]["summary_text"]
    assert "nucleus" in entry_rows[1]["summary_text"].lower()

    history_row = db_fetchone(
        notes_digest_db,
        """
        SELECT COUNT(*) AS count
        FROM notes_digest_history h
        JOIN notes_digests d ON d.id = h.digest_id
        WHERE d.chat_id = %s
        """,
        (chat_id,),
    )
    assert history_row["count"] == 2


def test_dedup_refines_existing_entry(
    client,
    auth_headers,
    notes_digest_db,
    notes_llm_stub,
    post_session_event,
    chat_session_ids,
    disable_lecture_links,
):
    chat_id, session_id = chat_session_ids

    event1 = post_session_event(
        session_id,
        message="Explain organelles in cells.",
        answer="Organelles help cells perform specialized functions.",
    )

    notes_llm_stub.set_responses([{
        "add_entries": [
            {
                "section_title": "Concepts Clarified",
                "concept_label": "Organelles",
                "summary_text": "Organelles are cell structures with specialized functions.",
                "source_type": "main_chat",
                "source_message_ids": [event1["event_id"]],
                "related_branch_id": None,
                "related_anchor_ids": None,
                "confidence_level": 0.78,
            }
        ],
        "refine_entries": [],
        "new_sections": [],
    }])

    first_update = client.post(
        f"/chats/{chat_id}/notes/update",
        json={"trigger_source": "manual"},
        headers=auth_headers,
    )
    assert first_update.status_code == 200

    entry_row = db_fetchone(
        notes_digest_db,
        "SELECT id, updated_at, summary_text FROM notes_entries WHERE chat_id = %s",
        (chat_id,),
    )
    first_updated_at = entry_row["updated_at"]

    event2 = post_session_event(
        session_id,
        message="What are organelles again?",
        answer="Organelles are structures inside cells that do specific jobs.",
    )

    notes_llm_stub.set_responses([{
        "add_entries": [
            {
                "section_title": "Concepts Clarified",
                "concept_label": "Organelles",
                "summary_text": "Organelles are membrane-bound structures that handle specific cell tasks.",
                "source_type": "main_chat",
                "source_message_ids": [event2["event_id"]],
                "related_branch_id": None,
                "related_anchor_ids": None,
                "confidence_level": 0.82,
            }
        ],
        "refine_entries": [],
        "new_sections": [],
    }])

    second_update = client.post(
        f"/chats/{chat_id}/notes/update",
        json={"trigger_source": "manual"},
        headers=auth_headers,
    )
    assert second_update.status_code == 200
    second_body = second_update.json()
    assert second_body["entries_added"] == 0
    assert second_body["entries_refined"] == 1

    entries_after = db_fetchall(
        notes_digest_db,
        "SELECT updated_at, summary_text FROM notes_entries WHERE chat_id = %s",
        (chat_id,),
    )
    assert len(entries_after) == 1
    assert entries_after[0]["updated_at"] > first_updated_at
    assert "membrane-bound" in entries_after[0]["summary_text"]


def test_failure_handling_invalid_llm_response(
    client,
    auth_headers,
    notes_digest_db,
    notes_llm_stub,
    post_session_event,
    chat_session_ids,
    notes_digest_event_log,
    disable_lecture_links,
):
    chat_id, session_id = chat_session_ids

    event = post_session_event(
        session_id,
        message="Teach me about organelles.",
        answer="Organelles are specialized cell structures.",
    )

    notes_llm_stub.set_responses([
        json.JSONDecodeError("Expecting value", "not-json", 0),
        {
            "add_entries": [
                {
                    "section_title": "Concepts Clarified",
                    "concept_label": "Organelles",
                    "summary_text": "Organelles are specialized structures within cells.",
                    "source_type": "main_chat",
                    "source_message_ids": [event["event_id"]],
                    "related_branch_id": None,
                    "related_anchor_ids": None,
                    "confidence_level": 0.76,
                }
            ],
            "refine_entries": [],
            "new_sections": [],
        },
    ])

    failed_response = client.post(
        f"/chats/{chat_id}/notes/update",
        json={"trigger_source": "manual"},
        headers=auth_headers,
    )
    assert failed_response.status_code == 500
    assert "Failed to update notes" in failed_response.json()["detail"]

    digest_row = db_fetchone(
        notes_digest_db,
        "SELECT last_updated_at, last_processed_at FROM notes_digests WHERE chat_id = %s",
        (chat_id,),
    )
    assert digest_row["last_updated_at"] is None
    assert digest_row["last_processed_at"] is None

    assert not db_fetchall(
        notes_digest_db,
        "SELECT id FROM notes_entries WHERE chat_id = %s",
        (chat_id,),
    )

    history_row = db_fetchone(
        notes_digest_db,
        """
        SELECT COUNT(*) AS count
        FROM notes_digest_history h
        JOIN notes_digests d ON d.id = h.digest_id
        WHERE d.chat_id = %s
        """,
        (chat_id,),
    )
    assert history_row["count"] == 0

    failures = [evt for evt in notes_digest_event_log if evt["event_type"] == "notes_update_failed"]
    assert len(failures) == 1

    success_response = client.post(
        f"/chats/{chat_id}/notes/update",
        json={"trigger_source": "manual"},
        headers=auth_headers,
    )
    assert success_response.status_code == 200
    success_body = success_response.json()
    assert success_body["entries_added"] == 1

    failures = [evt for evt in notes_digest_event_log if evt["event_type"] == "notes_update_failed"]
    assert len(failures) == 1

    history_row = db_fetchone(
        notes_digest_db,
        """
        SELECT COUNT(*) AS count
        FROM notes_digest_history h
        JOIN notes_digests d ON d.id = h.digest_id
        WHERE d.chat_id = %s
        """,
        (chat_id,),
    )
    assert history_row["count"] == 1
