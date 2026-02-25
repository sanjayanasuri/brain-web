"""
Response style profile, answer records, style feedback, revisions, explanation feedback.
"""
import json
from datetime import datetime
from typing import List, Optional, Dict, Any

from neo4j import Session

from models import (
    ResponseStyleProfile,
    ResponseStyleProfileWrapper,
    ExplanationFeedback,
    FeedbackSummary,
    AnswerRecord,
    Revision,
)


def get_response_style_profile(session: Session) -> ResponseStyleProfileWrapper:
    """
    Fetch the current response style profile from Neo4j.
    If none exists, return a sensible default.
    This profile shapes how Brain Web answers questions.
    """
    query = """
    MERGE (m:Meta {key: 'response_style_profile'})
    ON CREATE SET m.value = $default_value
    RETURN m.value AS value
    """
    default = {
        "tone": "intuitive, grounded, exploratory, conversational but technical",
        "teaching_style": "analogy-first, zoom-out then zoom-in, highlight big picture first",
        "sentence_structure": "short, minimal filler, no dramatic flourishes",
        "explanation_order": [
            "big picture",
            "core concept definition",
            "example/analogy",
            "connection to adjacent concepts",
            "common pitfalls",
            "summary"
        ],
        "forbidden_styles": ["overly formal", "glib", "generic", "high-level nothingness", "GPT-polish"],
    }
    # Serialize default to JSON string for Neo4j storage
    default_json = json.dumps(default)
    record = session.run(query, default_value=default_json).single()
    if record and record["value"]:
        # Deserialize JSON string back to dict
        value = record["value"]
        if isinstance(value, str):
            profile_dict = json.loads(value)
        else:
            profile_dict = value
        profile = ResponseStyleProfile(**profile_dict)
    else:
        profile = ResponseStyleProfile(**default)
    return ResponseStyleProfileWrapper(id="default", profile=profile)


def update_response_style_profile(session: Session, wrapper: ResponseStyleProfileWrapper) -> ResponseStyleProfileWrapper:
    """
    Update the response style profile in Neo4j.
    """
    query = """
    MERGE (m:Meta {key: 'response_style_profile'})
    SET m.value = $value
    RETURN m.value AS value
    """
    # Serialize to JSON string for Neo4j storage
    value_json = json.dumps(wrapper.profile.dict())
    record = session.run(query, value=value_json).single()
    # Deserialize JSON string back to dict
    value = record["value"]
    if isinstance(value, str):
        profile_dict = json.loads(value)
    else:
        profile_dict = value
    profile = ResponseStyleProfile(**profile_dict)
    return ResponseStyleProfileWrapper(id=wrapper.id, profile=profile)


def store_answer(session: Session, answer: AnswerRecord) -> None:
    """
    Store an answer record in Neo4j.
    """
    query = """
    CREATE (a:AnswerRecord {
        answer_id: $answer_id,
        question: $question,
        raw_answer: $raw_answer,
        used_node_ids: $used_node_ids,
        created_at: $created_at
    })
    """
    answer_dict = answer.dict()
    if isinstance(answer_dict.get('created_at'), datetime):
        answer_dict['created_at'] = answer_dict['created_at'].isoformat()
    session.run(query, **answer_dict)


def store_style_feedback(session: Session, fb) -> str:
    """
    Store structured style feedback for learning user preferences.
    Returns the feedback_id.
    """
    import uuid

    feedback_id = f"style_fb_{uuid.uuid4().hex[:12]}"
    query = """
    CREATE (sf:StyleFeedback {
        feedback_id: $feedback_id,
        answer_id: $answer_id,
        question: $question,
        original_response: $original_response,
        feedback_notes: $feedback_notes,
        user_rewritten_version: $user_rewritten_version,
        test_label: $test_label,
        verbosity: $verbosity,
        question_preference: $question_preference,
        humor_preference: $humor_preference,
        created_at: $created_at
    })
    RETURN sf.feedback_id AS feedback_id
    """

    fb_dict = fb.dict()
    if isinstance(fb_dict.get('created_at'), datetime):
        fb_dict['created_at'] = fb_dict['created_at'].isoformat()

    fb_dict['feedback_id'] = feedback_id
    result = session.run(query, **fb_dict).single()
    if result:
        return result["feedback_id"]
    return feedback_id


