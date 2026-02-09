# backend/init_analytics_db.py
"""
Initialize analytics database tables for Phase 4.
Run this after Phase 3 database initialization.
"""

import os
import psycopg2

def init_analytics_db():
    """Initialize analytics database tables."""
    
    # Get connection string from environment
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
        schema_path = os.path.join(os.path.dirname(__file__), 'db_analytics_schema.sql')
        with open(schema_path, 'r') as f:
            schema_sql = f.read()
        
        # Execute schema
        print("Creating analytics tables...")
        cur.execute(schema_sql)
        conn.commit()
        
        print("✓ Analytics tables created successfully")
        
        # Verify tables exist
        cur.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN (
                'performance_history',
                'concept_mastery',
                'user_difficulty_levels',
                'recommendations'
            )
            ORDER BY table_name
        """)
        
        tables = [row[0] for row in cur.fetchall()]
        
        if len(tables) == 4:
            print("\n✓ All analytics tables initialized successfully!")
            print("\nCreated tables:")
            for table in tables:
                print(f"  - {table}")
            return True
        else:
            print(f"❌ Error: Expected 4 tables, found {len(tables)}")
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
    success = init_analytics_db()
    exit(0 if success else 1)
