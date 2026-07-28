# Research: FlowGram readonly editor + historical node-state injection (#139)

**Verdict: FEASIBLE** — Both prerequisites are satisfied by the existing code
and the `@flowgram.ai/free-layout-editor` API. The recommended path for #9 is
**reuse the existing editor + replace the runtime data source** (small surface
change), not a from-scratch readonly detail component.

---

## 1. Readonly mode support

### 1a. Native `readonly` config exists on the editor

The `FreeLayoutEditorProvider` (used in
[src/editor.tsx:27](file:///home/zubingtan/Projects/workflow/src/editor.tsx#L27))
accepts all `EditorProps`, which includes a top-level `readonly?: boolean`
declared at
[node_modules/.pnpm/@flowgram.ai+editor@1.0.12.../dist/index.d.ts:59](file:///home/zubingtan/Projects/workflow/node_modules/.pnpm/@flowgram.ai+editor@1.0.12_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/@flowgram.ai/editor/dist/index.d.ts#L59):

```ts
interface EditorProps<CTX, JSON> extends PlaygroundReactProps<CTX> {
  initialData?: JSON;
  /** whether it is readonly — 是否为 readonly */
  readonly?: boolean;
  ...
}
```

`FreeLayoutProps` (free-layout-editor) extends `EditorProps`, so the prop
flows straight through. It's already wired in
[src/hooks/use-editor-props.tsx:68](file:///home/zubingtan/Projects/workflow/src/hooks/use-editor-props.tsx#L68)
(hard-coded `readonly: false`).

### 1b. Runtime toggle API: `playground.config.readonly`

The runtime config entity
([node_modules/.pnpm/@flowgram.ai+core@1.0.12.../dist/index.d.ts:878-1023](file:///home/zubingtan/Projects/workflow/node_modules/.pnpm/@flowgram.ai+core@1.0.12_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/@flowgram.ai/core/dist/index.d.ts#L878))
exposes:

- `get readonly(): boolean` / `set readonly(readonly: boolean)`
- `get readonlyOrDisabled(): boolean`
- `readonly onReadonlyOrDisabledChange: Event<{ readonly; disabled }>`
- `get disabled(): boolean` / `set disabled(disabled: boolean)` (a separate,
  stronger flag — when true, even node *selection* is suppressed)

There's already a toggle button that flips this at runtime —
[src/components/tools/readonly.tsx:14-16](file:///home/zubingtan/Projects/workflow/src/components/tools/readonly.tsx#L14):

```ts
const toggleReadonly = useCallback(() => {
  playground.config.readonly = !playground.config.readonly;
}, [playground]);
```

### 1c. What readonly disables automatically (no extra work needed)

Existing code already gates edit operations on `playground.config.readonly`
(or the per-node `readonly` from `useNodeRender()`). Verified call sites:

| Operation gated by `readonly`                                  | File:line                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Node add panel (toolbar `AddNode` button)                      | [src/components/tools/index.tsx:80](file:///home/zubingtan/Projects/workflow/src/components/tools/index.tsx#L80) |
| Test Run button                                                | [src/components/tools/index.tsx:82](file:///home/zubingtan/Projects/workflow/src/components/tools/index.tsx#L82) |
| Undo / Redo buttons                                            | [src/components/tools/index.tsx:64,73](file:///home/zubingtan/Projects/workflow/src/components/tools/index.tsx#L64) |
| Auto-layout button                                             | [src/components/tools/auto-layout.tsx:17,36](file:///home/zubingtan/Projects/workflow/src/components/tools/auto-layout.tsx#L17) |
| Download button                                                | [src/components/tools/download.tsx:40,83](file:///home/zubingtan/Projects/workflow/src/components/tools/download.tsx#L40) |
| Comment button                                                 | [src/components/tools/comment.tsx:67](file:///home/zubingtan/Projects/workflow/src/components/tools/comment.tsx#L67) |
| Line-add button visibility                                     | [src/components/line-add-button/use-visible.ts:21](file:///home/zubingtan/Projects/workflow/src/components/line-add-button/use-visible.ts#L21) |
| Comment editor readOnly                                        | [src/components/comment/components/editor.tsx:52](file:///home/zubingtan/Projects/workflow/src/components/comment/components/editor.tsx#L52) |
| Sidebar `NodeFormPanel` — closes itself when readonly is true  | [src/components/sidebar/node-form-panel.tsx:78,83](file:///home/zubingtan/Projects/workflow/src/components/sidebar/node-form-panel.tsx#L78) |
| `Delete` shortcut (`Backspace`/`Del`)                          | [src/shortcuts/delete/index.ts:50,82](file:///home/zubingtan/Projects/workflow/src/shortcuts/delete/index.ts#L50) |
| `Copy` shortcut                                                | [src/shortcuts/copy/index.ts:54,84](file:///home/zubingtan/Projects/workflow/src/shortcuts/copy/index.ts#L54) |
| `Paste` shortcut                                               | [src/shortcuts/paste/index.ts:68,122](file:///home/zubingtan/Projects/workflow/src/shortcuts/paste/index.ts#L68) |
| Context-menu layer                                             | [src/plugins/context-menu-plugin/context-menu-layer.tsx:38](file:///home/zubingtan/Projects/workflow/src/plugins/context-menu-plugin/context-menu-layer.tsx#L38) (`readonlyOrDisabled`) |
| Port click (line drawing) on node wrapper                      | [src/components/base-node/node-wrapper.tsx:39](file:///home/zubingtan/Projects/workflow/src/components/base-node/node-wrapper.tsx#L39) |
| All node form inputs (title, prompt, agent select, http, code) | via `useNodeRenderContext().readonly` — see e.g. [src/nodes/llm/form-meta.tsx:183-185](file:///home/zubingtan/Projects/workflow/src/nodes/llm/form-meta.tsx#L183), [src/form-components/form-header/index.tsx:57](file:///home/zubingtan/Projects/workflow/src/form-components/form-header/index.tsx#L57) |

Plus the framework itself stops node drag/move when `readonly` is on (the
`useNodeRender().startDrag` path and the playground's drag handlers respect
`config.readonly`).

**Caveat — `NodeFormPanel` self-closes in readonly mode.** The current sidebar
behavior at [src/components/sidebar/node-form-panel.tsx:78-85](file:///home/zubingtan/Projects/workflow/src/components/sidebar/node-form-panel.tsx#L78)
returns `null` whenever `playground.config.readonly` is true. That's the
correct UX for the *edit* view's lock button, but it would prevent the
history detail view from showing the sidebar at all. The history view needs
to either (a) override this gate (e.g. add a second context flag like
`IsHistoryViewContext` that bypasses the early return), or (b) keep the
sidebar enabled by *not* flipping `playground.config.readonly` and instead
disabling edits a different way (see §1d).

### 1d. Two viable readonly strategies for #9

| Strategy | How | Pros | Cons |
| --- | --- | --- | --- |
| **A. Flip `readonly: true` on the editor props** | Pass `readonly: true` into `useEditorProps` for the history view; let the existing gates do the work. | Smallest change; all edit shortcuts, drag, line-draw, toolbar buttons auto-disabled. | `NodeFormPanel` self-closes (must be patched to allow a "history view" exception); the per-node form renders in "canvas card" mode (compact) since `isSidebar` is false. |
| **B. Keep `readonly: false` but render a stripped-down toolbar + set `playground.config.disabled`** | Don't mount `DemoTools` at all; set `playground.config.disabled = true` to suppress edit interactions while keeping the sidebar working. | Sidebar continues to work; no `NodeFormPanel` patch needed. | `disabled` is a stronger flag (also kills selection) — would need testing; need to ensure the sidebar form fields still render as read-only. |

**Recommendation: Strategy A** — pass `readonly: true` and add a small
`IsHistoryViewContext` (mirroring `IsSidebarContext`) that makes
`NodeFormPanel` stay open and makes `LLMFormRender`/etc. render the
historical outputs section in place of the live Run/Cancel buttons. This
reuses the maximum amount of existing UI.

---

## 2. Node state injection path

### 2a. Current data flow: polling → emitter → node-attached component

```
TestRunSidePanel.onTestRun ──> WorkflowRuntimeService.taskRun(values)
                                  │
                                  ▼
                            setInterval(syncTaskReport, 500ms)
                                  │
                                  ▼
       runtimeClient.TaskReport({ taskID })  →  server /api/workflow/task/report
                                  │
                                  ▼
       WorkflowRuntimeService.updateReport(report)
                                  │  for each nodeID in report.reports:
                                  ▼
       reportEmitter.fire(nodeReport)   ← public onNodeReportChange event
                                  │
                                  ▼
       NodeStatusBar (one per node, in BaseNode) subscribes:
         useNodeReport() filters by node.id → setReport(nodeReport)
                                  │
                                  ▼
       NodeStatusRender renders status + snapshots (Inputs/Outputs/Branch/Data)
```

Key files:

- Service: [src/plugins/runtime-plugin/runtime-service/index.ts:36-220](file:///home/zubingtan/Projects/workflow/src/plugins/runtime-plugin/runtime-service/index.ts#L36)
  - `taskRun` at L75, polling loop at L122, `updateReport` at L183, `reportEmitter.fire` at L214/L217
  - Public event `onNodeReportChange = this.reportEmitter.event` at L65
- Per-node renderer: [src/components/testrun/node-status-bar/index.tsx:19-54](file:///home/zubingtan/Projects/workflow/src/components/testrun/node-status-bar/index.tsx#L19)
  — `useNodeReport()` subscribes to `runtimeService.onNodeReportChange`,
  filters by `node.id`, stores in local `useState<NodeReport>`.
- Mounted on every node: [src/components/base-node/index.tsx:45](file:///home/zubingtan/Projects/workflow/src/components/base-node/index.tsx#L45)
  (`<NodeStatusBar />` is rendered inside `BaseNode`, outside the sidebar
  wrapper, so it shows on the canvas card for every node).
- Detail render: [src/components/testrun/node-status-bar/render/index.tsx:27](file:///home/zubingtan/Projects/workflow/src/components/testrun/node-status-bar/render/index.tsx#L27)
  — pure component `<NodeStatusRender report={report} />` that renders status
  icon, time cost, snapshot navigation, and `<NodeStatusGroup>` for
  Inputs/Outputs/Branch/Data.

### 2b. The `NodeStatusRender` component is already a pure function of a `NodeReport`

`NodeStatusGroup` ([src/components/testrun/node-status-bar/group/index.tsx:25](file:///home/zubingtan/Projects/workflow/src/components/testrun/node-status-bar/group/index.tsx#L25))
and `NodeStatusRender` ([render/index.tsx:27](file:///home/zubingtan/Projects/workflow/src/components/testrun/node-status-bar/render/index.tsx#L27))
take a `NodeReport`/`data` prop directly. They do **not** call
`useService(WorkflowRuntimeService)` themselves. Only the `useNodeReport`
hook in `index.tsx` does. So a static `NodeReport` snapshot can feed these
components without any polling whatsoever.

### 2c. Injection seam: a "static" replacement for `WorkflowRuntimeService`

`WorkflowRuntimeService` is bound in DI by `createRuntimePlugin`
([src/plugins/runtime-plugin/create-runtime-plugin.ts:26](file:///home/zubingtan/Projects/workflow/src/plugins/runtime-plugin/create-runtime-plugin.ts#L26))
as a singleton. `NodeStatusBar` resolves it via
`useService(WorkflowRuntimeService)`.

Two clean injection options:

**Option 1 (recommended): replace `WorkflowRuntimeService` with a
`StaticHistoryRuntimeService` for the history editor instance.**

- Subclass or re-implement `WorkflowRuntimeService` with the same public
  surface (`onNodeReportChange`, `onReset`, `onResultChanged`,
  `isFlowingLine`, `taskRun`, `taskCancel`).
- Constructor takes a pre-fetched `IReport` snapshot (the historical run's
  full TaskReport).
- On `onInit` (or lazily on first subscriber), fire `reportEmitter.fire(...)`
  once for each `nodeID` in `report.reports`. No polling, no `taskRun`.
- Bind it via a new `createHistoryRuntimePlugin(report)` that
  `rebind(WorkflowRuntimeService).to(...)` and also
  `rebind(WorkflowRuntimeClient).to(...)` to a no-op client (so even if
  `taskRun` is somehow called, nothing hits the network).
- In `useEditorProps`, switch the runtime plugin based on a `historyReport?`
  prop: `historyReport ? createHistoryRuntimePlugin(historyReport) : createRuntimePlugin({ mode: 'server', ... })`.

**Option 2: keep `WorkflowRuntimeService` and call a new method
`loadStaticReport(report)` from `onInit`.**

- Add `public loadStaticReport(report: IReport)` to
  `WorkflowRuntimeService` that calls `this.updateReport(report)` once.
- Pros: even less new code. Cons: leaves the polling/taskRun code paths
  reachable; the history view could accidentally trigger a live run if a
  button isn't gated. Less safe.

Option 1 is preferred — it makes the history view structurally incapable of
launching a new run.

### 2d. The `AgentOutput` panel (LLM node detail) currently reads from a *different* source

Important asymmetry: the LLM node's "Run Agent" / output panel
([src/nodes/llm/form-meta.tsx:118-179](file:///home/zubingtan/Projects/workflow/src/nodes/llm/form-meta.tsx#L118))
does **not** read from `WorkflowRuntimeService`. It uses
`useAgentExecution({ agentId, prompt })`
([src/agent-execution/use-agent-execution.ts](file:///home/zubingtan/Projects/workflow/src/agent-execution/use-agent-execution.ts)),
which calls `POST /agents/:id/run` directly via `api.runAgentById`. This is
the per-node "Test Run"-style live execution, completely separate from the
canvas-wide `TaskRun`/`TaskReport` polling.

For the history view, this panel must be replaced with a static renderer
fed by the historical `NodeReport.snapshots[]` (which already contains
`inputs`/`outputs`/`data`/`error` per snapshot — see
[runtime-interface/dist/index.d.ts:472-482](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-interface/dist/index.d.ts#L472)).

Concretely: in `LLMFormRender`, gate the `<AgentOutput>` block on a new
context (`IsHistoryViewContext`). When in history view, render a
`<StaticAgentOutput snapshots={reportFromHistoryView} />` instead — which
can itself just be `<NodeStatusRender report={...} />` (the same component
the canvas card uses) or a richer per-snapshot viewer. This is the only
spot where a *new* (small) component is needed; everything else is reused.

### 2e. Type summary (for the implementation ticket)

```ts
// from @flowgram.ai/runtime-interface — already in the dep tree
interface SnapshotData {
  nodeID: string;
  inputs: WorkflowInputs;     // Record<string, any>
  outputs: WorkflowOutputs;   // Record<string, any>
  data?: any;
  branch?: any;
  error?: string;
}
interface Snapshot extends SnapshotData { id: string; }
interface NodeReport extends StatusData {   // StatusData: status, terminated, startTime, endTime?, timeCost
  id: string;
  snapshots: Snapshot[];
}
interface IReport {
  id: string;
  inputs: WorkflowInputs;
  outputs: WorkflowOutputs;
  workflowStatus: StatusData;
  reports: Record<string, NodeReport>;  // ← keyed by nodeID — this is the historical per-node state
  messages: WorkflowMessages;
}
```

So a single stored `IReport` (one TaskReport snapshot for the historical
run) is the complete data source for the entire readonly canvas. No further
fetching needed.

---

## 3. Recommended implementation path for ticket #9

**Reuse the existing editor + swap the runtime data source.** Concretely:

1. **Persist the full `IReport`** alongside each agent execution history
   row (server-side: add a `task_report_json` column to whichever table
   backs the history Modal, or fetch it on demand from
   `GET /api/workflow/task/report?taskID=…` if taskIDs are retained).
   *Out of scope for #9 itself — assumed as a prerequisite from the history
   storage ticket.*
2. **Add a `historyReport?: IReport` prop to `<Editor>`** in
   [src/editor.tsx](file:///home/zubingtan/Projects/workflow/src/editor.tsx),
   forwarded into `useEditorProps`.
3. **In `useEditorProps`** ([src/hooks/use-editor-props.tsx](file:///home/zubingtan/Projects/workflow/src/hooks/use-editor-props.tsx)):
   - set `readonly: true` when `historyReport` is provided
   - swap `createRuntimePlugin({ mode: 'server', … })` for a new
     `createHistoryRuntimePlugin(historyReport)` that binds a
     `StaticHistoryRuntimeService` (fires `onNodeReportChange` once per
     node on init, no polling, no `taskRun`).
4. **Patch `NodeFormPanel`** ([src/components/sidebar/node-form-panel.tsx:78,83](file:///home/zubingtan/Projects/workflow/src/components/sidebar/node-form-panel.tsx#L78))
   to also stay open when a new `IsHistoryViewContext` is true (so the
   sidebar detail is visible in readonly history mode).
5. **In `LLMFormRender`** ([src/nodes/llm/form-meta.tsx:223](file:///home/zubingtan/Projects/workflow/src/nodes/llm/form-meta.tsx#L223)):
   gate `<AgentOutput>` on `IsHistoryViewContext`; in history view, render
   a static output block (can be as simple as
   `<NodeStatusRender report={historyReport.reports[node.id]} />` — same
   component the canvas card already uses).
6. **Don't mount `DemoTools`** (or mount a stripped version with only
   FitView / Minimap / Zoom) for the history view — the toolbar is
   editor-internal, not part of `<Editor>`, so this is just a conditional
   in the parent that hosts `<Editor>`.

**Why reuse wins here:**

- The canvas, node rendering, sidebar form rendering, line rendering,
  minimap, zoom, fit-view, and the per-node `NodeStatusRender` /
  `NodeStatusGroup` / `DataStructureViewer` are all reusable as-is. They
  are pure of the runtime transport.
- The *only* new code is: a `StaticHistoryRuntimeService` (~50 LOC, mostly
  no-ops + a one-shot emitter loop), a `createHistoryRuntimePlugin`
  (~10 LOC), a small `IsHistoryViewContext` provider, the
  `NodeFormPanel` exception, and the `AgentOutput` swap. Total: well under
  200 LOC of net new code, no new node types, no new APIs.
- The historical `IReport` shape already matches what
  `WorkflowRuntimeService.updateReport` consumes — no translation layer.

---

## 4. Fallbacks (if any prerequisite breaks)

In rough order of cost:

1. **If `playground.config.readonly` proves to over-restrict the sidebar**
   (e.g. some form input renders as fully hidden rather than disabled):
   fall back to Strategy B — keep `readonly: false`, set
   `playground.config.disabled = false`, don't mount `DemoTools`, and gate
   each form input on `IsHistoryViewContext` instead of on `readonly`.
   Higher per-component patch count but no framework fights.
2. **If persisting the full `IReport` is too expensive**: fetch it on
   demand when a history row is clicked, via the existing
   `GET /api/workflow/task/report?taskID=…` endpoint (already implemented
   in [src/plugins/runtime-plugin/client/server-client/index.ts:48-55](file:///home/zubingtan/Projects/workflow/src/plugins/runtime-plugin/client/server-client/index.ts#L48)).
   The history Modal already needs the taskID; the readonly editor can
   show a `Spin` while the one-shot fetch resolves, then feed the result
   into `StaticHistoryRuntimeService`.
3. **If reusing the editor at all proves too brittle** (e.g. some plugin
   hard-codes edit behavior that can't be gated): fall back to a
   standalone **JSON tree viewer** rendering `IReport.reports` as a
   per-node accordion (Inputs / Outputs / Branch / Data / error). This is
   a strict subset of `NodeStatusGroup` + `DataStructureViewer` already,
   so even the fallback reuses existing components — just not the canvas.
4. **Last resort**: a pure read-only node-detail panel (no canvas, no
   sidebar form) that lists nodes by title and shows the
   `NodeStatusRender` output for the selected node. Same components as
   above, different shell.

Fallbacks 1–2 are small variants of the recommended path. Only 3–4 abandon
the canvas entirely — and even then, the `NodeStatusRender` /
`NodeStatusGroup` / `DataStructureViewer` components are reusable.
