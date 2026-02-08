import os
import logging
from passlib.context import CryptContext
from db_postgres import execute_query, execute_update
from typing import Optional, Dict, Any
import uuid
from datetime import datetime

logger = logging.getLogger("brain_web")

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against a hashed one."""
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
    # Each user gets their own tenant_id for isolation, initially same as user_id
    tenant_id = user_id 
    
    query = """
        INSERT INTO users (user_id, tenant_id, email, password_hash, full_name, created_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING user_id, tenant_id, email, full_name, created_at
    """
    params = (user_id, tenant_id, email, password_hash, full_name, datetime.utcnow())
    
    results = execute_query(query, params)
    return results[0]

def init_user_db():
    """Initialize the users table if it doesn't exist."""
    query = """
        CREATE TABLE IF NOT EXISTS users (
            user_id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            full_name VARCHAR(255),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE,
            is_admin BOOLEAN DEFAULT FALSE
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
    """
    execute_update(query)
    logger.info("Users table initialized successfully")
