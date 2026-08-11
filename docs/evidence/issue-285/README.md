# Issue #285 T4 browser evidence

Date: 2026-08-11
Branch: `feat/editor-node-forms`
Manual server: `http://localhost:4060/#/workflows`

## Smoke coverage

The browser smoke was exercised against the production build with `agent-browser` using the `t4-evidence` and `t4-record` sessions. The pnpm reproduction command is:

```bash
AGENT_BROWSER_DEFAULT_TIMEOUT=5000 pnpm dlx agent-browser --session t4-record <command>
```

The recorded interaction was:

1. Created `T4 Browser Smoke` from the Workflows screen and opened it in the editor.
2. Confirmed the seeded Start → Agent_Main → End connection and captured the editor at 1440×900.
3. Added a Condition node from Add Node, connected its output port to End with a real drag, and switched the layout to vertical.
4. Waited for the debounced content change to surface `Unsaved changes`, clicked Back, and confirmed the Unsaved Changes dialog.
5. Cancelled navigation, saved the workflow, and reopened it after a hard refresh; the added Condition node remained present.
6. Captured the narrow editor at 720×900.

The repeatable Playwright coverage is [t4-editor-smoke.spec.ts](../../../e2e/t4-editor-smoke.spec.ts). It covers UI creation/open, real port-to-port edge creation (three connected edges after the drag), layout editing, save, reload, 1440×900 and 720×900 screenshots, invalid Agent form validation, and Cancel/Discard unsaved navigation.

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
