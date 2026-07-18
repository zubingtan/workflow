-- Development baseline: clear the PostgreSQL volume before applying this file.
CREATE TABLE IF NOT EXISTS workflows (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_definitions (
  id text PRIMARY KEY,
  name text NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS skill_definitions (
  id text PRIMARY KEY,
  name text NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mcp_definitions (
  id text PRIMARY KEY,
  name text NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_definition_versions (
  id text PRIMARY KEY,
  agent_definition_id text NOT NULL REFERENCES agent_definitions (id) ON DELETE CASCADE,
  version integer NOT NULL,
  definition jsonb NOT NULL,
  canonical_json text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_definition_id, version)
);
CREATE TABLE IF NOT EXISTS skill_definition_versions (
  id text PRIMARY KEY,
  skill_definition_id text NOT NULL REFERENCES skill_definitions (id) ON DELETE CASCADE,
  version integer NOT NULL,
  definition jsonb NOT NULL,
  canonical_json text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_definition_id, version)
);
CREATE TABLE IF NOT EXISTS mcp_definition_versions (
  id text PRIMARY KEY,
  mcp_definition_id text NOT NULL REFERENCES mcp_definitions (id) ON DELETE CASCADE,
  version integer NOT NULL,
  definition jsonb NOT NULL,
  canonical_json text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mcp_definition_id, version)
);
CREATE TABLE IF NOT EXISTS workflow_definition_versions (
  id text PRIMARY KEY,
  workflow_id text NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
  version integer NOT NULL,
  definition jsonb NOT NULL,
  authoring jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_json text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, version)
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id text PRIMARY KEY,
  workflow_definition_version_id text NOT NULL REFERENCES workflow_definition_versions (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  input jsonb NOT NULL,
  output jsonb,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS node_runs (
  id text PRIMARY KEY,
  workflow_run_id text NOT NULL REFERENCES workflow_runs (id) ON DELETE CASCADE,
  node_id text NOT NULL,
  node_type text NOT NULL,
  execution_order integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'queued', 'running', 'succeeded', 'failed', 'skipped')),
  agent_definition_version_id text,
  provider_binding_ref text,
  input jsonb,
  output jsonb,
  skip_reason text,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (workflow_run_id, node_id)
);
CREATE TABLE IF NOT EXISTS execution_events (
  id text PRIMARY KEY,
  workflow_run_id text NOT NULL REFERENCES workflow_runs (id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  type text NOT NULL,
  node_run_id text REFERENCES node_runs (id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_run_id, sequence)
);
CREATE TABLE IF NOT EXISTS queue_jobs (
  id text PRIMARY KEY,
  workflow_run_id text NOT NULL UNIQUE REFERENCES workflow_runs (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('available', 'leased', 'completed')),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS queue_jobs_claim_idx ON queue_jobs (available_at, created_at) WHERE status = 'available';
CREATE INDEX IF NOT EXISTS node_runs_run_order_idx ON node_runs (workflow_run_id, execution_order);
CREATE INDEX IF NOT EXISTS execution_events_run_sequence_idx ON execution_events (workflow_run_id, sequence);
