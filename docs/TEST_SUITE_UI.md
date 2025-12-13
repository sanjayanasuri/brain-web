# Test Suite UI

The Brain Web project now includes a web-based test suite UI for running and monitoring pytest tests.

## Access

Navigate to `/tests` in the frontend to access the Test Suite UI.

## Features

- **Test Organization**: Tests are organized by feature area (Graph & Concepts, Lectures, Teaching Style, Preferences, Notion Sync, Admin, AI, Core)
- **Selective Running**: Select individual tests or entire test suites to run
- **Real-time Results**: View test results with pass/fail status and output
- **Test Metadata**: Each test includes a human-readable description of expected behavior

## Backend API

### GET `/tests/manifest`

Returns the test manifest with all test suites and individual tests.

**Response:**
```json
{
  "suites": [
    {
      "id": "graph-concepts",
      "label": "Graph & Concepts",
      "description": "Tests for concept CRUD, relationships, and graph operations",
      "tests": [
        {
          "id": "test_get_concept_by_id_success",
          "path": "tests/test_concepts_api.py::TestGetConceptById::test_get_concept_by_id_success",
          "description": "Successfully getting a concept by node_id returns correct data.",
          "enabled": true
        }
      ]
    }
  ]
}
```

### POST `/tests/run`

Runs selected tests and returns results.

**Request:**
```json
{
  "tests": ["tests/test_concepts_api.py::TestGetConceptById::test_get_concept_by_id_success"],
  "suite_ids": ["graph-concepts"]  // optional
}
```

**Response:**
```json
{
  "results": [
    {
      "path": "tests/test_concepts_api.py::...",
      "passed": true,
      "output": "pytest output...",
      "duration": null
    }
  ],
  "success": true,
  "total_tests": 1,
  "passed_tests": 1,
  "failed_tests": 0
}
```

## Implementation Details

- **Backend**: `backend/api_tests.py` - FastAPI router for test endpoints
- **Manifest**: `backend/tests_manifest.py` - Centralized test metadata
- **Frontend**: `frontend/app/tests/page.tsx` - React component for test UI

## Adding New Tests

To add a new test to the manifest, edit `backend/tests_manifest.py` and add the test to the appropriate suite:

```python
{
    "id": "test_my_new_test",
    "path": "tests/test_my_feature.py::TestMyFeature::test_my_new_test",
    "description": "Human-readable description of what this test verifies.",
    "enabled": True,
}
```

The path format is: `tests/<test_file>.py::<TestClass>::<test_method>` or `tests/<test_file>.py::<test_function>`.
