"""
Conversation summaries and learning topics for long-term memory.
"""
import time
from typing import List

from neo4j import Session

from models import ConversationSummary, LearningTopic


def store_conversation_summary(
    session: Session,
    summary: ConversationSummary,
    *,
    user_id: str = "default",
    tenant_id: str = "default",
) -> ConversationSummary:
    """
    Store a conversation summary in Neo4j for long-term memory.
    """
    query = """
    MERGE (cs:ConversationSummary {id: $id})
    SET cs.timestamp = $timestamp,
        cs.question = $question,
        cs.answer = $answer,
        cs.topics = $topics,
        cs.summary = $summary,
        cs.user_id = $user_id,
        cs.tenant_id = $tenant_id
    RETURN cs
    """
    rec = session.run(query, **summary.dict(), user_id=user_id, tenant_id=tenant_id).single()
    cs = rec["cs"]
    return ConversationSummary(
        id=cs.get("id"),
        timestamp=cs.get("timestamp"),
        question=cs.get("question"),
        answer=cs.get("answer"),
        topics=cs.get("topics", []),
        summary=cs.get("summary", ""),
    )


def get_recent_conversation_summaries(
    session: Session,
    limit: int = 10,
    *,
    user_id: str = "default",
    tenant_id: str = "default",
) -> List[ConversationSummary]:
    """
    Get recent conversation summaries for context.
    """
    query = """
    MATCH (cs:ConversationSummary)
    WHERE (
      cs.user_id = $user_id
      AND (cs.tenant_id = $tenant_id OR cs.tenant_id IS NULL)
    ) OR (
      cs.user_id IS NULL
      AND cs.tenant_id IS NULL
      AND ($user_id = 'default' OR $user_id STARTS WITH 'dev-')
    )
    RETURN cs
    ORDER BY cs.timestamp DESC
    LIMIT $limit
    """
    results = session.run(query, limit=limit, user_id=user_id, tenant_id=tenant_id)
    summaries = []
    for rec in results:
        cs = rec["cs"]
        summaries.append(ConversationSummary(
            id=cs.get("id"),
            timestamp=cs.get("timestamp"),
            question=cs.get("question"),
            answer=cs.get("answer"),
            topics=cs.get("topics", []),
            summary=cs.get("summary", ""),
        ))
    return summaries


def upsert_learning_topic(session: Session, topic: LearningTopic) -> LearningTopic:
    """
    Create or update a learning topic. If topic exists, increment mention count and update last_mentioned.
    """
    query = """
    MERGE (lt:LearningTopic {id: $id})
    ON CREATE SET lt.name = $name,
                  lt.first_mentioned = $first_mentioned,
                  lt.last_mentioned = $last_mentioned,
                  lt.mention_count = 1,
                  lt.related_topics = $related_topics,
                  lt.notes = $notes
    ON MATCH SET lt.last_mentioned = $last_mentioned,
                 lt.mention_count = lt.mention_count + 1,
                 lt.related_topics = CASE
                     WHEN $related_topics IS NOT NULL AND size($related_topics) > 0
                     THEN $related_topics
                     ELSE lt.related_topics
                 END,
                 lt.notes = CASE
                     WHEN $notes IS NOT NULL AND $notes <> ''
                     THEN $notes
                     ELSE lt.notes
                 END
    RETURN lt
    """
    rec = session.run(query, **topic.dict()).single()
    lt = rec["lt"]
    return LearningTopic(
        id=lt.get("id"),
        name=lt.get("name"),
        first_mentioned=lt.get("first_mentioned"),
        last_mentioned=lt.get("last_mentioned"),
        mention_count=lt.get("mention_count", 1),
        related_topics=lt.get("related_topics", []),
        notes=lt.get("notes", ""),
    )


def get_active_learning_topics(session: Session, limit: int = 20) -> List[LearningTopic]:
    """
    Get active learning topics (recently mentioned).
    """
    thirty_days_ago = int(time.time()) - (30 * 24 * 60 * 60)
    query = """
    MATCH (lt:LearningTopic)
    WHERE lt.last_mentioned >= $thirty_days_ago
    RETURN lt
    ORDER BY lt.last_mentioned DESC, lt.mention_count DESC
    LIMIT $limit
    """
    results = session.run(query, thirty_days_ago=thirty_days_ago, limit=limit)
    topics = []
    for rec in results:
        lt = rec["lt"]
        topics.append(LearningTopic(
            id=lt.get("id"),
            name=lt.get("name"),
            first_mentioned=lt.get("first_mentioned"),
            last_mentioned=lt.get("last_mentioned"),
            mention_count=lt.get("mention_count", 1),
            related_topics=lt.get("related_topics", []),
            notes=lt.get("notes", ""),
        ))
    return topics
