# Issue #281 management UI evidence

## Browser smoke

Environment: local `pnpm dev`, server `:4001`, fake provider `:4010`, Chromium via `pnpm dlx agent-browser`.

1. Opened `#/workflows`; created `Issue 281 CRUD smoke`, opened it, returned to the catalog, copied it, and deleted both the copy and the original through the confirmation dialog.
2. Repeated the workflow path with rename and History; the new modal rendered the empty state without a legacy dialog.
3. Opened `#/agents`; created an agent, opened Basic and Provider, and verified model discovery/testing controls. The search clear affordance was exercised through the new local Input primitive.
4. Opened `#/settings`; verified vertical Execution/Memory/LLM navigation. With empty mem0 fields, Test Connection produced the recoverable message `Please fill in mem0 Server URL and API Key first` in the shared feedback viewport.
5. Captured light and dark screenshots at 1440×900. At 900×900, collapsed the rail and verified the snapshot changed from `Collapse navigation` to `Expand navigation`.

## Captures

- [Workflows light](./workflows-light.png)
- [Agents light](./agents-light.png)
- [Agents dark](./agents-dark.png)
- [Settings light](./settings-light.png)
- [Settings dark](./settings-dark.png)
- [Workflows narrow dark](./workflows-narrow-dark.png)

The smoke used the existing API and FlowGram editor paths; no API payload or Workflow JSON contract was changed.

Manual signoff: Codex browser smoke completed on 2026-08-11; screenshots and the operation record above are the review evidence for #281.
