/**
 * Phase 8 (#160): boolean React context indicating the editor is rendering a
 * historical run's terminal snapshot (readonly), not a live editable workflow.
 *
 * Provided as `true` by `HistoryViewer`. Consumers:
 *   - `NodeFormPanel` — stays open in history view (bypasses the readonly
 *     self-close gate) so the sidebar detail is visible.
 *   - `LLMFormRender` — renders the static historical output instead of the
 *     live `useAgentExecution` SSE panel.
 */
import React from 'react';

export const IsHistoryViewContext = React.createContext<boolean>(false);
