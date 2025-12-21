# Demo Mode Implementation Status

## Overview
This document tracks the status of converting Brain Web from a dev system into a safe, public-facing read-only demo environment.

## ✅ Completed Components

### 1. Centralized Demo Gate Middleware
- **Location**: `backend/main.py` - `demo_gate_and_observability` middleware
- **Status**: ✅ Complete
- **Features**:
  - Enforces demo mode rules on every request
  - Blocks blocked paths (403)
  - Blocks write methods unless in safe_write_paths (405)
  - Rate limiting (per IP and per session)
  - Request logging with structured JSON
  - Session cookie management

### 2. Startup Behavior Gating
- **Location**: `backend/main.py` - `lifespan` function
- **Status**: ✅ Complete
- **Features**:
  - CSV auto-import disabled when `DEMO_MODE=true`
  - Notion auto-sync disabled when `DEMO_MODE=true`
  - Graceful handling when Neo4j is unreachable

### 3. Router-Level Blocking
- **Location**: `backend/main.py` - conditional router mounting
- **Status**: ✅ Complete
- **Blocked Routers** (not mounted in demo mode):
  - `/admin` - Admin endpoints
  - `/notion` - Notion integration
  - `/debug` - Debug endpoints
  - `/tests` - Test endpoints
  - `/connectors` - Connector ingestion (SEC, News, Prices sync)
  - `/finance` - Finance ingestion

### 4. Path-Level Blocking
- **Location**: `backend/demo_mode.py` - `path_is_blocked_in_demo()`
- **Status**: ✅ Complete
- **Blocked Paths**:
  - `/admin/*`
  - `/notion/*`
  - `/debug/*`
  - `/tests/*`
  - `/connectors/*`
  - `/finance/*`

### 5. Write Method Protection
- **Location**: `backend/demo_mode.py` - `enforce_demo_mode_request()`
- **Status**: ✅ Complete
- **Behavior**:
  - `DEMO_ALLOW_WRITES=false` by default (read-only demo)
  - Safe write paths allowlist: `/ai/chat`, `/ai/semantic-search`, `/events`
  - All other POST/PUT/PATCH/DELETE requests return 405

### 6. Rate Limiting
- **Location**: `backend/demo_mode.py` - `FixedWindowRateLimiter`
- **Status**: ✅ Complete
- **Limits**:
  - Per IP: 120 requests/minute (configurable)
  - Per Session: 60 requests/minute (configurable)
  - Returns 429 when exceeded

### 7. Detail Level Summary Mode
- **Location**: `backend/api_retrieval.py` - `_transform_to_summary_mode()`
- **Status**: ✅ Complete
- **Features**:
  - Default `detail_level="summary"` in `RetrievalRequest`
  - Caps: 5 entities, 5 claims, 3 sources, 10 edges
  - Strips verbose fields (descriptions, full chunks)
  - Frontend uses summary mode by default

### 8. Infrastructure as Code
- **Location**: `infra/envs/demo/`
- **Status**: ✅ Complete
- **Components**:
  - VPC with public/private subnets (2 AZs)
  - ECS Fargate cluster and service
  - Application Load Balancer (ALB)
  - ECR repository
  - Secrets Manager (Neo4j, OpenAI)
  - CloudWatch Logs
  - DynamoDB (events table)
  - WAFv2 with:
    - AWS Managed Rules Common Rule Set
    - Rate limiting (IP-based, configurable per 5 minutes)
  - Budgets (optional, requires email)
  - IAM roles and policies

### 9. CI/CD Pipeline
- **Location**: `.github/workflows/backend-deploy.yml`
- **Status**: ✅ Complete
- **Features**:
  - Builds Docker image on push to `main`
  - Pushes to ECR
  - Updates ECS task definition
  - Deploys to ECS Fargate
  - Uses OIDC for AWS authentication

### 10. Configuration
- **Location**: `backend/config.py`, `backend/env.example`
- **Status**: ✅ Complete
- **Demo Settings**:
  - `DEMO_MODE` - Enable/disable demo mode
  - `DEMO_ALLOW_WRITES` - Allow writes (default: false)
  - `DEMO_TENANT_ID` - Force tenant isolation
  - `DEMO_GRAPH_ID` - Force graph isolation
  - `DEMO_SAFE_WRITE_PATHS` - Allowlist for write endpoints
  - Rate limit configs
  - Bedrock token caps

## 🔒 Security Posture

### Blocked in Demo Mode
1. **Ingestion Endpoints**:
   - `/admin/*` - All admin operations
   - `/notion/*` - Notion integration
   - `/connectors/*` - SEC/News/Prices sync
   - `/finance/*` - Finance ingestion
   - `/debug/*` - Debug endpoints
   - `/tests/*` - Test endpoints

2. **Write Operations** (except safe paths):
   - `/concepts` - POST/PUT/DELETE (GET allowed)
   - `/lectures` - POST (GET allowed)
   - `/resources` - POST (GET allowed)
   - `/branches` - POST (GET allowed)
   - `/graphs` - POST/PATCH/DELETE (GET allowed)
   - `/snapshots` - POST (GET allowed)
   - `/review` - POST (GET allowed)
   - `/preferences` - POST (GET allowed)
   - `/teaching_style` - POST (GET allowed)

