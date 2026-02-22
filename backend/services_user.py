import logging
from typing import Optional, Dict, Any
import uuid
from datetime import datetime
import os

logger = logging.getLogger("brain_web")

# Dynamic DB selection
try:
    from db_postgres import (
        execute_query,
        execute_update,
        get_db_connection,
        return_db_connection,
        apply_rls_session_settings,
    )
    # Test connection
    conn = get_db_connection()
    return_db_connection(conn)
    logger.info("Connected to Postgres for User Service")
except Exception as e:
    from config import ENVIRONMENT
    import os
    
    # STRICT MODE: Only allow SQLite if explicitly enabled in DEV
    enable_sqlite = os.getenv("ENABLE_SQLITE_FALLBACK", "false").lower() in ("true", "1", "yes")
    
    if ENVIRONMENT == "production" or not enable_sqlite:
        logger.error(f"CRITICAL: Postgres connection failed: {e}")
        logger.error("To enable SQLite fallback in development, set ENABLE_SQLITE_FALLBACK=true")
        raise RuntimeError(f"Database connection failed. Postgres unreachable and SQLite fallback disabled. Error: {e}")
    
    logger.warning(f"Postgres not available ({e}). Falling back to SQLite (ENABLE_SQLITE_FALLBACK=true).")
    from db_sqlite import execute_query, execute_update
    
try:
    from passlib.context import CryptContext
except Exception:  # pragma: no cover
    CryptContext = None  # type: ignore[assignment]
    pwd_context = None
else:
    # Password hashing context
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a hashed one."""
    if pwd_context is None:  # pragma: no cover
        raise RuntimeError("passlib is required for password verification; install backend/requirements.txt")
    try:
        print(f"DEBUG: Verifying password for hash starting with {hashed_password[:10]}...")
        result = pwd_context.verify(plain_password, hashed_password)
        print(f"DEBUG: Verification result: {result}")
        return result
    except Exception as e:
        print(f"DEBUG: Verify error: {e}")
        return False

def get_password_hash(password: str) -> str:
    """Generate a hash for a password."""
    if pwd_context is None:  # pragma: no cover
        raise RuntimeError("passlib is required for password hashing; install backend/requirements.txt")
    return pwd_context.hash(password)

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Fetch a user from the database by email."""
    print(f"DEBUG: Fetching user by email: {email}")
    query = "SELECT * FROM users WHERE email = %s"
    results = execute_query(query, (email,))
    if results:
        print("DEBUG: User found")
        return results[0]
    print("DEBUG: User not found")
    return None

def create_user(email: str, password_hash: str, full_name: str = "") -> Dict[str, Any]:
    """Create a new user and return the user object."""
    user_id = str(uuid.uuid4())
    # Personal default tenant (owner model). This is now represented in
    # tenants + tenant_memberships as well.
    tenant_id = user_id
    created_at = datetime.utcnow()

    # Prefer one transaction when Postgres helpers are available.
    if "return_db_connection" in globals() and "apply_rls_session_settings" in globals():
        conn = get_db_connection()
        error = False
        try:
            with conn.cursor() as cur:
                # RLS context for tenant-scoped tables.
                apply_rls_session_settings(cur, user_id=user_id, tenant_id=tenant_id)
                cur.execute(
                    """
                    INSERT INTO users (user_id, tenant_id, email, password_hash, full_name, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (user_id, tenant_id, email, password_hash, full_name, created_at),
                )
                # Tenant registry (idempotent for retries).
                cur.execute(
                    """
                    INSERT INTO tenants (tenant_id, name, created_at)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (tenant_id) DO NOTHING
                    """,
                    (tenant_id, (full_name or email or "Personal Workspace"), created_at),
                )
                # Owner membership.
                cur.execute(
                    """
                    INSERT INTO tenant_memberships (tenant_id, user_id, role, created_at)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (tenant_id, user_id)
                    DO UPDATE SET role = EXCLUDED.role
                    """,
                    (tenant_id, user_id, "owner", created_at),
                )
            conn.commit()
            return {
                "user_id": user_id,
                "tenant_id": tenant_id,
                "email": email,
                "full_name": full_name,
                "created_at": created_at,
            }
        except Exception:
            error = True
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            return_db_connection(conn, error=error)

    # Fallback path (SQLite/dev compatibility)
    query = """
        INSERT INTO users (user_id, tenant_id, email, password_hash, full_name, created_at)
        VALUES (%s, %s, %s, %s, %s, %s)
    """
    params = (user_id, tenant_id, email, password_hash, full_name, created_at)
    execute_update(query, params)
    try:
        execute_update(
            """
            INSERT INTO tenants (tenant_id, name, created_at)
            VALUES (%s, %s, %s)
            """,
            (tenant_id, (full_name or email or "Personal Workspace"), created_at),
        )
        execute_update(
            """
            INSERT INTO tenant_memberships (tenant_id, user_id, role, created_at)
            VALUES (%s, %s, %s, %s)
            """,
            (tenant_id, user_id, "owner", created_at),
        )
    except Exception:
        # Optional tables in SQLite fallback; keep user creation resilient.
        pass
    return get_user_by_id(user_id)

def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    """Fetch a user from the database by user_id."""
    query = "SELECT * FROM users WHERE user_id = %s"
    results = execute_query(query, (user_id,))
    return results[0] if results else None

def update_user(user_id: str, email: Optional[str] = None, full_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Update user details in the database."""
    set_clauses = []
    params = []
    
    if email:
        set_clauses.append("email = %s")
        params.append(email)
    
    if full_name:
        set_clauses.append("full_name = %s")
        params.append(full_name)
        
    if not set_clauses:
        return get_user_by_id(user_id)
        
    query = f"UPDATE users SET {', '.join(set_clauses)} WHERE user_id = %s"
    params.append(user_id)
    
    # Try with RETURNING first
    try:
        query_returning = query + " RETURNING user_id, tenant_id, email, full_name, created_at"
        results = execute_query(query_returning, tuple(params), commit=True)
        return results[0]
    except Exception:
        execute_update(query, tuple(params))
        return get_user_by_id(user_id)

def init_user_db():
    """Initialize the users table if it doesn't exist."""
    # Detect if we are using SQLite (hacky check but works for this context)
    is_sqlite = "sqlite" in str(execute_query.__module__)
    
    id_type = "TEXT" if is_sqlite else "UUID"
    timestamp_type = "TIMESTAMP" if is_sqlite else "TIMESTAMP WITH TIME ZONE"
    
    # Split statements for SQLite compatibility (python driver generally doesn't support multiple statements in execute)
    statements = [
        f"""
        CREATE TABLE IF NOT EXISTS users (
            user_id {id_type} PRIMARY KEY,
            tenant_id {id_type} NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            full_name VARCHAR(255),
            created_at {timestamp_type} DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE,
            is_admin BOOLEAN DEFAULT FALSE
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);",
        "CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);"
    ]
    
    for stmt in statements:
        if stmt.strip():
            execute_update(stmt)
            
    logger.info("Users table initialized successfully")
