/** Stable private scope contract for Loop's `{ item, index }` variables. */
export function getLoopScopeContract(nodeId) {
  return {
    declarationKey: `${nodeId}_locals`,
    itemKey: 'item',
    indexKey: 'index',
  };
}
