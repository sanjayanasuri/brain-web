"""
Morning digest / daily briefing endpoint.

Generates a personalized summary based on the user's interests, recent activity,
learning topics, and optionally live data (news, stocks).
"""
import logging
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import require_auth
from db_neo4j import get_neo4j_session
from services_branch_explorer import get_active_graph_context, ensure_graph_scoping_initialized

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/briefing", tags=["briefing"])


class BriefingSection(BaseModel):
    title: str
    icon: str
    items: List[dict]


class DailyBriefing(BaseModel):
    greeting: str
    generated_at: str
    sections: List[BriefingSection]


@router.get("/daily", response_model=DailyBriefing)
def get_daily_briefing(
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
    include_news: bool = Query(True),
    include_stocks: bool = Query(False),
):
    """
    Generate a personalized daily briefing for the user.

    Includes:
    - Study progress summary
    - Concepts to review (spaced repetition candidates)
    - Recent activity recap
    - Optionally: news and stock updates based on interests
    """
    user_id = auth.get("user_id", "")
    tenant_id = auth.get("tenant_id", "")

    try:
        ensure_graph_scoping_initialized(session)
        graph_id, branch_id = get_active_graph_context(session)
    except Exception:
        graph_id = "default"
        branch_id = "main"

    sections: List[BriefingSection] = []

    # 1. Study progress
    try:
        result = session.run("""
            MATCH (c:Concept)
            WHERE c.graph_id = $graph_id
            AND ($branch_id IN c.on_branches OR c.on_branches IS NULL)
            RETURN count(c) AS total_concepts,
                   avg(COALESCE(c.mastery_level, 0)) AS avg_mastery
        """, graph_id=graph_id, branch_id=branch_id)
        record = result.single()
        total = record["total_concepts"] if record else 0
        avg_mastery = round((record["avg_mastery"] or 0) * 100)

        sections.append(BriefingSection(
            title="Study Progress",
            icon="📊",
            items=[{
                "label": f"{total} topics in your study map",
                "detail": f"Average mastery: {avg_mastery}%",
                "type": "stat",
            }]
        ))
    except Exception as e:
        logger.warning(f"Failed to get study progress: {e}")

    # 2. Concepts to review (lowest mastery, recently added)
    try:
        result = session.run("""
            MATCH (c:Concept)
            WHERE c.graph_id = $graph_id
            AND ($branch_id IN c.on_branches OR c.on_branches IS NULL)
            AND COALESCE(c.mastery_level, 0) < 3
            RETURN c.name AS name, c.node_id AS node_id,
                   COALESCE(c.mastery_level, 0) AS mastery, c.domain AS domain
            ORDER BY c.mastery_level ASC
            LIMIT 5
        """, graph_id=graph_id, branch_id=branch_id)

        review_items = []
        for record in result:
            review_items.append({
                "label": record["name"],
                "detail": f"Mastery: {record['mastery']}/5 · {record['domain'] or 'General'}",
                "concept_id": record["node_id"],
                "type": "review",
            })

        if review_items:
            sections.append(BriefingSection(
                title="Topics to Review",
                icon="🔄",
                items=review_items
            ))
    except Exception as e:
        logger.warning(f"Failed to get review topics: {e}")

    # 3. Recent concepts added
    try:
        result = session.run("""
            MATCH (c:Concept)
            WHERE c.graph_id = $graph_id
            AND ($branch_id IN c.on_branches OR c.on_branches IS NULL)
            RETURN c.name AS name, c.domain AS domain
            ORDER BY c.created_at DESC
            LIMIT 3
        """, graph_id=graph_id, branch_id=branch_id)

        recent_items = [{
            "label": r["name"],
            "detail": r["domain"] or "General",
            "type": "recent",
        } for r in result]

        if recent_items:
            sections.append(BriefingSection(
                title="Recently Added",
                icon="✨",
                items=recent_items
            ))
    except Exception as e:
        logger.warning(f"Failed to get recent concepts: {e}")

    # 4. News (if enabled, use web search)
    if include_news:
        try:
            from services_web_search import discover_news
            news_items = discover_news(limit=3)
            if news_items:
                sections.append(BriefingSection(
                    title="News & Updates",
                    icon="📰",
                    items=[{
                        "label": item.get("title", ""),
                        "detail": item.get("snippet", ""),
                        "url": item.get("url", ""),
                        "type": "news",
                    } for item in news_items[:3]]
                ))
        except Exception as e:
            logger.debug(f"News fetch skipped: {e}")

    # 5. Stocks (if enabled)
    if include_stocks:
        try:
            from services_web_search import get_stock_quote
            import asyncio
            for symbol in ["AAPL", "GOOGL", "MSFT"]:
                try:
                    quote = asyncio.get_event_loop().run_until_complete(get_stock_quote(symbol))
                    if quote:
                        sections.append(BriefingSection(
                            title="Market Watch",
                            icon="📈",
                            items=[{
                                "label": f"{symbol}: ${quote.get('price', 'N/A')}",
                                "detail": f"Change: {quote.get('change_percent', 'N/A')}%",
                                "type": "stock",
                            }]
                        ))
                        break
                except Exception:
                    continue
        except Exception as e:
            logger.debug(f"Stock fetch skipped: {e}")

    hour = datetime.now().hour
    if hour < 12:
        greeting = "Good morning! Here's your daily briefing."
    elif hour < 17:
        greeting = "Good afternoon! Here's what's happening."
    else:
        greeting = "Good evening! Here's your recap."

    return DailyBriefing(
        greeting=greeting,
        generated_at=datetime.utcnow().isoformat(),
        sections=sections,
    )
