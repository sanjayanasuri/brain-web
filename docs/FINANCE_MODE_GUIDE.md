# Finance Mode Guide

Finance Mode is a specialized feature in Brain Web that enables you to analyze companies using financial data from SEC filings, investor relations pages, and news sources. It uses GraphRAG (Graph Retrieval-Augmented Generation) to build a knowledge graph from financial documents and answer questions about companies.

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Ingesting Finance Data](#ingesting-finance-data)
4. [Using Finance Mode for Queries](#using-finance-mode-for-queries)
5. [Finance Lenses](#finance-lenses)
6. [Query Examples](#query-examples)
7. [Configuration](#configuration)
8. [Troubleshooting](#troubleshooting)

---

## Overview

Finance Mode allows you to:

- **Ingest financial data** from multiple sources:
  - **SEC EDGAR**: 10-K, 10-Q, 8-K filings
  - **Investor Relations (IR)**: Press releases, shareholder letters
  - **News RSS**: News articles from configured RSS feeds

- **Query with specialized lenses** that focus on different aspects:
  - **Fundamentals**: Financial metrics, earnings, guidance
  - **Catalysts**: Recent news, events, announcements
  - **Competition**: Competitive positioning, market share
  - **Risks**: Risk factors, vulnerabilities, concerns
  - **Narrative**: Investment thesis, long-term story

- **Get evidence-backed answers** with citations to source documents

---

## Getting Started

### Prerequisites

1. **Neo4j Database**: Finance mode requires a Neo4j database connection
2. **OpenAI API Key**: For claim extraction and embeddings (optional but recommended)
3. **SEC User-Agent**: Set environment variable for SEC EDGAR access:
   ```bash
   export SEC_USER_AGENT="BrainWeb/1.0 your@email.com"
   ```
   Or add to `.env` file in the backend directory.

### Quick Start (EDGAR Only)

The easiest way to get started is using **EDGAR connector only**, which requires no configuration:

```bash
# Test with EDGAR only (no config needed)
curl -X POST http://localhost:8000/finance/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "ticker": "NVDA",
    "since_days": 90,
    "limit": 10,
    "connectors": ["edgar"]
  }'
```

**If you get 0 documents**:
- Check that `SEC_USER_AGENT` environment variable is set
- Check backend console/logs for `[EDGAR]` error messages
- Try increasing `since_days` to 180 or 365
- Ensure you have network access to `https://www.sec.gov`

**For IR and News connectors**, you'll need to configure URLs in `finance_sources.json` (see Configuration section below).

### Enable Finance Mode in the UI

1. Open the main graph visualization page
2. Look for the **"💰 Finance"** button in the chat/command panel area
3. Click the button to enable Finance Mode (it will turn active/highlighted)
4. When enabled, you'll see:
   - A ticker input field (e.g., "AAPL", "NVDA")
   - A lens dropdown selector

---

## Ingesting Finance Data

Before you can query finance data, you need to ingest it into your knowledge graph.

### Method 1: Using the API Endpoint

Use the `/finance/ingest` endpoint to ingest data for a company:

```bash
curl -X POST http://localhost:8000/finance/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "ticker": "NVDA",
    "since_days": 30,
    "limit": 20,
    "connectors": ["edgar", "ir", "news"]
  }'
```

**Important Notes**:
- **EDGAR connector works out of the box** - no configuration needed, just ensure `SEC_USER_AGENT` environment variable is set
- **IR and News connectors require configuration** - update `finance_sources.json` with actual URLs (see Configuration section)
- **If you get 0 documents**: Check the Troubleshooting section below
- **Start with EDGAR only**: If IR/News aren't configured, use `"connectors": ["edgar"]` to test

**Parameters:**
- `ticker` (required): Stock ticker symbol (e.g., "NVDA", "AAPL")
- `since_days` (optional, default: 30): Number of days to look back
- `limit` (optional, default: 20): Maximum documents per connector
- `connectors` (optional, default: ["edgar", "ir", "news"]): Which data sources to use

**Response:**
```json
{
  "documents_fetched": 15,
  "chunks_created": 120,
  "claims_created": 85,
  "proposed_edges_created": 0,
  "errors": [],
  "ingested_docs": [
    {
      "title": "10-Q Quarterly Report",
      "url": "https://...",
      "doc_type": "10-Q"
    }
  ]
}
```

### Method 2: Using the Script

Use the finance sync script for automated ingestion:

```bash
cd backend
python scripts/run_finance_sync.py \
  --ticker NVDA \
  --sources sec,news,prices \
  --graph-id default \
  --branch-id main
```

### What Happens During Ingestion

1. **Document Fetching**: Connectors fetch documents from configured sources
2. **Text Extraction**: Documents are converted to text
3. **Chunking**: Text is split into manageable chunks (~1200 chars with 150 char overlap)
4. **Claim Extraction**: LLM extracts factual claims from each chunk
5. **Concept Linking**: Claims are linked to existing concepts in the graph
6. **Storage**: Documents, chunks, and claims are stored in Neo4j

---

## Using Finance Mode for Queries

### Step 1: Enable Finance Mode

Click the **"💰 Finance"** button in the UI to enable finance mode.

### Step 2: Enter Ticker (Optional)

Enter a stock ticker in the ticker input field (e.g., "AAPL", "NVDA"). This helps filter results to that specific company.

### Step 3: Select a Lens (Optional)

Choose a finance lens from the dropdown:
- **General**: Default, auto-routes based on query
- **Fundamentals**: Financial metrics and performance
- **Catalysts**: Recent events and news
- **Competition**: Competitive analysis
- **Risks**: Risk factors
- **Narrative**: Investment thesis

### Step 4: Ask Your Question

Type your question in the chat input. Examples:
- "What are NVDA's recent catalysts?"
- "How does AAPL compare to competitors?"
- "What are the risks for TSLA?"
- "What is the investment narrative for MSFT?"

### Query Formats

You can use several query formats:

1. **Simple query with ticker in UI**: 
   - Set ticker to "NVDA" in UI
   - Ask: "What are the recent catalysts?"

2. **Ticker prefix format**:
   - Ask: "NVDA: What are the recent catalysts?"

3. **Company name**:
   - Ask: "NVIDIA: What are the risks?"

---

## Finance Lenses

Finance Mode uses specialized "lenses" that focus on different aspects of company analysis. The system automatically routes your query to the appropriate lens based on keywords, or you can explicitly select one.

### Fundamentals Lens

**Focus**: Financial metrics, earnings, guidance, performance

**Keywords**: revenue, margin, eps, guidance, quarter, earnings, profit, loss, ebitda, financials

**Answer Structure**:
- Snapshot (Last 4 Quarters)
- Trend Notes
- Guidance + Deltas
- What to Watch Next Quarter
- Evidence

**Example Queries**:
- "What are NVDA's revenue trends?"
- "Show me AAPL's earnings guidance"
- "What are TSLA's margins?"

### Catalysts Lens

**Focus**: Recent events, news, announcements, market-moving developments

**Keywords**: news, today, recent, announcement, lawsuit, sec, downgrade, upgrade, analyst, catalyst

**Answer Structure**:
- What Changed Recently (Ranked by Recency + Confidence)
- Why It Matters (Mechanism)
- Second-Order Effects
- Open Questions / What Would Falsify

**Example Queries**:
- "What's new with NVDA?"
- "Recent news about AAPL"
- "What catalysts affected TSLA today?"

### Competition Lens

**Focus**: Competitive positioning, market share, differentiators

**Keywords**: competitor, vs, compare, market share, moat, competitive, rival, advantage

**Answer Structure**:
- Competitive Map
- Differentiators (Claims Supported)
- Switching Costs / Moats
- Where Competitors Win

**Example Queries**:
- "How does NVDA compare to AMD?"
- "What are AAPL's competitive advantages?"
- "Who are TSLA's main competitors?"

### Risks Lens

**Focus**: Risk factors, vulnerabilities, concerns, headwinds

**Keywords**: risk, downside, regulation, export controls, supply chain, threat, vulnerability, concern

**Answer Structure**:
- Risk Register (Mechanism, Severity, Evidence)
- Mitigations / Hedges
- Monitoring Signals

**Example Queries**:
- "What are the risks for NVDA?"
- "What are AAPL's vulnerabilities?"
- "Regulatory risks for TSLA"

### Narrative Lens

**Focus**: Investment thesis, long-term story, strategy

**Keywords**: strategy, positioning, thesis, narrative, vision, future, direction, outlook

**Answer Structure**:
- Core Thesis
- Supporting Pillars
- Weak Points / Counterarguments
- "If X Happens, Thesis Changes"

**Example Queries**:
- "What is the investment thesis for NVDA?"
- "What is AAPL's long-term strategy?"
- "What is the narrative for TSLA?"

---

## Query Examples

### Example 1: Fundamentals Analysis

**Setup**:
- Enable Finance Mode
- Set ticker: "NVDA"
- Select lens: "Fundamentals" (or let it auto-route)

**Query**: "What are NVDA's revenue trends and margins?"

**Expected Answer**: Structured response with:
- Revenue snapshot for last 4 quarters
- Margin trends
- Quarter-over-quarter changes
- Evidence citations

### Example 2: Recent Catalysts

**Setup**:
- Enable Finance Mode
- Set ticker: "AAPL"
- Select lens: "Catalysts"

**Query**: "What are the recent catalysts for Apple?"

**Expected Answer**: 
- Recent events ranked by recency
- Why each matters
- Second-order effects
- Source citations

### Example 3: Competitive Analysis

**Setup**:
- Enable Finance Mode
- Set ticker: "NVDA"
- Select lens: "Competition"

**Query**: "How does NVIDIA compare to AMD and Intel?"

**Expected Answer**:
- Competitive map
- Differentiators with evidence
- Market positioning
- Where competitors have advantages

### Example 4: Risk Assessment

**Setup**:
- Enable Finance Mode
- Set ticker: "TSLA"
- Select lens: "Risks"

**Query**: "What are the main risks for Tesla?"

**Expected Answer**:
- Risk register with mechanisms
- Severity assessments
- Mitigation strategies
- Monitoring signals

### Example 5: Investment Narrative

**Setup**:
- Enable Finance Mode
- Set ticker: "MSFT"
- Select lens: "Narrative"

**Query**: "What is the investment thesis for Microsoft?"

**Expected Answer**:
- Core thesis
- Supporting pillars
- Weak points
- Scenarios that would change the thesis

---

## Configuration

### Finance Sources Configuration

Edit `backend/finance_sources.json` to configure company-specific settings.

**Important**: The default config has placeholder URLs (`PUT_URL_HERE`, `PUT_RSS_URL_HERE`). You must replace these with actual URLs for IR and News connectors to work.

**Example Configuration**:

```json
{
  "defaults": {
    "since_days": 30,
    "limit": 20,
    "news": {
      "allow_fulltext_fetch": false
    }
  },
  "companies": {
    "NVDA": {
      "company_name": "NVIDIA",
      "cik": null,
      "ir": {
        "press_release_index_url": "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/jobs?q=press+release",
        "shareholder_letter_index_url": "https://investor.nvidia.com/annual-reports",
        "link_include_patterns": [],
        "link_exclude_patterns": []
      },
      "news": {
        "rss_feeds": [
          "https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA",
          "https://www.nasdaq.com/feed/rssoutbound?symbol=NVDA"
        ],
        "allow_fulltext_fetch": false
      }
    }
  }
}
```

**Note**: 
- **EDGAR connector works without config** - it automatically finds CIK from ticker
- **IR connector requires valid URLs** - replace `PUT_URL_HERE` with actual IR page URLs
- **News RSS connector requires valid RSS feed URLs** - replace `PUT_RSS_URL_HERE` with actual feed URLs
- If you don't have IR or News URLs, you can remove those connectors from the request or leave them with placeholders (they'll just return 0 documents)

**Configuration Fields**:
- `defaults`: Default settings for all companies
- `companies`: Company-specific overrides
  - `company_name`: Full company name
  - `cik`: SEC CIK number (optional)
  - `ir`: Investor relations configuration
    - `press_release_index_url`: URL to press release index page
    - `shareholder_letter_index_url`: URL to shareholder letter index
  - `news`: News RSS configuration
    - `rss_feeds`: Array of RSS feed URLs

### Connector Configuration

The system uses three main connectors:

1. **EDGAR Connector** (`edgar`): Fetches SEC filings
   - Automatically finds CIK from ticker
   - Fetches 10-K, 10-Q, 8-K forms
   - No additional configuration needed

2. **IR Connector** (`ir`): Fetches investor relations pages
   - Requires `press_release_index_url` in config
   - Scrapes press releases and shareholder letters

3. **News RSS Connector** (`news`): Fetches news articles
   - Requires `rss_feeds` in config
   - Parses RSS feeds for relevant articles

---

## Troubleshooting

### No Documents Fetched (0 documents_fetched)

**Problem**: Ingestion returns `{"documents_fetched": 0, ...}` with no errors.

**Common Causes & Solutions**:

1. **EDGAR Connector Issues**:
   - **Check SEC User-Agent**: SEC requires a proper User-Agent. Set environment variable:
     ```bash
     export SEC_USER_AGENT="BrainWeb/1.0 your@email.com"
     ```
     Or add to `.env` file:
     ```
     SEC_USER_AGENT=BrainWeb/1.0 your@email.com
     ```
   - **Check network access**: Ensure you can reach `https://www.sec.gov`
   - **Try longer time window**: Increase `since_days` (e.g., 90 or 180) to catch more filings
   - **Check backend logs**: Look for `[EDGAR]` messages in backend console/logs
   - **Test CIK lookup**: The connector needs to find NVDA's CIK. Check if ticker mapping is working

2. **IR Connector Issues**:
   - **Placeholder URLs**: The default `finance_sources.json` has `"PUT_URL_HERE"` placeholders
   - **Configure URLs**: Update `finance_sources.json` with actual IR page URLs:
     ```json
     "ir": {
       "press_release_index_url": "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/jobs?q=press+release",
       "shareholder_letter_index_url": "https://investor.nvidia.com/annual-reports"
     }
     ```
   - **Skip IR if not configured**: Remove `"ir"` from connectors array if you don't have URLs

3. **News RSS Connector Issues**:
   - **Placeholder URLs**: Default config has `"PUT_RSS_URL_HERE"` placeholder
   - **Configure RSS feeds**: Add actual RSS feed URLs:
     ```json
     "news": {
       "rss_feeds": [
         "https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA",
         "https://www.nasdaq.com/feed/rssoutbound?symbol=NVDA"
       ]
     }
     ```
   - **Skip News if not configured**: Remove `"news"` from connectors array if you don't have feeds

4. **Test Individual Connectors**:
   ```bash
   # Test EDGAR only
   curl -X POST http://localhost:8000/finance/ingest \
     -H "Content-Type: application/json" \
     -d '{"ticker": "NVDA", "since_days": 180, "limit": 10, "connectors": ["edgar"]}'
   ```

5. **Check Backend Logs**:
   - Look for connector-specific log messages: `[EDGAR]`, `[IR]`, `[News RSS]`
   - Check for error messages or warnings
   - Verify network requests are being made

### No Results Returned

**Problem**: Queries return no results or empty answers.

**Solutions**:
1. **Check if data was ingested**: Verify that ingestion completed successfully with `documents_fetched > 0`
2. **Check ticker**: Ensure the ticker matches what was used during ingestion
3. **Check lens**: Try different lenses or let it auto-route
4. **Check graph context**: Ensure you're on the correct graph/branch
5. **Wait for processing**: After ingestion, wait a moment for claims to be extracted and linked

### Ingestion Fails with Errors

**Problem**: Finance ingestion returns errors in the `errors` array.

**Solutions**:
1. **Check connector errors**: Each error message indicates which connector failed and why
2. **Check network**: Ensure you can access SEC EDGAR, IR pages, and RSS feeds
3. **Check Neo4j**: Verify database connection is working
4. **Check logs**: Review backend logs for detailed error messages
5. **Check configuration**: Verify `finance_sources.json` has valid URLs (not placeholders)

### Wrong Lens Selected

**Problem**: System routes to wrong lens.

**Solutions**:
1. **Explicit lens**: Manually select the desired lens in the UI
2. **Query keywords**: Add more specific keywords to your query
3. **Ticker prefix**: Use "TICKER: query" format for better routing

### Missing Data Sources

**Problem**: Some data sources aren't being fetched.

**Solutions**:
1. **Check config**: Verify URLs in `finance_sources.json` are correct (not placeholders)
2. **Check connectors**: Ensure desired connectors are in the `connectors` array
3. **Check limits**: Increase `limit` parameter if needed
4. **Check date range**: Increase `since_days` to look back further

---

## Advanced Usage

### Custom Retrieval Parameters

When using the API directly, you can customize retrieval:

```python
# Example: High strictness, recent data only
retrieval_params = {
    "evidence_strictness": "high",  # "high", "medium", "low"
    "recency_days": 7,  # Only last 7 days
    "max_communities": 5,
    "max_claims_per_community": 20
}
```

### Batch Ingestion

Ingest multiple companies:

```bash
for ticker in NVDA AAPL MSFT GOOGL; do
  curl -X POST http://localhost:8000/finance/ingest \
    -H "Content-Type: application/json" \
    -d "{\"ticker\": \"$ticker\", \"since_days\": 30}"
done
```

### Scheduled Sync

Set up a cron job for regular updates:

```bash
# Run daily at 2 AM
0 2 * * * cd /path/to/brain-web/backend && python scripts/run_finance_sync.py --ticker NVDA --sources sec,news
```

---

## Best Practices

1. **Regular Ingestion**: Ingest data regularly (daily or weekly) to keep information current
2. **Specific Queries**: Be specific in your queries for better results
3. **Use Tickers**: Always specify tickers when querying to filter results
4. **Check Sources**: Review source citations to verify information
5. **Multiple Lenses**: Try different lenses for comprehensive analysis
6. **Evidence Review**: Always check the evidence subgraph for claim sources

---

## Summary

Finance Mode enables powerful financial analysis by:

1. **Ingesting** financial data from SEC, IR, and news sources
2. **Structuring** data into claims and evidence in a knowledge graph
3. **Querying** with specialized lenses for different analysis types
4. **Answering** with evidence-backed responses and citations

Start by ingesting data for a company, then enable Finance Mode in the UI and start asking questions!

