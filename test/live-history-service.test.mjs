import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * #181 TDD: unit tests for LiveHistoryRuntimeService's SSE event → NodeReport
 * emitter mapping. The service subclasses WorkflowRuntimeService (Inversify DI),
 * which is hard to instantiate in a pure node test. Instead we test the pure
 * helper `applyRunProgress(report, prevNodeStatus, fireNodeReport)` that the
 * service calls from its SSE onmessage handler.
 *
 * The helper mirrors `WorkflowRuntimeService.updateReport` (index.ts:285-322)
 * but is exported standalone so it's testable without a Playground/Document.
 */
import {
  applyRunProgress,
  createReportBuffer,
} from '../src/plugins/runtime-plugin/runtime-service/apply-run-progress.mjs';

/**
 * Build a minimal IReport-shaped object for testing.
 * Only the fields used by applyRunProgress are populated.
 */
function makeReport(nodes) {
  const reports = {};
  for (const [nodeID, status, snapshotsLen = 0] of nodes) {
    reports[nodeID] = {
      id: nodeID,
      status,
      terminated: status === 'succeeded' || status === 'failed' || status === 'canceled',
      startTime: 1,
      endTime: status === 'processing' ? undefined : 2,
      timeCost: status === 'processing' ? 0 : 1,
      snapshots: Array.from({ length: snapshotsLen }, () => ({})),
    };
  }
  return { reports, workflowStatus: { status: 'processing', terminated: false } };
}

test('applyRunProgress: first progress for a node fires the emitter', () => {
  const fired = [];
  const prev = new Map();
  const report = makeReport([['nodeA', 'processing', 0]]);
  applyRunProgress(report, prev, (nr) => fired.push(nr.id));
  assert.deepEqual(fired, ['nodeA']);
  assert.equal(prev.get('nodeA').status, 'processing');
  assert.equal(prev.get('nodeA').nodeResultLength, 0);
});

test('applyRunProgress: no-op tick (same status + same snapshots length) does NOT fire', () => {
  const fired = [];
  const prev = new Map([['nodeA', { nodeID: 'nodeA', status: 'processing', nodeResultLength: 0 }]]);
  const report = makeReport([['nodeA', 'processing', 0]]);
  applyRunProgress(report, prev, (nr) => fired.push(nr.id));
  assert.deepEqual(fired, []);
});

test('applyRunProgress: snapshot-length change fires (new output arrived)', () => {
  const fired = [];
  const prev = new Map([['nodeA', { nodeID: 'nodeA', status: 'processing', nodeResultLength: 0 }]]);
  const report = makeReport([['nodeA', 'processing', 1]]);
  applyRunProgress(report, prev, (nr) => fired.push(nr.id));
  assert.deepEqual(fired, ['nodeA']);
  assert.equal(prev.get('nodeA').nodeResultLength, 1);
});

test('applyRunProgress: status transition (processing → succeeded) fires', () => {
  const fired = [];
  const prev = new Map([['nodeA', { nodeID: 'nodeA', status: 'processing', nodeResultLength: 0 }]]);
  const report = makeReport([['nodeA', 'succeeded', 1]]);
  applyRunProgress(report, prev, (nr) => fired.push(nr.id));
  assert.deepEqual(fired, ['nodeA']);
  assert.equal(prev.get('nodeA').status, 'succeeded');
});

test('applyRunProgress: multiple nodes, only the changed one fires', () => {
  const fired = [];
  const prev = new Map([
    ['nodeA', { nodeID: 'nodeA', status: 'succeeded', nodeResultLength: 1 }],
    ['nodeB', { nodeID: 'nodeB', status: 'processing', nodeResultLength: 0 }],
  ]);
  const report = makeReport([
    ['nodeA', 'succeeded', 1],
    ['nodeB', 'succeeded', 1],
  ]);
  applyRunProgress(report, prev, (nr) => fired.push(nr.id));
  assert.deepEqual(fired, ['nodeB']);
});

test('applyRunProgress: new node appearing fires for that node only', () => {
  const fired = [];
  const prev = new Map([['nodeA', { nodeID: 'nodeA', status: 'succeeded', nodeResultLength: 1 }]]);
  const report = makeReport([
    ['nodeA', 'succeeded', 1],
    ['nodeB', 'processing', 0],
  ]);
  applyRunProgress(report, prev, (nr) => fired.push(nr.id));
  assert.deepEqual(fired, ['nodeB']);
});

test('live report buffer replays progress that arrives before node listeners', () => {
  const fired = [];
  const reportBuffer = createReportBuffer((nodeReport) => fired.push(nodeReport.id));
  const prev = new Map();

  applyRunProgress(makeReport([['nodeA', 'processing', 0]]), prev, (nodeReport) =>
    reportBuffer.emit(nodeReport)
  );
  assert.deepEqual(fired, []);

  reportBuffer.flush();
  assert.deepEqual(fired, ['nodeA']);

  applyRunProgress(makeReport([['nodeA', 'succeeded', 1]]), prev, (nodeReport) =>
    reportBuffer.emit(nodeReport)
  );
  assert.deepEqual(fired, ['nodeA', 'nodeA']);
});
