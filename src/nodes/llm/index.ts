import { nanoid } from 'nanoid';

import { WorkflowNodeType } from '../constants';
import { FlowNodeRegistry } from '../../typings';
import iconLLM from '../../assets/icon-llm.jpg';
import { LLMFormMeta } from './form-meta';

let index = 0;
export const LLMNodeRegistry: FlowNodeRegistry = {
  type: WorkflowNodeType.LLM,
  info: {
    icon: iconLLM,
    description: 'Run an AI agent with a prompt and stream the response.',
  },
  meta: {
    size: {
      width: 360,
      height: 420,
    },
  },
  formMeta: LLMFormMeta,
  onAdd() {
    return {
      id: `llm_${nanoid(5)}`,
      type: 'llm',
      data: {
        title: `Agent_${++index}`,
        inputsValues: {
          agentId: {
            type: 'constant',
            content: '',
          },
          prompt: {
            type: 'template',
            content: '',
          },
        },
        inputs: {
          type: 'object',
          required: ['agentId', 'prompt'],
          properties: {
            agentId: {
              type: 'string',
              extra: {
                formComponent: 'agent-select',
              },
            },
            prompt: {
              type: 'string',
              extra: {
                formComponent: 'prompt-editor',
              },
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
    };
  },
};
