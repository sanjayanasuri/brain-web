# API Test Suite

Automated tests for all Brain Web Backend API endpoints.

## Running Tests

### Run all tests:
```bash
cd backend
source .venv/bin/activate
pytest
```

### Run specific test file:
```bash
pytest tests/test_concepts.py
```

### Run with verbose output:
```bash
pytest -v
```

### Run specific test:
```bash
pytest tests/test_concepts.py::test_get_concept_by_id
```

### Run with coverage:
```bash
pytest --cov=. --cov-report=html
```

## Test Structure

- `test_root.py` - Root endpoint tests
- `test_concepts.py` - Concept CRUD and relationship tests
- `test_ai.py` - AI chat endpoint tests
- `test_lectures.py` - Lecture management tests
- `test_admin.py` - Admin operations (import/export) - skipped by default

## Prerequisites

1. Neo4j must be running
2. `.env` file must be configured with Neo4j credentials
3. Virtual environment must be activated
4. Test data should be imported (run `python scripts/import_csv_to_neo4j.py` first)

## Notes

- Tests use the actual Neo4j database (not a mock)
- Admin tests are skipped by default as they modify the database
- Tests use unique names (with timestamps) to avoid conflicts when running multiple times
- Some tests create temporary data that remains in the database (this is expected behavior)

