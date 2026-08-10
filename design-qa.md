# Design QA — Issue #281 management surfaces

## Source visual truth

- Repository branch: [research/shadcn-ui-prototype](https://github.com/zubingtan/workflow/tree/research/shadcn-ui-prototype)
- Commit: `da7203e64`
- Workflow source: `/Users/zubingtan/Documents/workflow/.worktrees/shadcn-ui-prototype/docs/prototypes/shadcn-ui/workflows-clean-navigation.png`
- Agent source: `/Users/zubingtan/Documents/workflow/.worktrees/shadcn-ui-prototype/docs/prototypes/shadcn-ui/agents-full-detail-stats.png`
- Settings source: `/Users/zubingtan/Documents/workflow/.worktrees/shadcn-ui-prototype/docs/prototypes/shadcn-ui/audit-modern-shell/35-settings-mem0-main-sync.png`, plus the current source layout in `src/prototypes/shadcn-ui/prototype-app.tsx`

## Implementation evidence

- Workflow: `docs/evidence/issue-281/workflows-prototype-aligned.png`
- Agent: `docs/evidence/issue-281/agents-prototype-aligned.png`
- Settings: `docs/evidence/issue-281/settings-prototype-aligned.png`
- Default acceptance viewport: `docs/evidence/issue-281/workflows-1440x900.png` at 1440×900 CSS px, light mode.
- Narrow rail viewport: `docs/evidence/issue-281/workflows-narrow-rail.png` at 900×900 CSS px; the rail changes from `Collapse navigation` to `Expand navigation`.
- Prototype comparison viewport: 1446×976 CSS px; source workflow/agent captures are 1446×976 px, implementation captures are 1446×976 px; device scale factor 1; no density normalization required for those comparisons.
- Settings source is the older 1600×900 audit capture; the implementation was compared by matching its visible Workbench Rail, settings navigation, Memory card, field grouping and Test connection state against both that capture and the current prototype source code.

## State and interaction coverage

- Workflows collection with one persisted workflow and the primary Open/Copy/History/Delete actions visible.
- Agent detail for the persisted Fake Provider agent, Stats section selected, empty execution state visible.
- Settings Memory section selected, Saved state visible, mem0/LLM/embedding fields visible.
- Provider section was opened separately and its model/test controls were verified.
- Browser errors: none reported by `agent-browser errors --json`.
- Accessibility audit: no page runtime errors; the remaining axe findings are existing document-level landmark/lang issues and one token contrast heuristic, not a broken management interaction.

## Comparison

The source and implementation captures were opened as paired comparisons at the same viewport. The corrected implementation now shares the prototype's main visual decisions: Workbench Rail shell, compact row/card collection surfaces, Agent detail header with horizontal sections, and Settings left section navigation with a single focused card.

Intentional production differences are limited to data and existing semantics: the backend workflow list does not expose prototype-only description/success/node metrics, and production must keep Copy, History and Delete actions on each workflow row. Agent Stats correctly renders the real empty state when the persisted agent has no execution history instead of inventing prototype metrics.

## Required fidelity surfaces

- Fonts and typography: existing app/system font stack and token-based weights are retained; headings, tertiary descriptions and compact controls follow the prototype hierarchy.
- Spacing and layout rhythm: 8px rail gap, rounded shell, 1120px content frame, compact rows, horizontal Agent sections and focused Settings card were checked at 1446×976.
- Colors and visual tokens: implementation uses canonical `--background`, `--card`, `--muted`, `--border`, `--primary` and semantic status tokens in both light and dark mode.
- Image quality and asset fidelity: the target uses UI icons only; implementation uses the existing Lucide icon library and no placeholder imagery or CSS-drawn assets.
- Copy and app-specific content: production labels preserve current API actions and mem0/provider terminology; prototype-only sample descriptions and metrics are not fabricated.

## Findings

- [P3] Workflow collection has one full-width production row instead of the prototype's multi-card sample grid. This is an intentional data-shape/semantic constraint; the production list does not provide the prototype's sample descriptions, node counts or success rates.
- [P3] Agent empty Stats state has no metric cards because the persisted agent has no execution data. This is the correct production empty state.
- [P3] Memory model discovery remains a production API boundary: the existing backend exposes provider discovery per Agent, not a global mem0 model catalog, so the refresh affordance presents a non-destructive notice instead of making an unauthenticated cross-origin request.

## Comparison history

1. Earlier evidence used the wrong management screenshots and a table/three-column/flat-settings implementation; those files were removed.
2. After comparing the actual branch source and captures, Workflow, Agent and Settings surfaces were corrected and recaptured at the source viewport.

## Final result

passed
