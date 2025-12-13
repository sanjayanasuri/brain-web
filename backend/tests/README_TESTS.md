# Brain Web Backend Test Suite

## Overview

This test suite provides comprehensive coverage of the Brain Web backend API, focusing on:
- **API endpoint testing** (happy paths and error paths)
- **Service-level testing** (graph operations, lecture ingestion, Notion sync)
- **Error logging and handling** verification
- **Mocked external dependencies** (Neo4j, OpenAI, Notion API)

All tests use mocks to avoid hitting real external services, making tests fast, reliable, and safe to run in any environment.

## API Surface

### Concepts API (`/concepts`)
- `GET /concepts/{node_id}` - Get concept by ID
- `GET /concepts/by-name/{name}` - Get concept by name
- `GET /concepts/{node_id}/neighbors` - Get neighbor concepts
- `GET /concepts/{node_id}/neighbors-with-relationships` - Get neighbors with relationship types
- `GET /concepts/missing-descriptions` - Get concepts missing descriptions
- `GET /concepts/gaps` - Get concept gaps (low degree/short descriptions)
- `GET /concepts/search?q={query}` - Search concepts by name
- `GET /concepts/all/graph` - Get all nodes and relationships
- `POST /concepts/` - Create a concept
- `POST /concepts/relationship` - Create relationship by names
- `POST /concepts/relationship-by-ids` - Create relationship by IDs
- `DELETE /concepts/{node_id}` - Delete a concept
- `DELETE /concepts/relationship` - Delete a relationship
- `POST /concepts/cleanup-test-data` - Cleanup test concepts

### Lectures API (`/lectures`)
- `POST /lectures/ingest` - Ingest lecture text using LLM to extract concepts/relationships
- `POST /lectures/` - Create lecture metadata
- `GET /lectures/{lecture_id}` - Get lecture by ID
- `POST /lectures/{lecture_id}/steps` - Add step to lecture
- `GET /lectures/{lecture_id}/steps` - Get lecture steps

### Admin API (`/admin`)
- `POST /admin/import` - Import CSV files to Neo4j
- `POST /admin/export` - Export Neo4j graph to CSV
- `POST /admin/sync-notion` - Manually trigger Notion sync
- `GET /admin/notion/pages` - List Notion pages with indexing status
- `POST /admin/notion/pages/index` - Toggle page indexing
- `POST /admin/notion/unlink-page` - Unlink a Notion page from graph
- `GET /admin/notion-config` - Get Notion sync configuration
- `POST /admin/notion-config` - Update Notion sync configuration

### Preferences API (`/preferences`)
- `GET /preferences/response-style` - Get response style profile
- `POST /preferences/response-style` - Update response style profile
- `GET /preferences/focus-areas` - List all focus areas
- `POST /preferences/focus-areas` - Create/update focus area
- `POST /preferences/focus-areas/{focus_id}/active` - Toggle focus area active status
- `GET /preferences/user-profile` - Get user profile
- `POST /preferences/user-profile` - Update user profile

### Notion API (`/notion`)
- `GET /notion/summary` - Get summary of Notion pages and databases
- `POST /notion/ingest-pages` - Bulk ingest specific Notion pages
- `POST /notion/ingest-all` - Ingest all pages/databases

## Main Services

### Graph Services (`services_graph.py`)
- `get_concept_by_id()` - Retrieve concept by node_id
- `get_concept_by_name()` - Retrieve concept by name
- `create_concept()` - Create new concept node
- `create_relationship()` - Create relationship by concept names
- `create_relationship_by_ids()` - Create relationship by node IDs
- `get_neighbors()` - Get neighbor concepts
- `delete_concept()` - Delete concept and relationships
- `delete_relationship()` - Delete specific relationship
- `get_nodes_missing_description()` - Find concepts without descriptions
- `find_concept_gaps()` - Find concepts with low degree/short descriptions
- Personalization functions: `get_response_style_profile()`, `update_response_style_profile()`, `get_focus_areas()`, `upsert_focus_area()`, `get_user_profile()`, `update_user_profile()`, `get_notion_config()`, `update_notion_config()`

