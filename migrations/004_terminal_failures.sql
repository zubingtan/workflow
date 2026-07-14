ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE node_runs
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS skip_reason text;

ALTER TABLE node_run_attempts
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE agent_executions
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS provider_request_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_result_persisted_at timestamptz;

ALTER TABLE execution_events
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS skip_reason text;

ALTER TABLE workflow_runs
  DROP CONSTRAINT IF EXISTS workflow_runs_status_check,
  DROP CONSTRAINT IF EXISTS workflow_runs_check,
  DROP CONSTRAINT IF EXISTS workflow_runs_pr5_error_code_check,
  DROP CONSTRAINT IF EXISTS workflow_runs_pr5_error_pair_check,
  DROP CONSTRAINT IF EXISTS workflow_runs_pr5_state_check;

ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_pr5_error_code_check CHECK (
    error_code IS NULL OR error_code IN (
      'provider_auth_failed',
      'provider_timeout',
      'provider_empty_output',
      'worker_lost',
      'outcome_unknown'
    )
  ),
  ADD CONSTRAINT workflow_runs_pr5_error_pair_check CHECK (
    (error_code IS NULL) = (error_message IS NULL)
    AND (
      (error_code IS NULL AND error_message IS NULL)
      OR (error_code = 'provider_auth_failed' AND error_message = 'Provider authentication failed')
      OR (error_code = 'provider_timeout' AND error_message = 'Provider request timed out')
      OR (error_code = 'provider_empty_output' AND error_message = 'Provider returned empty output')
      OR (error_code = 'worker_lost' AND error_message = 'Worker was lost before provider dispatch')
      OR (error_code = 'outcome_unknown' AND error_message = 'Provider outcome is unknown')
    )
  ),
  ADD CONSTRAINT workflow_runs_pr5_state_check CHECK (
    (status = 'queued' AND started_at IS NULL AND completed_at IS NULL
      AND error_code IS NULL)
    OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL
      AND error_code IS NULL)
    OR (status = 'succeeded' AND started_at IS NOT NULL AND completed_at IS NOT NULL
      AND error_code IS NULL)
    OR (status = 'failed' AND started_at IS NOT NULL AND completed_at IS NOT NULL
      AND error_code IS NOT NULL)
  );

ALTER TABLE node_runs
  DROP CONSTRAINT IF EXISTS node_runs_status_check,
  DROP CONSTRAINT IF EXISTS node_runs_check2,
  DROP CONSTRAINT IF EXISTS node_runs_pr5_error_code_check,
  DROP CONSTRAINT IF EXISTS node_runs_pr5_error_pair_check,
  DROP CONSTRAINT IF EXISTS node_runs_pr5_skip_reason_check,
  DROP CONSTRAINT IF EXISTS node_runs_pr5_state_check;

ALTER TABLE node_runs
  ADD CONSTRAINT node_runs_pr5_error_code_check CHECK (
    error_code IS NULL OR error_code IN (
      'provider_auth_failed',
      'provider_timeout',
      'provider_empty_output',
      'worker_lost',
      'outcome_unknown'
    )
  ),
  ADD CONSTRAINT node_runs_pr5_error_pair_check CHECK (
    (error_code IS NULL) = (error_message IS NULL)
    AND (
      (error_code IS NULL AND error_message IS NULL)
      OR (error_code = 'provider_auth_failed' AND error_message = 'Provider authentication failed')
      OR (error_code = 'provider_timeout' AND error_message = 'Provider request timed out')
      OR (error_code = 'provider_empty_output' AND error_message = 'Provider returned empty output')
      OR (error_code = 'worker_lost' AND error_message = 'Worker was lost before provider dispatch')
      OR (error_code = 'outcome_unknown' AND error_message = 'Provider outcome is unknown')
    )
  ),
  ADD CONSTRAINT node_runs_pr5_skip_reason_check CHECK (
    skip_reason IS NULL OR skip_reason = 'upstream_failed'
  ),
  ADD CONSTRAINT node_runs_pr5_state_check CHECK (
    (status IN ('pending', 'queued')
      AND started_at IS NULL AND completed_at IS NULL
      AND error_code IS NULL AND skip_reason IS NULL)
    OR (status = 'running'
      AND started_at IS NOT NULL AND completed_at IS NULL
      AND error_code IS NULL AND skip_reason IS NULL)
    OR (status = 'succeeded'
      AND started_at IS NOT NULL AND completed_at IS NOT NULL
      AND error_code IS NULL AND skip_reason IS NULL)
    OR (status = 'failed'
      AND started_at IS NOT NULL AND completed_at IS NOT NULL
      AND error_code IS NOT NULL AND skip_reason IS NULL)
    OR (status = 'skipped'
      AND started_at IS NULL AND completed_at IS NOT NULL
      AND error_code IS NULL AND skip_reason = 'upstream_failed')
  );

ALTER TABLE node_run_attempts
  DROP CONSTRAINT IF EXISTS node_run_attempts_status_check,
  DROP CONSTRAINT IF EXISTS node_run_attempts_check,
  DROP CONSTRAINT IF EXISTS node_run_attempts_pr5_error_code_check,
  DROP CONSTRAINT IF EXISTS node_run_attempts_pr5_error_pair_check,
  DROP CONSTRAINT IF EXISTS node_run_attempts_pr5_state_check;

