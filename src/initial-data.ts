import { FlowDocumentJSON } from './typings';

/**
 * Default example workflow — the translation pipeline (English ⇄ Chinese).
 *
 * Exercises the platform's core surfaces end to end:
 *   - Start → Classifier Agent with a STRUCTURED OUTPUT boolean
 *     (`is_english_word`) — the #247/#248/#249 contract
 *   - Condition branching on that boolean (`is_true`)
 *   - Two translator Agents (e2c / c2e), one per branch
 *   - A code aggregator merging whichever branch ran
 *   - End node consuming the aggregated result
 *
 * `agentId` is empty on purpose: every dev worktree has its own agent
 * database, so the user picks an agent per node before running.
 */
export const initialData: FlowDocumentJSON = {
  nodes: [
    {
      id: 'start_0',
      type: 'start',
      meta: {
        position: {
          x: 180,
          y: 245,
        },
      },
      data: {
        title: 'Start',
        outputs: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              default: 'Hello',
            },
          },
        },
      },
    },
    {
      id: 'llm_main',
      type: 'llm',
      meta: {
        position: {
          x: 640,
          y: 156.9,
        },
      },
      data: {
        outputs: {
          type: 'object',
          properties: {
            is_english_word: {
              type: 'boolean',
            },
          },
        },
        inputs: {
          type: 'object',
          required: ['agentId', 'prompt'],
          properties: {
            agentId: {
              type: 'string',
              extra: { formComponent: 'agent-select' },
            },
            prompt: {
              type: 'string',
              extra: { formComponent: 'prompt-editor' },
            },
          },
        },
        inputsValues: {
          agentId: {
            type: 'constant',
            content: '',
          },
          prompt: {
            type: 'template',
            content: 'return true if {{start_0.query}} is English',
          },
        },
        title: 'Classifier',
      },
    },
    {
      id: 'condition_0',
      type: 'condition',
      meta: {
        position: {
          x: 1100,
          y: 191,
        },
      },
      data: {
        title: 'Condition',
        conditions: [
          {
            value: {
              left: {
                type: 'ref',
                content: ['llm_main', 'is_english_word'],
              },
              operator: 'is_true',
            },
            key: 'if_0',
          },
        ],
      },
    },
    {
      id: 'llm_yes',
      type: 'llm',
      meta: {
        position: {
          x: 1560,
          y: 0,
        },
      },
      data: {
        title: 'translator(e2c)',
        inputsValues: {
          agentId: {
            type: 'constant',
            content: '',
          },
          prompt: {
            type: 'template',
            content: 'translate {{start_0.query}} to Chinese',
          },
        },
        inputs: {
          type: 'object',
          required: ['agentId', 'prompt'],
          properties: {
            agentId: {
              type: 'string',
              extra: { formComponent: 'agent-select' },
            },
            prompt: {
              type: 'string',
              extra: { formComponent: 'prompt-editor' },
            },
          },
        },
        outputs: {
          type: 'object',
          properties: {
            result: { type: 'string' },
          },
        },
      },
    },
    {
      id: 'llm_no',
      type: 'llm',
      meta: {
        position: {
          x: 1560,
          y: 332,
        },
      },
      data: {
        title: 'translator(c2e)',
        inputsValues: {
          agentId: {
            type: 'constant',
            content: '',
          },
          prompt: {
            type: 'template',
            content: 'translate {{start_0.query}} to English',
          },
        },
        inputs: {
          type: 'object',
          required: ['agentId', 'prompt'],
          properties: {
            agentId: {
              type: 'string',
              extra: { formComponent: 'agent-select' },
            },
            prompt: {
              type: 'string',
              extra: { formComponent: 'prompt-editor' },
            },
          },
        },
        outputs: {
          type: 'object',
          properties: {
            result: { type: 'string' },
          },
        },
      },
    },
    {
      id: 'code_k0pZu',
      type: 'code',
      meta: {
        position: {
          x: 2020,
          y: 227.5,
        },
      },
      data: {
        title: 'aggregator',
        inputsValues: {
          e2c_result: {
            type: 'ref',
            content: ['llm_yes', 'result'],
            extra: { index: 0 },
          },
          c2e_result: {
            type: 'ref',
            content: ['llm_no', 'result'],
            extra: { index: 1 },
          },
          query: {
            type: 'ref',
            content: ['start_0', 'query'],
          },
        },
        script: {
          language: 'javascript',
          content:
            'async function main({ params }) {\n  return {\n    final_result: params.e2c_result ?? params.c2e_result ?? "No result",\n  };\n}',
        },
        outputs: {
          type: 'object',
          properties: {
            final_result: {
              type: 'string',
            },
          },
          required: [],
        },
        inputs: {
          type: 'object',
          properties: {
            e2c_result: {
              type: 'string',
            },
            c2e_result: {
              type: 'string',
            },
            query: {
              type: 'string',
            },
          },
        },
      },
    },
    {
      id: 'end_0',
      type: 'end',
      meta: {
        position: {
          x: 2480,
          y: 245,
        },
      },
      data: {
        title: 'End',
        inputsValues: {
          final_result: {
            type: 'ref',
            content: ['code_k0pZu', 'final_result'],
            extra: { index: 0 },
          },
        },
        inputs: {
          type: 'object',
          properties: {
            final_result: {
              type: 'string',
            },
          },
        },
      },
    },
  ],
  edges: [
    {
      sourceNodeID: 'start_0',
      targetNodeID: 'llm_main',
    },
    {
      sourceNodeID: 'llm_main',
      targetNodeID: 'condition_0',
    },
    {
      sourceNodeID: 'condition_0',
      targetNodeID: 'llm_yes',
      sourcePortID: 'if_0',
    },
    {
      sourceNodeID: 'condition_0',
      targetNodeID: 'llm_no',
      sourcePortID: 'else',
    },
    {
      sourceNodeID: 'llm_yes',
      targetNodeID: 'code_k0pZu',
    },
    {
      sourceNodeID: 'llm_no',
      targetNodeID: 'code_k0pZu',
    },
    {
      sourceNodeID: 'code_k0pZu',
      targetNodeID: 'end_0',
    },
  ],
  globalVariable: {
    type: 'object',
    required: [],
    properties: {
      userId: {
        type: 'string',
      },
    },
  },
};
