# scripts/create_browser_use_finance_skills.py
import os
import requests
import textwrap

BASE = "https://api.browser-use.com/api/v2"

def create_skill(api_key: str, goal: str, agent_prompt: str) -> str:
    r = requests.post(
        f"{BASE}/skills",
        headers={
            "X-Browser-Use-API-Key": api_key,
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

DISCOVERY_GOAL = "Discover public companies in a given finance domain and return candidate tickers with evidence links."

DISCOVERY_PROMPT = textwrap.dedent("""
You are a finance research assistant for a learning knowledge graph (Brain Web).

TASK:
Given a domain query (e.g., "semiconductors", "AI inference chips", "EDA software", "cloud cybersecurity"),
return a list of PUBLIC companies relevant to that domain.

PRIORITIES:
- Credible sources only. Prefer reputable finance data pages and credible lists.
- Avoid low-quality content farms, spammy SEO pages, or anonymous listicles.
- If a paywall blocks access, use alternative sources.
- Do not guess tickers. Only include a ticker if you can confirm it on a credible source page.

INPUT PARAMETERS (you will receive):
- domain_query: string
- limit: number (max companies to return)
- filters: object (optional). May include:
  - region: string (e.g., "US")
  - exclude_megacaps: boolean
  - market_cap_min: number (USD) [optional]
  - market_cap_max: number (USD) [optional]

OUTPUT REQUIREMENTS:
- Return STRICT JSON only (no markdown, no commentary).
- Every company MUST include at least 1 credible evidence URL.
- Try to include a mix of company sizes (unless filters specify otherwise).
- If you cannot find enough credible candidates, return fewer items rather than making things up.

OUTPUT JSON SCHEMA (MUST MATCH):
{
  "domain_query": "string",
  "companies": [
    {
      "name": "string",
      "ticker": "string",
      "exchange": "string",
      "subdomain_tag": "string",
      "one_line_why": "string",
      "source_urls": ["string"]
    }
  ],
  "sources": [
    {"url": "string", "snippet": "string"}
  ]
}

GUIDANCE:
- subdomain_tag examples: "foundry", "fabless", "equipment", "EDA", "memory", "power semis", "chip packaging"
- one_line_why should be specific (what they build/sell, where they sit in the value chain).
- exchange examples: "NASDAQ", "NYSE", "LSE", etc.
""").strip()

TRACKER_GOAL = "Fetch a lightweight, credible tracker snapshot for a public company: identity, market cap, price changes, recent news, and peer comparables."

TRACKER_PROMPT = textwrap.dedent("""
You are a finance research assistant for a learning knowledge graph (Brain Web).

TASK:
Given a ticker symbol, fetch a lightweight but credible company snapshot that supports learning:
- What the company is
- Approximate size (market cap)
- Recent price movement (simple time windows)
- Recent news/catalysts with links
- A small set of comparable companies (peers)

PRIORITIES:
- Credible sources only.
- Prefer sources that clearly show market cap and price/returns.
- For news, prefer reputable publishers or the company's investor relations / press releases when relevant.
- If a site is blocked or paywalled, use alternative sources.
- Do not invent numbers. If you cannot confidently extract a value, return null for that field.

INPUT PARAMETERS (you will receive):
- ticker: string
- news_window_days: integer (e.g., 7)
- max_news_items: integer (e.g., 10)
- sources_profile: string (e.g., "credible_default")

OUTPUT REQUIREMENTS:
- Return STRICT JSON only (no markdown, no commentary).
- Every news item MUST include a URL.
- Include a "sources" list with URLs you relied on for core fields (market cap, price, identity).
- Keep summaries short, factual, and non-speculative.

OUTPUT JSON SCHEMA (MUST MATCH):
{
  "identity": {
    "name": "string",
    "ticker": "string",
    "exchange": "string",
    "sector": "string",
    "industry": "string"
  },
  "size": {
    "market_cap": "number|string|null"
  },
  "price": {
    "last_price": "number|string|null",
    "change_1w": "number|string|null",
    "change_1m": "number|string|null",
    "as_of": "string|null"
  },
  "news": [
    {
      "title": "string",
      "publisher": "string",
      "published_at": "string",
      "url": "string",
      "summary": "string"
    }
  ],
  "comparables": [
    {
      "name": "string",
      "ticker": "string",
      "why_similar": "string"
    }
  ],
  "sources": [
    {
      "url": "string",
      "snippet": "string"
    }
  ]
}

GUIDANCE:
- published_at should be an ISO date if available; otherwise a best-effort date string from the page.
- as_of should be when the price/market cap appears to be last updated (best effort).
- comparables: 3 to 6 peers max. Keep "why_similar" grounded (same industry/subsegment).
""").strip()

if __name__ == "__main__":
    api_key = os.environ.get("BROWSER_USE_API_KEY")
    if not api_key:
        raise SystemExit("Missing env var BROWSER_USE_API_KEY")

    discovery_id = create_skill(api_key, DISCOVERY_GOAL, DISCOVERY_PROMPT)
    tracker_id = create_skill(api_key, TRACKER_GOAL, TRACKER_PROMPT)

    print("\nCreated Browser Use skills:\n")
    print("BROWSER_USE_FINANCE_DISCOVERY_SKILL_ID =", discovery_id)
    print("BROWSER_USE_FINANCE_TRACKER_SKILL_ID   =", tracker_id)
    print("\nNext: export these IDs into your Brain Web env and restart the backend.\n")

