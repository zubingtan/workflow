# Shadcn UI direction prototype

Throwaway whole-product UI prototype for comparing three structural directions before the Semi UI migration.

## Run

```bash
pnpm prototype:ui
```

Open <http://localhost:4173/?variant=A&view=editor>.

The preferred review entry is <http://localhost:4173/?variant=A&view=workflows>.

## Compare

- `variant=A` — Workbench Rail: persistent navigation and contextual inspector.
- `variant=B` — Command Deck: top-level command navigation and execution dock.
- `variant=C` — Focus Dock: compact icon rail, node library, and floating inspector.
- Add `compare=1` to an editor URL to show the evaluation-only variant switcher, then use the switcher or the left/right arrow keys to move between variants.
- The switcher stays hidden in the default product view and on management pages.
- Use `view=editor`, `view=workflows`, `view=agents`, or `view=settings` to open a product surface directly.

Variant A now tests the preferred product structure:

- A floating rounded sidebar collapses to an icon rail and owns the theme switcher.
- Workflows and Agents open as collection pages with one primary `New` action.
- Selecting a row fades and shifts the collection away before replacing it with the full editor or settings surface.
- The detail header provides a single Back action that restores the collection page.
- The node inspector is a rounded floating surface over the workflow canvas, consistent with the app rail and canvas controls.
- Agent details use a vertical settings sidebar and retain inline title editing plus provider model discovery/testing.
- Sessions owns conversation entry: `New session` replaces the settings content with a full inline Agent conversation, and Back restores the recent-session list.

The prototype uses local mock state only. It does not call backend APIs, persist workflow data, or change Workflow JSON and execution behavior.
