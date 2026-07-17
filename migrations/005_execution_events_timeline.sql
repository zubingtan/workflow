ALTER TABLE execution_events
  DROP CONSTRAINT IF EXISTS execution_events_pr5_type_check,
  DROP CONSTRAINT IF EXISTS execution_events_pr5_error_code_check,
  DROP CONSTRAINT IF EXISTS execution_events_pr5_terminal_fields_check,
  DROP CONSTRAINT IF EXISTS execution_events_pr5_references_check,
  DROP CONSTRAINT IF EXISTS execution_events_pr6_type_check,
  DROP CONSTRAINT IF EXISTS execution_events_pr6_error_code_check,
  DROP CONSTRAINT IF EXISTS execution_events_pr6_terminal_fields_check,
  DROP CONSTRAINT IF EXISTS execution_events_pr6_references_check,
  DROP CONSTRAINT IF EXISTS execution_events_pr6_payload_check;

ALTER TABLE execution_events
  ADD CONSTRAINT execution_events_pr6_type_check CHECK (type IN (
    'workflow.run.queued',
    'workflow.run.started',
    'node.attempt.started',
    'node.attempt.succeeded',
    'node.attempt.failed',
    'node.run.skipped',
    'agent.execution.started',
    'agent.execution.succeeded',
    'agent.execution.failed',
    'artifact.created',
    'workflow.run.succeeded',
    'workflow.run.failed'
  )),
  ADD CONSTRAINT execution_events_pr6_error_code_check CHECK (
    error_code IS NULL OR error_code IN (
      'provider_auth_failed',
      'provider_timeout',
      'provider_empty_output',
      'worker_lost',
      'outcome_unknown'
    )
  ),
  ADD CONSTRAINT execution_events_pr6_terminal_fields_check CHECK (
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
  ADD CONSTRAINT execution_events_pr6_references_check CHECK (
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
    OR (type IN ('node.run.skipped', 'artifact.created')
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
  ),
  ADD CONSTRAINT execution_events_pr6_payload_check CHECK (
    (type <> 'artifact.created' AND payload = '{}'::jsonb)
    OR (
      type = 'artifact.created'
      AND payload ?& ARRAY[
        'source', 'sha256', 'mediaType', 'sizeBytes', 'sensitivity', 'retentionPolicy'
      ]
      AND (payload - ARRAY[
        'source', 'sha256', 'mediaType', 'sizeBytes', 'sensitivity', 'retentionPolicy'
      ]) = '{}'::jsonb
      AND jsonb_typeof(payload->'source') = 'object'
      AND (payload->'source') ?& ARRAY['kind', 'nodeId']
      AND ((payload->'source') - ARRAY['kind', 'nodeId']) = '{}'::jsonb
      AND payload #>> '{source,kind}' = 'node.output'
      AND jsonb_typeof(payload #> '{source,nodeId}') = 'string'
      AND payload #>> '{source,nodeId}' <> ''
      AND jsonb_typeof(payload->'sha256') = 'string'
      AND payload->>'sha256' ~ '^[0-9a-f]{64}$'
      AND payload->>'mediaType' = 'text/markdown'
      AND jsonb_typeof(payload->'sizeBytes') = 'number'
      AND payload->>'sizeBytes' ~ '^(0|[1-9][0-9]*)$'
      AND payload->>'sensitivity' = 'internal'
      AND payload->>'retentionPolicy' = 'run-history'
    )
  );

INSERT INTO schema_migrations (name)
VALUES ('005_execution_events_timeline.sql')
ON CONFLICT (name) DO NOTHING;
