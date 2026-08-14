import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isTestRunActive,
  isTestRunTerminal,
  phaseFromTerminalStatus,
  phaseFromRunStatus,
  testRunActionLabel,
  testRunStatusLabel,
} from '../src/components/testrun/testrun-panel/run-state.mjs';

test('Test Run phase uses the structured terminal status, not error text', () => {
  assert.equal(phaseFromTerminalStatus('succeeded'), 'succeeded');
  assert.equal(phaseFromTerminalStatus('failed'), 'failed');
  assert.equal(phaseFromTerminalStatus('terminated'), 'terminated');
  // Provider messages are payload only; the status remains authoritative.
  assert.equal(phaseFromTerminalStatus('failed'), 'failed');
  assert.equal(phaseFromTerminalStatus(undefined), 'failed');
});

test('Test Run phases reflect queued/running REST status without sharing agent phases', () => {
  assert.equal(phaseFromRunStatus('queued', 2), 'queued');
  assert.equal(phaseFromRunStatus('running'), 'running');
  assert.equal(phaseFromRunStatus('succeeded'), 'succeeded');
  assert.equal(phaseFromRunStatus('failed'), 'failed');
  assert.equal(phaseFromRunStatus('terminated'), 'terminated');
  assert.equal(isTestRunActive('queued'), true);
  assert.equal(isTestRunActive('running'), true);
  assert.equal(isTestRunActive('streaming'), false);
  assert.equal(isTestRunTerminal('terminated'), true);
});

test('Test Run action/status labels support retry and cancellation recovery', () => {
  assert.equal(testRunActionLabel('idle'), 'Test Run');
  assert.equal(testRunActionLabel('failed'), 'Retry');
  assert.equal(testRunActionLabel('terminated'), 'Retry');
  // Keep the existing Test Run accessible contract for successful reruns;
  // retry is called out explicitly only for failed/cancelled attempts.
  assert.equal(testRunActionLabel('succeeded'), 'Test Run');
  assert.equal(testRunStatusLabel('starting'), 'Validating…');
  assert.equal(testRunStatusLabel('terminated'), 'Terminated');
});
