# Provider Bindings

- `provider-bindings.json` — the active binding loaded by the Hono backend at
  startup. Contains `apiKeyEnv` (env var name), never the actual key.
- `provider-bindings.example.json` — template for real-provider setup. Copy to
  `provider-bindings.json`, edit `baseUrl` / `apiKeyEnv` / `model`, set the env
  var, restart `pnpm server`. Never put credentials in JSON.
