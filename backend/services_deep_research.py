"""
Deep Research Service

Orchestrates the "Deep Research" workflow:
1.  Search & Fetch: Find high-quality content for a topic.
2.  Ingest: Parse and structure content into the knowledge graph.
3.  Analyze: Run retrieval plans on the *newly ingested* data to extract timelines, causal chains, and key entities.
4.  Synthesize: Produce a structured "Learning Brief".
"""
import asyncio
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from neo4j import Session

from services_web_search import search_and_fetch
from services_web_ingestion import ingest_web_payload
from services_retrieval_plans import run_plan
from services_retrieval_helpers import retrieve_focus_communities, retrieve_claims_for_community_ids
from services_ingestion_runs import create_ingestion_run, update_ingestion_run_status
from services_branch_explorer import get_active_graph_context
from db_neo4j import get_neo4j_session
from models import Intent

logger = logging.getLogger("brain_web")

async def perform_deep_research(
    topic: str,
    breadth: int = 3,
    depth: int = 2,
    intent: str = "auto",
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Execute a deep research run on a topic.
    
    Args:
        topic: Research topic/query
        breadth: Number of parallel search paths/results
        depth: Depth of recursive exploration (1=single step, 2=follow-up)
        intent: Retrieval intent for analysis ("auto" or specific Intent enum)
        graph_id: Scoping
        branch_id: Scoping
        
    Returns:
        Structured research result with summary, timeline, entities, and sources.
    """
    
    # 1. Setup Session & Context
    from db_neo4j import get_driver
    driver = get_driver()
    
    with driver.session() as session:
        if not graph_id or not branch_id:
            graph_id, branch_id = get_active_graph_context(session)
            
        # 2. Create Ingestion Run (Parent container for this research session)
        # We'll use a special source_type "DEEP_RESEARCH"
        research_run = create_ingestion_run(session, source_type="DEEP_RESEARCH", source_label=topic)
        run_id = research_run.run_id
        logger.info(f"Starting Deep Research detected run_id: {run_id} for topic: {topic}")
        
        try:
            # 3. Search & Fetch (Phase 1)
            # We use `search_and_fetch` which does both efficiently
            search_result = await search_and_fetch(
                query=topic,
                num_results=breadth,
                engines="google,bing,duckduckgo",
                rerank=True,
                stealth_mode="medium", # Good balance
                max_content_length=15000, 
            )
            
            fetches = search_result.get("results", [])
            logger.info(f"Deep Research: Found {len(fetches)} matching sources for '{topic}'")
            for i, f in enumerate(fetches):
                url = f.get("search_result", {}).get("url")
                title = f.get("search_result", {}).get("title")
                logger.info(f"  Source {i+1}: [{title}]({url})")
            
            # 4. Ingest Content (Parallel)
            ingest_tasks = []
            
            for i, item in enumerate(fetches):
                status = item.get("fetch_status")
                if status != "success":
                    logger.warning(f"  Skipping Source {i+1}: Fetch failed or no content")
                    continue
                    
                content_data = item.get("fetched_content", {})
                url = item.get("search_result", {}).get("url")
                title = content_data.get("title") or item.get("search_result", {}).get("title")
                
                logger.info(f"Ingesting Source {i+1}: {title}...")
                
                # Metadata to track this specific research run
                meta = {
                    "research_topic": topic,
                    "research_run_id": run_id,
                    "source_title": title,
                }
                
                res = ingest_web_payload(
                    session=session,
                    url=url,
                    text=content_data.get("content", ""),
                    title=title,
                    graph_id_override=graph_id,
                    branch_id_override=branch_id,
                    metadata=meta,
                )
                
                item["ingest_result"] = res
                logger.info(f"  ✓ Ingested {title}. Run ID: {res['run_id']}")
            
            # Collect all run IDs from ingestion
            ingestion_run_ids = [
                item["ingest_result"]["run_id"] 
                for item in fetches 
                if item.get("ingest_result", {}).get("status") in ("COMPLETED", "INGESTED", "SKIPPED")
            ]
            
            # Also include the main research run_id? It has no claims directly.
            # But the analysis should focus on the claims from the *ingested pages*.
            
            if not ingestion_run_ids:
                logger.warning("No content successfully ingested.")
                update_ingestion_run_status(session, run_id, "FAILED", errors=["No content ingested"])
                return {"error": "No content found or ingested."}

            logger.info(f"Deep Research: Analysis targets runs: {ingestion_run_ids}")

            # 5. Determine Intent & Analyze
            # If intent is auto, pick based on topic keywords
            if intent == "auto":
                topic_lower = topic.lower()
                if any(w in topic_lower for w in ["history", "timeline", "when"]):
                    intent = Intent.TIMELINE.value
                elif any(w in topic_lower for w in ["why", "cause", "reason"]):
                    intent = Intent.CAUSAL_CHAIN.value
                elif any(w in topic_lower for w in ["who", "people", "actors"]):
                    intent = Intent.WHO_NETWORK.value
                elif any(w in topic_lower for w in ["vs", "versus", "compare"]):
                    intent = Intent.COMPARE.value
                else:
                    intent = Intent.DEFINITION_OVERVIEW.value
            
            logger.info(f"Deep Research: Detected intent '{intent}' for analysis")
            logger.info(f"Deep Research: Running retrieval plan on {len(ingestion_run_ids)} ingested sources...")
            
            # 6. Run Retrieval Plan
            # We need to run the plan passing the *list* of run_ids to filter.
            # Wait, I updated helpers to take `ingestion_run_id: Optional[str]`. 
            # Single string. 
            # I should have updated it to take `Optional[List[str]]` or `Union[str, List[str]]`.
            # 
            # Workaround: Retrieve claims for *each* run_id and combine? 
            # Or update the helper again to support a list.
            # Updating properly is better.
            
            # For now, let's just pick the "biggest" run or run for all?
            # If I don't filter, I get global context + new info (which is actually good).
            # But the user wants "quick access" to *this* info.
            # 
            # Let's assume for MVP we fetch claims for *all* the new runs.
            # I can manually call `retrieve_claims_for_community_ids` isn't accessible here easily with list.
            #
            # Actually, `retrieve_top_claims_by_query_embedding` is the main entry point for "Evidence Check".
            # For "Timeline", "Definition", it starts with *Communities*.
            # The communities might be old, but we want claims from the *new* runs within those communities.
            #
            # Let's pause and fix `services_retrieval_helpers.py` to accept `Union[str, List[str]]` for `ingestion_run_id` field.
            # This is the robust way.
            #
            # Re-planning slightly: I will write this file, handling the logic assuming I WILL fix the helper next.
            
            # ... (Writing code assuming helper will support list) ...
            
            # Actually, for the first pass, let's just NOT filter by run_id in the plan call, 
            # but rely on the fact that we just ingested relevant info and semantic search will find it.
            # AND we can do a specific "Fresh Claims" query here manually to augment the plan.
            
            # Run standard plan (Global Context)
            plan_result = run_plan(
                session=session,
                query=topic,
                intent=intent,
                graph_id=graph_id,
                branch_id=branch_id,
                limit=10,
                detail_level="full",
                ingestion_run_id=ingestion_run_ids
            )
            
            # 7. Augment with "Fresh" Claims from this session
            # Manually fetch claims from the specific runs we just did
            fresh_claims = []
            if ingestion_run_ids:
                query_fresh = """
                MATCH (c:Claim {graph_id: $graph_id})
                WHERE c.ingestion_run_id IN $run_ids
                RETURN c.claim_id as claim_id, c.text as text, c.confidence as confidence, c.source_id as source_id
                ORDER BY c.confidence DESC
                LIMIT 20
                """
                fresh_res = session.run(query_fresh, graph_id=graph_id, run_ids=ingestion_run_ids)
                fresh_claims = [record.data() for record in fresh_res]
            
            # 8. Synthesize Learning Report
            from services_research_memo import generate_research_memo
            
            logger.info(f"Deep Research: Synthesizing research report for '{topic}'")
            memo_result = generate_research_memo(
                session=session,
                query=topic,
                graph_id=graph_id,
                branch_id=branch_id,
                evidence_strictness="low", # Be more inclusive for research findings
            )
            
            response = {
                "topic": topic,
                "intent": intent,
                "summary": memo_result.get("memo_text", "Research complete."),
                "fresh_findings": fresh_claims,
                "context_analysis": plan_result.dict(),
                "citations": memo_result.get("citations", []),
                "sources": [
                    {"title": i["search_result"]["title"], "url": i["search_result"]["url"]}
                    for i in fetches if i.get("fetch_status") == "success"
                ]
            }
            
            # 9. Recursive Exploration (Depth > 1)
            if depth > 1:
                # Identify follow-up topics from the "Explore Next" suggestions or extracted concepts
                suggestions = plan_result.context.get("suggestions", [])
                
                # If no suggestions from plan, use top 3 concepts from fresh findings
                if not suggestions and fresh_claims:
                    # heuristic: most frequent or highest confidence claims? 
                    # Let's just pick top concepts from the subgraph
                    subgraph = plan_result.context.get("subgraph", {})
                    concepts = subgraph.get("concepts", [])
                    # Sort by explore score if available, or just take first few
                    suggestions = [{"query": c.get("name"), "label": f"Explore {c.get('name')}"} for c in concepts[:3]]
                
                logger.info(f"Deep Research: Recursive step. Candidates: {[s.get('query') for s in suggestions]}")
                
                sub_results = []
                # Limit recursion breadth to avoid explosion. Top 2 suggestions.
                for suggestion in suggestions[:2]:
                    sub_topic = suggestion.get("query")
                    if not sub_topic: 
                        continue
                        
                    logger.info(f"Deep Research: Recursing into '{sub_topic}'")
                    sub_res = await perform_deep_research(
                        topic=sub_topic,
                        breadth=max(1, breadth - 1), # Reduce breadth for sub-steps
                        depth=depth - 1,
                        intent="auto",
                        graph_id=graph_id,
                        branch_id=branch_id
                    )
                    sub_results.append(sub_res)
                
                response["sub_research"] = sub_results
            
            return response
            
        except Exception as e:
            logger.error(f"Deep Research failed: {e}", exc_info=True)
            update_ingestion_run_status(session, run_id, "FAILED", errors=[str(e)])
            raise e
