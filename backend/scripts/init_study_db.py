#!/usr/bin/env python3
"""
Initialize study tables in Postgres database.
Run this script to create the study_sessions, study_tasks, and study_attempts tables.
"""

import os
import sys

try:
    import psycopg2
except ImportError:
    print("Error: psycopg2-binary is not installed")
    print("Install it with: pip install psycopg2-binary")
    sys.exit(1)

from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
load_dotenv(os.path.join(os.path.dirname(__file__), "../.env"))

# Get connection string from environment or use default
POSTGRES_CONNECTION_STRING = os.getenv(
    "POSTGRES_CONNECTION_STRING",
    "postgresql://brainweb:brainweb@localhost:5432/brainweb"
)

if not POSTGRES_CONNECTION_STRING:
    print("Error: POSTGRES_CONNECTION_STRING environment variable not set")
    print("Example: export POSTGRES_CONNECTION_STRING='postgresql://user:pass@localhost:5432/dbname'")
    sys.exit(1)

# SQL schema
SCHEMA_SQL = """
-- Study Sessions Table
CREATE TABLE IF NOT EXISTS study_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  graph_id VARCHAR(255),
  branch_id VARCHAR(255),
  topic_id TEXT,
  selection_id TEXT,
  intent VARCHAR(50) NOT NULL,
  current_mode VARCHAR(20) NOT NULL DEFAULT 'explain',
  mode_inertia FLOAT DEFAULT 0.5,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_study_sessions_user ON study_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_sessions_tenant ON study_sessions(tenant_id, started_at DESC);

-- Study Tasks Table
CREATE TABLE IF NOT EXISTS study_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES study_sessions(id) ON DELETE CASCADE,
  task_type VARCHAR(50) NOT NULL,
  prompt TEXT NOT NULL,
  rubric_json JSONB NOT NULL,
  context_pack_json JSONB NOT NULL,
  compatible_modes JSONB NOT NULL,
  disruption_cost FLOAT DEFAULT 0.3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_tasks_session ON study_tasks(session_id, created_at);

-- Study Attempts Table
CREATE TABLE IF NOT EXISTS study_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES study_tasks(id) ON DELETE CASCADE,
  response_text TEXT NOT NULL,
  score_json JSONB NOT NULL,
  composite_score FLOAT NOT NULL,
  feedback_text TEXT,
  gap_concepts JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_attempts_task ON study_attempts(task_id, created_at);

-- Comments
COMMENT ON TABLE study_sessions IS 'Guided study sessions with multiple tasks';
COMMENT ON TABLE study_tasks IS 'Individual tasks within a study session';
COMMENT ON TABLE study_attempts IS 'User attempts at completing tasks with scores';

COMMENT ON COLUMN study_sessions.mode_inertia IS 'Inertia score (0-1) for mode switching resistance';
COMMENT ON COLUMN study_tasks.disruption_cost IS 'Cost of switching to this task (0=seamless, 1=major)';
COMMENT ON COLUMN study_attempts.composite_score IS 'Weighted average of all dimension scores';

-- Voice Sessions Table
CREATE TABLE IF NOT EXISTS voice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  graph_id VARCHAR(255) NOT NULL,
  branch_id VARCHAR(255) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  total_duration_seconds INTEGER DEFAULT 0,
  token_usage_estimate INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_user ON voice_sessions(user_id, started_at DESC);

-- Voice Transcript Chunks (Artifact Store)
CREATE TABLE IF NOT EXISTS voice_transcript_chunks (
  id TEXT PRIMARY KEY,
  voice_session_id TEXT NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  graph_id VARCHAR(255) NOT NULL,
  branch_id VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  content TEXT NOT NULL,
  start_ms INTEGER,
  end_ms INTEGER,
  anchor_id TEXT,
  anchor_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_transcript_chunks_session ON voice_transcript_chunks(voice_session_id, start_ms, created_at);
CREATE INDEX IF NOT EXISTS idx_voice_transcript_chunks_user_graph_branch_created ON voice_transcript_chunks(user_id, graph_id, branch_id, created_at DESC);

-- Voice Learning Signals (Extracted)
CREATE TABLE IF NOT EXISTS voice_learning_signals (
  id TEXT PRIMARY KEY,
  voice_session_id TEXT NOT NULL,
  chunk_id TEXT,
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  graph_id VARCHAR(255) NOT NULL,
  branch_id VARCHAR(255) NOT NULL,
  kind VARCHAR(64) NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_learning_signals_session ON voice_learning_signals(voice_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_learning_signals_kind ON voice_learning_signals(kind);

-- Usage Logs Table
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  action_type VARCHAR(50) NOT NULL,
  quantity FLOAT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_user ON usage_logs(user_id, timestamp DESC);

-- Concept Mastery Table (for analytics)
CREATE TABLE IF NOT EXISTS concept_mastery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  concept_name TEXT NOT NULL,
  mastery_score FLOAT NOT NULL DEFAULT 0.0 CHECK (mastery_score >= 0 AND mastery_score <= 1),
  exposure_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, tenant_id, concept_name)
);

CREATE INDEX IF NOT EXISTS idx_concept_mastery_user ON concept_mastery(user_id, tenant_id, mastery_score DESC);
CREATE INDEX IF NOT EXISTS idx_concept_mastery_last_seen ON concept_mastery(user_id, tenant_id, last_seen DESC);

-- Performance History Table (for analytics)
CREATE TABLE IF NOT EXISTS performance_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  average_score FLOAT,
  study_duration_minutes INTEGER DEFAULT 0,
  concepts_practiced JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, tenant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_performance_history_user ON performance_history(user_id, tenant_id, date DESC);

-- Chat Messages Table (for conversation history)
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id, tenant_id, created_at DESC);

COMMENT ON TABLE chat_messages IS 'Chat conversation history for short-term memory';
COMMENT ON COLUMN chat_messages.chat_id IS 'Groups messages in a conversation thread';
COMMENT ON COLUMN chat_messages.role IS 'Message role: user, assistant, or system';

-- Memory Sync Events Table
CREATE TABLE IF NOT EXISTS memory_sync_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  source VARCHAR(50) NOT NULL,
  memory_id VARCHAR(255),
  content_preview TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'synced'
);

CREATE INDEX IF NOT EXISTS idx_memory_sync_user ON memory_sync_events(user_id, timestamp DESC);
"""

def main():
    print("Connecting to Postgres...")
    try:
        conn = psycopg2.connect(POSTGRES_CONNECTION_STRING)
        print("✓ Connected successfully")
    except Exception as e:
        print(f"✗ Connection failed: {e}")
        sys.exit(1)
    
    try:
        with conn.cursor() as cur:
            print("\nCreating study tables...")
            cur.execute(SCHEMA_SQL)
            conn.commit()
            print("✓ Tables created successfully")
            
            # Verify tables exist
            cur.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name IN ('study_sessions', 'study_tasks', 'study_attempts', 'voice_sessions', 'usage_logs', 'memory_sync_events', 'concept_mastery', 'performance_history', 'chat_messages')
                ORDER BY table_name
            """)
            tables = cur.fetchall()
            
            print("\nCreated tables:")
            for table in tables:
                print(f"  - {table[0]}")
            
            if len(tables) >= 9:
                print("\n✓ All study, voice, analytics, and chat tables initialized successfully!")
            else:
                print(f"\n⚠ Warning: Expected at least 9 tables, found {len(tables)}")
    
    except Exception as e:
        print(f"\n✗ Error creating tables: {e}")
        conn.rollback()
        sys.exit(1)
    
    finally:
        conn.close()

if __name__ == "__main__":
    main()
