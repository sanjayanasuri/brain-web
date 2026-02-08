# backend/db_analytics_schema.sql
"""
Analytics database schema for Phase 4.
Tracks performance history, concept mastery, difficulty levels, and recommendations.
"""

-- Performance History (Daily Rollups)
CREATE TABLE IF NOT EXISTS performance_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  avg_score FLOAT NOT NULL,
  task_count INT NOT NULL,
  session_count INT NOT NULL,
  mode_distribution JSONB,  -- {"explain": 5, "typing": 3, "voice": 2}
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tenant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_performance_history_user 
ON performance_history(user_id, tenant_id, date DESC);

-- Concept Mastery Tracking
CREATE TABLE IF NOT EXISTS concept_mastery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  concept_name VARCHAR(255) NOT NULL,
  mastery_score FLOAT NOT NULL DEFAULT 0.5,  -- 0-1
  exposure_count INT NOT NULL DEFAULT 0,     -- Times seen in tasks
  success_count INT NOT NULL DEFAULT 0,      -- Times answered correctly
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tenant_id, concept_name)
);

CREATE INDEX IF NOT EXISTS idx_concept_mastery_user 
ON concept_mastery(user_id, tenant_id, mastery_score);

CREATE INDEX IF NOT EXISTS idx_concept_mastery_score 
ON concept_mastery(user_id, tenant_id, mastery_score DESC);

-- User Difficulty Levels (Per Task Type)
CREATE TABLE IF NOT EXISTS user_difficulty_levels (
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  task_type VARCHAR(50) NOT NULL,
  difficulty_level FLOAT NOT NULL DEFAULT 0.5,  -- 0-1 (beginner to expert)
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, tenant_id, task_type)
);

CREATE INDEX IF NOT EXISTS idx_difficulty_levels_user 
ON user_difficulty_levels(user_id, tenant_id);

-- Recommendations
CREATE TABLE IF NOT EXISTS recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,  -- 'task_focus', 'concept_review', 'session_length'
  priority VARCHAR(20) NOT NULL,  -- 'high', 'medium', 'low'
  message TEXT NOT NULL,
  action VARCHAR(50),  -- 'start_session', 'review_concepts', etc.
  params JSONB,  -- Action parameters
  dismissed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_user 
ON recommendations(user_id, tenant_id, dismissed, created_at DESC);

-- Comments
COMMENT ON TABLE performance_history IS 'Daily rollups of user performance metrics';
COMMENT ON TABLE concept_mastery IS 'Tracks user mastery level for each concept';
COMMENT ON TABLE user_difficulty_levels IS 'Adaptive difficulty levels per task type';
COMMENT ON TABLE recommendations IS 'Personalized study recommendations';

COMMENT ON COLUMN performance_history.mode_distribution IS 'JSON object with task counts per mode';
COMMENT ON COLUMN concept_mastery.mastery_score IS 'Calculated mastery level (0=novice, 1=expert)';
COMMENT ON COLUMN concept_mastery.exposure_count IS 'Number of times concept appeared in tasks';
COMMENT ON COLUMN concept_mastery.success_count IS 'Number of successful attempts involving this concept';
