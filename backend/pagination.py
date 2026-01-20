"""
Pagination utilities for consistent pagination across API endpoints.
"""
from typing import Optional
from fastapi import Query
from pydantic import BaseModel

from config import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE


class PaginationParams(BaseModel):
    """Standard pagination parameters."""
    limit: int
    offset: int
    
    @classmethod
    def from_query(
        cls,
        limit: Optional[int] = Query(None, ge=1, le=MAX_PAGE_SIZE, description=f"Number of items per page (max {MAX_PAGE_SIZE})"),
        offset: Optional[int] = Query(0, ge=0, description="Number of items to skip"),
    ) -> "PaginationParams":
        """
        Create pagination params from FastAPI query parameters.
        
        Args:
            limit: Items per page (defaults to DEFAULT_PAGE_SIZE, max MAX_PAGE_SIZE)
            offset: Items to skip (defaults to 0)
        
        Returns:
            PaginationParams instance
        """
        return cls(
            limit=limit or DEFAULT_PAGE_SIZE,
            offset=offset or 0,
        )


class PaginatedResponse(BaseModel):
    """Standard paginated response wrapper."""
    items: list
    total: Optional[int] = None
    limit: int
    offset: int
    has_more: Optional[bool] = None
    
    @classmethod
    def create(
        cls,
        items: list,
        limit: int,
        offset: int,
        total: Optional[int] = None,
    ) -> "PaginatedResponse":
        """
        Create a paginated response.
        
        Args:
            items: List of items for this page
            limit: Items per page
            offset: Items skipped
            total: Total number of items (optional, used to compute has_more)
        
        Returns:
            PaginatedResponse instance
        """
        has_more = None
        if total is not None:
            has_more = (offset + len(items)) < total
        
        return cls(
            items=items,
            total=total,
            limit=limit,
            offset=offset,
            has_more=has_more,
        )

