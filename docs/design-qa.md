# Design QA

Rendered layout and content acceptance checklist for the workflow editor.

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

## Rendered evidence

- The Builder journey checks actual content and geometry at 1440×900 and
  1280×720 in Chromium.
- At both viewports, the body remains within the viewport and the topbar,
  tabs, canvas, Inspector, and Add node controls are visible without page
  scrolling. Long canvas, Inspector, dialog, and History content may scroll
  internally.
- The same UI-only journey manually opens Add node, chooses Agent/Condition/
  Markdown, edits Inspector values, saves, runs, and opens History details.
- No screenshot-pixel comparison or fixed reference resolution is part of this
  acceptance. Screenshots may be used as supplemental visual evidence only.

## Final result

`pending` — review the rendered journey evidence and console health before
marking this checklist complete.
