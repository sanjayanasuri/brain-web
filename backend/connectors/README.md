# Finance Data Connectors

This directory contains pluggable connectors for ingesting public finance data into the GraphRAG system.

## Architecture

All connectors implement the `BaseConnector` interface defined in `base.py`. They fetch data from external sources and return standardized `SourceDocument` objects that are then processed by the finance ingestion service.

## Available Connectors

### 1. EDGAR Connector (`edgar.py`)

Fetches SEC EDGAR filings (10-K, 10-Q, 8-K) for public companies.

**Features:**
- Automatically maps ticker symbols to CIK numbers
- Caches company ticker mapping locally
- Respects SEC rate limiting (User-Agent required)
- Extracts text from filing HTML

**Configuration:**
- Set `SEC_USER_AGENT` environment variable (required by SEC)
- Example: `SEC_USER_AGENT="BrainWeb/1.0 your@email.com"`

**Usage:**
The connector automatically fetches filings based on ticker. No additional config needed in `finance_sources.json` (CIK is auto-resolved).

### 2. IR Connector (`ir.py`)

Fetches press releases and shareholder letters from Investor Relations pages.

**Features:**
- Extracts links from IR index pages
- Heuristic content extraction (finds main article content)
- Paywall detection (skips full text if paywall detected)
- Configurable link filtering patterns

**Configuration in `finance_sources.json`:**
```json
{
  "ir": {
    "press_release_index_url": "https://example.com/investor-relations/press-releases",
    "shareholder_letter_index_url": "https://example.com/investor-relations/shareholder-letters",
    "link_include_patterns": ["press-release", "announcement"],
    "link_exclude_patterns": ["archive", "old"]
  }
}
```

### 3. News RSS Connector (`news_rss.py`)

Fetches news articles from RSS feeds.

**Features:**
- Parses RSS feeds using feedparser
- By default, only ingests title/description/link (safe, no paywall risk)
- Optional full-text fetching (if `allow_fulltext_fetch: true`)
- Paywall detection for full-text mode

**Configuration in `finance_sources.json`:**
```json
{
  "news": {
    "rss_feeds": [
      "https://example.com/rss/company-news",
      "https://feeds.example.com/nvidia"
    ],
    "allow_fulltext_fetch": false
  }
}
```

## Adding a New Connector

1. Create a new file in `connectors/` (e.g., `transcript.py`)

2. Implement the `BaseConnector` interface:

```python
from connectors.base import BaseConnector, SourceDocument

class TranscriptConnector(BaseConnector):
    @property
    def name(self) -> str:
        return "transcript"
    
    def fetch(
        self,
        ticker: str,
        company: Dict[str, Any],
        since_days: int,
        limit: int
    ) -> List[SourceDocument]:
        # Your implementation here
        documents = []
        # ... fetch data ...
        return documents
```

3. Register the connector in `services_finance_ingestion.py`:

```python
from connectors.transcript import TranscriptConnector

def _get_connector_instance(connector_name: str):
    # ... existing connectors ...
    elif connector_name == "transcript":
        return TranscriptConnector()
```

4. Add connector config to `finance_sources.json` if needed

## Adding a New Company

Edit `backend/finance_sources.json`:

```json
{
  "companies": {
    "TICKER": {
      "company_name": "Company Name",
      "cik": "0000123456",  // Optional, auto-resolved if not provided
      "ir": {
        "press_release_index_url": "URL_HERE",
        "shareholder_letter_index_url": "URL_HERE"
      },
      "news": {
        "rss_feeds": ["RSS_URL_1", "RSS_URL_2"],
        "allow_fulltext_fetch": false
      }
    }
  }
}
```

## Running Ingestion

### Via API

```bash
POST /finance/ingest
{
  "ticker": "NVDA",
  "since_days": 30,
  "limit": 20,
  "connectors": ["edgar", "ir", "news"]
}
```

### Via CLI

```bash
python backend/scripts/ingest_finance.py \
  --graph-id YOUR_GRAPH_ID \
  --branch-id YOUR_BRANCH_ID \
  --ticker NVDA \
  --since-days 30 \
  --limit 20 \
  --connectors edgar ir news
```

## Safety and Legal Considerations

- **Public Data Only**: All connectors only fetch publicly accessible data
- **RSS/News**: By default, only ingests title/description/link (no full-text fetching)
- **Paywall Detection**: IR and News connectors detect paywalls and skip full-text extraction
- **SEC Compliance**: EDGAR connector includes required User-Agent header
- **Rate Limiting**: All connectors include retry logic and respect rate limits

## Troubleshooting

### EDGAR connector fails
- Check `SEC_USER_AGENT` environment variable is set
- Verify ticker symbol is correct (use uppercase)
- Check SEC website is accessible

### IR connector returns no documents
- Verify IR URLs are correct and accessible
- Check link filtering patterns aren't too restrictive
- Some IR pages may require JavaScript (not supported)

### News RSS connector returns no documents
- Verify RSS feed URLs are valid and accessible
- Check feed format is standard RSS/Atom
- Some feeds may require authentication (not supported)

## Future Enhancements

- Database-backed config (instead of JSON file)
- Support for paid APIs (Bloomberg, FactSet, etc.)
- Transcript feeds (earnings calls)
- More sophisticated content extraction
- Automatic feed discovery
