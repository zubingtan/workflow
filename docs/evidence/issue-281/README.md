# Issue #281 management UI evidence

## Visual source of truth

The management surfaces were reviewed against the repository's actual prototype branch:

- [research/shadcn-ui-prototype](https://github.com/zubingtan/workflow/tree/research/shadcn-ui-prototype), commit `da7203e64`
- Workflows: `docs/prototypes/shadcn-ui/workflows-clean-navigation.png`
- Agents: `docs/prototypes/shadcn-ui/agents-full-detail-stats.png`
- Settings: `docs/prototypes/shadcn-ui/audit-modern-shell/35-settings-mem0-main-sync.png`, with the current Memory section also checked against `src/prototypes/shadcn-ui/prototype-app.tsx`

The earlier management screenshots were superseded because they were captured before the real prototype branch was verified. Only the captures below are current evidence.

## Browser smoke

Environment: local `pnpm dev`, server `:4001`, fake provider `:4010`, Chromium via `pnpm dlx agent-browser`.

1. Opened `#/workflows`; verified the prototype-aligned collection header, reusable workflow row, Open, Copy, History and Delete actions.
2. Opened `#/agents`; opened the Fake Provider agent, verified the horizontal General/Provider/System Prompt/Tools/Runtime/Skills/Extensions/Memories/Sessions/Stats sections, then checked the empty Stats state.
3. Opened `#/settings`; switched Execution → Memory and verified the card layout, mem0 fields, LLM/embedding fields, model refresh affordance and Test connection action.
4. Captured the default Workflow state at 1440×900 light and a 900×900 narrow rail state; captured Agent and Settings focused states at 1446×976 to match the checked prototype captures. Browser console/page errors were checked and none were reported.

The smoke used the existing API and FlowGram editor paths; no API payload or Workflow JSON contract was changed.

## Captures

- [Workflows (prototype-aligned)](./workflows-prototype-aligned.png)
- [Agents (prototype-aligned)](./agents-prototype-aligned.png)
- [Settings (prototype-aligned)](./settings-prototype-aligned.png)
- [Workflows default 1440×900](./workflows-1440x900.png)
- [Workflows narrow rail 900×900](./workflows-narrow-rail.png)

Manual signoff: Codex browser smoke completed on 2026-08-11; the branch references, screenshots and operation record above are the review evidence for #281.
