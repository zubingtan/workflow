/**
 * Migrations for persisted workflow documents.
 *
 * Workflow documents are JSON blobs, so changes to a node contract need to be
 * applied when old documents are read/created rather than only in the editor's
 * in-memory template. The LLM node moved from inline provider fields to the
 * agent-id + prompt contract; keep this migration narrow and idempotent.
 */

const LEGACY_LLM_INPUT_KEYS = new Set([
  'modelName',
  'apiKey',
  'apiHost',
  'temperature',
  'systemPrompt',
]);

/** Prefer the local deterministic agent, then the most recently created one. */
export function findDefaultAgentId(db) {
  return (
    db.prepare("SELECT id FROM agents WHERE id = 'fake-default' LIMIT 1").get()?.id ??
    db.prepare('SELECT id FROM agents ORDER BY created_at DESC LIMIT 1').get()?.id
  );
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function flowValueContent(value) {
  if (typeof value === 'string') return value;
  return typeof value?.content === 'string' ? value.content : '';
}

function templateValue(value) {
  if (isRecord(value)) {
    return { ...value, type: 'template', content: String(value.content ?? '') };
  }
  return { type: 'template', content: typeof value === 'string' ? value : '' };
}

function agentValue(value) {
  return { type: 'constant', content: value };
}

function llmInputSchema(existing) {
  const next = {
    ...(isRecord(existing) ? existing : {}),
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
  };
  return next;
}

function migrateLlmNode(node, defaultAgentId) {
  if (!isRecord(node?.data)) return false;
  const data = node.data;
  const oldValues = isRecord(data.inputsValues) ? data.inputsValues : {};
  const existingAgentId =
    flowValueContent(oldValues.agentId) ||
    flowValueContent(data.agentId) ||
    flowValueContent(data.agent_id);
  const agentId = existingAgentId || defaultAgentId || '';
  const prompt = templateValue(oldValues.prompt ?? data.prompt);

  const nextValues = {};
  for (const [key, value] of Object.entries(oldValues)) {
    if (!LEGACY_LLM_INPUT_KEYS.has(key) && key !== 'agentId' && key !== 'prompt') {
      nextValues[key] = value;
    }
  }
  nextValues.agentId = agentValue(agentId);
  nextValues.prompt = prompt;

  const nextData = {
    ...data,
    inputsValues: nextValues,
    inputs: llmInputSchema(data.inputs),
  };
  if (!isRecord(nextData.outputs)) {
    nextData.outputs = {
      type: 'object',
      properties: { result: { type: 'string' } },
    };
  }
  delete nextData.agentId;
  delete nextData.agent_id;
  delete nextData.prompt;

  const before = JSON.stringify(data);
  const after = JSON.stringify(nextData);
  if (before === after) return false;
  node.data = nextData;
  return true;
}

function migrateNodes(nodes, defaultAgentId) {
  if (!Array.isArray(nodes)) return false;
  let changed = false;
  for (const node of nodes) {
    if (node?.type === 'llm') changed = migrateLlmNode(node, defaultAgentId) || changed;
    if (Array.isArray(node?.blocks)) changed = migrateNodes(node.blocks, defaultAgentId) || changed;
  }
  return changed;
}

/**
 * Normalize a workflow document to the current LLM node contract.
 *
 * The returned document is a clone; callers can safely compare/persist it.
 * Existing non-empty agent IDs are preserved. Empty IDs use the supplied
 * default agent, which is intentionally injected by the caller so this module
 * does not depend on the agent catalog or database.
 */
export function migrateWorkflowData(data, defaultAgentId) {
  if (!isRecord(data)) return { data, changed: false };
  const nextData = structuredClone(data);
  const changed = migrateNodes(nextData.nodes, defaultAgentId);
  return { data: nextData, changed };
}

/** Migrate the persisted workflow named Default Workflow, if present. */
export function migrateDefaultWorkflow(db, defaultAgentId) {
  const row = db
    .prepare(
      "SELECT id, data FROM workflows WHERE name = 'Default Workflow' ORDER BY created_at ASC LIMIT 1"
    )
    .get();
  if (!row) return { changed: false, workflowId: undefined };

  let data;
  try {
    data = JSON.parse(row.data);
  } catch {
    return { changed: false, workflowId: row.id };
  }
  const result = migrateWorkflowData(data, defaultAgentId);
  if (!result.changed) return { changed: false, workflowId: row.id };

  db.prepare("UPDATE workflows SET data = ?, updated_at = datetime('now') WHERE id = ?").run(
    JSON.stringify(result.data),
    row.id
  );
  return { changed: true, workflowId: row.id };
}
