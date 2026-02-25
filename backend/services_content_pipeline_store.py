"""
Postgres-backed store for the unified content pipeline.

This is the single persistence surface for ContentItem ingestion + processing.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from db_postgres import execute_query, execute_update

logger = logging.getLogger("brain_web")


def create_content_item(
    *,
    user_id: str,
    type: str,
    source_url: Optional[str] = None,
    source_platform: Optional[str] = None,
    title: Optional[str] = None,
    raw_text: Optional[str] = None,
    raw_html: Optional[str] = None,
    raw_media_url: Optional[str] = None,
) -> str:
    rows = execute_query(
        """
        INSERT INTO content_items (
            user_id,
            type,
            source_url,
            source_platform,
            title,
            raw_text,
            raw_html,
            raw_media_url,
            status,
            created_at,
            updated_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'created', NOW(), NOW())
        RETURNING id
        """,
        (user_id, type, source_url, source_platform, title, raw_text, raw_html, raw_media_url),
        commit=True,
    )
    return str(rows[0]["id"])


def get_content_item(*, content_item_id: str) -> Optional[Dict[str, Any]]:
    rows = execute_query(
        """
        SELECT id::text AS id,
               user_id::text AS user_id,
               type,
               source_url,
               source_platform,
               title,
               raw_text,
               raw_html,
               raw_media_url,
               extracted_text,
               status,
               created_at,
               updated_at
        FROM content_items
        WHERE id = %s
        LIMIT 1
        """,
        (content_item_id,),
    )
    return rows[0] if rows else None


def update_content_item_status(
    *,
    content_item_id: str,
    status: str,
    extracted_text: Optional[str] = None,
) -> None:
    execute_update(
        """
        UPDATE content_items
        SET status = %s,
            extracted_text = COALESCE(%s, extracted_text),
            updated_at = NOW()
        WHERE id = %s
        """,
        (status, extracted_text, content_item_id),
    )


def insert_content_analysis_heuristic(
    *,
    content_item_id: str,
    summary_short: str,
    summary_long: str,
) -> str:
    rows = execute_query(
        """
        INSERT INTO content_analyses (
            content_item_id,
            model,
            summary_short,
            summary_long,
            key_points,
            entities,
            topics,
            questions,
            action_items,
            analysis_json,
            created_at
        )
        VALUES (
            %s,
            %s,
            %s,
            %s,
            '[]'::jsonb,
            '[]'::jsonb,
            '[]'::jsonb,
            '[]'::jsonb,
            '[]'::jsonb,
            %s::jsonb,
            NOW()
        )
        RETURNING id
        """,
        (
            content_item_id,
            "heuristic-v0",
            summary_short,
            summary_long,
            '{"analysis_method":"heuristic","pending_llm":true}'  # safe, explicit placeholder
        ),
        commit=True,
    )
    return str(rows[0]["id"])

