# Fix Neo4j Connection - Step by Step

## The Problem
1. Your `.env.local` has **duplicate Neo4j entries**
2. The password might not match your local Neo4j instance
3. Backend is trying to connect to cloud instance (`944b0387.databases.neo4j.io`)

## Solution

### Step 1: Get Your Neo4j Password

In **Neo4j Desktop**:
1. Click on your **"Brain Web"** instance (the one that's RUNNING)
2. Click **"Connect"** button or the **"..."** menu
3. You'll see the password you set when creating the instance
4. **Copy that password** - you'll need it

### Step 2: Clean Up .env.local

Your `.env.local` currently has duplicates. You need to:

1. **Open** `/Users/sanjayanasuri/brain-web/.env.local`
2. **Remove ALL duplicate NEO4J entries**
3. **Keep only ONE set** with the correct values:

```bash
# Neo4j Configuration - Local Instance
NEO4J_URI=neo4j://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=YOUR_ACTUAL_PASSWORD_HERE
```

**Important:**
- Replace `YOUR_ACTUAL_PASSWORD_HERE` with the password from Step 1
- Use `neo4j://127.0.0.1:7687` (matches your Neo4j Desktop)
- If that doesn't work, try `bolt://127.0.0.1:7687`

### Step 3: Test Connection

```bash
cd backend
source .venv/bin/activate
python3 test_neo4j_connection.py
```

You should see:
```
✅ Connection successful!
✅ Query test successful!
✅ Database accessible (schema check passed)
✅ Neo4j connection is working correctly!
```

### Step 4: Restart Backend

**After fixing `.env.local`:**

1. Stop the backend (Ctrl+C in the terminal running it)
2. Start it fresh:
   ```bash
   cd backend
   source .venv/bin/activate
   ./run.sh
   ```

3. **Check the startup logs** - you should see:
   - No more "944b0387.databases.neo4j.io" errors
   - Should connect to `127.0.0.1:7687` instead

### Step 5: Test Extension

1. Reload extension in Chrome (`chrome://extensions/`)
2. Try capturing a selection
3. You should see: **"Saved QXXXXXXXXXX"** ✅

## Quick Fix Command

If you know your password, you can quickly fix `.env.local`:

```bash
cd /Users/sanjayanasuri/brain-web
cat > .env.local << 'EOF'
NEO4J_URI=neo4j://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=YOUR_PASSWORD_HERE
EOF
```

(Replace `YOUR_PASSWORD_HERE` with your actual password)

