from typing import List, Optional
from uuid import uuid4

from neo4j import Session

from models import LectureBlock, LectureBlockUpsert
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context


def _normalize_block_id(block_id: Optional[str]) -> str:
    if block_id:
        return block_id
    return f"BLK_{uuid4().hex[:10]}"


def upsert_lecture_blocks(
    session: Session,
    lecture_id: str,
    blocks: List[LectureBlockUpsert],
) -> List[LectureBlock]:
    """
    Upsert lecture blocks with stable block_ids.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    saved: List[LectureBlock] = []

    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (l:Lecture {lecture_id: $lecture_id})
    MERGE (b:LectureBlock {block_id: $block_id})
      ON CREATE SET b.graph_id = $graph_id,
                    b.lecture_id = $lecture_id,
                    b.on_branches = [$branch_id],
                    b.created_at = datetime()
    SET b.block_index = $block_index,
        b.block_type = $block_type,
        b.text = $text,
        b.updated_at = datetime(),
        b.on_branches = CASE
          WHEN b.on_branches IS NULL THEN [$branch_id]
          WHEN $branch_id IN b.on_branches THEN b.on_branches
          ELSE b.on_branches + $branch_id
        END
    MERGE (b)-[:BELONGS_TO]->(g)
    MERGE (l)-[:HAS_BLOCK]->(b)
    RETURN b.block_id AS block_id,
           b.lecture_id AS lecture_id,
           b.block_index AS block_index,
           b.block_type AS block_type,
           b.text AS text
    """

    for block in blocks:
        block_id = _normalize_block_id(block.block_id)
        record = session.run(
            query,
            graph_id=graph_id,
            branch_id=branch_id,
            lecture_id=lecture_id,
            block_id=block_id,
            block_index=block.block_index,
            block_type=block.block_type,
            text=block.text,
        ).single()
        if record:
            saved.append(LectureBlock(**record.data()))

    return saved


def list_lecture_blocks(session: Session, lecture_id: str) -> List[LectureBlock]:
    """
    List blocks for a lecture, ordered by block_index.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    query = """
    MATCH (l:Lecture {lecture_id: $lecture_id})-[:HAS_BLOCK]->(b:LectureBlock)
    WHERE b.graph_id = $graph_id
      AND $branch_id IN COALESCE(b.on_branches, [])
    RETURN b.block_id AS block_id,
           b.lecture_id AS lecture_id,
           b.block_index AS block_index,
           b.block_type AS block_type,
           b.text AS text
    ORDER BY b.block_index ASC
    """
    result = session.run(
        query,
        lecture_id=lecture_id,
        graph_id=graph_id,
        branch_id=branch_id,
    )
    blocks: List[LectureBlock] = []
    for record in result:
        blocks.append(LectureBlock(**record.data()))
    return blocks
