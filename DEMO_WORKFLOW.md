# Brain Web Demo - Portfolio Integration & Workflow Guide

## 🎯 How to Link to Your Portfolio

### Option 1: Direct Link (Recommended)
Add a button/link on your "For Employers" page:

```html
<a href="https://demo.sanjayanasuri.com" target="_blank" rel="noopener">
  View Knowledge Graph Demo →
</a>
```

**Pros:**
- Simple, clean
- Opens in new tab
- No iframe issues

### Option 2: Embedded iframe (Not Recommended)
```html
<iframe 
  src="https://demo.sanjayanasuri.com" 
  width="100%" 
  height="600px"
  frameborder="0">
</iframe>
```

**Cons:**
- Mobile responsiveness issues
- Security/CSP headers might block it
- Not great UX

### Option 3: Subdomain Integration
If your portfolio is at `sanjayanasuri.com`, you can:
- Portfolio: `sanjayanasuri.com` (main site)
- Demo: `demo.sanjayanasuri.com` (already set up!)
- API: `api-demo.sanjayanasuri.com` (backend)

**Current Setup:**
- ✅ `demo.sanjayanasuri.com` → Frontend (Amplify)
- ✅ `api-demo.sanjayanasuri.com` → Backend (ECS)

---

## 📊 How Adding Nodes Works

### Current Demo Data
- **Location**: `graph/demo_nodes.csv` and `graph/demo_edges.csv`
- **Content**: Curated "Software Architecture" concepts (25 nodes, 33 edges)
- **Tenant ID**: `demo` (scoped for safety)

### Workflow: Adding New Nodes

#### Step 1: Update CSV Files
```bash
# Edit the demo dataset
vim graph/demo_nodes.csv    # Add new nodes
vim graph/demo_edges.csv   # Add new relationships
```

**CSV Format:**
- `demo_nodes.csv`: `node_id,name,description,domain,type`
- `demo_edges.csv`: `source_id,target_id,predicate`

#### Step 2: Re-seed the Database
```bash
cd /Users/sanjayanasuri/brain-web
export NEO4J_URI="neo4j+s://944b0387.databases.neo4j.io"
export NEO4J_USER="neo4j"
export NEO4J_PASSWORD="YOUR_PASSWORD"
export DEMO_SEED_CONFIRM="YES"

# Re-seed (this adds/updates nodes, doesn't delete existing ones)
python backend/scripts/seed_demo_graph.py

# Or reset everything and start fresh
python backend/scripts/seed_demo_graph.py --reset
```

#### Step 3: Verify in Neo4j Browser
1. Go to: https://console.neo4j.io/
2. Open your database
3. Query: `MATCH (n {tenant_id: "demo"}) RETURN n LIMIT 25`

**That's it!** No code deployment needed - just update CSVs and re-seed.

---

## 💻 How Code Changes Work

### Automatic Deployment (GitHub Actions)

#### Backend Changes
1. **Edit code** in `backend/`
2. **Commit & push:**
   ```bash
   git add backend/
   git commit -m "Add new feature"
   git push origin main
   ```
3. **GitHub Actions automatically:**
   - Builds Docker image
   - Pushes to ECR
   - Updates ECS service
   - Deploys new version
   - **Takes ~5-10 minutes**

4. **Check status:**
   - https://github.com/sanjayanasuri/brain-web/actions
   - Green checkmark = deployed ✅

#### Frontend Changes
1. **Edit code** in `frontend/`
2. **Commit & push:**
   ```bash
   git add frontend/
   git commit -m "Update UI"
   git push origin main
   ```
3. **Amplify automatically:**
   - Detects push to `main` branch
   - Builds Next.js app
   - Deploys to CloudFront
   - **Takes ~3-5 minutes**

4. **Check status:**
   - https://console.aws.amazon.com/amplify/home?region=us-west-2#/d1n2j8e98wvbzd/main

### Manual Deployment (If Needed)

#### Backend
```bash
# Build and push manually
cd backend
docker build -t brain-web-demo-api:latest .
docker tag brain-web-demo-api:latest 008971644235.dkr.ecr.us-east-1.amazonaws.com/brain-web-demo-api:latest
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 008971644235.dkr.ecr.us-east-1.amazonaws.com
docker push 008971644235.dkr.ecr.us-east-1.amazonaws.com/brain-web-demo-api:latest

# Force ECS update
aws ecs update-service --cluster brain-web-demo-cluster --service brain-web-demo-api --force-new-deployment --region us-east-1
```

#### Frontend
- Just push to GitHub - Amplify auto-deploys!

---

## 🔄 Complete Update Workflow Example

### Scenario: Add "Microservices" concept to the graph

