import os
import requests

BROWSER_USE_API_KEY = os.environ["BROWSER_USE_API_KEY"]
BASE = "https://api.browser-use.com/api/v2"

def create_skill(goal: str, agent_prompt: str) -> str:
    r = requests.post(
        f"{BASE}/skills",
        headers={
            "X-Browser-Use-API-Key": BROWSER_USE_API_KEY,
            "Content-Type": "application/json",
        },
        json={
            "goal": goal,
            "agentPrompt": agent_prompt,
        },
        timeout=60,
    )
    r.raise_for_status()
    data = r.json()
    return data["id"]

if __name__ == "__main__":
    goal = "Mine common confusions and pitfalls about a technical concept from credible public sources."

    agent_prompt = """
You are a research assistant for a learning knowledge graph.

TASK:
Given a concept query (string), find common confusion patterns and pitfalls.
Prefer: StackOverflow, official docs, GitHub issues, and reputable engineering blogs.
Avoid: low-quality clickbait or content farms.

REQUIREMENTS:
- Return STRICT JSON (no markdown).
- Include evidence URLs for every extracted confusion/pitfall.
- Do not invent claims; if uncertain, exclude.
- Normalize confusions into short, reusable bullets.

INPUT PARAMETERS (you will receive):
- query: string
- sources: array of strings (e.g. ["stackoverflow","github","docs","blogs"])
- limit: number (how many pages/posts to sample)

OUTPUT JSON SCHEMA:
{
  "query": "string",
  "confusions": [{"title":"string","summary":"string","evidence_urls":["string"]}],
  "pitfalls": [{"title":"string","summary":"string","evidence_urls":["string"]}],
  "recommended_search_queries": ["string"],
  "evidence": [{"url":"string","snippet":"string"}]
}
"""

    skill_id = create_skill(goal, agent_prompt)
    print("Created skill_id:", skill_id)

