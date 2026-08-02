# Shadcn UI direction prototype

Throwaway whole-product UI prototype for comparing three structural directions before the Semi UI migration.

## Run

```bash
pnpm prototype:ui
```

Open <http://localhost:4173/?variant=A&view=editor>.

## Compare

- `variant=A` — Workbench Rail: persistent navigation and contextual inspector.
- `variant=B` — Command Deck: top-level command navigation and execution dock.
- `variant=C` — Focus Dock: compact icon rail, node library, and floating inspector.
- Use the floating switcher or the left/right arrow keys to move between variants.
- Use `view=editor`, `view=workflows`, `view=agents`, or `view=settings` to open a product surface directly.

The prototype uses local mock state only. It does not call backend APIs, persist workflow data, or change Workflow JSON and execution behavior.
