# M0 Schema, API, Event, and Error Specification

- **Version:** v0.4-M0
- **Status:** Accepted implementation contract
- **Applies to:** PR3 definition versioning

## 1. Authority and scope

This specification freezes the smallest executable contract needed by PR3. When documents disagree, use the precedence in [M0 Implementation Plan — Authority and Conflict Resolution](./implementation-plan.md#authority-and-conflict-resolution): current explicit user decisions, Roadmap, Automated Acceptance, accepted ADRs, Design Doc, PRD and Testing UX, Documentation Governance, then supporting documents.

The source requirements are:

- [`docs/source/v0.4/04-ROADMAP.md`, `M0 / Scope`, `自动化验收`, and `Exit Criteria`](../../source/v0.4/04-ROADMAP.md): JSON import and validation, immutable Definition Versions, the three M0 node types, Provider Binding, explicit field errors, and historical version traceability.
- [`docs/source/v0.4/09-MILESTONE-AUTOMATED-ACCEPTANCE.md`, `M0 Acceptance Suite`](../../source/v0.4/09-MILESTONE-AUTOMATED-ACCEPTANCE.md): M0-T03 creates an immutable version; M0-T04 returns node- and field-level errors.
- [`docs/source/v0.4/03-ADR.md`, ADR-0003, ADR-0005, ADR-0006, ADR-0010, and ADR-0011](../../source/v0.4/03-ADR.md): versioned JSON is the source of truth; control flow and data mapping are separate; Workflow and Agent definitions are separate; versions are immutable; Definitions contain Binding references rather than secrets.
- [`docs/source/v0.4/02-DESIGN-DOC.md`, `Workflow Compiler`, `核心领域对象`, `Workflow DSL`, `Provider 与模型能力`, and `存储`](../../source/v0.4/02-DESIGN-DOC.md): the compiler validates references, reachability, cycles, mappings, Agent references, and milestone scope; PostgreSQL stores definitions and versions.
- [M0 Implementation Plan — M0 Contracts and Sequential Delivery](./implementation-plan.md#m0-contracts): M0 uses one three-node workflow shape; Workflow and Agent versions are immutable; each Agent node contains an Agent Version reference and a node-level Provider Binding reference.

The Roadmap places complete Agent Definition Version governance in M1. The higher-priority current decision brings forward only the minimal immutable Agent Version record and reference required by M0. Agent authoring, budgets, capabilities, Tool or Skill policy, publishing, and model governance remain outside PR3.

PR3 covers Definition schema, validation, canonicalization, immutable versions, and Workflow import/list/detail APIs. Run creation, queueing, execution events, runtime errors, and UI behavior are not defined here.

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

An Agent Definition Version stores the corresponding parent Agent ID, positive version, immutable definition payload, canonical JSON, hash, and creation timestamp. PR3 seeds the minimal Agent Version used by the valid example; its runtime prompt semantics are deferred to PR4.

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

Version-history and Run-history response shapes are deferred until the runtime API is introduced.

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

Other HTTP error envelopes are not frozen by PR3.

## 8. Event and runtime boundary

PR3 defines no execution event schema and emits no Run, Node, Attempt, Agent Execution, or runtime failure events. Those contracts depend on runtime persistence introduced in PR4 and failure semantics introduced in PR5.

Specifically deferred:

- `POST /api/runs` and Run query responses;
- `GET /api/workflows/:id/runs`;
- Run, Node, Attempt, Agent Execution, and append-only event schemas;
- Provider effective-model snapshots;
- provider, timeout, empty-output, worker-loss, and outcome-unknown errors;
- Retry, Cancel, Replay, SSE, or multi-Attempt behavior.

Later specifications may add these runtime contracts but must not change an existing immutable Workflow or Agent Definition Version.

## 9. Acceptance mapping

PR3 provides the non-UI evidence for:

- **M0-T03:** a valid import creates a canonical, hashed, monotonically numbered, database-enforced immutable Version.
- **M0-T04:** each invalid fixture returns the fixed node- or field-level error and leaves Workflow and Version row counts unchanged.

The UI portion of M0-T04 remains pending PR6. Requirement-to-test-to-evidence traceability follows [`docs/source/v0.4/09-MILESTONE-AUTOMATED-ACCEPTANCE.md`, `Requirement Traceability`](../../source/v0.4/09-MILESTONE-AUTOMATED-ACCEPTANCE.md).
