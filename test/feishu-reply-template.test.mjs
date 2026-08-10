import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #294: feishu-reply.json — the deployable Feishu echo workflow template.
 *
 * Pins the template document shape so the shipped JSON can never drift from
 * what the backend/editor expect:
 *   - valid FlowGram document (nodes + edges, one start + one end)
 *   - Feishu Trigger: enabled, onlyWhenMentioned=true, credentials EMPTY
 *     (filled in the UI after import — empty credentials = no long
 *     connection, per the single-instance decision #295), chatIdAllowlist
 *     non-empty (verification group only, prevents cross-group triggers)
 *   - LLM node: prompt references {{start_0.query}}
 *   - Feishu Bot: app mode, reply inside the thread
 *     (replyToMessageId={{start_0.messageId}}), receiveId={{start_0.chatId}}
 *   - linear node chain start → llm → feishu-bot → end
 */

const TEMPLATE_PATH = join(import.meta.dirname, '..', 'deploy', 'templates', 'feishu-reply.json');

function loadTemplate() {
  return JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));
}

function findNode(doc, type) {
  return doc.nodes.find((n) => n.type === type);
}

test('template file exists and parses as a FlowGram document', () => {
  const doc = loadTemplate();
  assert.ok(Array.isArray(doc.nodes) && doc.nodes.length >= 4, 'nodes present');
  assert.ok(Array.isArray(doc.edges) && doc.edges.length >= 3, 'edges present');
  for (const node of doc.nodes) {
    assert.ok(node.id, 'node id');
    assert.equal(typeof node.type, 'string', 'node type');
    assert.ok(node.data, 'node data');
    assert.ok(node.meta?.position, 'node position');
  }
});

test('document has exactly one start and one end, chained linearly', () => {
  const doc = loadTemplate();
  assert.equal(doc.nodes.filter((n) => n.type === 'start').length, 1);
  assert.equal(doc.nodes.filter((n) => n.type === 'end').length, 1);
  const types = doc.nodes.map((n) => n.type);
  const order = ['start', 'llm', 'feishu-bot', 'end'];
  for (const expected of order) {
    assert.ok(types.includes(expected), `contains ${expected}`);
  }
  const edges = doc.edges.map((e) => `${e.sourceNodeID}->${e.targetNodeID}`);
  const start = findNode(doc, 'start');
  const llm = findNode(doc, 'llm');
  const bot = findNode(doc, 'feishu-bot');
  assert.ok(edges.includes(`${start.id}->${llm.id}`), 'start → llm');
  assert.ok(edges.includes(`${llm.id}->${bot.id}`), 'llm → feishu-bot');
  assert.ok(edges.includes(`${bot.id}->${findNode(doc, 'end').id}`), 'feishu-bot → end');
});

test('feishu trigger: mentioned-only, allowlisted, credentials empty', () => {
  const trigger = findNode(loadTemplate(), 'feishu-trigger');
  const d = trigger.data;
  assert.equal(d.enabled, true);
  assert.equal(d.onlyWhenMentioned, true);
  assert.equal(d.appId, '', 'App ID empty until filled in UI');
  assert.equal(d.appSecret, '', 'App Secret empty until filled in UI');
  assert.ok(
    typeof d.chatIdAllowlist === 'string' && d.chatIdAllowlist.trim().length > 0,
    'chatIdAllowlist set to the verification group'
  );
  assert.ok(['auto', 'thread', 'chat_window'].includes(d.contextMode));
  // Trigger outputs must include the inputs the chain references.
  const props = d.outputs?.properties ?? {};
  for (const key of ['query', 'contextText', 'chatId', 'messageId']) {
    assert.ok(props[key], `outputs.${key}`);
  }
});

test('llm node: prompt references the trigger query', () => {
  const llm = findNode(loadTemplate(), 'llm');
  const prompt = llm.data.inputsValues?.prompt;
  assert.ok(prompt, 'inputsValues.prompt present');
  assert.equal(prompt.type, 'template');
  const start = findNode(loadTemplate(), 'start');
  assert.ok(prompt.content.includes(`{{${start.id}.query}}`), 'prompt uses {{start.query}}');
  // Agent is chosen in the UI after import (verification period: fake-provider).
  assert.equal(llm.data.inputsValues?.agentId?.content, '');
});

test('feishu bot: app mode, replies in-thread to the triggering message', () => {
  const bot = findNode(loadTemplate(), 'feishu-bot');
  const d = bot.data;
  assert.equal(d.botType, 'app');
  assert.equal(d.msgType, 'text');
  assert.equal(d.app?.receiveIdType, 'chat_id');
  assert.equal(d.app?.appId, '', 'app credentials filled in UI after import');
  const start = findNode(loadTemplate(), 'start');
  const inputs = d.inputsValues;
  assert.equal(inputs.receiveId.type, 'template');
  assert.equal(inputs.receiveId.content, `{{${start.id}.chatId}}`);
  assert.equal(inputs.replyToMessageId.type, 'template');
  assert.equal(inputs.replyToMessageId.content, `{{${start.id}.messageId}}`);
  const llm = findNode(loadTemplate(), 'llm');
  assert.equal(inputs.textContent.type, 'template');
  assert.ok(inputs.textContent.content.includes(`{{${llm.id}.result}}`), 'sends the LLM result');
});
