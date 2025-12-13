# Demo Mode Setup Guide

This guide explains how to set up Brain Web in demo/trial mode for public access on your portfolio website.

## Overview

Demo mode allows visitors to try Brain Web without requiring their own API keys or database setup. The demo uses:
- **Your API keys** (OpenAI, Neo4j) - shared securely with rate limiting
- **Isolated graph instances** - each demo session gets its own isolated graph
- **Pre-seeded demo data** - interesting sample concepts and relationships
- **Session limits** - timeouts and query limits to prevent abuse

## Architecture

### Option 1: Separate Demo Database (Recommended)

```
Production Database (neo4j)     Demo Database (neo4j-demo)
├── Your personal graph         ├── Demo session 1
├── Your lectures               ├── Demo session 2
└── Your concepts               └── Demo session 3
```

**Pros:**
- Complete isolation from your data
- Easy to reset/cleanup
- Can use same Neo4j instance with different databases

**Cons:**
- Requires Neo4j multi-database support (Neo4j 4.0+)
- Need to manage demo database lifecycle

### Option 2: Namespace Isolation

```
Single Database (neo4j)
├── production:namespace
│   ├── Your personal graph
│   └── Your concepts
└── demo:namespace
    ├── Demo session 1
    └── Demo session 2
```

**Pros:**
- Works with any Neo4j version
- Single database to manage

**Cons:**
- Requires code changes to add namespace prefixes
- More complex query isolation

## Implementation Steps

### 1. Backend Changes

#### Add Demo Session Management

Create `backend/demo_session.py`:

```python
from datetime import datetime, timedelta
from typing import Optional, Dict
import uuid
from neo4j import Session

class DemoSession:
    def __init__(self, session_id: str, created_at: datetime, query_count: int = 0):
        self.session_id = session_id
        self.created_at = created_at
        self.query_count = query_count
        self.max_queries = 20
        self.timeout_minutes = 30
    
    def is_expired(self) -> bool:
        return datetime.now() - self.created_at > timedelta(minutes=self.timeout_minutes)
    
    def can_query(self) -> bool:
        return not self.is_expired() and self.query_count < self.max_queries
    
    def increment_query(self):
        self.query_count += 1

# In-memory session store (use Redis in production)
demo_sessions: Dict[str, DemoSession] = {}

def create_demo_session() -> str:
    session_id = str(uuid.uuid4())
    demo_sessions[session_id] = DemoSession(session_id, datetime.now())
    return session_id

def get_demo_session(session_id: str) -> Optional[DemoSession]:
    return demo_sessions.get(session_id)

def cleanup_expired_sessions():
    expired = [sid for sid, session in demo_sessions.items() if session.is_expired()]
    for sid in expired:
        del demo_sessions[sid]
```

#### Modify Neo4j Connection for Demo Mode

Update `backend/db_neo4j.py`:

```python
from config import DEMO_MODE_ENABLED, DEMO_NEO4J_DATABASE

def get_neo4j_session(demo_session_id: Optional[str] = None):
    driver = get_neo4j_driver()
    
    if demo_session_id and DEMO_MODE_ENABLED:
        # Use demo database
        database = DEMO_NEO4J_DATABASE or "demo"
        session = driver.session(database=database)
    else:
        # Use default database
        session = driver.session()
    
    try:
        yield session
    finally:
        session.close()
```

#### Add Demo Endpoints

Create `backend/api_demo.py`:

```python
from fastapi import APIRouter, HTTPException, Depends
from models import DemoSessionResponse, DemoQueryRequest
from demo_session import create_demo_session, get_demo_session, cleanup_expired_sessions
from db_neo4j import get_neo4j_session

router = APIRouter(prefix="/demo", tags=["demo"])

@router.post("/session", response_model=DemoSessionResponse)
async def create_session():
    """Create a new demo session"""
    cleanup_expired_sessions()
    session_id = create_demo_session()
    return {"session_id": session_id, "queries_remaining": 20}

@router.get("/session/{session_id}")
async def get_session(session_id: str):
    """Get demo session status"""
    session = get_demo_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.is_expired():
        raise HTTPException(status_code=410, detail="Session expired")
    return {
        "session_id": session_id,
        "queries_remaining": session.max_queries - session.query_count,
        "expires_at": (session.created_at + timedelta(minutes=session.timeout_minutes)).isoformat()
    }

@router.post("/query")
async def demo_query(request: DemoQueryRequest):
    """Execute a demo query (with rate limiting)"""
    session = get_demo_session(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.can_query():
        raise HTTPException(status_code=429, detail="Query limit reached or session expired")
    
    session.increment_query()
    # Execute query with demo session isolation
    # ...
```

