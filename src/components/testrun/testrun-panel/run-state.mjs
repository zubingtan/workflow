/**
 * Workflow Test Run presentation helpers.
 *
 * This module deliberately does not share the Agent Execution state machine.
 * Workflow runs use FlowGram's task/report contract and the canonical
 * `queued | running | succeeded | failed | terminated` lifecycle. Agent
 * execution has a separate controller and SSE protocol.
 */

/** @typedef {'idle'|'starting'|'queued'|'running'|'succeeded'|'failed'|'terminated'} TestRunPhase */

/** @param {TestRunPhase} phase */
export function isTestRunActive(phase) {
  return phase === 'starting' || phase === 'queued' || phase === 'running';
}

/** @param {TestRunPhase} phase */
export function isTestRunTerminal(phase) {
  return phase === 'succeeded' || phase === 'failed' || phase === 'terminated';
}

/**
 * Convert a terminal result emitted by WorkflowRuntimeService into the
 * canonical workflow status used by the server and history UI.
 *
 * @param {{result?: unknown, errors?: unknown}} change
 * @returns {{phase: 'succeeded'|'failed'|'terminated', errors: string[]}}
 */
export function classifyTestRunResult(change = {}) {
  const rawErrors = Array.isArray(change.errors) ? change.errors : [];
  const errors = rawErrors
    .filter((error) => error !== undefined && error !== null)
    .map((error) => String(error));

  if (change.result !== undefined && errors.length === 0) {
    return { phase: 'succeeded', errors: [] };
  }

  // WorkflowRuntimeService uses an explicit run-level message for the
  // canonical `terminated` state. Do not infer that state from arbitrary
  // provider/node text such as "provider process terminated": those are
  // ordinary task failures, not a cancellation reason.
  const terminated = errors.some((error) =>
    /^(?:run|workflow)\s+(?:cancel(?:led|ed)|terminated)\b/i.test(error)
  );
  return {
    phase: terminated ? 'terminated' : 'failed',
    errors: errors.length > 0 ? errors : ['Run ended without a result'],
  };
}

/**
 * Pick the UI phase from the REST run status. Queue position is intentionally
 * only a presentation hint; the server's status remains authoritative.
 *
 * @param {string|undefined} status
 * @param {number|undefined} queuePosition
 * @returns {TestRunPhase}
 */
export function phaseFromRunStatus(status, queuePosition = 0) {
  if (status === 'queued') return 'queued';
  if (status === 'running') return 'running';
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed') return 'failed';
  if (status === 'terminated') return 'terminated';
  return queuePosition > 0 ? 'queued' : 'running';
}

/** @param {TestRunPhase} phase */
export function testRunActionLabel(phase) {
  if (phase === 'failed' || phase === 'terminated') return 'Retry';
  return 'Test Run';
}

/** @param {TestRunPhase} phase */
export function testRunStatusLabel(phase) {
  switch (phase) {
    case 'starting':
      return 'Validating…';
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'succeeded':
      return 'Succeeded';
    case 'failed':
      return 'Failed';
    case 'terminated':
      return 'Terminated';
    default:
      return '';
  }
}
