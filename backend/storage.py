"""
Storage abstraction layer for resource files.

Supports:
- Local filesystem storage (default, no cost)
- S3 storage (optional, for production scale)

Designed for easy migration from local to S3 when ready.
"""
import os
import uuid
from typing import Optional, Tuple, BinaryIO
from pathlib import Path
import logging

logger = logging.getLogger("brain_web")

# Storage backend configuration
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").lower()  # "local" or "s3"
S3_BUCKET = os.getenv("S3_BUCKET")
S3_REGION = os.getenv("S3_REGION", "us-east-1")
S3_PREFIX = os.getenv("S3_PREFIX", "resources")  # Prefix for all resource objects

# Local storage configuration
LOCAL_UPLOAD_DIR = os.environ.get("RESOURCE_UPLOAD_DIR", "uploaded_resources")
LOCAL_STATIC_URL_PREFIX = "/static/resources"


def _ensure_local_dir() -> Path:
    """Ensure local upload directory exists."""
    upload_path = Path(LOCAL_UPLOAD_DIR)
    upload_path.mkdir(parents=True, exist_ok=True)
    return upload_path


def save_file_local(file_content: bytes, filename: str) -> Tuple[str, str]:
    """
    Save file to local filesystem.
    
    Returns:
        (url_path, file_path) tuple
    """
    upload_path = _ensure_local_dir()
    ext = Path(filename).suffix if filename else ""
    unique_filename = f"{uuid.uuid4().hex}{ext}"
    file_path = upload_path / unique_filename
    
    with open(file_path, "wb") as f:
        f.write(file_content)
    
    url_path = f"{LOCAL_STATIC_URL_PREFIX}/{unique_filename}"
    return url_path, str(file_path)


def save_file_s3(file_content: bytes, filename: str, tenant_id: Optional[str] = None) -> Tuple[str, str]:
    """
    Save file to S3.
    
    Args:
        file_content: File bytes
        filename: Original filename (for extension)
        tenant_id: Optional tenant ID for multi-tenant isolation
    
    Returns:
        (url_path, s3_key) tuple
        url_path is a signed URL or S3 URL
    """
    try:
        import boto3
        from botocore.exceptions import ClientError
    except ImportError:
        raise RuntimeError("boto3 not installed. Install with: pip install boto3")
    
    if not S3_BUCKET:
        raise RuntimeError("S3_BUCKET not configured")
    
    s3_client = boto3.client("s3", region_name=S3_REGION)
    
    # Build S3 key with tenant isolation
    ext = Path(filename).suffix if filename else ""
    unique_filename = f"{uuid.uuid4().hex}{ext}"
    
    if tenant_id:
        s3_key = f"{S3_PREFIX}/{tenant_id}/{unique_filename}"
    else:
        s3_key = f"{S3_PREFIX}/{unique_filename}"
    
    # Upload to S3
    try:
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=file_content,
            ContentType=_guess_content_type(filename),
        )
        
        # Generate signed URL (expires in 1 year for resources)
        # In production, you might want shorter expiration and regenerate on-demand
        url_path = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_BUCKET, "Key": s3_key},
            ExpiresIn=31536000,  # 1 year
        )
        
        return url_path, s3_key
    except ClientError as e:
        logger.error(f"Failed to upload to S3: {e}")
        raise RuntimeError(f"S3 upload failed: {str(e)}")


def read_file_local(file_path: str) -> bytes:
    """Read file from local filesystem."""
    with open(file_path, "rb") as f:
        return f.read()


def read_file_s3(s3_key: str) -> bytes:
    """Read file from S3."""
    try:
        import boto3
        from botocore.exceptions import ClientError
    except ImportError:
        raise RuntimeError("boto3 not installed")
    
    if not S3_BUCKET:
        raise RuntimeError("S3_BUCKET not configured")
    
    s3_client = boto3.client("s3", region_name=S3_REGION)
    
    try:
        response = s3_client.get_object(Bucket=S3_BUCKET, Key=s3_key)
        return response["Body"].read()
    except ClientError as e:
        logger.error(f"Failed to read from S3: {e}")
        raise RuntimeError(f"S3 read failed: {str(e)}")


def _guess_content_type(filename: str) -> str:
    """Guess content type from filename."""
    import mimetypes
    mime_type, _ = mimetypes.guess_type(filename)
    return mime_type or "application/octet-stream"


def save_file(file_content: bytes, filename: str, tenant_id: Optional[str] = None) -> Tuple[str, str]:
    """
    Save file using configured storage backend.
    
    Args:
        file_content: File bytes
        filename: Original filename
        tenant_id: Optional tenant ID for multi-tenant isolation
    
    Returns:
        (url_path, storage_path) tuple
        - url_path: URL to access the file (local: /static/resources/..., S3: signed URL)
        - storage_path: Internal storage path (local: file path, S3: S3 key)
    """
    if STORAGE_BACKEND == "s3":
        return save_file_s3(file_content, filename, tenant_id=tenant_id)
    else:
        return save_file_local(file_content, filename)


def read_file(storage_path: str) -> bytes:
    """
    Read file from configured storage backend.
    
    Args:
        storage_path: Storage path returned by save_file()
    
    Returns:
        File bytes
    """
    if STORAGE_BACKEND == "s3":
        return read_file_s3(storage_path)
    else:
        return read_file_local(storage_path)


def get_file_url(storage_path: str, tenant_id: Optional[str] = None) -> str:
    """
    Get URL to access a file.
    
    For local storage, returns the static URL path.
    For S3, generates a signed URL.
    
    Args:
        storage_path: Storage path returned by save_file()
        tenant_id: Optional tenant ID (for S3 signed URL generation)
    
    Returns:
        URL string
    """
    if STORAGE_BACKEND == "s3":
        try:
            import boto3
        except ImportError:
            raise RuntimeError("boto3 not installed")
        
        if not S3_BUCKET:
            raise RuntimeError("S3_BUCKET not configured")
        
        s3_client = boto3.client("s3", region_name=S3_REGION)
        
        # Generate signed URL (expires in 1 hour for on-demand access)
        url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_BUCKET, "Key": storage_path},
            ExpiresIn=3600,  # 1 hour
        )
        return url
    else:
        # Local storage: return static URL path
        # Extract filename from storage_path
        filename = Path(storage_path).name
        return f"{LOCAL_STATIC_URL_PREFIX}/{filename}"

