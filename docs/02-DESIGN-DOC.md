# Design and API contract

## Definition schema

```json
{
  "apiVersion": "workflow/v1alpha1",
  "kind": "Workflow",
  "metadata": { "name": "example" },
  "spec": {
    "nodes": [
      { "id": "prompt", "type": "input.prompt", "config": {} },
      { "id": "agent", "type": "task.agent", "config": {
        "systemPrompt": "…", "skillVersionRefs": [],
        "mcpServerVersionRefs": [], "providerBindingRef": "default"
      }},
      { "id": "result", "type": "output.markdown", "config": {} }
    ],
    "edges": [{ "from": "prompt", "to": "agent",
      "mapping": [{ "source": "prompt", "target": "prompt" }] }]
  }
}
```

The compiler validates node IDs, ports, mappings, reachability, branch IDs,
and condition literals. The supported node union is intentionally closed.

## Condition

A condition branch has an optional expression. Expressions are recursive:
`{type:"all", children:[...]}`, `{type:"any", children:[...]}`, or a leaf
`{left, operator, right}`. Branches are evaluated in declaration order; the
first true branch wins and a branch without a condition is the fallback.

## API surface

- `GET /api/workflows` — list workflow summaries and latest versions.
- `POST /api/workflows` — create a workflow and its first version.
- `GET /api/workflows/:id` — fetch metadata, versions, and latest definition.
- `POST /api/workflows/:id/versions` — validate and append a version.
- `POST /api/runs` — create a run pinned to a definition version.
- `GET /api/runs/:id` — read the run projection and node statuses.
- Resource endpoints list and version Agent, Skill, and MCP definitions.

JSON authoring and visual editing call the same version endpoint; neither path
mutates an existing version.

## Runtime boundary

The worker evaluates the DAG and calls Pi through `RuntimeAdapter`. Pi is the
agent loop, not the workflow engine. The adapter receives the selected Agent
snapshot, Skill text, and provider binding. MCP references are retained for
traceability but the minimal runtime passes no MCP tools to Pi and performs no
MCP calls.

For each node, `pending` means waiting, `queued`/`running` means selected for
execution, `succeeded` or `failed` is terminal, and `skipped` means a branch or
dependency made it ineligible. A join executes only after every incoming edge
has resolved; values are mapped without coercion.