### Lecture Ingestion Service (`services_lecture_ingestion.py`)
- `ingest_lecture()` - Main ingestion function that:
  1. Calls LLM to extract nodes and links from lecture text
  2. Upserts nodes (creates new or updates existing by name+domain)
  3. Creates relationships between concepts
  4. Returns `LectureIngestResult` with created/updated nodes and links
- `call_llm_for_extraction()` - Calls OpenAI API to extract concepts/relationships
- `find_concept_by_name_and_domain()` - Find existing concept for upsert logic
- `update_concept_description_if_better()` - Update description only if new one is longer
- `update_concept_tags()` - Merge tags with existing tags

### Notion Sync Service (`notion_sync.py`)
- `sync_once()` - Perform a single sync cycle:
  1. Load last sync timestamp
  2. Find updated pages since last sync
  3. Convert each page to lecture format
  4. Ingest each page as a lecture
  5. Save new sync timestamp
- `load_last_sync_timestamp()` - Load timestamp from local JSON file
- `save_last_sync_timestamp()` - Save timestamp to local JSON file
- `find_updated_pages_since()` - Query Notion API for updated pages
- `page_to_lecture()` - Convert Notion page object to (title, text, domain) tuple

### Sync Service (`services_sync.py`)
- `auto_export_csv()` - Export Neo4j graph to CSV files (can run in background)

## Error Logging

### Current State
- Basic logging is set up in `main.py` using Python's `logging` module
- Some endpoints catch exceptions and return HTTPException with error messages
- Startup errors are logged with `exc_info=True` for stack traces

### Error Handling Strategy
- **4xx errors** (client errors): Logged at WARNING level with request context
- **5xx errors** (server errors): Logged at ERROR level with full stack traces
- **Unhandled exceptions**: Caught by global exception handler, logged with stack trace, returned as sanitized 500 error
- **Validation errors**: FastAPI automatically returns 422 with validation details

### Implementation
- Global exception handler in `main.py` catches all unhandled exceptions
- Logs full exception details with stack trace
- Returns generic error message to client (prevents leaking internal details)
- Uses structured logging with context (endpoint, method, error type)

## Running Tests

### Prerequisites

**Important**: Always activate the virtual environment before running tests!

```bash
# Activate virtual environment
source .venv/bin/activate  # Linux/Mac
# OR
.venv\Scripts\activate      # Windows

# Install test dependencies (if not already installed)
pip install pytest pytest-mock pytest-asyncio httpx

# Make sure all project dependencies are installed
pip install -r requirements.txt
```

### Run All Tests
```bash
cd backend
pytest
```

### Run Specific Test File
```bash
pytest tests/test_concepts_api.py
pytest tests/test_lectures_api.py
pytest tests/test_admin_api.py
```

### Run with Verbose Output
```bash
pytest -v
```

### Run with Coverage
```bash
pytest --cov=. --cov-report=html
```

### Run Specific Test
```bash
pytest tests/test_concepts_api.py::test_get_concept_by_id_success
```

### Run Tests Matching Pattern
```bash
pytest -k "test_get_concept"
```

## Extending Tests

### Adding Tests for New Endpoints

1. **Identify the endpoint** in the appropriate API router file (`api_*.py`)

2. **Create test functions** in the corresponding test file:
   ```python
   def test_new_endpoint_success(client, mock_neo4j_session):
       """Test happy path for new endpoint."""
       # Arrange
       mock_neo4j_session.run.return_value.single.return_value = {...}
       
       # Act
       response = client.get("/new/endpoint")
       
       # Assert
       assert response.status_code == 200
       assert response.json() == {...}
   ```

3. **Add error path tests**:
   ```python
   def test_new_endpoint_not_found(client, mock_neo4j_session):
       """Test error path when resource not found."""
       mock_neo4j_session.run.return_value.single.return_value = None
       
       response = client.get("/new/endpoint/123")
       assert response.status_code == 404
   ```

### Adding Tests for New Services

1. **Create a new test file** if needed: `test_new_service.py`

2. **Mock external dependencies** using fixtures from `conftest.py`

3. **Test service functions directly** (not just API endpoints):
   ```python
   def test_service_function(mock_neo4j_session):
       from services_new import new_service_function
       
       result = new_service_function(mock_neo4j_session, ...)
       assert result == expected
   ```

### Mocking Patterns

