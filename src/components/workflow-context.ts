import { createContext, useContext } from 'react';

/**
 * Holds the current saved-workflow id for components rendered deep inside the
 * FlowGram editor (toolbar, panels) that can't easily receive props. The Editor
 * component provides the value; consumers read it via `useWorkflowId`.
 *
 * `null` means a draft (unsaved) workflow — features that require a saved id
 * (e.g. the History Modal) should disable themselves in that case.
 */
export const WorkflowIdContext = createContext<string | null>(null);

export function useWorkflowId(): string | null {
  return useContext(WorkflowIdContext);
}
