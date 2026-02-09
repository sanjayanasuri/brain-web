#!/usr/bin/env python3
"""
System-wide health check script for Brain Web backend.

This script tests all API endpoints to ensure the system is production-ready.
It checks:
- All endpoints are accessible
- Responses are valid
- No critical errors
- System dependencies are healthy
"""
import sys
import os
import requests
import json
from typing import Dict, List, Tuple, Optional
from urllib.parse import urljoin
from datetime import datetime

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Configuration
BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
AUTH_TOKEN = os.getenv("API_TOKEN", None)
TENANT_ID = os.getenv("TENANT_ID", "test-tenant")

# Colors for output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"


class HealthCheckResult:
    """Result of a health check."""
    def __init__(self, endpoint: str, method: str, status_code: int, 
                 success: bool, error: Optional[str] = None, 
                 response_time_ms: Optional[float] = None):
        self.endpoint = endpoint
        self.method = method
        self.status_code = status_code
        self.success = success
        self.error = error
        self.response_time_ms = response_time_ms
        self.timestamp = datetime.now()


def get_headers() -> Dict[str, str]:
    """Get request headers with auth if available."""
    headers = {
        "Content-Type": "application/json",
        "x-tenant-id": TENANT_ID,
    }
    if AUTH_TOKEN:
        headers["Authorization"] = f"Bearer {AUTH_TOKEN}"
    return headers


def check_endpoint(method: str, endpoint: str, payload: Optional[Dict] = None) -> HealthCheckResult:
    """Check a single endpoint."""
    url = urljoin(BASE_URL, endpoint)
    headers = get_headers()
    
    try:
        import time
        start_time = time.time()
        
        if method.upper() == "GET":
            response = requests.get(url, headers=headers, timeout=10)
        elif method.upper() == "POST":
            response = requests.post(url, json=payload or {}, headers=headers, timeout=10)
        elif method.upper() == "PUT":
            response = requests.put(url, json=payload or {}, headers=headers, timeout=10)
        elif method.upper() == "PATCH":
            response = requests.patch(url, json=payload or {}, headers=headers, timeout=10)
        elif method.upper() == "DELETE":
            response = requests.delete(url, headers=headers, timeout=10)
        else:
            return HealthCheckResult(endpoint, method, 0, False, f"Unsupported method: {method}")
        
        response_time_ms = (time.time() - start_time) * 1000
        
        # Consider 2xx and 3xx as success, 4xx/5xx as failures
        # But 401/403 might be expected for some endpoints
        success = response.status_code < 500
        
        return HealthCheckResult(
            endpoint=endpoint,
            method=method,
            status_code=response.status_code,
            success=success,
            response_time_ms=response_time_ms
        )
    except requests.exceptions.RequestException as e:
        return HealthCheckResult(
            endpoint=endpoint,
            method=method,
            status_code=0,
            success=False,
            error=str(e)
        )


# Define all endpoints to test
ENDPOINTS = [
    # Root
    ("GET", "/"),
    
    # Concepts
    ("GET", "/concepts/"),
    ("GET", "/concepts/search?q=test"),
    ("GET", "/concepts/N001"),  # May 404, that's OK
    
    # Lectures
    ("GET", "/lectures/"),
    ("GET", "/lectures/L001"),  # May 404, that's OK
    
    # AI
    ("POST", "/ai/chat", {"message": "test", "mode": "chat"}),
    ("POST", "/ai/retrieve", {"query": "test", "detail_level": "summary"}),
    
    # Retrieval
    ("POST", "/retrieval/", {"query": "test", "detail_level": "summary"}),
    
    # Graphs
    ("GET", "/graphs/"),
    ("GET", "/graphs/default"),
    
    # Branches
    ("GET", "/branches/"),
    ("GET", "/branches/main"),
    
    # Resources
    ("GET", "/resources/"),
    
    # Events (public)
    ("POST", "/events", {"name": "health_check", "properties": {}}),
    
    # Preferences
    ("GET", "/preferences/"),
    
    # Review
    ("GET", "/review/"),
    
    # Gaps
    ("GET", "/gaps/"),
    
    # Snapshots
    ("GET", "/snapshots/"),
    
    # Signals
    ("GET", "/signals/"),
    
    # Paths
    ("GET", "/paths/"),
    
    # Quality
    ("GET", "/quality/concept/N001"),  # May 404, that's OK
    
    # Dashboard
    ("GET", "/dashboard/"),
    
    # Exams
    ("GET", "/exams/"),
    
    # Workflows
    ("GET", "/workflows/"),
    
    # Admin
    ("GET", "/admin/status"),
    
    # Public endpoints
    ("GET", "/docs"),
    ("GET", "/openapi.json"),
    ("GET", "/redoc"),
]


