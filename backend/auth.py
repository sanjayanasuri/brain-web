"""
Authentication and authorization module.

Provides:
- Token-based authentication (Bearer tokens)
- User/tenant extraction from tokens
- FastAPI dependencies for route protection
- Public endpoint exemption
"""
import os
import jwt
import hashlib
from typing import Optional, Dict, Any
from fastapi import HTTPException, Request, Security, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# Security scheme for Bearer token authentication
security = HTTPBearer(auto_error=False)

# Public endpoints that don't require authentication
PUBLIC_ENDPOINTS = {
    "/",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/health",
    "/auth",
}


def get_api_token_secret() -> str:
    """Get API token secret from environment or generate a default for dev."""
    secret = os.getenv("API_TOKEN_SECRET")
    if not secret:
        # In production, this MUST be set via environment variable
        # For dev, we'll use a default (not secure, but allows local testing)
        return "dev-secret-key-change-in-production"
    return secret


def verify_token(token: str) -> Dict[str, Any]:
    """
    Verify and decode a JWT token.
    
    Returns:
        Decoded token payload with user_id, tenant_id, etc.
    
    Raises:
        HTTPException if token is invalid
    """
    try:
        secret = get_api_token_secret()
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def create_token(user_id: str, tenant_id: str, expires_in_days: int = 30) -> str:
    """
    Create a JWT token for a user/tenant.
    
    Args:
        user_id: User identifier
        tenant_id: Tenant/organization identifier
        expires_in_days: Token expiration in days
    
    Returns:
        JWT token string
    """
    import datetime
    secret = get_api_token_secret()
    payload = {
        "user_id": user_id,
        "tenant_id": tenant_id,
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=expires_in_days),
        "iat": datetime.datetime.utcnow(),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def extract_token_from_request(request: Request) -> Optional[str]:
    """
    Extract token from request headers (Authorization: Bearer <token>).
    
    Returns:
        Token string if found, None otherwise
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        return None
    
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None


def extract_api_key_from_request(request: Request) -> Optional[str]:
    """
    Extract personal API key from request headers.

    Supported:
    - X-API-Key: <key>
    """
    api_key = request.headers.get("x-api-key") or request.headers.get("X-API-Key")
    if not api_key:
        return None
    api_key = str(api_key).strip()
    if not api_key or len(api_key) > 512:
        return None
    return api_key


def get_user_context_from_request(request: Request) -> Dict[str, Any]:
    """
    Extract user context from request (token).
    
    Returns:
        Dict with user_id, tenant_id, and is_authenticated
    """
    # 1) JWT bearer token (primary)
    token = extract_token_from_request(request)
    if token:
        try:
            payload = verify_token(token)
            return {
                "user_id": payload.get("user_id"),
                "tenant_id": payload.get("tenant_id"),
                "is_authenticated": True,
            }
        except HTTPException:
            pass

    # 2) Personal API key (clipper/mobile)
    api_key = extract_api_key_from_request(request)
    if api_key:
        try:
            from services_api_keys import verify_personal_api_key

            res = verify_personal_api_key(api_key)
            if res:
                return {
                    "user_id": res.user_id,
                    "tenant_id": res.tenant_id,
                    "is_authenticated": True,
                }
        except Exception:
            pass

    return {
        "user_id": None,
        "tenant_id": None,
        "is_authenticated": False,
    }


def require_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
    request: Request = None,
) -> Dict[str, Any]:
    """
    FastAPI dependency that requires authentication.
    
    Checks for token OR if the request was already authenticated by middleware
    (e.g., via Demo Mode elevation).
    """
    # Check if middleware already authenticated the request
    if request and hasattr(request.state, "is_authenticated") and request.state.is_authenticated:
        return {
            "user_id": getattr(request.state, "user_id", None),
            "tenant_id": getattr(request.state, "tenant_id", None),
            "is_authenticated": True,
        }
    # Check for token in Authorization header
    if credentials:
        try:
            payload = verify_token(credentials.credentials)
            return {
                "user_id": payload.get("user_id"),
                "tenant_id": payload.get("tenant_id"),
                "is_authenticated": True,
            }
        except HTTPException:
            pass
    
    # Also check request headers directly (for extension compatibility)
    if request:
        token = extract_token_from_request(request)
        if token:
            try:
                payload = verify_token(token)
                return {
                    "user_id": payload.get("user_id"),
                    "tenant_id": payload.get("tenant_id"),
                    "is_authenticated": True,
                }
            except HTTPException:
                pass
    
    raise HTTPException(status_code=401, detail="Authentication required")


def optional_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
    request: Request = None,
) -> Dict[str, Any]:
    """
    FastAPI dependency that optionally extracts auth context.
    
    Returns auth context if available, otherwise returns None values.
    Does not raise exceptions.
    """
    # Try to get auth from credentials
    if credentials:
        try:
            payload = verify_token(credentials.credentials)
            return {
                "user_id": payload.get("user_id"),
                "tenant_id": payload.get("tenant_id"),
                "is_authenticated": True,
            }
        except HTTPException:
            pass
    
    # Try request headers
    if request:
        token = extract_token_from_request(request)
        if token:
            try:
                payload = verify_token(token)
                return {
                    "user_id": payload.get("user_id"),
                    "tenant_id": payload.get("tenant_id"),
                    "is_authenticated": True,
                }
            except HTTPException:
                pass
    
    # Return unauthenticated context
    return {
        "user_id": None,
        "tenant_id": None,
        "is_authenticated": False,
    }


def is_public_endpoint(path: str) -> bool:
    """Check if an endpoint is public (doesn't require auth)."""
    # Exact match
    if path in PUBLIC_ENDPOINTS:
        return True
    
    # Check if path starts with any public prefix (excluding root '/')
    for public_path in PUBLIC_ENDPOINTS:
        if public_path != "/" and path.startswith(public_path):
            return True
    
    return False
