CREATE TABLE IF NOT EXISTS workflow_runs (
  id text PRIMARY KEY,
  workflow_definition_version_id text NOT NULL REFERENCES workflow_definition_versions (id),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded')),
  input jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CHECK (jsonb_typeof(input) = 'object'),
  CHECK (input ? 'prompt'),
  CHECK (input = jsonb_build_object('prompt', input->'prompt')),
  CHECK (jsonb_typeof(input->'prompt') = 'string'),
  CHECK (input->>'prompt' <> ''),
  CHECK ((status = 'queued' AND started_at IS NULL AND completed_at IS NULL)
    OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL)
    OR (status = 'succeeded' AND started_at IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS workflow_runs_definition_created_idx
  ON workflow_runs (workflow_definition_version_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS node_runs (
  id text PRIMARY KEY,
  workflow_run_id text NOT NULL REFERENCES workflow_runs (id),
  node_id text NOT NULL,
  node_type text NOT NULL CHECK (node_type IN ('input.prompt', 'process.agent', 'output.markdown')),
  execution_order integer NOT NULL CHECK (execution_order BETWEEN 1 AND 3),
  status text NOT NULL CHECK (status IN ('pending', 'queued', 'running', 'succeeded')),
  agent_definition_version_id text REFERENCES agent_definition_versions (id),
  provider_binding_ref text,
  output jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (workflow_run_id, node_id),
  UNIQUE (workflow_run_id, execution_order),
  CHECK ((node_type = 'process.agent'
      AND agent_definition_version_id IS NOT NULL
      AND provider_binding_ref IS NOT NULL)
    OR (node_type <> 'process.agent'
      AND agent_definition_version_id IS NULL
      AND provider_binding_ref IS NULL)),
  CHECK (output IS NULL OR node_type = 'output.markdown'),
  CHECK ((status IN ('pending', 'queued') AND started_at IS NULL AND completed_at IS NULL)
    OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL)
    OR (status = 'succeeded' AND started_at IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS node_runs_workflow_run_order_idx
  ON node_runs (workflow_run_id, execution_order);

CREATE TABLE IF NOT EXISTS node_run_attempts (
  id text PRIMARY KEY,
  node_run_id text NOT NULL REFERENCES node_runs (id),
  number integer NOT NULL CHECK (number = 1),
  status text NOT NULL CHECK (status IN ('running', 'succeeded')),
  provider_snapshot jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (node_run_id, number),
  CHECK ((status = 'running' AND completed_at IS NULL)
    OR (status = 'succeeded' AND completed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS agent_executions (
  id text PRIMARY KEY,
  node_run_attempt_id text NOT NULL UNIQUE REFERENCES node_run_attempts (id),
  agent_definition_version_id text NOT NULL REFERENCES agent_definition_versions (id),
  status text NOT NULL CHECK (status IN ('running', 'succeeded')),
  provider_snapshot jsonb NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'running' AND completed_at IS NULL)
    OR (status = 'succeeded' AND completed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS execution_events (
  id text PRIMARY KEY,
  workflow_run_id text NOT NULL REFERENCES workflow_runs (id),
  sequence integer NOT NULL CHECK (sequence > 0),
  type text NOT NULL CHECK (type IN (
    'workflow.run.queued',
    'workflow.run.started',
    'node.attempt.started',
    'node.attempt.succeeded',
    'agent.execution.started',
    'agent.execution.succeeded',
    'workflow.run.succeeded'
  )),
  node_run_id text REFERENCES node_runs (id),
  attempt_id text REFERENCES node_run_attempts (id),
  agent_execution_id text REFERENCES agent_executions (id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_run_id, sequence),
  CHECK (jsonb_typeof(payload) = 'object'),
  CHECK (
    (type IN ('workflow.run.queued', 'workflow.run.started', 'workflow.run.succeeded')
      AND node_run_id IS NULL
      AND attempt_id IS NULL
      AND agent_execution_id IS NULL)
    OR (type IN ('node.attempt.started', 'node.attempt.succeeded')
      AND node_run_id IS NOT NULL
      AND attempt_id IS NOT NULL
      AND agent_execution_id IS NULL)
    OR (type IN ('agent.execution.started', 'agent.execution.succeeded')
      AND node_run_id IS NOT NULL
      AND attempt_id IS NOT NULL
      AND agent_execution_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS execution_events_run_sequence_idx
  ON execution_events (workflow_run_id, sequence);

CREATE OR REPLACE FUNCTION reject_execution_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Execution events are append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS execution_events_append_only ON execution_events;
CREATE TRIGGER execution_events_append_only
  BEFORE UPDATE OR DELETE ON execution_events
  FOR EACH ROW EXECUTE FUNCTION reject_execution_event_mutation();

CREATE TABLE IF NOT EXISTS queue_jobs (
  id text PRIMARY KEY,
  workflow_run_id text NOT NULL UNIQUE REFERENCES workflow_runs (id),
  status text NOT NULL CHECK (status IN ('available', 'leased', 'completed')),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'available'
      AND lease_owner IS NULL
      AND lease_expires_at IS NULL
      AND completed_at IS NULL)
    OR (status = 'leased'
      AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND completed_at IS NULL)
    OR (status = 'completed'
      AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS queue_jobs_claim_idx
  ON queue_jobs (available_at, created_at, id)
  WHERE status = 'available';

INSERT INTO schema_migrations (name)
VALUES ('003_async_runtime.sql')
ON CONFLICT (name) DO NOTHING;
