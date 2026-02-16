from fastapi import APIRouter, HTTPException, Depends, status
import logging
from pydantic import BaseModel, EmailStr
from typing import Optional, Dict, Any
from auth import create_token
from services_user import (
    get_user_by_email, 
    verify_password, 
    get_password_hash, 
    create_user
)

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserSignup(BaseModel):
    email: EmailStr
    password: str
    full_name: str = ""

@router.post("/signup")
def signup(payload: UserSignup):
    """Create a new user account."""
    existing_user = get_user_by_email(payload.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    password_hash = get_password_hash(payload.password)
    user = create_user(payload.email, password_hash, payload.full_name)
    
    # Generate token immediately after signup
    token = create_token(user["user_id"], user["tenant_id"])
    
    logger.info(f"User signed up: {payload.email} (user_id: {user['user_id']})")
    
    return {
        "status": "ok",
        "user_id": user["user_id"],
        "tenant_id": user["tenant_id"],
        "access_token": token,
        "token_type": "bearer"
    }

@router.post("/login")
def login(payload: UserLogin):
    """Authenticate a user and return a token."""
    user = get_user_by_email(payload.email)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = create_token(user["user_id"], user["tenant_id"])
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "user_id": user["user_id"],
            "tenant_id": user["tenant_id"],
            "email": user["email"],
            "full_name": user["full_name"]
        }
    }

@router.get("/me")
def get_me(current_user: dict = Depends(get_user_by_email)):
    """Get current user's profile."""
    # This is a placeholder, verify_token already provides the payload
    # In a full system, this would fetch the latest user data from DB
    return current_user
