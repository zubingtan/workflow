CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflows (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_definitions (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO workflows (id, name)
VALUES ('seed-workflow', 'M0 Bootstrap Workflow')
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_definitions (id, name)
VALUES ('seed-agent', 'M0 Bootstrap Agent')
ON CONFLICT (id) DO NOTHING;

INSERT INTO schema_migrations (name)
VALUES ('001_bootstrap.sql')
ON CONFLICT (name) DO NOTHING;
