# Test-mode UX

The editor's test action is read-only with respect to the saved definition. It
asks for a prompt, creates a run pinned to the selected version, and displays
the graph projection alongside the Markdown result.

Status language is stable and user-facing:

- **pending** — waiting for dependencies;
- **queued** — selected for execution and displayed as **Pending** in the
  graph overlay until it starts;
- **running** — selected work in progress;
- **succeeded/failed** — terminal execution result;
- **skipped** — branch or dependency made the node ineligible.

Condition views show the selected branch and explain why sibling descendants
were skipped. A join remains pending until all incoming edges resolve. Errors
identify the affected node and a safe next action without exposing provider
credentials or MCP endpoints.

Testing should protect this behavior at the contract layer first. The single
browser E2E covers the complete editor-to-run journey; avoid broad UI snapshots
or tests that merely assert file names and implementation details.
