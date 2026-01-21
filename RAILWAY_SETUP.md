# Railway Deployment Guide

Deploy Brain Web backend to Railway for **$5-10/month** (vs $70+/month on AWS).

## Quick Setup (15 minutes)

### Step 1: Create Railway Account
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub (free tier: $5/month credit)

### Step 2: Create New Project
1. Click "New Project"
2. Select "Deploy from GitHub repo"
3. Connect your `brain-web` repository
4. Select the repository

### Step 3: Deploy Backend Service
1. Click "Add Service" → "GitHub Repo"
2. Select your repo
3. Railway will auto-detect the root-level `Dockerfile` and `railway.json`
4. The Dockerfile is configured to build from the `backend/` directory
5. Railway will automatically deploy

### Step 4: Add Database Services

#### Neo4j
1. Click "New" → "Database" → "Neo4j"
2. Railway will provision Neo4j
3. Copy the connection details:
   - `NEO4J_URI` (will be something like `neo4j://...railway.app`)
   - `NEO4J_USER` (usually `neo4j`)
   - `NEO4J_PASSWORD` (auto-generated)

#### PostgreSQL (for events)
1. Click "New" → "Database" → "PostgreSQL"
2. Railway auto-provisions PostgreSQL
3. Connection string will be in `DATABASE_URL` env var

#### Redis (for caching)
1. Click "New" → "Database" → "Redis"
2. Railway auto-provisions Redis
3. Connection details in `REDIS_URL` env var

#### Qdrant (for vector search)
1. Click "New" → "Empty Service"
2. Add this to the service's `railway.toml`:
   ```toml
   [build]
   builder = "NIXPACKS"
   
   [deploy]
   startCommand = "qdrant"
   ```
3. Or use Railway's Qdrant template if available

### Step 5: Configure Environment Variables

In your **Backend Service** → "Variables" tab, add:

#### Required Variables
```
NODE_ENV=production
DEMO_MODE=true
PORT=8000
```

#### Neo4j (from Neo4j service)
```
NEO4J_URI=<from Neo4j service>
NEO4J_USER=neo4j
NEO4J_PASSWORD=<from Neo4j service>
NEO4J_DATABASE=neo4j
```

#### PostgreSQL (from PostgreSQL service)
```
POSTGRES_HOST=<extract from DATABASE_URL>
POSTGRES_PORT=5432
POSTGRES_DB=<extract from DATABASE_URL>
POSTGRES_USER=<extract from DATABASE_URL>
POSTGRES_PASSWORD=<extract from DATABASE_URL>
EVENTS_POSTGRES=true
```

#### Redis (from Redis service)
```
REDIS_HOST=<extract from REDIS_URL>
REDIS_PORT=6379
REDIS_DB=0
USE_REDIS=true
```

#### Qdrant (from Qdrant service)
```
QDRANT_HOST=<Qdrant service hostname>
QDRANT_PORT=6333
QDRANT_COLLECTION=concepts
USE_QDRANT=true
```

#### Optional (for full features)
```
OPENAI_API_KEY=<your OpenAI key>
NOTION_API_KEY=<if using Notion>
API_TOKEN_SECRET=<generate: openssl rand -hex 32>
STORAGE_BACKEND=local
```

### Step 6: Link Services
1. In Backend service → "Settings" → "Service Dependencies"
2. Link: Neo4j, PostgreSQL, Redis, Qdrant
3. This makes their connection strings available as env vars

### Step 7: Deploy & Get URL
1. Railway will auto-deploy on git push
2. Go to Backend service → "Settings" → "Networking"
3. Generate a public domain (e.g., `brain-web-production.up.railway.app`)
4. Copy the URL - this is your backend API URL

### Step 8: Update Frontend (Vercel)
1. Go to Vercel dashboard → Your project → Settings → Environment Variables
2. Add/Update:
   ```
   NEXT_PUBLIC_API_URL=https://brain-web-production.up.railway.app
   ```
3. Redeploy frontend

### Step 9: Custom Domain (Optional)
1. In Railway Backend service → "Settings" → "Networking"
2. Click "Custom Domain"
3. Add `api.demo.sanjayanasuri.com` (or whatever you want)
4. Update DNS:
   - Add CNAME: `api.demo` → Railway's domain
5. Update Vercel env var to use custom domain

## Cost Breakdown

**Railway Free Tier:**
- $5/month credit
- Usually enough for:
  - Backend service (low traffic): ~$3-5/month
  - Neo4j: ~$2-3/month
  - PostgreSQL: ~$1/month
  - Redis: ~$1/month
  - Qdrant: ~$1/month

**After Free Tier:**
- Total: ~$8-12/month
- Still way cheaper than AWS ($70+/month)

## Troubleshooting

### Backend won't start
- Check logs: Backend service → "Deployments" → Click latest → "View Logs"
- Common issues:
  - Missing env vars
  - Database connection issues
  - Port conflicts

### Database connection errors
- Make sure services are linked (Service Dependencies)
- Check env vars are set correctly
- Verify database services are running

### CORS errors
- Update `backend/main.py` CORS origins to include Railway domain
- Add your Railway URL to allowed origins

## Monitoring

- Railway dashboard shows:
  - CPU/Memory usage
  - Request logs
  - Deployment history
  - Service health

## Auto-Deploy

Railway auto-deploys on:
- Push to `main` branch (if connected to GitHub)
- Manual trigger from dashboard

---

**That's it!** Your demo will be live at `demo.sanjayanasuri.com` pointing to Vercel frontend, which calls Railway backend.
