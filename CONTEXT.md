# Workflow

Workflow lets users compose FlowGram workflows and run their LLM nodes through configured Agents.

## Language

**Agent**:
A persisted provider and model configuration that a Workflow LLM node can reference. Its credential is represented by an environment-variable name, never by the credential value.
_Avoid_: provider profile

**Agent Configuration**:
The editable settings that determine how an Agent connects to its provider and behaves during an Agent Execution, including provider connection details, prompts, tools, runtime options, skills, and extensions. It is part of the Agent and has no execution state of its own.
_Avoid_: agent settings blob, provider profile

**Agent Node**:
A Workflow LLM node that invokes a configured Agent and declares the values available to downstream nodes. Its output contract belongs to the Workflow, not to the persisted Agent or its Agent Configuration.
_Avoid_: agent card (when referring to the Workflow node), Agent (when referring to the persisted configuration)

**Structured Output Schema**:
The schema declared by an Agent Node for the typed values it produces and exposes to downstream nodes. It is part of the Workflow document and is independent of the Agent Configuration.
_Avoid_: Agent output schema (when implying that the schema belongs to the persisted Agent)

**Agent Execution**:
One invocation of an Agent with a prompt, from start until a terminal outcome. It has ordered progress as well as a final outcome, rather than only a final text value.
_Avoid_: agent run, session

**Cancellation**:
A terminal Agent Execution outcome requested before normal completion. It is distinct from both a successful outcome and a failed outcome.
_Avoid_: stop, abort

**Execution Detail**:
An explicitly requested view of one Agent Execution's permitted structured tool activity, including inputs, results, and failures but never credential values. It is not the default presentation of an execution.
_Avoid_: debug workflow

**Workflow**:
A user-authored, persisted flow definition (nodes + edges) stored in the `workflows` table. It is a reusable template with no execution state of its own; Runs are created against it. Deleting a Workflow cascades to all its Runs.
_Avoid_: workflow instance, run, flow, pipeline

**Workflow Run**:
One execution instance of a Workflow, stored in `workflow_runs`. Identified by `runID` (nanoid(12), assigned at enqueue time), distinct from FlowGram runtime's `taskID` (assigned when the Queue dequeues and calls TaskRunAPI). Lifecycle: `queued` → `running` → terminal (`succeeded` / `failed` / `terminated`). Terminal row is immutable.
_Avoid_: execution, session, task, run instance

**Queue**:
A per-Workflow in-memory FIFO serial queue. Runs of the same Workflow execute strictly in enqueue order. No global cross-Workflow queue exists. Three trigger points: enqueue, onTerminal (advance next), cancelQueued (remove without advancing).
_Avoid_: global queue, task queue, job queue

**TaskReport**:
The execution report object produced by FlowGram runtime, fetched via `TaskReportAPI({taskID})`. Its `workflowStatus` carries `status` (string enum) and `terminated` (boolean). At Run terminal, the full report (merged with the queue's `reason`) is written to `workflow_runs.report`. The poll that first observes terminal carries the report forward to `onTerminal` to avoid a second fetch hitting runtime GC.
_Avoid_: run report, execution report, result

**Terminal State**:
The irreversible final state of a Run, merged to three values: `succeeded`, `failed`, `terminated`. `terminated` is the #141 merge of `cancelled` + `interrupted` — those are `reason` sub-values, not independent states. Terminal write is idempotent (`WHERE status NOT IN (...)`).
_Avoid_: final state, done, completed, finished; especially avoid treating `cancelled` / `interrupted` as standalone states

**History Modal**:
A centralized management dialog (70% width) listing all Runs of one Workflow. REST pulls a lightweight list on open, then an EventSource receives incremental `run_status` / `run_terminal` / `workflow_deleted` events. Row actions: view detail / cancel / delete (terminal only). Hosts the HistoryViewer overlay.
_Avoid_: runs modal, run list, history dialog, runs panel

**HistoryViewer**:
A fullscreen readonly Editor overlay (z-index 1100) rendering one Run's terminal snapshot: `schema_snapshot` as canvas data, `report` as history data, `runID` as identity. Non-terminal or missing-snapshot Runs show a placeholder. A back button returns to the History Modal (which stays mounted to preserve scroll).
_Avoid_: history editor, readonly editor (that's an Editor mode), run detail, history modal (that's the list layer)

**Schema Snapshot**:
A one-time frozen copy of the Workflow's `data` (FlowGram document JSON) captured at the moment a Run reaches terminal, stored in `workflow_runs.schema_snapshot`. Lets HistoryViewer render the canvas as it was at execution time, not as the currently-edited Workflow.
_Avoid_: workflow snapshot, workflow data, frozen schema, checkpoint, version

**SSE Event**:
A server-sent event broadcast per-Workflow to all `EventSource` subscribers. Four types: `init` (active run IDs on subscribe), `run_status` (enqueue/dequeue/cancel patch), `run_terminal` (full report + snapshot, after DB write), `workflow_deleted` (close modals). Heartbeat `:ping` every 25s.
_Avoid_: message, notification, push event, websocket event

**Active Run**:
A Run in `queued` or `running` state (not yet terminal). Guards `DELETE /workflows/:id` (409 `workflow_has_active_runs` if any). Drives the real-time Delete-button disable via `useActiveRunCounts` hook subscribed to SSE. No bulk cancellation — each Active Run must be cancelled individually.
_Avoid_: running run (misses queued), pending run (`pending` is FlowGram's StatusData.status, not our Run status), in-flight run

**Draft Lock**:
A per-process schema-hash mutex for unsaved-draft Test Runs only (`POST /api/task/run` without `workflowId`). Prevents two concurrent drafts on the same schema from stomping each other. Acquired synchronously before `await TaskRunAPI` (TOCTOU-safe placeholder-then-patch). No TTL. Saved-Workflow Runs use the Queue instead; the old 409 `workflow_busy` schema-hash mutex was removed.
_Avoid_: workflow lock, schema lock, test lock, global lock