```bash
# 1. Add node to CSV
echo "MS001,Microservices,Distributed system architecture pattern,Software Architecture,Concept" >> graph/demo_nodes.csv

# 2. Add relationship
echo "MS001,SA001,RELATED_TO" >> graph/demo_edges.csv

# 3. Re-seed database
export NEO4J_URI="neo4j+s://944b0387.databases.neo4j.io"
export NEO4J_USER="neo4j"
export NEO4J_PASSWORD="YOUR_PASSWORD"
export DEMO_SEED_CONFIRM="YES"
python backend/scripts/seed_demo_graph.py

# 4. (Optional) Commit CSV changes to git
git add graph/demo_*.csv
git commit -m "Add Microservices concept to demo graph"
git push origin main
```

**Result:** New node appears in the graph immediately (no deployment needed!)

---

## 🎨 Portfolio Integration Best Practices

### 1. Create a Demo Section
```html
<section id="demo">
  <h2>Knowledge Graph Demo</h2>
  <p>Interactive visualization of software architecture concepts</p>
  <a href="https://demo.sanjayanasuri.com" class="btn">
    Explore Graph →
  </a>
</section>
```

### 2. Add Screenshot/Preview
- Take a screenshot of the graph
- Use it as a preview image
- Link to full demo

### 3. Explain the Tech Stack
```markdown
## Tech Stack
- **Frontend**: Next.js, React, D3.js
- **Backend**: FastAPI, Python
- **Database**: Neo4j Aura (Graph Database)
- **Infrastructure**: AWS (ECS, Amplify, ALB, WAF)
- **CI/CD**: GitHub Actions
```

### 4. Highlight Key Features
- Real-time graph visualization
- Semantic search
- Read-only demo mode (safe for public)
- Auto-scaling infrastructure

---

## 🔒 Security & Demo Mode

### Current Protections
- ✅ **Read-only mode**: No writes allowed (except safe endpoints)
- ✅ **Rate limiting**: 120 req/min per IP, 60 req/min per session
- ✅ **WAF**: Bot protection, common attack blocking
- ✅ **Tenant scoping**: All data scoped to `tenant_id="demo"`
- ✅ **No personal data**: Curated demo dataset only

### What Visitors Can Do
- ✅ View the graph
- ✅ Search concepts
- ✅ Explore relationships
- ✅ Use semantic search

### What Visitors CANNOT Do
- ❌ Create/modify nodes
- ❌ Upload files
- ❌ Change graph structure
- ❌ Access personal data

---

## 📝 Maintenance Checklist

### Weekly
- [ ] Check GitHub Actions (ensure deployments succeed)
- [ ] Check Amplify builds (ensure frontend deploys)
- [ ] Monitor CloudWatch logs (check for errors)

### Monthly
- [ ] Review AWS costs (should be ~$10-20/month)
- [ ] Update demo dataset (add new concepts if needed)
- [ ] Test the full stack (frontend → backend → database)

### When Adding Features
1. Test locally first (`docker-compose up`)
2. Push to GitHub
3. Monitor deployment
4. Test on live site
5. Update portfolio if needed

---

## 🚀 Quick Reference

### URLs
- **Frontend**: https://demo.sanjayanasuri.com
- **Backend API**: https://api-demo.sanjayanasuri.com
- **GitHub**: https://github.com/sanjayanasuri/brain-web
- **Amplify Console**: https://console.aws.amazon.com/amplify/home?region=us-west-2#/d1n2j8e98wvbzd
- **ECS Console**: https://console.aws.amazon.com/ecs/v2/clusters/brain-web-demo-cluster/services

### Key Commands
```bash
# Re-seed demo graph
python backend/scripts/seed_demo_graph.py

# Check backend status
aws ecs describe-services --cluster brain-web-demo-cluster --services brain-web-demo-api --region us-east-1

# View logs
aws logs tail /ecs/brain-web-demo-api --region us-east-1 --follow

# Force backend redeploy
aws ecs update-service --cluster brain-web-demo-cluster --service brain-web-demo-api --force-new-deployment --region us-east-1
```

---

## 💡 Pro Tips

1. **Keep demo data fresh**: Add new concepts monthly to show active development
2. **Monitor costs**: Set up AWS Budget alerts (already configured)
3. **Document changes**: Update this file when you add features
4. **Test before sharing**: Always test the demo before sending to employers
5. **Backup data**: The demo dataset is in git, so it's safe

---

## 🆘 Troubleshooting

### Demo not loading?
1. Check Amplify build: https://console.aws.amazon.com/amplify/home?region=us-west-2
2. Check backend: `curl https://api-demo.sanjayanasuri.com/`
3. Check DNS: `dig demo.sanjayanasuri.com`

### Graph empty?
1. Check Neo4j: Query `MATCH (n {tenant_id: "demo"}) RETURN count(n)`
2. Re-seed: Run `seed_demo_graph.py`

### Deployment failing?
1. Check GitHub Actions logs
2. Check CloudWatch logs
3. Verify secrets in AWS Secrets Manager

---

**You're all set!** Your demo is production-ready and can be shared with employers. 🎉

