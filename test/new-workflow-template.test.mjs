import assert from 'node:assert/strict';
import test from 'node:test';

import { newWorkflowTemplate } from '../src/new-workflow-template.mjs';

test('newWorkflowTemplate seeds exactly one start and one end node', () => {
  const doc = newWorkflowTemplate();
  const starts = doc.nodes.filter((n) => n.type === 'start');
  const ends = doc.nodes.filter((n) => n.type === 'end');
  assert.equal(starts.length, 1, 'must seed exactly one start node');
  assert.equal(ends.length, 1, 'must seed exactly one end node');
});

test('newWorkflowTemplate seeds exactly one llm node wired between start and end', () => {
  const doc = newWorkflowTemplate();
  const llms = doc.nodes.filter((n) => n.type === 'llm');
  assert.equal(llms.length, 1, 'must seed exactly one llm node');
  const llm = llms[0];

  // start → llm → end chain
  assert.ok(
    doc.edges.some((e) => e.sourceNodeID === 'start_0' && e.targetNodeID === llm.id),
    'start must connect to llm'
  );
  assert.ok(
    doc.edges.some((e) => e.sourceNodeID === llm.id && e.targetNodeID === 'end_0'),
    'llm must connect to end'
  );
});

test('newWorkflowTemplate node ids are unique', () => {
  const doc = newWorkflowTemplate();
  const ids = doc.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'node ids must not collide');
});

test('newWorkflowTemplate does not emit an empty document', () => {
  const doc = newWorkflowTemplate();
  assert.ok(doc.nodes.length > 0, 'must not return an empty nodes array');
  assert.ok(doc.edges.length > 0, 'must not return an empty edges array');
});

test('newWorkflowTemplate returns a fresh object each call (no shared mutation)', () => {
  const a = newWorkflowTemplate();
  const b = newWorkflowTemplate();
  assert.notEqual(a, b, 'top-level object must be fresh');
  assert.notEqual(a.nodes, b.nodes, 'nodes array must be fresh');
  assert.notEqual(a.nodes[0], b.nodes[0], 'node objects must be fresh');
  a.nodes[0].data.title = 'mutated';
  assert.notEqual(
    b.nodes[0].data.title,
    'mutated',
    'mutating one return value must not affect the next'
  );
});
