import { FlowDocumentJSON } from './typings';

export const initialData: FlowDocumentJSON = {
  nodes: [
    {
      id: 'start_0',
      type: 'start',
      meta: {
        position: { x: 100, y: 300 },
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
        position: { x: 420, y: 300 },
      },
      data: {
        title: 'Agent_Main',
        inputsValues: {
          agentId: {
            type: 'constant',
            content: '',
          },
          prompt: {
            type: 'template',
            content: '{{start_0.query}}',
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
      id: 'condition_0',
      type: 'condition',
      meta: {
        position: { x: 780, y: 300 },
      },
      data: {
        title: 'Condition',
        conditions: [
          {
            key: 'if_0',
            value: {
              left: {
                type: 'ref',
                content: ['llm_main', 'result'],
              },
              operator: 'contains',
              right: {
                type: 'constant',
                content: 'yes',
              },
            },
          },
        ],
      },
    },
    {
      id: 'llm_yes',
      type: 'llm',
      meta: {
        position: { x: 1100, y: 180 },
      },
      data: {
        title: 'Agent_Yes',
        inputsValues: {
          agentId: {
            type: 'constant',
            content: '',
          },
          prompt: {
            type: 'template',
            content: 'The answer was positive: {{llm_main.result}}',
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
        position: { x: 1100, y: 450 },
      },
      data: {
        title: 'Agent_No',
        inputsValues: {
          agentId: {
            type: 'constant',
            content: '',
          },
          prompt: {
            type: 'template',
            content: 'The answer was negative: {{llm_main.result}}',
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
      id: 'end_0',
      type: 'end',
      meta: {
        position: { x: 1420, y: 300 },
      },
      data: {
        title: 'End',
        inputsValues: {
          result: {
            type: 'ref',
            content: ['llm_main', 'result'],
          },
        },
        inputs: {
          type: 'object',
          properties: {
            result: {
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
      targetNodeID: 'end_0',
    },
    {
      sourceNodeID: 'llm_no',
      targetNodeID: 'end_0',
    },
  ],
};
