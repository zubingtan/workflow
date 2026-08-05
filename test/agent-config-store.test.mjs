import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentSaveCoordinator,
  mergeAgentPatch,
  parseAgentConfig,
  providerConnectionFingerprint,
} from '../src/components/agent-miller/agent-config-store.mjs';

test('parseAgentConfig tolerates malformed rows without losing the editor', () => {
  assert.deepEqual(parseAgentConfig('not json'), {});
  assert.deepEqual(parseAgentConfig(JSON.stringify({ future: { enabled: true } })), {
    future: { enabled: true },
  });
});

test('mergeAgentPatch preserves nested siblings and makes the last same-field edit win', () => {
  const result = mergeAgentPatch(
    {
      config: {
        pi_settings: { retry: { enabled: true, maxRetries: 3 }, future: { enabled: true } },
      },
    },
    { config: { pi_settings: { retry: { enabled: false } } } }
  );
  const final = mergeAgentPatch(result, {
    config: { pi_settings: { retry: { maxRetries: 5 } } },
  });

  assert.deepEqual(final.config, {
    pi_settings: { retry: { enabled: false, maxRetries: 5 }, future: { enabled: true } },
  });
  assert.equal(
    providerConnectionFingerprint({
      base_url: 'u',
      api_key: 'k',
      model: 'm',
      pricing: { input: 1 },
    }),
    providerConnectionFingerprint({
      base_url: 'u',
      api_key: 'k',
      model: 'm',
      pricing: { input: 2 },
    })
  );
});

test('AgentSaveCoordinator serializes saves and retains failed patches for retry', async () => {
  const calls = [];
  let rejectNext = true;
  const coordinator = new AgentSaveCoordinator({
    delayMs: 0,
    save: async (id, patch) => {
      calls.push({ id, patch });
      if (rejectNext) {
        rejectNext = false;
        throw new Error('offline');
      }
      return {
        config: JSON.stringify({ pi_settings: { retry: { enabled: false, maxRetries: 5 } } }),
      };
    },
  });
  coordinator.seed({
    id: 'agent-1',
    config: JSON.stringify({ pi_settings: { retry: { enabled: true, maxRetries: 3 } } }),
  });
  coordinator.update('agent-1', { config: { pi_settings: { retry: { enabled: false } } } });
  coordinator.update('agent-1', { config: { pi_settings: { retry: { maxRetries: 5 } } } });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].patch, {
    config: { pi_settings: { retry: { enabled: false, maxRetries: 5 } } },
  });
  assert.equal(coordinator.getStatus('agent-1').state, 'error');

  coordinator.retry('agent-1');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.length, 2);
  assert.equal(coordinator.getStatus('agent-1').state, 'saved');
  coordinator.dispose();
});