#### Add Rate Limiting Middleware

```python
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

class DemoRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith("/demo/"):
            session_id = request.headers.get("X-Demo-Session-Id")
            if session_id:
                session = get_demo_session(session_id)
                if session and not session.can_query():
                    raise HTTPException(status_code=429, detail="Rate limit exceeded")
        return await call_next(request)
```

### 2. Frontend Changes

#### Add Demo Route

Create `frontend/app/demo/page.tsx`:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DemoPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [queriesRemaining, setQueriesRemaining] = useState(20);
  const router = useRouter();

  useEffect(() => {
    // Create demo session on mount
    fetch('/api/demo/session', { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        setSessionId(data.session_id);
        setQueriesRemaining(data.queries_remaining);
      });
  }, []);

  if (!sessionId) {
    return <div>Loading demo...</div>;
  }

  return (
    <div>
      <div className="demo-banner">
        <p>Demo Mode - {queriesRemaining} queries remaining</p>
      </div>
      {/* Render GraphVisualization with demo session ID */}
    </div>
  );
}
```

#### Modify API Client for Demo Mode

Update `frontend/app/api-client.ts`:

```typescript
const DEMO_SESSION_ID = typeof window !== 'undefined' 
  ? localStorage.getItem('demo_session_id') 
  : null;

async function apiCall(endpoint: string, options: RequestInit = {}) {
  const headers = {
    ...options.headers,
    ...(DEMO_SESSION_ID && { 'X-Demo-Session-Id': DEMO_SESSION_ID }),
  };
  
  const url = DEMO_SESSION_ID 
    ? `/api/demo${endpoint}` 
    : endpoint;
  
  return fetch(url, { ...options, headers });
}
```

### 3. Demo Data Seeding

Create `backend/scripts/seed_demo_data.py`:

```python
from db_neo4j import get_neo4j_driver
from services_graph import create_concept, create_relationship

def seed_demo_data(database: str = "demo"):
    """Seed demo database with interesting sample data"""
    driver = get_neo4j_driver()
    session = driver.session(database=database)
    
    try:
        # Clear existing data
        session.run("MATCH (n) DETACH DELETE n")
        
        # Create sample concepts
        concepts = [
            {"name": "Machine Learning", "domain": "AI", "description": "..."},
            {"name": "Neural Networks", "domain": "AI", "description": "..."},
            {"name": "Backpropagation", "domain": "AI", "description": "..."},
            # ... more concepts
        ]
        
        for concept in concepts:
            create_concept(session, **concept)
        
        # Create sample relationships
        relationships = [
            ("Machine Learning", "Neural Networks", "INCLUDES"),
            ("Neural Networks", "Backpropagation", "USES"),
            # ... more relationships
        ]
        
        for source, target, predicate in relationships:
            create_relationship(session, source, target, predicate)
        
        print(f"Demo data seeded successfully in database: {database}")
    finally:
        session.close()
