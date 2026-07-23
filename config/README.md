# Provider configuration

Provider bindings are no longer file-based. Agent definitions (provider
`baseUrl`, `model`, and `provider_api_key_env`) are stored in the SQLite
database at `~/.config/workflow/workflow.db` and managed through the Agents UI
(http://localhost:3000 → Agents). The API key itself is never stored — only the
name of the env var that holds it.

This directory is kept for historical reference only; no files here are loaded
by the backend.
