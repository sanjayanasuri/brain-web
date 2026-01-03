# How to Confirm Neo4j Connection

## Step 1: Check Your Local Neo4j Instance

From Neo4j Desktop (the image you showed):
- **Instance:** "Brain Web" 
- **Status:** RUNNING ✅
- **Connection URI:** `neo4j://127.0.0.1:7687`

## Step 2: Get the Correct Password

1. In Neo4j Desktop, click on your "Brain Web" instance
2. Click the "Connect" button (or the "..." menu)
3. You'll see the password you set when creating the instance
4. **Copy that password** - you'll need it for `.env.local`

## Step 3: Update .env.local

Your `.env.local` currently has duplicate/conflicting entries. You need to:

1. **Remove duplicate entries** - keep only ONE set of Neo4j settings
2. **Use the correct password** from Step 2
3. **Use the correct URI format**

Here's what your `.env.local` should have (replace `YOUR_PASSWORD` with the actual password):

```bash
NEO4J_URI=neo4j://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=YOUR_PASSWORD_HERE
```

**OR** if `neo4j://` doesn't work, try `bolt://`:

```bash
NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=YOUR_PASSWORD_HERE
```

## Step 4: Test the Connection

Run the test script:

```bash
cd backend
python3 test_neo4j_connection.py
```

You should see:
```
✅ Connection successful!
✅ Query test successful!
✅ Database accessible (schema check passed)
✅ Neo4j connection is working correctly!
```

## Step 5: Restart Backend

After fixing `.env.local`:

1. Stop your backend (Ctrl+C)
2. Start it again:
   ```bash
   cd backend
   ./run.sh
   ```

## Step 6: Test the Extension

1. Reload the extension in Chrome
2. Try capturing a selection
3. You should see: "Saved QXXXXXXXXXX" (success notification)

## Troubleshooting

**If you get "authentication failure":**
- The password in `.env.local` doesn't match your Neo4j instance password
- Get the password from Neo4j Desktop (see Step 2)

**If you get "Cannot resolve address":**
- Make sure your Neo4j instance is RUNNING in Neo4j Desktop
- Check the URI matches: `neo4j://127.0.0.1:7687` or `bolt://127.0.0.1:7687`

**If connection works but extension still fails:**
- Make sure you restarted the backend after changing `.env.local`
- Check backend logs for errors

