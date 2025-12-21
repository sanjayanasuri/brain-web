# Finance Sources Configuration Guide

This guide explains what links you need to put in `finance_sources.json` and how to find them.

## Quick Answer

**You don't need ANY links for EDGAR connector** - it works automatically! Just use `"connectors": ["edgar"]` and it will fetch SEC filings.

**You only need links if you want to use IR or News connectors.**

---

## Understanding the Three Connectors

### 1. EDGAR Connector (No Links Needed! ✅)

**What it does**: Fetches SEC filings (10-K, 10-Q, 8-K) from the SEC EDGAR database.

**Links needed**: **NONE** - it works automatically!

**Configuration**: Just ensure `SEC_USER_AGENT` environment variable is set:
```bash
export SEC_USER_AGENT="BrainWeb/1.0 your@email.com"
```

**How to use**: Just specify the ticker:
```bash
curl -X POST http://localhost:8000/finance/ingest \
  -H "Content-Type: application/json" \
  -d '{"ticker": "NVDA", "connectors": ["edgar"]}'
```

**Why you might get 0 documents**:
- Missing `SEC_USER_AGENT` environment variable
- Network issues accessing sec.gov
- No filings in the date range (try increasing `since_days`)

---

### 2. IR Connector (Needs Links)

**What it does**: Fetches press releases and shareholder letters from company Investor Relations pages.

**Links needed**: 
- `press_release_index_url`: A page that lists press releases (usually the company's IR press release page)
- `shareholder_letter_index_url`: A page that lists shareholder letters/annual reports (optional)

**How to find these URLs**:

1. **Go to the company's Investor Relations website**
   - For NVIDIA: https://investor.nvidia.com
   - Look for "Press Releases" or "News" section
   - Look for "Annual Reports" or "Shareholder Letters" section

2. **Find the index/list page** (not individual press releases)
   - You want the page that lists ALL press releases
   - Usually looks like: `https://investor.company.com/news/press-releases` or `https://investor.company.com/news`

3. **Example for NVIDIA**:
   - Press releases: https://investor.nvidia.com/news-events/press-releases
   - Annual reports: https://investor.nvidia.com/annual-reports

**Configuration example**:
```json
{
  "ir": {
    "press_release_index_url": "https://investor.nvidia.com/news-events/press-releases",
    "shareholder_letter_index_url": "https://investor.nvidia.com/annual-reports",
    "link_include_patterns": [],
    "link_exclude_patterns": []
  }
}
```

**Note**: The connector will automatically extract links from these index pages. You don't need to list individual press release URLs.

---

### 3. News RSS Connector (Needs RSS Feed URLs)

**What it does**: Fetches news articles from RSS feeds.

**Links needed**: RSS feed URLs (XML format)

**How to find RSS feeds**:

1. **Financial news sites with RSS**:
   - Yahoo Finance: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA`
   - Nasdaq: `https://www.nasdaq.com/feed/rssoutbound?symbol=NVDA`
   - MarketWatch: Usually has RSS feeds for tickers
   - Seeking Alpha: Has RSS feeds for companies

2. **How to find them**:
   - Look for RSS icon (📡) on news pages
   - Check if URL ends in `.rss` or `?format=rss`
   - Some sites have `/rss` or `/feed` in the URL

3. **Test the RSS feed**:
   - Open the URL in a browser - you should see XML
   - Or use: `curl https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA`

**Configuration example**:
```json
{
  "news": {
    "rss_feeds": [
      "https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA",
      "https://www.nasdaq.com/feed/rssoutbound?symbol=NVDA"
    ],
    "allow_fulltext_fetch": false
  }
}
```

**Note**: 
- `allow_fulltext_fetch: false` means it only gets title/description (safer, no paywall risk)
- `allow_fulltext_fetch: true` tries to fetch full article text (may hit paywalls)

---

## Complete Example Configuration

Here's a complete `finance_sources.json` for NVIDIA:

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
        "press_release_index_url": "https://investor.nvidia.com/news-events/press-releases",
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

---

## Step-by-Step: Finding Links for Any Company

### For IR Links:

1. **Search**: `"[Company Name] investor relations"` on Google
2. **Visit**: The official IR website (usually `investor.companyname.com`)
3. **Navigate**: Look for "Press Releases" or "News" section
4. **Copy**: The URL of the page that lists all press releases (not individual ones)
5. **Test**: Open the URL - you should see a list of press releases

### For RSS Feeds:

1. **Try Yahoo Finance**: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=TICKER`
2. **Try Nasdaq**: `https://www.nasdaq.com/feed/rssoutbound?symbol=TICKER`
3. **Search**: `"[Company Name] RSS feed"` or `"[Ticker] news RSS"`
4. **Test**: Open the URL in browser - should show XML

---

## What If I Don't Have Links?

**No problem!** You can:

1. **Use EDGAR only** (recommended to start):
   ```bash
   curl -X POST http://localhost:8000/finance/ingest \
     -H "Content-Type: application/json" \
     -d '{"ticker": "NVDA", "connectors": ["edgar"]}'
   ```

2. **Leave placeholders** - IR and News connectors will just return 0 documents (not an error)

3. **Add links later** - You can always update the config and re-run ingestion

---

## Common Issues

### "I can't find the IR press release page"

- Try: `investor.[company].com/news` or `investor.[company].com/press-releases`
- Some companies use different structures - just find the page that lists multiple press releases
- If you can't find it, just skip IR connector and use EDGAR only

### "RSS feed doesn't work"

- Test the URL in a browser first - should show XML
- Some RSS feeds require authentication or have changed URLs
- Try multiple sources (Yahoo, Nasdaq, etc.)
- If none work, just skip News connector

### "EDGAR returns 0 documents"

- Check `SEC_USER_AGENT` is set: `echo $SEC_USER_AGENT`
- Try increasing `since_days` to 180 or 365
- Check backend logs for `[EDGAR]` error messages
- Test network: `curl https://www.sec.gov`

---

## Summary

| Connector | Links Needed? | Where to Find |
|-----------|---------------|---------------|
| **EDGAR** | ❌ No | Works automatically |
| **IR** | ✅ Yes | Company IR website → Press Releases page |
| **News** | ✅ Yes | Financial news sites → RSS feed URLs |

**Start with EDGAR only** - it's the easiest and doesn't need any configuration!



