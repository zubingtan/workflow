# Design QA

Screenshot acceptance checklist for the workflow editor.

- [x] Workflow list has a clear create/open action and readable version state.
- [x] Visual editor shows Input, Agent, Condition, and Markdown node labels.
- [x] Selected-node inspector exposes the fields required by that node type.
- [x] JSON authoring is readable, uses the `workflow/v1alpha1` shape, and can
  be saved as a new version.
- [x] Test run makes selected, skipped, and joined nodes visually distinct.
- [x] Markdown output and failure explanation remain legible at the target
  viewport.
- [x] Keyboard focus, contrast, and responsive layout are usable.
- [x] Browser console has no product errors during the journey.

## Compared evidence

- Viewport: 2048×1167, Chromium on the real Compose stack.
- `condition-selected.png` shows the Input → Condition → Agent → Agent →
  Output layout, selected Condition styling, ordered branch summary, and the
  recursive condition inspector (`and`/`or`, references, operators, and
  literals).
- `workflow-builder.png` shows the saved workflow editor state with the same
  stable canvas layout, node labels, version header, Visual/JSON tabs, and
  right-hand Inspector boundary.
- `run-route-a.png` shows the runtime projection for the first selected branch:
  `agent-a` succeeded, `agent-b` was skipped, and Markdown output is visible.
- `run-route-b.png` shows the complementary runtime projection: `agent-a` was
  skipped, `agent-b` succeeded, and Markdown output is visible.
- Evidence files:
  - `test-results/workflow-builder-authors-v-a9103-w-on-the-real-Compose-stack-chromium/condition-selected.png`
  - `test-results/workflow-builder-authors-v-a9103-w-on-the-real-Compose-stack-chromium/workflow-builder.png`
  - `test-results/workflow-builder-authors-v-a9103-w-on-the-real-Compose-stack-chromium/run-route-a.png`
  - `test-results/workflow-builder-authors-v-a9103-w-on-the-real-Compose-stack-chromium/run-route-b.png`

## Final result

`passed` — the screenshots above were compared against the checklist at the
recorded viewport; the listed layout points matched.