3. **Allowed Write Operations** (safe paths):
   - `/ai/chat` - POST (needed for chat functionality)
   - `/ai/semantic-search` - POST (needed for search)
   - `/events` - POST (needed for analytics)

### Protection Layers
1. **Application Layer**:
   - Demo mode middleware (path + method blocking)
   - Rate limiting (in-process)
   - Request logging

2. **Infrastructure Layer**:
   - WAFv2 (AWS managed rules + rate limiting)
   - ALB (public entry point)
   - VPC isolation (private subnets for ECS)
   - Secrets Manager (no secrets in code/images)

3. **Cost Controls**:
   - Budget alerts (optional)
   - Rate limiting (prevents cost blow-ups)

## 📋 Write Endpoints Review

### Read-Only Endpoints (GET) - ✅ Allowed in Demo
- `/concepts/*` - GET endpoints for reading concepts
- `/lectures/*` - GET endpoints for reading lectures
- `/resources/*` - GET endpoints for reading resources
- `/review/*` - GET endpoints for viewing proposed relationships
- `/gaps/*` - GET endpoints for viewing gaps
- `/graphs/*` - GET endpoints for viewing graphs
- `/branches/*` - GET endpoints for viewing branches
- `/snapshots/*` - GET endpoints for viewing snapshots
- `/ai/retrieve` - POST (read-only retrieval, allowed)
- `/ai/semantic-search` - POST (read-only search, in safe_write_paths)

### Write Endpoints - ✅ Blocked in Demo (unless in safe_write_paths)
- `/concepts` - POST/PUT/DELETE (blocked by write method check)
- `/lectures` - POST (blocked by write method check)
- `/resources` - POST (blocked by write method check)
- `/branches` - POST (blocked by write method check)
- `/graphs` - POST/PATCH/DELETE (blocked by write method check)
- `/snapshots` - POST (blocked by write method check)
- `/review` - POST (blocked by write method check)
- `/preferences` - POST (blocked by write method check)
- `/teaching_style` - POST (blocked by write method check)

## 🚀 Deployment Configuration

### Terraform Variables
- `project` - Project name
- `env` - Environment (e.g., "demo")
- `container_cpu` - ECS task CPU
- `container_memory` - ECS task memory
- `waf_rate_limit_per_5m` - WAF rate limit
- `budget_email` - Optional budget alert email
- `budget_monthly_usd` - Monthly budget limit

### Environment Variables (ECS Task)
- `DEMO_MODE=true`
- `DEMO_ALLOW_WRITES=false` ✅ (Fixed: was `true`)
- `DEMO_TENANT_ID=demo`
- `DEMO_GRAPH_ID=demo`
- `DEMO_SAFE_WRITE_PATHS=/ai/chat,/ai/semantic-search,/events`
- Rate limit configs
- Secrets from Secrets Manager

## 📝 Recent Fixes

1. ✅ **Added `/connectors` and `/finance` to blocked paths** - These ingestion endpoints are now blocked in demo mode
2. ✅ **Conditionally excluded connectors/finance routers** - Cleaner than mounting and blocking
3. ✅ **Fixed Terraform `DEMO_ALLOW_WRITES`** - Changed from `true` to `false` for proper read-only demo

## 🔍 Testing Recommendations

1. **Manual Testing**:
   - Verify blocked endpoints return 403/405
   - Verify rate limiting works (429 after limit)
   - Verify safe write paths work (`/ai/chat`, `/ai/semantic-search`, `/events`)
   - Verify GET endpoints work (read-only operations)

2. **Integration Testing**:
   - Test full chat flow with summary mode
   - Test retrieval with detail_level="summary"
   - Test that ingestion endpoints are unreachable

3. **Load Testing**:
   - Verify rate limits are enforced
   - Verify WAF rate limits work
   - Monitor CloudWatch metrics

## 🎯 Next Steps (Optional Enhancements)

1. **Enhanced Monitoring**:
   - CloudWatch dashboards for demo metrics
   - Alarms for rate limit violations
   - Cost anomaly detection

2. **Additional Protections**:
   - IP allowlist/blocklist (if needed)
   - Geographic restrictions (if needed)
   - Enhanced WAF rules (SQL injection, XSS, etc.)

3. **Documentation**:
   - API documentation for demo endpoints
   - Demo mode user guide
   - Troubleshooting guide

## 📚 Related Files

- `backend/main.py` - Main FastAPI app and middleware
- `backend/demo_mode.py` - Demo mode enforcement logic
- `backend/config.py` - Configuration and env vars
- `backend/api_retrieval.py` - Retrieval with summary mode
- `infra/envs/demo/main.tf` - Terraform infrastructure
- `.github/workflows/backend-deploy.yml` - CI/CD pipeline
- `backend/env.example` - Environment variable template

