/**
 * Template for a freshly created workflow.
 *
 * Start and End nodes are seeded-only (nodePanelVisible: false + canAdd → false
 * in their registries), so they cannot be added from the node panel. To keep
 * "New Workflow" usable, the document must ship with one of each, plus a single
 * empty LLM node wired between them so the user has something to configure.
 *
 * Node width is 360px for all three types (set in each node registry's
 * meta.size.width and in base-node/styles.tsx). The horizontal gap between
 * adjacent node left-edges is 440px (= 360px node + 80px gutter), so nodes
 * never overlap visually and the start→llm→end chain reads as a clear line.
 *
 * @returns {import('./typings').FlowDocumentJSON}
 */
export function newWorkflowTemplate() {
  return {
    nodes: [
      {
        id: 'start_0',
        type: 'start',
        meta: { position: { x: 100, y: 300 } },
        data: {
          title: 'Start',
          outputs: {
            type: 'object',
            properties: {
              query: { type: 'string', default: 'Hello' },
            },
          },
        },
      },
      {
        id: 'llm_main',
        type: 'llm',
        meta: { position: { x: 540, y: 300 } },
        data: {
          title: 'Agent_Main',
          inputsValues: {
            agentId: { type: 'constant', content: '' },
            prompt: { type: 'template', content: '{{start_0.query}}' },
          },
          inputs: {
            type: 'object',
            required: ['agentId', 'prompt'],
            properties: {
              agentId: { type: 'string', extra: { formComponent: 'agent-select' } },
              prompt: { type: 'string', extra: { formComponent: 'prompt-editor' } },
            },
          },
          outputs: {
            type: 'object',
            properties: { result: { type: 'string' } },
          },
        },
      },
      {
        id: 'end_0',
        type: 'end',
        meta: { position: { x: 980, y: 300 } },
        data: {
          title: 'End',
          inputsValues: {
            result: { type: 'ref', content: ['llm_main', 'result'] },
          },
          inputs: {
            type: 'object',
            properties: { result: { type: 'string' } },
          },
        },
      },
    ],
    edges: [
      { sourceNodeID: 'start_0', targetNodeID: 'llm_main' },
      { sourceNodeID: 'llm_main', targetNodeID: 'end_0' },
    ],
  };
}