ALTER TABLE node_run_attempts
  ADD CONSTRAINT node_run_attempts_pr5_error_code_check CHECK (
    error_code IS NULL OR error_code IN (
      'provider_auth_failed',
      'provider_timeout',
      'provider_empty_output',
      'worker_lost',
      'outcome_unknown'
    )
  ),
  ADD CONSTRAINT node_run_attempts_pr5_error_pair_check CHECK (
    (error_code IS NULL) = (error_message IS NULL)
    AND (
      (error_code IS NULL AND error_message IS NULL)
      OR (error_code = 'provider_auth_failed' AND error_message = 'Provider authentication failed')
      OR (error_code = 'provider_timeout' AND error_message = 'Provider request timed out')
      OR (error_code = 'provider_empty_output' AND error_message = 'Provider returned empty output')
      OR (error_code = 'worker_lost' AND error_message = 'Worker was lost before provider dispatch')
      OR (error_code = 'outcome_unknown' AND error_message = 'Provider outcome is unknown')
    )
  ),
  ADD CONSTRAINT node_run_attempts_pr5_state_check CHECK (
    (status = 'running' AND completed_at IS NULL AND error_code IS NULL)
    OR (status = 'succeeded' AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  );

ALTER TABLE agent_executions
  DROP CONSTRAINT IF EXISTS agent_executions_status_check,
  DROP CONSTRAINT IF EXISTS agent_executions_check,
  DROP CONSTRAINT IF EXISTS agent_executions_pr5_error_code_check,
  DROP CONSTRAINT IF EXISTS agent_executions_pr5_error_pair_check,
  DROP CONSTRAINT IF EXISTS agent_executions_pr5_marker_check,
  DROP CONSTRAINT IF EXISTS agent_executions_pr5_state_check;

ALTER TABLE agent_executions
  ADD CONSTRAINT agent_executions_pr5_error_code_check CHECK (
    error_code IS NULL OR error_code IN (
      'provider_auth_failed',
      'provider_timeout',
      'provider_empty_output',
      'worker_lost',
      'outcome_unknown'
    )
  ),
  ADD CONSTRAINT agent_executions_pr5_error_pair_check CHECK (
    (error_code IS NULL) = (error_message IS NULL)
    AND (
      (error_code IS NULL AND error_message IS NULL)
      OR (error_code = 'provider_auth_failed' AND error_message = 'Provider authentication failed')
      OR (error_code = 'provider_timeout' AND error_message = 'Provider request timed out')
      OR (error_code = 'provider_empty_output' AND error_message = 'Provider returned empty output')
      OR (error_code = 'worker_lost' AND error_message = 'Worker was lost before provider dispatch')
      OR (error_code = 'outcome_unknown' AND error_message = 'Provider outcome is unknown')
    )
  ),
  ADD CONSTRAINT agent_executions_pr5_marker_check CHECK (
    provider_result_persisted_at IS NULL OR provider_request_started_at IS NOT NULL
  ),
  ADD CONSTRAINT agent_executions_pr5_state_check CHECK (
    (status = 'running' AND completed_at IS NULL AND error_code IS NULL)
    OR (status = 'succeeded' AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  );

ALTER TABLE execution_events
  DROP CONSTRAINT IF EXISTS execution_events_type_check,
  DROP CONSTRAINT IF EXISTS execution_events_check,
  DROP CONSTRAINT IF EXISTS execution_events_pr5_type_check,
  DROP CONSTRAINT IF EXISTS execution_events_pr5_error_code_check,
  DROP CONSTRAINT IF EXISTS execution_events_pr5_terminal_fields_check,
  DROP CONSTRAINT IF EXISTS execution_events_pr5_references_check;

ALTER TABLE execution_events
  ADD CONSTRAINT execution_events_pr5_type_check CHECK (type IN (
    'workflow.run.queued',
    'workflow.run.started',
    'node.attempt.started',
    'node.attempt.succeeded',
    'node.attempt.failed',
    'node.run.skipped',
    'agent.execution.started',
    'agent.execution.succeeded',
    'agent.execution.failed',
    'workflow.run.succeeded',
    'workflow.run.failed'
  )),
  ADD CONSTRAINT execution_events_pr5_error_code_check CHECK (
    error_code IS NULL OR error_code IN (
      'provider_auth_failed',
      'provider_timeout',
      'provider_empty_output',
      'worker_lost',
      'outcome_unknown'
    )
  ),
  ADD CONSTRAINT execution_events_pr5_terminal_fields_check CHECK (
    (type IN ('agent.execution.failed', 'node.attempt.failed', 'workflow.run.failed')
      AND error_code IS NOT NULL AND skip_reason IS NULL)
    OR (type = 'node.run.skipped'
      AND error_code IS NULL AND skip_reason = 'upstream_failed')
    OR (type NOT IN (
        'agent.execution.failed',
        'node.attempt.failed',
        'workflow.run.failed',
        'node.run.skipped'
      ) AND error_code IS NULL AND skip_reason IS NULL)
  ),
  ADD CONSTRAINT execution_events_pr5_references_check CHECK (
    (type IN (
        'workflow.run.queued',
        'workflow.run.started',
        'workflow.run.succeeded',
        'workflow.run.failed'
      )
      AND node_run_id IS NULL
      AND attempt_id IS NULL
      AND agent_execution_id IS NULL)
    OR (type IN ('node.attempt.started', 'node.attempt.succeeded', 'node.attempt.failed')
      AND node_run_id IS NOT NULL
      AND attempt_id IS NOT NULL
      AND agent_execution_id IS NULL)
    OR (type = 'node.run.skipped'
      AND node_run_id IS NOT NULL
      AND attempt_id IS NULL
      AND agent_execution_id IS NULL)
    OR (type IN (
        'agent.execution.started',
        'agent.execution.succeeded',
        'agent.execution.failed'
      )
      AND node_run_id IS NOT NULL
      AND attempt_id IS NOT NULL
      AND agent_execution_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS queue_jobs_expired_lease_idx
  ON queue_jobs (lease_expires_at, id)
  WHERE status = 'leased';

INSERT INTO schema_migrations (name)
VALUES ('004_terminal_failures.sql')
ON CONFLICT (name) DO NOTHING;
