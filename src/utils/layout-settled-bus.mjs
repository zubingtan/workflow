/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

/**
 * #190: a tiny event bus bridging the Layout Direction toggle and the
 * condition / multi-condition port-order hook.
 *
 * Why it exists: `tools.autoLayout({ enableAnimation: true })` interpolates
 * each node's `transform.position` over the animation duration (a `startTween`
 * in @flowgram.ai/free-auto-layout-plugin). The condition port-order hook
 * derives slot order from target node positions, but the positions it reads
 * mid-animation are transient — sibling End nodes can momentarily sit in a
 * different left-to-right order than they settle into. If the hook's debounced
 * recompute fires during the animation and nothing re-triggers it once the
 * layout settles, the port slots stay locked to the transient order and the
 * branch lines cross in TB mode.
 *
 * The toggle `await`s `autoLayout`, so it knows exactly when the layout has
 * settled. It fires `fireLayoutSettled()` then; the hook listens and recomputes
 * against the final positions, removing the crossing.
 */

const listeners = new Set();

/**
 * Subscribe to layout-settled notifications.
 * @param {() => void} callback
 * @returns {() => void} unsubscribe
 */
export function onLayoutSettled(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** Notify all subscribers that an auto-layout animation has settled. */
export function fireLayoutSettled() {
  for (const callback of listeners) {
    callback();
  }
}