def get_style_feedback_examples(session: Session, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Get recent style feedback examples for display and analysis.
    """
    query = """
    MATCH (sf:StyleFeedback)
    WITH sf
    ORDER BY sf.created_at DESC
    LIMIT $limit
    RETURN sf.feedback_id AS feedback_id,
           sf.answer_id AS answer_id,
           sf.question AS question,
           sf.original_response AS original_response,
           sf.feedback_notes AS feedback_notes,
           sf.user_rewritten_version AS user_rewritten_version,
           sf.test_label AS test_label,
           sf.verbosity AS verbosity,
           sf.question_preference AS question_preference,
           sf.humor_preference AS humor_preference,
           sf.created_at AS created_at
    """
    records = session.run(query, limit=limit)
    results = []
    for rec in records:
        results.append({
            "feedback_id": rec["feedback_id"],
            "answer_id": rec["answer_id"],
            "question": rec["question"],
            "original_response": rec["original_response"],
            "feedback_notes": rec["feedback_notes"],
            "user_rewritten_version": rec.get("user_rewritten_version"),
            "test_label": rec.get("test_label"),
            "verbosity": rec.get("verbosity"),
            "question_preference": rec.get("question_preference"),
            "humor_preference": rec.get("humor_preference"),
            "created_at": rec["created_at"],
        })
    return results


def store_revision(session: Session, revision: Revision) -> None:
    """
    Store a user-rewritten answer as a Revision node linked to the AnswerRecord.
    """
    query = """
    MATCH (a:AnswerRecord {answer_id: $answer_id})
    CREATE (r:Revision {
        answer_id: $answer_id,
        user_rewritten_answer: $user_rewritten_answer,
        created_at: $created_at
    })
    CREATE (a)-[:HAS_REVISION]->(r)
    """
    revision_dict = revision.dict()
    if isinstance(revision_dict.get('created_at'), datetime):
        revision_dict['created_at'] = revision_dict['created_at'].isoformat()
    session.run(query, **revision_dict)


def get_recent_answers(session: Session, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Get recent answers with feedback and revision flags.
    """
    query = """
    MATCH (a:AnswerRecord)
    OPTIONAL MATCH (a)-[:HAS_REVISION]->(r:Revision)
    OPTIONAL MATCH (f:Feedback {answer_id: a.answer_id})
    WITH a,
         COUNT(DISTINCT r) > 0 AS has_revision,
         COUNT(DISTINCT f) > 0 AS has_feedback
    ORDER BY a.created_at DESC
    LIMIT $limit
    RETURN a.answer_id AS answer_id,
           a.question AS question,
           a.raw_answer AS raw_answer,
           a.created_at AS created_at,
           has_feedback,
           has_revision
    """
    records = session.run(query, limit=limit)
    results = []
    for rec in records:
        results.append({
            "answer_id": rec["answer_id"],
            "question": rec["question"],
            "raw_answer": rec["raw_answer"],
            "created_at": rec["created_at"],
            "has_feedback": rec["has_feedback"],
            "has_revision": rec["has_revision"],
        })
    return results


def get_answer_detail(session: Session, answer_id: str) -> Optional[Dict[str, Any]]:
    """
    Get full answer details including feedback and revisions.
    """
    query = """
    MATCH (a:AnswerRecord {answer_id: $answer_id})
    OPTIONAL MATCH (f:Feedback {answer_id: $answer_id})
    OPTIONAL MATCH (a)-[:HAS_REVISION]->(r:Revision)
    RETURN a,
           collect(DISTINCT {rating: f.rating, reason: f.reasoning, created_at: f.created_at}) AS feedback,
           collect(DISTINCT {user_rewritten_answer: r.user_rewritten_answer, created_at: r.created_at}) AS revisions
    """
    record = session.run(query, answer_id=answer_id).single()
    if not record:
        return None

    a = record["a"]
    feedback = [f for f in record["feedback"] if f.get("rating") is not None]
    revisions = [r for r in record["revisions"] if r.get("user_rewritten_answer")]

    return {
        "answer": {
            "answer_id": a.get("answer_id"),
            "question": a.get("question"),
            "raw_answer": a.get("raw_answer"),
            "used_node_ids": a.get("used_node_ids", []),
            "created_at": a.get("created_at"),
        },
        "feedback": feedback,
        "revisions": revisions,
    }


def get_example_answers(session: Session, limit: int = 5) -> List[Dict[str, Any]]:
    """
    Get recent user-rewritten answers to use as style examples.
    Returns answers with their revisions for style guidance.
    """
    query = """
    MATCH (a:AnswerRecord)-[:HAS_REVISION]->(r:Revision)
    WITH a, r
    ORDER BY r.created_at DESC
    LIMIT $limit
    RETURN a.question AS question,
           r.user_rewritten_answer AS answer,
           a.answer_id AS answer_id
    """
    records = session.run(query, limit=limit)
    results = []
    for rec in records:
        results.append({
            "question": rec["question"],
            "answer": rec["answer"],
            "answer_id": rec["answer_id"],
        })
    return results


def store_feedback(session: Session, fb: ExplanationFeedback) -> None:
    """
    Store feedback as a node in Neo4j.
    Feedback is used to improve future responses through feedback loops.
    """
    query = """
    CREATE (f:Feedback {
        answer_id: $answer_id,
        question: $question,
        rating: $rating,
        reasoning: $reasoning,
        verbosity: $verbosity,
        question_preference: $question_preference,
        humor_preference: $humor_preference,
        created_at: $created_at
    })
    """
    # Convert datetime to ISO format string for Neo4j storage
    fb_dict = fb.dict()
    if isinstance(fb_dict.get('created_at'), datetime):
        fb_dict['created_at'] = fb_dict['created_at'].isoformat()
    session.run(query, **fb_dict)


def get_recent_feedback_summary(session: Session, limit: int = 50) -> FeedbackSummary:
    """
    Aggregate recent feedback to guide future responses.
    Returns a summary of positive/negative feedback and common reasons.
    """
    query = """
    MATCH (f:Feedback)
    WITH f
    ORDER BY f.created_at DESC
    LIMIT $limit
    RETURN collect(f) AS feedback
    """
    record = session.run(query, limit=limit).single()
    feedback_nodes = record["feedback"] if record and record["feedback"] else []

    total = len(feedback_nodes)
    positive = sum(1 for f in feedback_nodes if f.get("rating", 0) > 0)
    negative = sum(1 for f in feedback_nodes if f.get("rating", 0) < 0)
    reasons: Dict[str, int] = {}
    for f in feedback_nodes:
        reason = f.get("reasoning") or "unspecified"
        reasons[reason] = reasons.get(reason, 0) + 1

    return FeedbackSummary(
        total=total,
        positive=positive,
        negative=negative,
        common_reasons=reasons,
    )