- **Neo4j**: Use `mock_neo4j_session` fixture - mock `session.run()` return values
- **OpenAI**: Use `mock_openai_client` fixture - mock `client.chat.completions.create()`
- **Notion**: Use `mock_notion_client` fixture - mock Notion API calls
- **File I/O**: Use `tmp_path` fixture from pytest for temporary files

### Test Naming Conventions

- `test_{endpoint}_{scenario}` - e.g., `test_get_concept_by_id_success`
- `test_{endpoint}_{error_type}` - e.g., `test_get_concept_by_id_not_found`
- `test_{service_function}_{scenario}` - e.g., `test_ingest_lecture_with_existing_nodes`

## Test Structure

```
backend/tests/
├── __init__.py
├── conftest.py              # Shared fixtures and mocks
├── README_TESTS.md          # This file
├── test_concepts_api.py     # Concepts API endpoint tests
├── test_lectures_api.py     # Lectures API endpoint tests
├── test_admin_api.py        # Admin API endpoint tests
├── test_preferences_api.py  # Preferences API endpoint tests
├── test_notion_sync.py      # Notion sync service tests
└── test_error_logging.py    # Error logging verification tests
```

## Notes

- All tests use **mocks** - no real external services are called
- Tests are **fast** and **deterministic** - no network calls or database operations
- Tests can be run in **any environment** - no need for Neo4j, OpenAI, or Notion credentials
- **Background tasks** are mocked - CSV exports and other async operations don't actually run
- **File I/O** uses temporary paths - no real files are created/modified

## Test Coverage Summary

### Concepts API (`test_concepts_api.py`)
- ✅ GET by ID (success, not found)
- ✅ GET by name (success, not found)
- ✅ POST create (success, validation errors)
- ✅ POST relationship (success, duplicate handling)
- ✅ POST relationship-by-ids (success)
- ✅ GET neighbors (success, empty)
- ✅ DELETE concept (success, not found)
- ✅ DELETE relationship (success, not found)
- ✅ GET missing descriptions
- ✅ GET concept gaps

### Lectures API (`test_lectures_api.py`)
- ✅ POST ingest (success, validation errors, LLM errors, internal errors)
- ✅ POST create lecture (success, validation errors)
- ✅ GET lecture (success, not found)
- ✅ POST add step (success, invalid concept)
- ✅ GET steps (success, empty)

### Admin API (`test_admin_api.py`)
- ✅ POST import (success, error)
- ✅ POST export (success, error)
- ✅ POST sync-notion (success, with errors, complete failure)
- ✅ GET notion pages (success, error)
- ✅ POST toggle indexing (success, error)
- ✅ POST unlink page (success, no lectures, error)
- ✅ GET/POST notion-config (success, default)

### Preferences API (`test_preferences_api.py`)
- ✅ GET/POST response-style (success, default)
- ✅ GET/POST focus areas (list, create, toggle, not found)
- ✅ GET/POST user-profile (success, default)

### Notion Sync Service (`test_notion_sync.py`)
- ✅ State management (load/save timestamps, invalid file)
- ✅ Find updated pages (no timestamp, with timestamp, empty)
- ✅ Page to lecture conversion (success, missing title, missing content)
- ✅ Sync once (no pages, with pages, ingestion errors, not indexed)

### Error Logging (`test_error_logging.py`)
- ✅ Unhandled exceptions (logged, sanitized)
- ✅ HTTP exceptions (4xx as warning, 5xx as error, not double-wrapped)
- ✅ Validation errors (logged, detailed response)
- ✅ Service-level errors (ValueError vs generic Exception)

## Quick Reference

### Running Tests
```bash
# All tests
pytest

# Specific file
pytest tests/test_concepts_api.py

# Specific test
pytest tests/test_concepts_api.py::TestGetConceptById::test_get_concept_by_id_success

# With coverage
pytest --cov=. --cov-report=html

# Verbose output
pytest -v

# Show print statements
pytest -s
```

### Common Issues

**Import errors**: Make sure you're in the `backend/` directory and have activated your virtual environment.

**Mock not working**: Check that you're using the correct fixture name (e.g., `mock_neo4j_driver` not `mock_neo4j_session` for API tests).

**Test endpoint conflicts**: If you add test endpoints in `test_error_logging.py`, they're isolated to that test file and won't affect other tests.
