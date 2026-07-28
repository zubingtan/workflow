# Research: 节点执行超时在 runtime-js / AgentExecutor 层的实现位置

**Verdict: EXECUTOR-PROMISE-RACE** — runtime-js has no per-node timeout concept (only the HTTP node's own `AbortSignal.timeout` and a workflow-level `AbortController`), but the patched `signal` is workflow-level, not per-node. The cleanest minimum-risk implementation is `Promise.race` inside `AgentExecutor.execute` (server/runtime-adapter.mjs) plus an explicit per-node `AbortController` that aborts on timeout, feeding the existing `signal.aborted → cancelled terminal` path. TaskReport terminal-state capture stays correct because `AgentExecutor.execute` **throws** on timeout → engine marks node `fail()` → reporter reflects `failed`. The fallback (wall-clock at the 409-lock layer) is too coarse for #14's per-node requirement.

---

## 1. Does the runtime-js engine layer support per-node timeout?

**No.** Patchable in theory, but not the right place.

### Evidence

- `TaskRunAPI` accepts only `{ schema, inputs }` — no `timeout` / `nodeTimeout` field exists on the public API ([index.d.ts:110-116](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.d.ts)).
- `WorkflowApplication.run(params)` ([dist/index.js:3167-3178](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js)) passes `params` straight into `engine.invoke(params)`, which only forwards `{ schema, inputs }` into the context init. No timeout bookkeeping.
- `WorkflowRuntimeEngine.executeNode` ([dist/index.js:3004-3049](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js)) calls `this.executor.execute({ node, inputs, runtime: context, signal: context.abortController.signal, container, snapshot })` and `await`s the returned promise directly — there is no `Promise.race` / `setTimeout` / `AbortSignal.timeout` wrapping. The only timeout primitive in the whole runtime-js bundle is the HTTPExecutor's `AbortSignal.timeout(timeout)` at [dist/index.js:855](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js), and that lives inside the HTTP executor's `request()` method, not the engine.
- Grep for `nodeTimeout|nodeTimeoutMs|perNodeTimeout|nodeExecutionTimeout|TASK_TTL` over `dist/index.js` and `dist/index.d.ts` → 0 matches.
- The `abortController` we patched in ([patch lines 5-6, 14-15, 20-21](file:///home/zubingtan/Projects/workflow/patches/@flowgram.ai__runtime-js@1.0.12.patch)) is **workflow-level, not node-level**: it is created once per `WorkflowRuntimeContext` constructor ([dist/index.js:2888](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js)), threaded unchanged through `sub()` ([dist/index.js:2940](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js)), and `task.cancel()` ([dist/index.js:1927-1934](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js)) aborts it once for the whole workflow and then iterates `Processing` nodes to mark each as `Cancelled`. There is no API to abort just one node.

### What `executor.execute(context)` receives

From [dist/index.js:3020-3027](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js):

```
{ node, inputs, runtime: context, signal: context.abortController.signal, container, snapshot }
```

`context.signal` is **the workflow's `AbortController.signal`** — one per run, shared by every node. Our `AgentExecutor` already reads `context.signal` ([runtime-adapter.mjs:112](file:///home/zubingtan/Projects/workflow/server/runtime-adapter.mjs)) and threads it into `runAgentExecution` ([agent-execution.mjs:39-110](file:///home/zubingtan/Projects/workflow/server/agent-execution.mjs)). The test [test/runtime-cancellation.test.mjs:63-67](file:///home/zubingtan/Projects/workflow/.worktrees/node-timeout/test/runtime-cancellation.test.mjs) confirms a single `TaskCancelAPI` call flips `context.signal.aborted` for the in-flight executor.

### Patchable?

Yes in principle — we could add a `setTimeout` in `WorkflowRuntimeEngine.executeNode` that calls a fresh per-node `AbortController.abort()` and pass `nodeSignal` into `executor.execute`. But that requires extending the patch (engine + d.ts), is fragile across runtime-js upgrades, and gives no benefit over doing the same `Promise.race` inside our own executor (we already control the executor). **Not recommended.**

---

## 2. Feasibility of `AgentExecutor.execute` Promise.race timeout + dirty-state risk

**Feasible and clean.** The minimum change is local to `AgentExecutor.execute` ([runtime-adapter.mjs:86-168](file:///home/zubingtan/Projects/workflow/server/runtime-adapter.mjs)).

### Mechanism

Wrap the existing `for await ... of this.runAgentExecution(...)` loop in a `Promise.race` against a `setTimeout(ms)`. On timeout, abort the **injected per-node** `AbortController` (not the workflow's `context.signal`) so the shared module's existing `signal.aborted → cancelled terminal` path runs ([agent-execution.mjs:140-143](file:///home/zubingtan/Projects/workflow/server/agent-execution.mjs)). Then either:

- **(A) treat timeout as `failed`** — `throw new AgentExecutionError({ kind: "timeout", message: "node exceeded timeout ${ms}ms" })`. This matches #14's wording ("on timeout the node fails → the whole workflow run fails").
- **(B) treat timeout as `cancelled`** — let the terminal `cancelled` projection return normally ([runtime-adapter.mjs:151-157](file:///home/zubingtan/Projects/workflow/server/runtime-adapter.mjs)). This conflicts with #14's "node fails" wording and would make the workflow run look cancelled, not failed.

**Recommend (A)** — timeout is a failure, not a cancellation. The user did not request cancellation. Throwing `AgentExecutionError({ kind: "timeout" })` matches the existing `failed` branch semantics at [runtime-adapter.mjs:158-161](file:///home/zubingtan/Projects/workflow/server/runtime-adapter.mjs).

To still get partial-text/tool-event capture, the executor can read the terminal that the shared module emitted before throwing — but `Promise.race` doesn't deliver the terminal if the timer wins. Two clean options:

1. **Race + abort + re-await terminal.** On timer fire, call `nodeAbort.abort()`, then continue draining the async generator until it yields its single terminal (the shared module always emits exactly one — see [agent-execution.mjs:37-169](file:///home/zubingtan/Projects/workflow/server/agent-execution.mjs)), capture `terminal.partialText` / `terminal.toolEvents`, then `throw AgentExecutionError({ kind: "timeout", detail: { partialText, toolEvents } })`. The engine still sees the throw → `nodeStatus.fail()`. The detail is preserved for `/api/task/result` error detail (extension point, not in #14 scope).
2. **Race + abort + throw immediately.** Simpler; partial state is lost. Acceptable if #14 doesn't require partial capture on timeout.

Option 1 is preferred because the map explicitly calls out "节点超时终态捕获精度" as Not-yet-specified — capturing partial state preserves the option without committing to exposing it.

### Where the per-node timeout value comes from

#14 specifies "global default 10 min + per-node override". The LLM node's inputs already come through `context.inputs` ([runtime-adapter.mjs:87](file:///home/zubingtan/Projects/workflow/server/runtime-adapter.mjs)); we can read `context.node.data.timeoutMs` (per-node override, set in the form-meta) and fall back to `process.env.NODE_TIMEOUT_MS ?? 10 * 60 * 1000` (global default). The override plumbing (form-meta + schema field) is a separate frontend ticket, not part of this research.

### Dirty-state risk in TaskReport after timeout — **none, as long as the executor throws**

Trace: `WorkflowRuntimeEngine.executeNode` calls `nodeStatus(node.id).process()` before `await executor.execute(...)` ([dist/index.js:3009](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js)), then on `catch (e)` calls `nodeStatus(node.id).fail()` ([dist/index.js:3044](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js)) and rethrows. The rethrow propagates to `process(context)` which calls `context.statusCenter.workflow.fail()` ([dist/index.js:3058-3061](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js)). `WorkflowRuntimeReporter.export()` reads `statusCenter.exportNodeStatus()` ([dist/index.js:2517-2532](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js)) — so the timed-out node shows `status: "failed"`, `terminated: true`, with `error` in the snapshot ([dist/index.js:3037-3046](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js) writes `snapshot.update({ error: errorMessage })`).

If we used approach **(B)** (return cancelled terminal) instead of throwing, the node would be marked `success` by the engine at [dist/index.js:3035](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js) — **dirty state** — because the engine can't tell a normal return from a "timeout I converted to a normal return". This is another reason to prefer (A).

### Workflow-run failure propagation

After the node throws, `process(context)` catches and calls `workflow.fail()` but **returns `{}`** rather than rethrowing ([dist/index.js:3058-3061](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js)). `TaskRunAPI` resolves with a `taskID` regardless. The caller learns the run failed by polling `TaskReportAPI`, which returns `workflowStatus: { status: "failed", terminated: true, ... }` plus per-node `reports[nodeID].status: "failed"`. **This matches #14's "node fails → whole workflow run fails" semantics** — no extra wiring needed at the engine layer.

### Partial-text / toolEvents retrieval on timeout

With approach 1 above: yes, the shared module's terminal projection runs to completion because we keep draining the generator after aborting. The terminal's `partialText` / `toolEvents` are accumulated by the subscribe handler up to the abort moment ([agent-execution.mjs:90-100](file:///home/zubingtan/Projects/workflow/server/agent-execution.mjs)) and the `signal.aborted` short-circuit at [agent-execution.mjs:140-143](file:///home/zubingtan/Projects/workflow/server/agent-execution.mjs) yields the `cancelled` terminal with whatever was accumulated. We can then re-classify it as a timeout failure in the executor.

The existing test [test/agent-executor-cancellation.test.mjs](file:///home/zubingtan/Projects/workflow/.worktrees/node-timeout/test/agent-executor-cancellation.test.mjs) already proves the abort → dispose → terminal path works; the timeout case reuses the same plumbing, just with a timer-driven abort instead of a user-driven one.

---

## 3. Tradeoffs of the wall-clock fallback (whole-run timeout)

**Insufficient for #14, but already exists as a coarse safety net.**

The 409 lock layer in [server/app.mjs:107-139](file:///home/zubingtan/Projects/workflow/server/app.mjs) already has `TASK_TTL_MS = 5 * 60 * 1000` with a 60-second sweep that calls `markTaskTerminated(taskID)` — but this **only releases the workflow lock so the next run can start**. It does **not** abort the in-flight pi session, does **not** flip the node's `WorkflowRuntimeStatus` to `failed`, and does **not** unblock `TaskRunAPI`'s caller. The actual `WorkflowRuntimeTask.processing` promise keeps running until the provider returns or the process dies. So:

- **False-kill risk: high.** A single long LLM call (e.g. a 5-minute reasoning model) would hit the 5-minute wall-clock and be reported as busy to the next caller, while the original run is still consuming the provider. Raising the wall-clock to 10 minutes (per #14) makes the false-kill window larger, not smaller.
- **No per-node precision.** #14 explicitly says "per-node override" — wall-clock can't honor that.
- **No terminal-state capture.** The sweep timer doesn't touch `WorkflowRuntimeReporter`, so `TaskReportAPI` would still show the node as `processing` indefinitely.

**Verdict on fallback:** keep the existing `TASK_TTL_MS` sweep as a deadlock-safety-net (it only releases the lock, doesn't pretend to fail the run), but **do not** promote it to be the #14 timeout mechanism. Per-node timeout in `AgentExecutor.execute` is required.

---

## 4. Recommended implementation path

**EXECUTOR-PROMISE-RACE with timeout-as-failure.**

### Sketch (for the implementation ticket, not for this research)

In `AgentExecutor.execute` ([runtime-adapter.mjs:86-168](file:///home/zubingtan/Projects/workflow/server/runtime-adapter.mjs)):

1. Read `timeoutMs` from `context.node.data?.timeoutMs` or fall back to `process.env.NODE_TIMEOUT_MS ?? 10 * 60 * 1000`.
2. Create a per-node `AbortController` (`nodeAbort`). Compose its signal with the workflow's `context.signal` so either aborts the shared module (e.g. `AbortSignal.any([context.signal, nodeAbort.signal])` — Node 20+ supports this; repo is on Node 22 per `.nvmrc`).
3. `Promise.race` between:
   - the existing `for await ... of runAgentExecution(...)` loop that captures the terminal, and
   - `new Promise((_, reject) => setTimeout(() => reject(new TimeoutError()), timeoutMs))` — but instead of rejecting, set a `timedOut` flag and call `nodeAbort.abort()`, then continue draining the generator to capture the `cancelled` terminal's `partialText`/`toolEvents`.
4. If `timedOut`: `throw new AgentExecutionError({ kind: "timeout", message: "node exceeded ${timeoutMs}ms", detail: { partialText, toolEvents } })`.
5. Otherwise: existing terminal projection at [runtime-adapter.mjs:143-167](file:///home/zubingtan/Projects/workflow/server/runtime-adapter.mjs) is unchanged.

### Why this path

- **Minimum surface area.** No runtime-js patch extension. No engine-layer changes. All changes are local to `runtime-adapter.mjs` (plus a new `kind: "timeout"` translation in `server/app.mjs`'s `taskErrorResponse` if you want a distinct HTTP code, but that's optional).
- **Reuses existing cancellation plumbing.** The shared module already classifies `signal.aborted` as a `cancelled` terminal with partial state — we just re-classify it as `timeout` failure at the executor boundary.
- **TaskReport stays correct for free.** The engine's existing `catch (e) → nodeStatus.fail() → workflow.fail()` path handles the throw. No dirty state. The map's "节点超时终态捕获精度" Not-yet-specified is answered: node = `failed`, workflow = `failed`, partial state available in `AgentExecutionError.detail` for future exposure via `/api/task/result` (out of #14 scope).
- **Per-node override is a frontend concern.** Reading `context.node.data.timeoutMs` is the only contract between the form-meta and the executor; no backend schema change needed for the default case.

### What NOT to do

- **Do not** extend the runtime-js patch to add per-node timeout to `WorkflowRuntimeEngine.executeNode`. Higher maintenance cost, no functional gain over executor-side race.
- **Do not** treat timeout as `cancelled` (approach B). It produces dirty TaskReport state (node marked `success`) and contradicts #14's "node fails" wording.
- **Do not** rely on the existing `TASK_TTL_MS` sweep for #14. It only releases the lock; it doesn't fail the run or capture terminal state.

---

## 5. Key file:line references

- [server/runtime-adapter.mjs:86-168](file:///home/zubingtan/Projects/workflow/server/runtime-adapter.mjs) — `AgentExecutor.execute` (the implementation site).
- [server/runtime-adapter.mjs:62-69](file:///home/zubingtan/Projects/workflow/server/runtime-adapter.mjs) — `AgentExecutionError` (add `kind: "timeout"`).
- [server/agent-execution.mjs:37-169](file:///home/zubingtan/Projects/workflow/server/agent-execution.mjs) — shared module; `signal.aborted → cancelled terminal` at lines 140-143.
- [server/app.mjs:107-139](file:///home/zubingtan/Projects/workflow/server/app.mjs) — existing `TASK_TTL_MS` wall-clock sweep (lock-only, not a run timeout).
- [server/app.mjs:57-62](file:///home/zubingtan/Projects/workflow/server/app.mjs) — `taskErrorResponse` (optional: translate `kind: "timeout"` to a distinct code).
- [node_modules/@flowgram.ai/runtime-js/dist/index.js:3004-3049](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js) — `WorkflowRuntimeEngine.executeNode` (proves throw → `nodeStatus.fail()`).
- [node_modules/@flowgram.ai/runtime-js/dist/index.js:3050-3062](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js) — `process(context)` (proves workflow `fail()` on rethrow).
- [node_modules/@flowgram.ai/runtime-js/dist/index.js:2496-2532](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js) — `WorkflowRuntimeReporter.export()` / `nodeReports()` (proves report reflects failed state).
- [node_modules/@flowgram.ai/runtime-js/dist/index.js:2888,2940,3024](file:///home/zubingtan/Projects/workflow/node_modules/@flowgram.ai/runtime-js/dist/index.js) — `abortController` is workflow-level (one per context, shared by sub() and all nodes).
- [patches/@flowgram.ai__runtime-js@1.0.12.patch](file:///home/zubingtan/Projects/workflow/patches/@flowgram.ai__runtime-js@1.0.12.patch) — the only runtime-js patch; adds `abortController` + `registerNodeExecutor`, nothing timeout-related.
- [test/runtime-cancellation.test.mjs:63-67](file:///home/zubingtan/Projects/workflow/.worktrees/node-timeout/test/runtime-cancellation.test.mjs) — proves `context.signal` is workflow-level and `TaskCancelAPI` aborts it.
- [test/agent-executor-cancellation.test.mjs](file:///home/zubingtan/Projects/workflow/.worktrees/node-timeout/test/agent-executor-cancellation.test.mjs) — proves abort → dispose → cancelled terminal path; reusable for timeout test.
