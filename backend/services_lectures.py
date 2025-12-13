from typing import List, Optional
from uuid import uuid4
from neo4j import Session

from models import Lecture, LectureCreate, LectureStepCreate, LectureStep, Concept


def create_lecture(session: Session, payload: LectureCreate) -> Lecture:
    """
    Create a Lecture node with a generated lecture_id (e.g., 'LABC12345').
    """
    lecture_id = f"L{uuid4().hex[:8].upper()}"

    query = """
    CREATE (l:Lecture {
        lecture_id: $lecture_id,
        title: $title,
        description: $description,
        primary_concept: $primary_concept,
        level: $level,
        estimated_time: $estimated_time,
        slug: $slug
    })
    RETURN l.lecture_id AS lecture_id,
           l.title AS title,
           l.description AS description,
           l.primary_concept AS primary_concept,
           l.level AS level,
           l.estimated_time AS estimated_time,
           l.slug AS slug
    """

    params = {
        "lecture_id": lecture_id,
        "title": payload.title,
        "description": payload.description,
        "primary_concept": payload.primary_concept,
        "level": payload.level,
        "estimated_time": payload.estimated_time,
        "slug": payload.slug,
    }

    record = session.run(query, **params).single()
    return Lecture(**record.data())


def get_lecture_by_id(session: Session, lecture_id: str) -> Optional[Lecture]:
    query = """
    MATCH (l:Lecture {lecture_id: $lecture_id})
    RETURN l.lecture_id AS lecture_id,
           l.title AS title,
           l.description AS description,
           l.primary_concept AS primary_concept,
           l.level AS level,
           l.estimated_time AS estimated_time,
           l.slug AS slug
    LIMIT 1
    """
    record = session.run(query, lecture_id=lecture_id).single()
    if not record:
        return None
    return Lecture(**record.data())


def add_lecture_step(
    session: Session,
    lecture_id: str,
    payload: LectureStepCreate,
) -> LectureStep:
    """
    Create or update a COVERS relationship between a Lecture and a Concept
    with a given step_order.
    """
    query = """
    MATCH (l:Lecture {lecture_id: $lecture_id})
    MATCH (c:Concept {node_id: $concept_id})
    MERGE (l)-[r:COVERS]->(c)
    SET r.step_order = $step_order
    RETURN l.lecture_id AS lecture_id,
           r.step_order AS step_order,
           c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug
    """

    params = {
        "lecture_id": lecture_id,
        "concept_id": payload.concept_id,
        "step_order": payload.step_order,
    }

    record = session.run(query, **params).single()
    if not record:
        # Either lecture or concept not found
        raise ValueError("Lecture or Concept not found when adding step")

    concept = Concept(
        node_id=record["node_id"],
        name=record["name"],
        domain=record["domain"],
        type=record["type"],
        notes_key=record["notes_key"],
        lecture_key=record["lecture_key"],
        url_slug=record["url_slug"],
    )

    return LectureStep(
        lecture_id=record["lecture_id"],
        step_order=record["step_order"],
        concept=concept,
    )


def get_lecture_steps(session: Session, lecture_id: str) -> List[LectureStep]:
    """
    Return all concepts covered by a lecture, ordered by step_order.
    """
    query = """
    MATCH (l:Lecture {lecture_id: $lecture_id})-[r:COVERS]->(c:Concept)
    RETURN l.lecture_id AS lecture_id,
           r.step_order AS step_order,
           c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug
    ORDER BY r.step_order ASC
    """

    result = session.run(query, lecture_id=lecture_id)
    steps: List[LectureStep] = []

    for record in result:
        concept = Concept(
            node_id=record["node_id"],
            name=record["name"],
            domain=record["domain"],
            type=record["type"],
            notes_key=record["notes_key"],
            lecture_key=record["lecture_key"],
            url_slug=record["url_slug"],
        )
        steps.append(
            LectureStep(
                lecture_id=record["lecture_id"],
                step_order=record["step_order"],
                concept=concept,
            )
        )

    return steps
