CREATE UNIQUE INDEX IF NOT EXISTS workflows_name_unique
  ON workflows (name);

CREATE TABLE IF NOT EXISTS agent_definition_versions (
  id text PRIMARY KEY,
  agent_definition_id text NOT NULL REFERENCES agent_definitions (id),
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL,
  canonical_json text NOT NULL,
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_definition_id, version)
);

CREATE TABLE IF NOT EXISTS workflow_definition_versions (
  id text PRIMARY KEY,
  workflow_id text NOT NULL REFERENCES workflows (id),
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL,
  canonical_json text NOT NULL,
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, version)
);

CREATE OR REPLACE FUNCTION reject_definition_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Definition versions are immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS agent_definition_versions_immutable
  ON agent_definition_versions;
CREATE TRIGGER agent_definition_versions_immutable
  BEFORE UPDATE OR DELETE ON agent_definition_versions
  FOR EACH ROW EXECUTE FUNCTION reject_definition_version_mutation();

DROP TRIGGER IF EXISTS workflow_definition_versions_immutable
  ON workflow_definition_versions;
CREATE TRIGGER workflow_definition_versions_immutable
  BEFORE UPDATE OR DELETE ON workflow_definition_versions
  FOR EACH ROW EXECUTE FUNCTION reject_definition_version_mutation();

INSERT INTO agent_definition_versions (
  id,
  agent_definition_id,
  version,
  definition,
  canonical_json,
  hash
)
SELECT
  'seed-agent-v1',
  id,
  1,
  '{"name":"M0 Bootstrap Agent"}'::jsonb,
  '{"name":"M0 Bootstrap Agent"}',
  '9aa53dfffacb26dd48e2663837da3a06d2d562f15bdb8a690c827462d274b3ee'
FROM agent_definitions
WHERE id = 'seed-agent'
ON CONFLICT (id) DO NOTHING;

INSERT INTO workflow_definition_versions (
  id,
  workflow_id,
  version,
  definition,
  canonical_json,
  hash
)
SELECT
  'seed-workflow-v1',
  id,
  1,
  '{"apiVersion":"oncall.workflow/v1alpha1","kind":"Workflow","metadata":{"name":"M0 Bootstrap Workflow"},"spec":{"edges":[{"from":"prompt","mapping":[{"from":"prompt","to":"prompt"}],"to":"analyze"},{"from":"analyze","mapping":[{"from":"markdown","to":"markdown"}],"to":"result"}],"nodes":[{"config":{},"id":"prompt","type":"input.prompt"},{"config":{"agentVersionRef":"seed-agent-v1","providerBindingRef":"fake-default"},"id":"analyze","type":"process.agent"},{"config":{},"id":"result","type":"output.markdown"}]}}'::jsonb,
  '{"apiVersion":"oncall.workflow/v1alpha1","kind":"Workflow","metadata":{"name":"M0 Bootstrap Workflow"},"spec":{"edges":[{"from":"prompt","mapping":[{"from":"prompt","to":"prompt"}],"to":"analyze"},{"from":"analyze","mapping":[{"from":"markdown","to":"markdown"}],"to":"result"}],"nodes":[{"config":{},"id":"prompt","type":"input.prompt"},{"config":{"agentVersionRef":"seed-agent-v1","providerBindingRef":"fake-default"},"id":"analyze","type":"process.agent"},{"config":{},"id":"result","type":"output.markdown"}]}}',
  '1292d961c1dff032a239909f79747e4b1e5b26436a284cb4bc06c8f2d63c659b'
FROM workflows
WHERE id = 'seed-workflow'
ON CONFLICT (id) DO NOTHING;

INSERT INTO schema_migrations (name)
VALUES ('002_definition_versions.sql')
ON CONFLICT (name) DO NOTHING;
