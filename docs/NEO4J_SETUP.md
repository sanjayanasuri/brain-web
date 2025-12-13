# Neo4j Setup Guide

## Creating a Local Database in Neo4j Desktop

### Step-by-Step Instructions

1. **Open Neo4j Desktop**
   - Launch the Neo4j Desktop application

2. **Create a New Project**
   - Click the "+" button or "New Project" button
   - Give it a name (e.g., "Brain Web" or "My Knowledge Graph")
   - Click "Create"

3. **Add a Database**
   - In your project, click "Add" → "Local DBMS" (or "Add Database")
   - You'll see options to create a new database

4. **Configure the Database**
   - **Name**: Give it a name (e.g., "brain-web-db" or "knowledge-graph")
   - **Password**: Set a password (remember this! You'll need it for your backend)
   - **Version**: Choose Neo4j 5.x (recommended) or 4.x
   - Click "Create"

5. **Start the Database**
   - Click the "Start" button (play icon) next to your database
   - Wait for it to start (the status will change to "Active")

6. **Get Connection Details**
   - Once started, you'll see connection information
   - **Bolt URI**: Usually `bolt://localhost:7687`
   - **Username**: Usually `neo4j`
   - **Password**: The one you set in step 4

7. **Open Neo4j Browser (Optional)**
   - Click "Open" to access the Neo4j Browser at http://localhost:7474
   - You can run Cypher queries here to explore your graph

### Setting Up Your Backend

Once your database is running, configure your backend:

**Option 1: Using .env file (Recommended - Already Created!)**

A `.env` file has been created in the `backend/` directory with your connection details:
```
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=Speedracer123$
```

The backend will automatically load these settings. Just start the server:
```bash
cd /Users/sanjayanasuri/brain-web/backend
source .venv/bin/activate
python -m uvicorn main:app --reload
```

**Option 2: Using environment variables**

If you prefer to set them manually:
```bash
cd /Users/sanjayanasuri/brain-web/backend
source .venv/bin/activate
export NEO4J_URI=bolt://localhost:7687
export NEO4J_USER=neo4j
export NEO4J_PASSWORD=Speedracer123$
python -m uvicorn main:app --reload
```

**Test Your Connection**

You can verify the connection works:
```bash
cd /Users/sanjayanasuri/brain-web/backend
source .venv/bin/activate
python test_connection.py
```

---

## What is Docker and Why Was It Mentioned?

### Docker's Purpose

**Docker** is a platform that lets you run applications in isolated containers. Think of it as a lightweight virtual machine.

### Docker's Role in This Project

In this context, Docker was suggested as a way to **run Neo4j** without installing it directly on your computer:

1. **Without Docker**: You'd need to:
   - Download Neo4j
   - Install it on your Mac
   - Configure it manually
   - Manage updates yourself

2. **With Docker**: You can:
   - Run Neo4j in a container (isolated environment)
   - Start/stop it easily with one command
   - Keep your system clean (no direct installation)
   - Use the same setup across different computers

### Why You're Not Using Docker Now

You're using **Neo4j Desktop** instead, which:
- ✅ Is easier to set up (no Docker needed)
- ✅ Has a nice GUI for managing databases
- ✅ Works great for development
- ✅ Doesn't require learning Docker commands

### When Would You Use Docker?

Docker is useful when:
- You want to deploy to production servers
- You need to run multiple databases easily
- You want to share exact configurations with a team
- You prefer command-line management

**For your current project (development/local), Neo4j Desktop is perfect!** You don't need Docker.

---

## Quick Reference

### Neo4j Desktop Connection Info
- **Bolt URI**: `bolt://localhost:7687`
- **HTTP URI**: `http://localhost:7474` (for browser)
- **Username**: `neo4j`
- **Password**: (whatever you set when creating the database)

### Testing Your Connection

You can test if Neo4j is running by:
1. Opening Neo4j Browser (click "Open" in Desktop)
2. Or running a simple Python script:
   ```python
   from neo4j import GraphDatabase
   
   driver = GraphDatabase.driver(
       "bolt://localhost:7687",
       auth=("neo4j", "your_password")
   )
   
   with driver.session() as session:
       result = session.run("RETURN 1 as test")
       print("Connected!", result.single())
   
   driver.close()
   ```

