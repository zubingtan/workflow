import assert from 'node:assert/strict';
import test from 'node:test';

import { computePortSlotOrder } from '../src/utils/port-slot-order.mjs';

/**
 * #190: computePortSlotOrder assigns horizontal slots to a condition node's
 * output ports so their left-to-right order matches their target nodes'
 * left-to-right order. This prevents connection lines from crossing in TB
 * mode when dagre places branch targets in an order that differs from the
 * ports' DOM order.
 */

test('ports already in target order keep their DOM-order slots', () => {
  const order = computePortSlotOrder(['if_0', 'else'], new Map([
    ['if_0', 100],
    ['else', 200],
  ]));
  assert.equal(order.get('if_0'), 0);
  assert.equal(order.get('else'), 1);
});

test('ports whose targets are reversed get swapped slots', () => {
  // dagre placed the if_0 target to the RIGHT of the else target.
  const order = computePortSlotOrder(['if_0', 'else'], new Map([
    ['if_0', 200],
    ['else', 100],
  ]));
  assert.equal(order.get('if_0'), 1);
  assert.equal(order.get('else'), 0);
});

test('three ports are sorted by ascending target x', () => {
  const order = computePortSlotOrder(['if_0', 'if_1', 'else'], new Map([
    ['if_0', 300],
    ['if_1', 100],
    ['else', 200],
  ]));
  assert.equal(order.get('if_1'), 0);
  assert.equal(order.get('else'), 1);
  assert.equal(order.get('if_0'), 2);
});

test('a port with no target sorts to the front (x = -Infinity)', () => {
  const order = computePortSlotOrder(['if_0', 'else'], new Map([
    ['else', 100],
  ]));
  assert.equal(order.get('if_0'), 0);
  assert.equal(order.get('else'), 1);
});

test('accepts a plain object for targetXs', () => {
  const order = computePortSlotOrder(['if_0', 'else'], { if_0: 200, else: 100 });
  assert.equal(order.get('if_0'), 1);
  assert.equal(order.get('else'), 0);
});
