# Running Miyami Search Locally (Without Docker)

This is the **open-source Miyami Search** code that we've integrated into Brain Web. You can run it directly on your Mac without Docker.

## Quick Start

```bash
cd services/miyami-search
./start_local.sh
```

This will:
1. Create a Python virtual environment
2. Install all dependencies (SearXNG, FastAPI, etc.)
3. Start SearXNG (search engine aggregator)
4. Start FastAPI (the API wrapper)

## What It Does

- **SearXNG**: Aggregates search results from Google, Bing, DuckDuckGo, Brave, etc.
- **FastAPI**: Provides LLM-friendly endpoints:
  - `/search-api` - Search the web
  - `/search-and-fetch` - Search AND scrape full content from results
  - `/fetch` - Scrape content from any URL
  - `/deep-research` - Multi-query research
  - `/crawl-site` - Crawl entire websites

## API Endpoints

Once running, the API is available at `http://localhost:8081`:

```bash
# Health check
curl http://localhost:8081/health

# Search
curl "http://localhost:8081/search-api?query=test"

# Search and fetch full content
curl "http://localhost:8081/search-and-fetch?query=test&num_results=3"
```

## Configuration

The frontend is already configured to use `http://localhost:8081` by default. No changes needed!

## Stopping

Press `Ctrl+C` in the terminal where it's running.

## Troubleshooting

- **Port already in use**: Change `PORT` in the script or kill the process using port 8081
- **SearXNG fails to start**: Check `/tmp/searxng.log` for errors
- **Dependencies fail**: Make sure you have Python 3.11+ and `git` installed

## License

This is open-source code from the Miyami project. We're using it directly as it's free and open-source.
