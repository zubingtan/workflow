# Provider configuration

Provider bindings are no longer file-based. Agent definitions (provider
`baseUrl`, `model`, and `provider_api_key`) are stored in the SQLite
database at `~/.config/workflow/workflow.db` (prod) or `~/.config/workflow-dev/workflow.db`
(dev) and managed through the Agents UI (http://localhost:4001 → Agents, or
http://localhost:4000 in prod). The API key value is stored directly in the
database.

This directory is kept for historical reference only; no files here are loaded
by the backend.
