"""
API endpoints for test suite management and execution.

Provides endpoints to:
- Get test manifest (suites and tests metadata)
- Run selected tests via pytest
"""
from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import subprocess
import os
from pathlib import Path

from tests_manifest import TEST_SUITES

router = APIRouter(prefix="/tests", tags=["tests"])


class TestRunRequest(BaseModel):
    """Request model for running tests."""
    tests: Optional[List[str]] = None  # list of `path::test_name`
    suite_ids: Optional[List[str]] = None  # optional: run all tests in these suites


class TestResult(BaseModel):
    """Result for a single test or test group."""
    path: str
    passed: bool
    output: Optional[str] = None
    duration: Optional[float] = None


class TestRunResponse(BaseModel):
    """Response model for test run results."""
    results: List[TestResult]
    success: bool
    total_tests: int
    passed_tests: int
    failed_tests: int


@router.get("/manifest")
def get_tests_manifest() -> Dict[str, Any]:
    """
    Return the test suites and tests metadata.
    
    Returns:
        Dictionary with "suites" key containing list of test suites,
        each with id, label, description, and list of tests.
    """
    return {"suites": TEST_SUITES}


@router.post("/run", response_model=TestRunResponse)
def run_tests(payload: TestRunRequest) -> TestRunResponse:
    """
    Run pytest on selected tests and return structured results.
    
    Args:
        payload: TestRunRequest with either:
            - tests: list of specific test paths (e.g., ["backend/tests/test_concepts_api.py::TestGetConceptById::test_get_concept_by_id_success"])
            - suite_ids: list of suite IDs to run all tests in those suites
    
    Returns:
        TestRunResponse with results for each test/group
    """
    selected_paths: List[str] = []
    
    # Collect test paths from direct test list
    if payload.tests:
        selected_paths.extend(payload.tests)
    
    # Collect test paths from suite IDs
    if payload.suite_ids:
        for suite_id in payload.suite_ids:
            suite = next((s for s in TEST_SUITES if s["id"] == suite_id), None)
            if suite:
                for t in suite["tests"]:
                    if t.get("enabled", True):
                        selected_paths.append(t["path"])
    
    # Deduplicate while preserving order
    seen = set()
    unique_paths = []
    for path in selected_paths:
        if path not in seen:
            seen.add(path)
            unique_paths.append(path)
    
    selected_paths = unique_paths
    
    if not selected_paths:
        raise HTTPException(status_code=400, detail="No tests selected")
    
    # Get the backend directory (parent of this file)
    backend_dir = Path(__file__).parent
    repo_root = backend_dir.parent
    
    # Run pytest as a subprocess
    # Use -v for verbose, --tb=short for shorter tracebacks, --no-header for cleaner output
    # pytest.ini is in backend/, so we need to run from backend/ or specify the config
    cmd = [
        "pytest",
        "-v",
        "--tb=short",
        "--no-header",
        "-q",  # quiet mode for summary
    ] + selected_paths
    
    try:
        # Change to backend directory since pytest.ini is there
        # Test paths in manifest are like "tests/test_*.py" which pytest will find from backend/
        completed = subprocess.run(
            cmd,
            cwd=str(backend_dir),
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Test execution timed out after 5 minutes")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to run pytest: {str(e)}")
    
    # Parse output to determine success
    # pytest returns exit code 0 on success, non-zero on failure
    success = completed.returncode == 0
    
    # Combine stdout and stderr
    output = (completed.stdout + "\n" + completed.stderr).strip()
    
    # Try to parse test results from output
    # For now, we'll create a single result entry for the entire run
    # In the future, we could use pytest-json-report or similar to get per-test results
    passed_count = 0
    failed_count = 0
    
    # Simple heuristic: count "PASSED" and "FAILED" in output
    if output:
        passed_count = output.count("PASSED")
        failed_count = output.count("FAILED")
    
    # If we can't parse individual results, treat as single group result
    if passed_count == 0 and failed_count == 0:
        # Create a single result for the entire run
        results = [
            TestResult(
                path=", ".join(selected_paths[:3]) + ("..." if len(selected_paths) > 3 else ""),
                passed=success,
                output=output,
            )
        ]
        total_tests = len(selected_paths)
        passed_tests = 1 if success else 0
        failed_tests = 0 if success else 1
    else:
        # We have parsed results
        results = [
            TestResult(
                path=", ".join(selected_paths[:3]) + ("..." if len(selected_paths) > 3 else ""),
                passed=success,
                output=output,
            )
        ]
        total_tests = passed_count + failed_count
        passed_tests = passed_count
        failed_tests = failed_count
    
    return TestRunResponse(
        results=results,
        success=success,
        total_tests=total_tests,
        passed_tests=passed_tests,
        failed_tests=failed_tests,
    )