```

### 4. Environment Configuration

Update `backend/config.py`:

```python
# Demo mode configuration
DEMO_MODE_ENABLED = os.getenv("DEMO_MODE_ENABLED", "false").lower() in ("true", "1", "yes")
DEMO_SESSION_TIMEOUT = int(os.getenv("DEMO_SESSION_TIMEOUT", "1800"))  # 30 minutes
DEMO_QUERY_LIMIT = int(os.getenv("DEMO_QUERY_LIMIT", "20"))
DEMO_NEO4J_DATABASE = os.getenv("DEMO_NEO4J_DATABASE", "demo")
```

Update `.env.example`:

```bash
# Demo Mode
DEMO_MODE_ENABLED=false
DEMO_SESSION_TIMEOUT=1800
DEMO_QUERY_LIMIT=20
DEMO_NEO4J_DATABASE=demo
```

### 5. Deployment Checklist

- [ ] Create demo Neo4j database
- [ ] Seed demo data
- [ ] Configure environment variables
- [ ] Enable demo mode in backend
- [ ] Deploy frontend with demo route
- [ ] Test demo session creation
- [ ] Test query limits
- [ ] Test session expiration
- [ ] Add demo link to portfolio website
- [ ] Monitor demo usage and costs

## Security Considerations

1. **Rate Limiting**: Enforce query limits per session
2. **Session Expiration**: Auto-expire sessions after timeout
3. **Input Validation**: Validate all demo inputs
4. **Resource Limits**: Limit file uploads, graph size in demo mode
5. **Monitoring**: Track demo usage to detect abuse
6. **Cost Control**: Set OpenAI API usage limits

## Cost Management

### OpenAI API Costs (Demo Mode)

**Estimated costs per demo session:**
- Semantic search: ~$0.0001 per query
- Chat response: ~$0.001 per query
- Lecture ingestion: ~$0.01 per lecture

**With 20 queries per session:**
- Average cost per session: ~$0.02
- 100 sessions/day: ~$2/day
- 1000 sessions/month: ~$60/month

**Recommendations:**
- Set OpenAI usage limits in your account
- Monitor costs via OpenAI dashboard
- Consider caching common queries
- Use cheaper models (GPT-4o-mini) for demo

### Neo4j Costs

- Free tier: Up to 1GB data
- Demo database: ~10MB per 1000 concepts
- Estimated: Free tier sufficient for demo

## Testing Demo Mode

### Manual Testing

1. **Create Session:**
   ```bash
   curl -X POST http://localhost:8000/demo/session
   ```

2. **Check Status:**
   ```bash
   curl http://localhost:8000/demo/session/{session_id}
   ```

3. **Make Query:**
   ```bash
   curl -X POST http://localhost:8000/demo/query \
     -H "X-Demo-Session-Id: {session_id}" \
     -d '{"query": "What is machine learning?"}'
   ```

4. **Test Limits:**
   - Make 20 queries (should succeed)
   - Make 21st query (should fail with 429)

### Automated Testing

Create `backend/tests/test_demo.py`:

```python
def test_demo_session_creation():
    response = client.post("/demo/session")
    assert response.status_code == 200
    assert "session_id" in response.json()

def test_demo_query_limit():
    session = create_demo_session()
    for i in range(20):
        response = client.post("/demo/query", 
            headers={"X-Demo-Session-Id": session.session_id},
            json={"query": "test"})
        assert response.status_code == 200
    
    # 21st query should fail
    response = client.post("/demo/query",
        headers={"X-Demo-Session-Id": session.session_id},
        json={"query": "test"})
    assert response.status_code == 429
```

## Monitoring & Analytics

### Key Metrics to Track

1. **Session Metrics:**
   - Sessions created per day
   - Average queries per session
   - Session completion rate

2. **Usage Metrics:**
   - Total queries per day
   - Peak usage times
   - Most common queries

3. **Cost Metrics:**
   - OpenAI API costs per day
   - Cost per session
   - Cost per query

4. **Error Metrics:**
   - Rate limit hits
   - Session expiration rate
   - API errors

### Recommended Tools

- **OpenAI Dashboard**: Monitor API usage and costs
- **Neo4j Browser**: Monitor database usage
- **Application Logs**: Track demo sessions and errors
- **Analytics**: Google Analytics or similar for frontend

## Troubleshooting

### Common Issues

1. **Sessions Expiring Too Quickly**
   - Check `DEMO_SESSION_TIMEOUT` setting
   - Verify server time is correct

2. **Query Limits Too Restrictive**
   - Adjust `DEMO_QUERY_LIMIT`
   - Consider different limits for different operations

3. **Demo Data Not Loading**
   - Verify demo database exists
   - Check seed script ran successfully
   - Verify database permissions

4. **High API Costs**
   - Review OpenAI usage dashboard
   - Consider caching common queries
   - Reduce query limits if needed

## Next Steps

1. Implement demo session management
2. Create demo data seeder
3. Add demo route to frontend
4. Test end-to-end demo flow
5. Deploy to staging environment
6. Monitor usage and costs
7. Deploy to production
8. Add demo link to portfolio

---

*This guide will be updated as demo mode is implemented.*