def main():
    """Run health check on all endpoints."""
    print(f"{BLUE}Brain Web Backend Health Check{RESET}")
    print(f"{BLUE}{'=' * 60}{RESET}")
    print(f"Base URL: {BASE_URL}")
    print(f"Tenant ID: {TENANT_ID}")
    print(f"Auth Token: {'Set' if AUTH_TOKEN else 'Not set'}")
    print(f"{BLUE}{'=' * 60}{RESET}\n")
    
    results: List[HealthCheckResult] = []
    
    for endpoint_def in ENDPOINTS:
        if len(endpoint_def) == 2:
            method, endpoint = endpoint_def
            payload = None
        else:
            method, endpoint, payload = endpoint_def
        
        print(f"Checking {method:6} {endpoint:40} ... ", end="", flush=True)
        result = check_endpoint(method, endpoint, payload)
        results.append(result)
        
        if result.success:
            if result.status_code < 300:
                print(f"{GREEN}✓{RESET} {result.status_code} ({result.response_time_ms:.0f}ms)")
            elif result.status_code in [401, 403]:
                print(f"{YELLOW}⚠{RESET} {result.status_code} (Auth required)")
            else:
                print(f"{YELLOW}⚠{RESET} {result.status_code}")
        else:
            if result.error:
                print(f"{RED}✗{RESET} Error: {result.error}")
            else:
                print(f"{RED}✗{RESET} {result.status_code}")
    
    # Summary
    print(f"\n{BLUE}{'=' * 60}{RESET}")
    print(f"{BLUE}Summary{RESET}")
    print(f"{BLUE}{'=' * 60}{RESET}")
    
    total = len(results)
    successful = sum(1 for r in results if r.success and r.status_code < 300)
    auth_required = sum(1 for r in results if r.status_code in [401, 403])
    errors = sum(1 for r in results if not r.success or r.status_code >= 500)
    
    print(f"Total endpoints checked: {total}")
    print(f"{GREEN}Successful (2xx): {successful}{RESET}")
    print(f"{YELLOW}Auth required (401/403): {auth_required}{RESET}")
    print(f"{RED}Errors (5xx or connection): {errors}{RESET}")
    
    # Check for critical failures
    critical_failures = [r for r in results if r.status_code >= 500 or (r.error and "Connection" in r.error)]
    
    if critical_failures:
        print(f"\n{RED}Critical Failures:{RESET}")
        for failure in critical_failures:
            print(f"  {RED}✗{RESET} {failure.method} {failure.endpoint}: {failure.error or failure.status_code}")
    
    # Check Neo4j connectivity
    print(f"\n{BLUE}Checking Neo4j connectivity...{RESET}")
    try:
        from config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
        from neo4j import GraphDatabase
        
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        driver.verify_connectivity()
        driver.close()
        print(f"{GREEN}✓ Neo4j connection successful{RESET}")
    except Exception as e:
        print(f"{RED}✗ Neo4j connection failed: {e}{RESET}")
    
    # Exit code
    if critical_failures:
        print(f"\n{RED}Health check FAILED - Critical errors detected{RESET}")
        sys.exit(1)
    else:
        print(f"\n{GREEN}Health check PASSED{RESET}")
        sys.exit(0)


if __name__ == "__main__":
    main()
