"""
Concepts API - nodes and relationships in the knowledge graph.

Read and write endpoints are split into api_concepts_read and api_concepts_write;
this module mounts both under /concepts so the URL surface is unchanged.
"""
from fastapi import APIRouter

from api_concepts_read import router as router_read
from api_concepts_write import router as router_write

router = APIRouter(prefix="/concepts", tags=["concepts"])
router.include_router(router_read)
router.include_router(router_write)
