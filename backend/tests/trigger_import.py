#!/usr/bin/env python3
"""
Simple script to trigger CSV import via the import function directly.
This avoids needing to start the full API server.
"""
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from scripts import import_csv_to_neo4j

if __name__ == "__main__":
    print("Triggering CSV import...")
    try:
        import_csv_to_neo4j.main()
        print("\n✅ Import completed successfully!")
    except Exception as e:
        print(f"\n❌ Import failed: {e}")
        sys.exit(1)

