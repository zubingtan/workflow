# M0 Schema, API, Event, and Error Specification

- **Version:** v0.4-M0
- **Status:** Accepted implementation contract
- **Applies to:** the delivered M0 definition, asynchronous runtime, terminal-failure, and API projection contracts

## 1. Authority and scope

This specification freezes the smallest executable contract needed by PR3 through PR5. When documents disagree, use the precedence in [M0 Implementation Plan — Authority and Conflict Resolution](./implementation-plan.md#authority-and-conflict-resolution): current explicit user decisions, Roadmap, Automated Acceptance, accepted ADRs, Design Doc, PRD and Testing UX, Documentation Governance, then supporting documents.

The source requirements are:

- [`docs/source/v0.4/04-ROADMAP.md`, `M0 / Scope`, `自动化验收`, and `Exit Criteria`](../../source/v0.4/04-ROADMAP.md): JSON import and validation, immutable Definition Versions, the three M0 node types, Provider Binding, explicit field errors, and historical version traceability.
- [`docs/source/v0.4/09-MILESTONE-AUTOMATED-ACCEPTANCE.md`, `M0 Acceptance Suite`](../../source/v0.4/09-MILESTONE-AUTOMATED-ACCEPTANCE.md): M0-T03 creates an immutable version; M0-T04 returns node- and field-level errors.
- [`docs/source/v0.4/03-ADR.md`, ADR-0003, ADR-0005, ADR-0006, ADR-0007, ADR-0008, ADR-0010, ADR-0011, and ADR-0026](../../source/v0.4/03-ADR.md): versioned JSON is the source of truth; Workflow, Agent, Run, and Pi session identities are separate; the API creates an asynchronous persisted Run; versions are immutable; Definitions contain Binding references rather than secrets; execution events are append-only.
- [`docs/source/v0.4/02-DESIGN-DOC.md`, `Platform Control Plane`, `Workflow Execution`, `Pi Runtime Integration`, `核心领域对象`, `Workflow DSL`, `执行状态与事件`, `Provider 与模型能力`, and `存储`](../../source/v0.4/02-DESIGN-DOC.md): the API does not run a Workflow in its request; the worker creates persisted execution facts through a Pi boundary; PostgreSQL stores Run, Node, Attempt, Definition, and early Event records.
- [M0 Implementation Plan — M0 Contracts and Sequential Delivery](./implementation-plan.md#m0-contracts): M0 uses one three-node workflow shape; Workflow and Agent versions are immutable; each Agent node contains an Agent Version reference and a node-level Provider Binding reference.

The Roadmap places complete Agent Definition Version governance and the full Event/Attempt reliability model in M1. The higher-priority current decisions bring forward only the minimal immutable Agent Version reference, one Attempt per executed node, and the basic append-only events required to explain an M0 Run. Retry, event streaming, replay, and broader Agent governance remain outside PR4.

PR3 delivered Definition schema, validation, canonicalization, immutable versions, and Workflow import/list/detail APIs. PR4 delivered the asynchronous successful path. PR5 added only terminal Provider failures, worker-loss classification without automatic model replay, restart persistence, and secret redaction. PR6 projected these contracts through the read-only Web shell without changing them.

## 2. Workflow Definition schema

### 2.1 Document identity

A Definition is a JSON object with exactly these top-level fields:

```json
{
  "apiVersion": "oncall.workflow/v1alpha1",
  "kind": "Workflow",
  "metadata": {
    "name": "m0-smoke"
  },
  "spec": {
    "nodes": [],
    "edges": []
  }
}
```

The fixed values are:

- `apiVersion`: `oncall.workflow/v1alpha1`
- `kind`: `Workflow`
- `metadata`: an object containing only a non-empty string `name`

`metadata.name` is the M0 Workflow identity. Imports compare it as an exact, case-sensitive string; M0 performs no case, whitespace, or Unicode normalization. The database stores one Workflow per unique name.

Every object in the Definition rejects unknown fields.

### 2.2 Nodes

M0 contains exactly three nodes: one `input.prompt`, one `process.agent`, and one `output.markdown`. Every node has exactly this shape:

```json
{
  "id": "node-id",
  "type": "input.prompt",
  "config": {}
}
```

Rules:

- `id` is a non-empty, case-sensitive string and is unique within the Definition.
- `type` is exactly one of `input.prompt`, `process.agent`, or `output.markdown`.
- `input.prompt.config` is the empty object.
- `output.markdown.config` is the empty object.
- `process.agent.config` contains exactly two non-empty strings:

```json
{
  "agentVersionRef": "seed-agent-v1",
  "providerBindingRef": "fake-default"
}
```

`agentVersionRef` must identify an existing immutable `AgentDefinitionVersion`. `providerBindingRef` must identify an alias in the server-side Provider Binding configuration.

The Definition must not contain a Provider name, Base URL, API key, API-key environment name, model, or runtime model parameters. In particular, fields such as `provider`, `baseUrl`, `apiKey`, `apiKeyEnv`, `model`, and `parameters` are invalid. Provider Binding details remain server configuration and are never returned through these APIs.

### 2.3 Ports and edges

M0 has these fixed typed ports:

| Node type | Input | Output |
|---|---|---|
| `input.prompt` | none | `prompt:string` |
| `process.agent` | `prompt:string` | `markdown:string` |
| `output.markdown` | `markdown:string` | none |

An edge has exactly this shape:

```json
{
  "from": "source-node-id",
  "to": "target-node-id",
  "mapping": [
    {
      "from": "source-port",
      "to": "target-port"
    }
  ]
}
```

The Definition contains exactly two edges and forms this chain:

1. `input.prompt` to `process.agent`, with exactly `prompt` mapped to `prompt`.
2. `process.agent` to `output.markdown`, with exactly `markdown` mapped to `markdown`.

Edge endpoints must reference existing nodes. All nodes must be reachable from the Input and able to reach the Output. The graph must have one start, one end, and no cycle. Because M0 has fixed ports, any missing, extra, reversed, unknown, or type-incompatible mapping is invalid.

### 2.4 Complete valid example

```json
{
  "apiVersion": "oncall.workflow/v1alpha1",
  "kind": "Workflow",
  "metadata": {
    "name": "m0-smoke"
  },
  "spec": {
    "nodes": [
      {
        "id": "prompt",
        "type": "input.prompt",
        "config": {}
      },
      {
        "id": "analyze",
        "type": "process.agent",
        "config": {
          "agentVersionRef": "seed-agent-v1",
          "providerBindingRef": "fake-default"
        }
      },
      {
        "id": "result",
        "type": "output.markdown",
        "config": {}
      }
    ],
    "edges": [
      {
        "from": "prompt",
        "to": "analyze",
        "mapping": [
          {
            "from": "prompt",
            "to": "prompt"
          }
        ]
      },
      {
        "from": "analyze",
        "to": "result",
        "mapping": [
          {
            "from": "markdown",
            "to": "markdown"
          }
        ]
      }
    ]
  }
}
```

## 3. Validation contract

Import validation is side-effect free until every check passes. It validates, in order:

1. The request contains valid JSON.
2. The JSON matches the closed schema in Section 2.
3. Node IDs and edge references are valid.
4. The graph is the supported three-node chain, is reachable, and is acyclic.
5. Port mappings match the fixed M0 types.
6. `agentVersionRef` exists.
7. `providerBindingRef` exists in server configuration.

An invalid import creates neither a Workflow nor a Workflow Definition Version. Tests should use one defect per fixture; selection among multiple simultaneous errors is not part of the M0 contract.

## 4. Canonical JSON and hash

Before persistence, the server canonicalizes a valid Definition as follows:

1. Recursively sort the keys of every JSON object in ascending Unicode code-point order.
2. Preserve array order.
3. Preserve JSON primitive values without string, case, whitespace-within-string, number, or Unicode normalization.
4. Serialize the result as compact UTF-8 JSON with no insignificant whitespace.
5. Compute SHA-256 over those exact UTF-8 bytes and encode it as 64 lowercase hexadecimal characters.

The canonical JSON text and hash are stored with the parsed Definition. Different object-key order produces the same canonical text and hash. Array reordering or a value change produces a different canonical text and hash.

## 5. Version and persistence contract

PR3 extends the existing `workflows` and `agent_definitions` tables and adds `workflow_definition_versions` and `agent_definition_versions`.

A Workflow Definition Version stores at least:

- opaque string ID;
- parent Workflow ID;
- positive integer version number;
- parsed Definition JSON;
- canonical JSON text;
- SHA-256 hash;
- creation timestamp.

An Agent Definition Version stores the corresponding parent Agent ID, positive version, immutable definition payload, canonical JSON, hash, and creation timestamp. PR3 seeds the minimal Agent Version used by the valid example; PR4 consumes that immutable reference during runtime execution.

Persistence rules:

- `workflows.name` is unique.
- `(workflow_id, version)` is unique.
- `(agent_definition_id, version)` is unique.
- Version rows reject direct `UPDATE` and `DELETE` at the database boundary.
- A parent with version rows cannot be deleted through cascading deletion.
- A successful import locks or otherwise serializes allocation for that Workflow, then inserts `max(committed version) + 1` in the same transaction.
- Workflow creation and its first Version insertion are one transaction.
- Every successful import creates the next immutable Version, including an import whose canonical hash matches an existing Version. Hash is therefore not unique.
- A failed transaction exposes neither a Workflow nor a Version and does not consume a committed version number.
- Provider Bindings are not stored as a global Provider or Provider Binding table in PR3.

## 6. Workflow API

All IDs are opaque platform strings. These APIs never expose Provider configuration or Pi runtime identifiers.

### 6.1 Import

`POST /api/workflows/import` accepts one Workflow Definition as its JSON body.

Success returns `201 Created`:

```json
{
  "workflow": {
    "id": "workflow-id",
    "name": "m0-smoke"
  },
  "workflowDefinitionVersion": {
    "id": "definition-version-id",
    "version": 1,
    "hash": "64-lowercase-hex-characters",
    "definition": {}
  }
}
```

`definition` is the parsed canonical Definition. A repeated successful import returns the newly created Version, not an earlier same-hash Version.

### 6.2 List

`GET /api/workflows` returns `200 OK`:

```json
{
  "workflows": [
    {
      "id": "workflow-id",
      "name": "m0-smoke",
      "latestDefinitionVersion": {
        "id": "definition-version-id",
        "version": 1,
        "hash": "64-lowercase-hex-characters"
      }
    }
  ]
}
```

The list contains one entry per Workflow. Ordering and pagination are outside M0.

### 6.3 Detail

`GET /api/workflows/:id` returns `200 OK` for the Workflow and its latest Definition Version:

```json
{
  "workflow": {
    "id": "workflow-id",
    "name": "m0-smoke"
  },
  "workflowDefinitionVersion": {
    "id": "definition-version-id",
    "version": 1,
    "hash": "64-lowercase-hex-characters",
    "definition": {}
  }
}
```

Workflow Definition Version history remains outside PR4. Workflow Run History is defined in Section 12.3.

## 7. Error contract

An invalid import returns `400 Bad Request` with one error object:

```json
{
  "code": "validation_error",
  "message": "Human-readable message",
  "path": "spec.nodes[1].config.providerBindingRef",
  "nodeId": "analyze"
}
```

Rules:

- `code` is exactly `validation_error`.
- `message` is non-empty and does not include secrets or resolved Provider configuration.
- `path` uses dot and zero-based bracket notation rooted at the Definition, without a leading `$`.
- `nodeId` is the node ID for errors local to `spec.nodes[i]`, including Agent Version and Provider Binding reference errors.
- `nodeId` is `null` for malformed JSON, document-level, edge-level, and graph-wide errors.
- A document-level path is the empty string. Edge and graph errors use the narrowest applicable `spec.edges[i]`, `spec.edges`, or `spec.nodes` path.

Run request validation uses the same `validation_error` envelope with `nodeId: null`. A non-empty but unknown resource ID returns `404 Not Found`:

```json
{
  "code": "not_found",
  "message": "Run not found"
}
```

The fixed messages are `Workflow not found`, `Workflow definition version not found`, and `Run not found` for their respective resources. Provider and worker terminal errors are defined in Sections 14 and 15.

## 8. PR4 runtime records and references

PR4 adds `workflow_runs`, `node_runs`, `node_run_attempts`, `agent_executions`, `execution_events`, and `queue_jobs` as PostgreSQL records.

A Run permanently references one immutable `workflow_definition_versions.id` and stores the original `input.prompt` string. It creates exactly three Node Runs in Definition execution order. The Process Node Run permanently references the immutable Agent Definition Version named by `agentVersionRef` and copies the configured `providerBindingRef` alias.

A successful M0 Run has exactly one Attempt for each Node Run and exactly one Agent Execution under the Process Attempt. Attempts are created when their node starts; therefore a queued or partially running Run may expose `attempt: null` for nodes that have not started. PR4 never creates a second Attempt.

When the worker starts the Process Attempt, it resolves the node's Binding and stores this allowlisted snapshot on both the Attempt and Agent Execution:

```json
{
  "bindingAlias": "fake-default",
  "effectiveProvider": "openai-compatible",
  "effectiveModel": "fake-m0",
  "parameters": {
    "temperature": 0
  }
}
```

Only non-secret runtime parameters may appear in `parameters`. The snapshot never contains a Base URL, API key, API-key environment name, other secret material, a Pi session ID, or a Pi internal type. The two stored snapshots must be equal and remain historical facts even if server Binding configuration later changes.

The worker persists the final Output Node value in PostgreSQL as:

```json
{
  "markdown": "Provider result"
}
```

The Output Node is the canonical public Markdown result. The local artifact sink is not used for this output.

## 9. M0 states and projection

PR4 uses the successful states below; PR5 adds the listed terminal failure states:

- Run: `queued`, `running`, `succeeded`, `failed`.
- Node Run: `pending`, `queued`, `running`, `succeeded`, `failed`, `skipped`.
- Node Attempt: `running`, `succeeded`, `failed`.
- Agent Execution: `running`, `succeeded`, `failed`.

Creation produces a `queued` Run, a `queued` Input Node, and `pending` Process and Output Nodes. The worker advances the nodes in fixed order:

```text
input.prompt:    queued -> running -> succeeded
process.agent:  pending -> queued -> running -> succeeded
output.markdown: pending -> queued -> running -> succeeded
run:             queued -> running -> succeeded
```

Each projection change and its matching event commit in the same database transaction. The external Provider request is outside the database transaction: start facts commit before dispatch, and success facts commit only after a result is received and persisted. Sections 14 and 15 define failures at that boundary.

## 10. Queue and worker boundary

`POST /api/runs` creates the Run, three Node Runs, one `available` queue job, and the first Run event in one transaction. If any insert fails, none is visible.

The internal queue job uses only `available`, `leased`, and `completed` in the PR4 happy path. There is exactly one queue job per Run.

- Claim atomically changes one eligible `available` job to `leased` and records a worker owner and lease expiry.
- Concurrent workers cannot successfully claim the same available job.
- Successful finalization changes the leased job to `completed` in the same transaction that succeeds the Run.
- Queue jobs, lease owners, and lease timestamps are never exposed by the product API.
- PR5 sweeps an expired `leased` job to a terminal failed Run; it never returns that job to `available` and never creates another Attempt.

The API handler creates database facts only. It does not call a model, the Fake Provider, or Pi and does not wait for the worker. Only the worker calls the Pi Runtime Adapter; only that adapter calls the configured Fake Provider in normal M0 acceptance. Public IDs and responses never contain Pi session identifiers.

The M0 Pi runtime package is pinned exactly to `@mariozechner/pi-agent-core` `0.73.1`. Every Pi import is confined to a dedicated internal Pi Runtime Adapter module: the worker imports and calls that adapter, while the Next.js application and its route handlers never import or call Pi directly. A Pi Session ID remains internal adapter state and must not be used as, or copied into, any platform ID, product API, or execution event. This boundary does not prescribe Agent class internals or require a coding-agent dependency.

## 11. Append-only happy-path events

Every event belongs to one Run, has an opaque ID, a positive per-Run `sequence`, a `type`, an `occurredAt` timestamp, and nullable `nodeRunId`, `attemptId`, and `agentExecutionId` references. Event rows reject update and delete. `(run_id, sequence)` is unique, begins at 1, and increases without gaps among committed events.

A successful PR4 Run emits exactly these ordered event types:

1. `workflow.run.queued`
2. `workflow.run.started`
3. `node.attempt.started` for Input
4. `node.attempt.succeeded` for Input
5. `node.attempt.started` for Process
6. `agent.execution.started`
7. `agent.execution.succeeded`
8. `node.attempt.succeeded` for Process
9. `node.attempt.started` for Output
10. `node.attempt.succeeded` for Output
11. `workflow.run.succeeded`

Run events have all subordinate references `null`. Node Attempt events identify their Node Run and Attempt. Agent Execution events also identify the Process Node Run, Process Attempt, and Agent Execution. Event payloads do not copy prompt text, Markdown, Provider configuration, model parameters, secrets, or Pi data. PR4 persists events for database verification; it does not add an event API or SSE.

## 12. Run API

All timestamps below are UTC ISO 8601 strings or `null` until the transition occurs. Nodes are returned in Input, Process, Output execution order.

### 12.1 Create Run

`POST /api/runs` accepts exactly:

```json
{
  "workflowDefinitionVersionId": "definition-version-id",
  "input": {
    "prompt": "Explain this incident"
  }
}
```

`workflowDefinitionVersionId` and `input.prompt` are non-empty strings; `input.prompt` is stored exactly as received. Unknown fields are invalid. An unknown non-empty Definition Version ID returns the Definition Version `404` from Section 7.

After the creation transaction commits, the API immediately returns exactly `202 Accepted`:

```json
{
  "runId": "run-id",
  "status": "queued"
}
```

### 12.2 Run Detail

`GET /api/runs/:id` returns `200 OK` with the current committed projection. A succeeded response has this envelope:

```json
{
  "run": {
    "id": "run-id",
    "status": "succeeded",
    "error": null,
    "createdAt": "2026-07-15T00:00:00.000Z",
    "startedAt": "2026-07-15T00:00:01.000Z",
    "completedAt": "2026-07-15T00:00:02.000Z",
    "workflow": {
      "id": "workflow-id",
      "name": "m0-smoke"
    },
    "workflowDefinitionVersion": {
      "id": "definition-version-id",
      "version": 1,
      "hash": "64-lowercase-hex-characters"
    },
    "input": {
      "prompt": "Explain this incident"
    },
    "nodes": [
      {
        "id": "input-node-run-id",
        "nodeId": "prompt",
        "type": "input.prompt",
        "status": "succeeded",
        "error": null,
        "skipReason": null,
        "agentDefinitionVersion": null,
        "providerBindingRef": null,
        "output": null,
        "attempt": {
          "id": "input-attempt-id",
          "number": 1,
          "status": "succeeded",
          "error": null,
          "startedAt": "2026-07-15T00:00:01.000Z",
          "completedAt": "2026-07-15T00:00:01.100Z",
          "providerSnapshot": null,
          "agentExecution": null
        }
      },
      {
        "id": "process-node-run-id",
        "nodeId": "analyze",
        "type": "process.agent",
        "status": "succeeded",
        "error": null,
        "skipReason": null,
        "agentDefinitionVersion": {
          "id": "seed-agent-v1",
          "version": 1,
          "hash": "64-lowercase-hex-characters"
        },
        "providerBindingRef": "fake-default",
        "output": null,
        "attempt": {
          "id": "process-attempt-id",
          "number": 1,
          "status": "succeeded",
          "error": null,
          "startedAt": "2026-07-15T00:00:01.100Z",
          "completedAt": "2026-07-15T00:00:01.900Z",
          "providerSnapshot": {
            "bindingAlias": "fake-default",
            "effectiveProvider": "openai-compatible",
            "effectiveModel": "fake-m0",
            "parameters": {
              "temperature": 0
            }
          },
          "agentExecution": {
            "id": "agent-execution-id",
            "status": "succeeded",
            "error": null,
            "startedAt": "2026-07-15T00:00:01.200Z",
            "completedAt": "2026-07-15T00:00:01.800Z",
            "agentDefinitionVersion": {
              "id": "seed-agent-v1",
              "version": 1,
              "hash": "64-lowercase-hex-characters"
            },
            "providerSnapshot": {
              "bindingAlias": "fake-default",
              "effectiveProvider": "openai-compatible",
              "effectiveModel": "fake-m0",
              "parameters": {
                "temperature": 0
              }
            }
          }
        }
      },
      {
        "id": "output-node-run-id",
        "nodeId": "result",
        "type": "output.markdown",
        "status": "succeeded",
        "error": null,
        "skipReason": null,
        "agentDefinitionVersion": null,
        "providerBindingRef": null,
        "output": {
          "markdown": "Provider result"
        },
        "attempt": {
          "id": "output-attempt-id",
          "number": 1,
          "status": "succeeded",
          "error": null,
          "startedAt": "2026-07-15T00:00:01.900Z",
          "completedAt": "2026-07-15T00:00:02.000Z",
          "providerSnapshot": null,
          "agentExecution": null
        }
      }
    ]
  }
}
```

Before a node starts, its `attempt` and `output` are `null`. `startedAt` is `null` until start, and `completedAt` is `null` until completion. Process provider and Agent Execution snapshots appear only after the Process Attempt starts.

### 12.3 Workflow Run History

`GET /api/workflows/:id/runs` returns `200 OK`:

```json
{
  "workflow": {
    "id": "workflow-id",
    "name": "m0-smoke"
  },
  "runs": [
    {
      "id": "run-id",
      "status": "succeeded",
      "error": null,
      "createdAt": "2026-07-15T00:00:00.000Z",
      "startedAt": "2026-07-15T00:00:01.000Z",
      "completedAt": "2026-07-15T00:00:02.000Z",
      "workflowDefinitionVersion": {
        "id": "definition-version-id",
        "version": 1,
        "hash": "64-lowercase-hex-characters"
      },
      "input": {
        "prompt": "Explain this incident"
      }
    }
  ]
}
```

History includes Runs from every Definition Version of that Workflow and is ordered by `createdAt` descending, then Run ID descending. Pagination is outside M0.

## 13. Polling semantics

Run Detail and Run History are uncached database projections. Responses use `Cache-Control: no-store`. A client observes progress by polling `GET /api/runs/:id`; each response returns immediately with the latest committed state. M0 provides no long polling, streaming response, or SSE.

## 14. PR5 terminal error contract

PR5 uses exactly these persisted runtime error codes:

| Code | Condition | Safe message |
|---|---|---|
| `provider_auth_failed` | Provider returns an authentication failure | `Provider authentication failed` |
| `provider_timeout` | The configured Provider deadline expires | `Provider request timed out` |
| `provider_empty_output` | A successful response has no text or only whitespace | `Provider returned empty output` |
| `worker_lost` | An expired lease proves no Provider dispatch started | `Worker was lost before provider dispatch` |
| `outcome_unknown` | Provider dispatch started but no durable result exists | `Provider outcome is unknown` |

The Run, failed Process Node, Process Attempt, and Agent Execution project the same redacted error object:

```json
{
  "code": "provider_timeout",
  "message": "Provider request timed out",
  "nodeId": "analyze"
}
```

No error field contains raw Provider response bodies, headers, URLs, credentials, stack traces, or Pi values. History returns the same Run-level error summary. Successful records keep `error: null`.

For every code above, the already successful Input remains unchanged. The one Process Attempt and its one Agent Execution transition from `running` to `failed`; the Process Node becomes `failed`; the Output Node becomes `skipped` with `error: null`, `skipReason: "upstream_failed"`, `attempt: null`, and `output: null`; then the Run becomes `failed`. No Output Attempt is created.

The failure tail after the common events 1–6 in Section 11 is exactly:

7. `agent.execution.failed`
8. `node.attempt.failed` for Process
9. `node.run.skipped` for Output
10. `workflow.run.failed`

Failure events 7, 8, and 10 store the error code; event 9 stores `skipReason: "upstream_failed"`. The matching projection and event commit together. No failure creates a second Attempt, requeues the job, or repeats a Provider request. Authentication, timeout, and empty-output scenarios each make exactly one Provider request; timeout never causes a second call after its deadline.

## 15. Worker-loss classification and sweep

Before dispatch, the Process Agent Execution durably records `provider_request_started_at`. This marker means a request may have reached the Provider; it is deliberately conservative. A Provider result becomes durable only when its result and `provider_result_persisted_at` commit together.

An expired-lease sweep is atomic and idempotent:

- `provider_request_started_at IS NULL` becomes `worker_lost`.
- `provider_request_started_at IS NOT NULL` and no durable result becomes `outcome_unknown`.
- A durable result may be finalized from PostgreSQL without another Provider call.
- The sweep applies the failure projection and events from Section 14, changes the queue job to terminal `completed`, and never changes it back to `available`.
- Repeating the sweep makes no state change, appends no event, and performs no Provider request.

M0 never retries or replays a model request after worker loss. `worker_lost` is used only when durable evidence proves dispatch did not start; ambiguity is classified as `outcome_unknown`.

## 16. Deterministic failure controls

The Fake Provider exposes test-only modes `success`, `auth_failure`, `timeout`, and `empty_output`. The worker exposes test-only fault hooks `before_model_request` and `after_model_request_before_persist`. These controls are acceptance configuration, not product API fields.

- `auth_failure` increments the per-test Provider request counter once and produces `provider_auth_failed`.
- `timeout` increments it once, exceeds the deterministic deadline, and produces `provider_timeout`.
- `empty_output` increments it once, returns empty or whitespace text, and produces `provider_empty_output`.
- `before_model_request` terminates the worker before `provider_request_started_at`; the counter remains zero and the sweep produces `worker_lost`.
- `after_model_request_before_persist` terminates after the Provider counter reaches one and before a durable result; the sweep produces `outcome_unknown`.

Counters are scoped by acceptance correlation and are diagnostic-only. They prove zero replay and are not exposed in Workflow, Run, Node, or Event APIs.

## 17. Restart persistence

PostgreSQL is the only product-state source. After all app, worker, PostgreSQL, and Fake Provider containers stop and restart with the same database volume:

- Workflow and Agent Version references, original prompt, Run and Node states, Attempts, Agent Execution, events, provider snapshot, errors, skip reason, and Markdown remain queryable.
- Run History reopens the same Run and `GET /api/runs/:id` returns the same terminal projection.
- A terminal Run does not enqueue work or change the Provider request counter.
- An expired in-flight lease is swept once under Section 15 and never causes a duplicate call.

No in-memory worker or Pi session state is required to explain a terminal Run.

## 18. Redaction and schema deltas

PR5 adds nullable error code/message columns to Run, Node, Attempt, and Agent Execution records; a nullable Node `skip_reason`; Agent Execution `provider_request_started_at` and `provider_result_persisted_at`; and nullable Event `error_code` and `skip_reason`. Error codes are limited to Section 14, and `skip_reason` is limited to `upstream_failed` in M0.

Persisted and projected Provider data uses the Section 8 allowlist only: Binding alias, effective Provider, effective Model, and explicitly non-secret parameters. Product tables, APIs, events, logs, and acceptance evidence must omit credential values and names, Base URLs, `apiKeyEnv`, Pi session/internal data, request headers, and raw Provider request or response bodies. Safe error messages come only from the table in Section 14; external messages are never passed through.

If diagnostic text must retain surrounding content, every configured credential value is replaced with `[REDACTED]` before persistence or logging. Acceptance injects a unique secret sentinel and scans serialized API responses, product-table exports, event exports, app/worker/Fake Provider logs, DOM/browser evidence, and the redacted Support Bundle; any sentinel match fails M0-T11. PR6 delivered the browser boundary and PR7 delivered Support Bundle generation.

## 19. Deferred runtime behavior

Retry, Cancel, Replay, SSE, multiple Attempts, waiting, Human Interaction, Tool execution, live-model evaluation, and product-level Event browsing remain outside M0. Later runtime contracts must not mutate historical Definition, Run reference, Attempt, Agent Execution, provider snapshot, Event, prompt, Markdown, error, or skip facts.

## 20. Acceptance mapping

PR3 provides the non-UI evidence for:

- **M0-T03:** a valid import creates a canonical, hashed, monotonically numbered, database-enforced immutable Version.
- **M0-T04:** each invalid fixture returns the fixed node- or field-level error and leaves Workflow and Version row counts unchanged.

PR4 provides the M0-T05 evidence that Run creation returns `202` before execution, the worker runs Input, Agent, and Output in order through the Fake Provider, one Attempt is retained per node, ordered events and immutable version/provider facts are persisted, and PostgreSQL Markdown is available through Run Detail.

PR5 provides:

- **M0-T06:** authentication failure produces `provider_auth_failed`, Process failed, Output skipped, Run failed, and one Provider call.
- **M0-T07:** deterministic timeout produces `provider_timeout`, a terminal Run, and exactly one Provider call.
- **M0-T07E:** empty or whitespace output produces `provider_empty_output` and no Markdown Output.
- **M0-T08:** before-dispatch loss becomes `worker_lost`; after-dispatch/no-result loss becomes `outcome_unknown`; neither path requeues or repeats a model call.
- **M0-T09:** a full restart preserves terminal history, nodes, attempts, events, snapshots, errors, version references, and Markdown without duplicate calls.
- **M0-T11:** the sentinel scan passes across API, database, events, logs, and PR5 evidence.

PR6 provides the UI portion of M0-T04, the full-stack Chromium evidence for M0-T10, and the DOM/browser portion of M0-T11. PR7 provides M0-T12 Support Bundle evidence and generates the runtime Requirement-to-Test-to-Evidence matrix used by the complete M0 gate. Traceability follows [`docs/source/v0.4/09-MILESTONE-AUTOMATED-ACCEPTANCE.md`, `Requirement Traceability`](../../source/v0.4/09-MILESTONE-AUTOMATED-ACCEPTANCE.md).
