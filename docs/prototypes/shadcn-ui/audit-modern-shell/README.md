# Modern shell interaction audit

## Scope

Validate the preferred Variant A structure after the latest navigation feedback:

- remove repeated page identity and duplicate agent names;
- keep only a collection list and primary New action at the top level;
- replace the collection with a full-width editor or settings surface after selection;
- restore the collection through an explicit Back action;
- make the floating sidebar collapsible and place theme switching inside it;
- retain the dark workflow canvas without the former red cast.

## Findings

- Before: Agents repeated the selected name in the switcher and detail header; Workflows repeated its identity across the product label, navigation, header, and page heading.
- After: management collections have no redundant page header; search, count, and the primary creation action share one compact tool row.
- After: both collection-to-detail paths use the same short fade-and-horizontal-shift transition and preserve an obvious return path.
- After: the Agent settings surface fills the entire right pane instead of sitting inside a second rounded card.
- After: the sidebar keeps only navigation and theme switching; the collapse control is visually muted and the unused account block is removed.
- After: the Agent identity row is compact, omits provider/model metadata and unused overflow actions, and keeps Discard/Save as direct actions instead of a bottom bar.
- After: Agent configuration uses a vertical settings sidebar instead of horizontal tabs.
- After: conversation entry lives inside Sessions; `New session` replaces the right content pane with a standard Agent conversation and Back restores the session list. The superseded top-level Quick chat action is gone.
- After: Settings starts directly with editable sections and a standalone Save button, without an explanatory masthead or sticky action bar.
- After: the dark editor uses neutral near-black layers; node cards and connections stay visually separated without a red background tint.
- After: the Variant A node inspector uses the same floating rounded-surface rule as the primary rail and canvas controls, with canvas visible on every side.
- Consistency check: Workflow and Agent collection cards plus Settings sections already use rounded surfaces. Agent detail navigation intentionally remains full-height inside the detail pane because it is page structure, not a temporary tool surface.
- After: Agent General starts directly with Description; the redundant Identity heading and rename instructions are removed because the name is edited in the detail header.
- After: Agent save actions belong to the specific sections that need an explicit commit instead of the global detail header. General, System prompt, Tools, and Runtime retain local save actions; Skills and Extensions apply toggles immediately.
- After: Agent list states occupy one fixed-width column, the detail identity icon is smaller, the settings rail is narrower, and the collapse control is reduced to a quiet chevron.
- After: Description has dependency-free Markdown shortcuts for bold, italic, inline code, and lists. Skills can import a local folder, and the imported package is enabled immediately in prototype state.
- After: Session history rows open their saved conversation in place; `New session` opens the same chat shell without a redundant centered Agent introduction.
- After: `Stats` is renamed `Statistics`, and the unused Workflow editor overflow action is removed.

## Evidence

- `01-agents-before.png` and `02-workflows-before.png`: repetition baseline.
- `03-workflows-after.png`: simplified Workflow collection.
- `04-agents-list-after.png` and `05-agent-detail-after.png`: Agent collection and full-width settings detail.
- `06-collapsed-sidebar.png`: compact icon rail.
- `07-workflow-editor-after.png`: Workflow detail/editor.
- `08-dark-workflow-list.png` and `09-dark-editor.png`: dark-mode checks.
- `10-agent-sidebar-settings.png`: compact Agent identity and vertical settings navigation.
- `11-quick-chat.png`: superseded Quick chat drawer iteration.
- `12-settings-clean.png`: Settings without the redundant introduction or bottom action bar.
- `13-sessions-new-session.png`: Sessions list with its local `New session` action.
- `14-session-chat.png`: full inline Agent conversation in dark mode, including message composer and sent-message state.
- `15-editor-inspector-before.png`: flush, square-edged node inspector baseline.
- `16-workflows-surface-before.png`, `17-agents-surface-before.png`, and `18-settings-surface-before.png`: cross-surface consistency audit.
- `19-editor-inspector-after.png`: rounded floating node inspector with preserved canvas layout.
- `20-editor-inspector-dark.png`: dark-mode verification of the same surface hierarchy.
- `21-agent-detail-surface-audit.png`: Agent detail remains a full-pane editing surface rather than an unnecessary nested floating panel.
- `22-agent-general-without-identity.png`: General settings after removing the redundant Identity introduction.
- `23-agent-general-local-save.png`: General with its local save action and a clean Agent header.
- `24-agent-sessions-no-global-save.png`: Sessions without an irrelevant global or local save action.
- `25-agent-list-density.png`: aligned status widths and the simplified sidebar-collapse affordance.
- `26-agent-general-markdown.png`: compact Agent identity, narrow settings rail, and lightweight Markdown editing.
- `27-agent-skills-import.png`: immediate Skill toggles with local folder import and no save action.
- `28-agent-session-history.png`: an existing session opened as a resumable conversation.
- `29-editor-clean-header.png`: Workflow editor header without an unused overflow menu.

Browser verification covered Workflow list -> editor -> Back, Agent list -> settings -> Back, Markdown selection formatting, immediate Skill toggles, Sessions -> existing history/New session -> chat, sidebar collapse/expand, theme switching, node-inspector surface consistency, and console warnings/errors.
