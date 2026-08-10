const CANONICAL_DOCUMENT_FIELDS = new Set(['nodes', 'edges', 'direction', 'globalVariable']);

/**
 * Preserve document fields that FlowGram does not model while allowing its
 * canonical nodes/edges serialization and the app-owned direction/scope
 * fields to win.
 */
export function preserveWorkflowDocumentFields(original, next) {
  const preserved = Object.fromEntries(
    Object.entries(original || {}).filter(([key]) => !CANONICAL_DOCUMENT_FIELDS.has(key))
  );
  return { ...preserved, ...next };
}
