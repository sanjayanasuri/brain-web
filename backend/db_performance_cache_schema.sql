
-- User Performance Cache Table
CREATE TABLE IF NOT EXISTS user_performance_cache (
  user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(255) NOT NULL,
  task_type VARCHAR(50) NOT NULL,
  avg_score FLOAT NOT NULL DEFAULT 0.5,
  attempt_count INT NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tenant_id, task_type)
);

CREATE INDEX IF NOT EXISTS idx_user_performance ON user_performance_cache(user_id, tenant_id);

-- Comments
COMMENT ON TABLE user_performance_cache IS 'Cached user performance metrics by task type for orchestrator';
COMMENT ON COLUMN user_performance_cache.avg_score IS 'Rolling average of composite scores (0-1)';
COMMENT ON COLUMN user_performance_cache.attempt_count IS 'Total number of attempts for this task type';
