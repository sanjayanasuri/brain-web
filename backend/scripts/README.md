# CSV Import/Export Scripts

## Directory Requirements

These scripts calculate paths relative to their own location and automatically add the parent directory to Python's path, so **you can run them from the `backend` directory** without any additional setup.

## Running the Scripts

### Option 1: From the `backend` directory (Recommended)

```bash
cd backend
source .venv/bin/activate
python scripts/import_csv_to_neo4j.py
python scripts/export_csv_from_neo4j.py
```

### Option 2: As a Python module

```bash
cd <project-root>
source backend/.venv/bin/activate
python -m backend.scripts.import_csv_to_neo4j
python -m backend.scripts.export_csv_from_neo4j
```

### Option 3: From anywhere (with PYTHONPATH)

```bash
# From any directory
cd <project-root>
source backend/.venv/bin/activate
export PYTHONPATH=<project-root>/backend:$PYTHONPATH
python backend/scripts/import_csv_to_neo4j.py
```

## What the Scripts Expect

The scripts automatically find the CSV files based on this structure:

```
brain-web/
├── backend/
│   └── scripts/
│       ├── import_csv_to_neo4j.py
│       └── export_csv_from_neo4j.py
└── graph/
    ├── nodes_semantic.csv
    ├── edges_semantic.csv
    └── lecture_covers_L001.csv
```

**Important:** The scripts look for CSV files in the `/graph` directory (sibling to `/backend`), so make sure your project structure matches this.

## Prerequisites

1. Neo4j must be running and accessible
2. Environment variables must be set (or use `.env` file):
   - `NEO4J_URI=bolt://localhost:7687`
   - `NEO4J_USER=neo4j`
   - `NEO4J_PASSWORD=your_password`
3. Virtual environment must be activated

