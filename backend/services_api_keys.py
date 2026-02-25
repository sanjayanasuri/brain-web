"""
Personal API key support (MVP).

Purpose:
- Allow browser extension / mobile share flows to authenticate ingest requests
  without storing a long-lived JWT.

Design notes:
- Keys are stored hashed (HMAC-SHA256) with a server-side pepper.
- Plaintext is returned once on creation/rotation.
- Verification is performed in the main auth middleware when no Bearer token is present.
"""

from __future__ import annotations

import hmac
import hashlib
import logging
import os
import secrets
from dataclasses import dataclass
from typing import Optional, Tuple

import psycopg2
from psycopg2.extras import RealDictCursor

from db_postgres import get_db_connection, return_db_connection

logger = logging.getLogger("brain_web")


def _get_api_key_pepper() -> str:
    # In production, set PERSONAL_API_KEY_PEPPER. For dev, fall back to API_TOKEN_SECRET.
    pepper = os.getenv("PERSONAL_API_KEY_PEPPER") or os.getenv("API_TOKEN_SECRET")
    return str(pepper or "dev-personal-api-key-pepper-change-in-production")


def generate_personal_api_key() -> str:
    # Prefix makes it easy to identify key type and avoid accidental token mixups.
    return f"bw_pk_{secrets.token_urlsafe(32)}"


def _hmac_sha256_hex(*, pepper: str, message: str) -> str:
    return hmac.new(pepper.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def hash_personal_api_key(api_key: str) -> str:
    api_key = str(api_key or "").strip()
    if not api_key or len(api_key) > 512:
        raise ValueError("Invalid API key")
    pepper = _get_api_key_pepper()
    return _hmac_sha256_hex(pepper=pepper, message=api_key)


def api_key_prefix(api_key: str, *, prefix_len: int = 12) -> str:
    api_key = str(api_key or "").strip()
    return api_key[: max(4, min(prefix_len, 32))]


def rotate_personal_api_key(*, user_id: str) -> Tuple[str, str]:
    """
    Rotate (create/replace) the user's personal API key.

    Returns (plaintext_api_key, api_key_prefix).
    """
    plaintext = generate_personal_api_key()
    hashed = hash_personal_api_key(plaintext)
    prefix = api_key_prefix(plaintext)

    conn = get_db_connection()
    error = False
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE users
                SET personal_api_key_hash = %s,
                    personal_api_key_prefix = %s,
                    personal_api_key_created_at = NOW(),
                    personal_api_key_last_used_at = NULL,
                    personal_api_key_revoked_at = NULL
                WHERE user_id = %s
                """,
                (hashed, prefix, user_id),
            )
            if cur.rowcount == 0:
                raise ValueError("User not found")
        conn.commit()
        return plaintext, prefix
    except Exception:
        error = True
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        return_db_connection(conn, error=error)


@dataclass(frozen=True)
class ApiKeyAuthResult:
    user_id: str
    tenant_id: str


def verify_personal_api_key(api_key: str) -> Optional[ApiKeyAuthResult]:
    """
    Verify an API key and return (user_id, tenant_id) on success.

    This performs a DB lookup against `users.personal_api_key_hash`.
    """
    try:
        hashed = hash_personal_api_key(api_key)
    except Exception:
        return None

    conn = None
    error = False
    try:
        conn = get_db_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT user_id::text AS user_id,
                       tenant_id::text AS tenant_id,
                       personal_api_key_revoked_at
                FROM users
                WHERE personal_api_key_hash = %s
                LIMIT 1
                """,
                (hashed,),
            )
            row = cur.fetchone()
            if not row:
                return None
            if row.get("personal_api_key_revoked_at") is not None:
                return None

        # Best-effort last_used tracking (do not fail auth on write errors).
        try:
            with conn.cursor() as cur2:
                cur2.execute(
                    "UPDATE users SET personal_api_key_last_used_at = NOW() WHERE personal_api_key_hash = %s",
                    (hashed,),
                )
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass

        return ApiKeyAuthResult(user_id=str(row["user_id"]), tenant_id=str(row["tenant_id"]))
    except Exception as e:
        error = True
        logger.debug(f"API key verification failed: {e}")
        return None
    finally:
        if conn is not None:
            return_db_connection(conn, error=error)

