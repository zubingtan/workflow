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
 * Convert the runtime service's structured terminal status into the panel
 * phase. Terminal status is protocol data; error text remains presentation
 * content and must not be parsed to recover lifecycle state.
 *
 * @param {string|undefined} status
 * @returns {'succeeded'|'failed'|'terminated'}
 */
export function phaseFromTerminalStatus(status) {
  if (status === 'succeeded' || status === 'failed' || status === 'terminated') {
    return status;
  }
  return 'failed';
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
