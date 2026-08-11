# Issue #285 T4 browser evidence

Date: 2026-08-11
Branch: `feat/editor-node-forms`
Manual server: `http://localhost:4060/#/workflows`

## Smoke coverage

The browser smoke was exercised against the production build with `npx --yes agent-browser` using the `t4-evidence` session:

1. Created `T4 Browser Smoke` from the Workflows screen and opened it in the editor.
2. Confirmed the seeded Start → Agent_Main → End connection and captured the editor at 1440×900.
3. Added a Condition node from Add Node and switched the layout to vertical.
4. Waited for the debounced content change to surface `Unsaved changes`, clicked Back, and confirmed the Unsaved Changes dialog.
5. Cancelled navigation, saved the workflow, and reopened it after a hard refresh.
6. Captured the narrow editor at 720×900.

The repeatable Playwright coverage is [t4-editor-smoke.spec.ts](../../../e2e/t4-editor-smoke.spec.ts). It covers UI creation/open, the two connected edges, layout editing, save, reload, 1440×900 and 720×900 screenshots, invalid Agent form validation, and Cancel/Discard unsaved navigation.

## Captured artifacts

- [1440×900 editor](./t4-editor-1440x900-light.png)
- [720×900 editor](./t4-editor-720x900-narrow.png)

## Verification

The focused browser test passed:

```text
pnpm exec playwright test e2e/t4-editor-smoke.spec.ts
1 passed
```

Automated human-facing visual sign-off is not fabricated here: a maintainer still needs to inspect the two committed screenshots and confirm the T4 visual acceptance criteria before PR merge.
