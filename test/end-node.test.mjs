import assert from 'node:assert/strict';
import test from 'node:test';

import { canRemoveEndNodes } from '../src/utils/end-node.mjs';

/**
 * A workflow may have multiple End nodes (one per condition branch), but at
 * least one must always remain. canRemoveEndNodes decides whether removing a
 * given number of End nodes is allowed.
 */

test('removing one End is allowed when several exist', () => {
  assert.equal(canRemoveEndNodes(3, 1), true);
});

test('removing one End is allowed when exactly two exist', () => {
  assert.equal(canRemoveEndNodes(2, 1), true);
});

test('removing the last remaining End is blocked', () => {
  assert.equal(canRemoveEndNodes(1, 1), false);
});

test('removing all Ends in a multi-select is blocked', () => {
  assert.equal(canRemoveEndNodes(2, 2), false);
});

test('removing a subset that leaves one End is allowed', () => {
  assert.equal(canRemoveEndNodes(3, 2), true);
});
