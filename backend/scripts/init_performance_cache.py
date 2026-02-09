# backend/init_performance_cache.py
"""
Initialize performance cache table for Phase 3 orchestrator.
Run this after Phase 2 database initialization.
"""

import os
import psycopg2

def init_performance_cache():
    """Initialize performance cache table."""
    
    # Get connection string from config
    try:
        from config import POSTGRES_CONNECTION_STRING as conn_str
    except ImportError:
        # Fallback if config not found (e.g. running from wrong dir)
        conn_str = os.getenv('POSTGRES_CONNECTION_STRING')

    if not conn_str:
        print("❌ Error: POSTGRES_CONNECTION_STRING environment variable not set")
        print("   Set it with: export POSTGRES_CONNECTION_STRING='postgresql://user:pass@host:port/dbname'")
        return False
    
    try:
        # Connect to database
        print("Connecting to Postgres...")
        conn = psycopg2.connect(conn_str)
        cur = conn.cursor()
        
        print("✓ Connected successfully")
        
        # Read schema file
        schema_path = os.path.join(os.path.dirname(__file__), 'db_performance_cache_schema.sql')
        with open(schema_path, 'r') as f:
            schema_sql = f.read()
        
        # Execute schema
        print("Creating performance cache table...")
        cur.execute(schema_sql)
        conn.commit()
        
        print("✓ Performance cache table created successfully")
        
        # Verify table exists
        cur.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'user_performance_cache'
        """)
        
        if cur.fetchone():
            print("\n✓ All performance cache tables initialized successfully!")
            print("\nCreated tables:")
            print("  - user_performance_cache")
            return True
        else:
            print("❌ Error: Table creation verification failed")
            return False
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    finally:
        if 'cur' in locals():
            cur.close()
        if 'conn' in locals():
            conn.close()


if __name__ == '__main__':
    success = init_performance_cache()
    exit(0 if success else 1)
