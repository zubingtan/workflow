import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import postgres from "postgres";
import { runPiAgent } from "./pi-runtime-adapter.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 2 });
const owner = `worker-${randomUUID()}`;
const leaseMs = Number(process.env.WORKER_LEASE_MS ?? 300_000);
const port = Number(process.env.WORKER_HEALTH_PORT ?? 4011);
let running = true;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const read = (source, values) => source in values ? values[source] : source.split(".").reduce((current, key) => current !== null && typeof current === "object" ? current[key] : undefined, values);
function condition(expression, values) {
  if ("group" in expression) return expression.group === "and" ? expression.children.every((child) => condition(child, values)) : expression.children.some((child) => condition(child, values));
  const resolve = (value) => "ref" in value ? read(value.ref, values) : value.literal;
  const left = resolve(expression.left); const right = resolve(expression.right);
  if (expression.operator === "strict_equals") return left === right;
  if (expression.operator === "contains") return typeof left === "string" && typeof right === "string" && left.includes(right);
  return typeof left === "string" && typeof right === "string" && new RegExp(right).test(left);
}
function ordered(definition) {
  const count = new Map(definition.spec.nodes.map((node) => [node.id, 0])); const next = new Map(definition.spec.nodes.map((node) => [node.id, []]));
  for (const edge of definition.spec.edges) { count.set(edge.to, count.get(edge.to) + 1); next.get(edge.from).push(edge.to); }
  const ready = definition.spec.nodes.filter((node) => count.get(node.id) === 0); const result = [];
  while (ready.length) { const node = ready.shift(); result.push(node); for (const target of next.get(node.id)) { count.set(target, count.get(target) - 1); if (count.get(target) === 0) ready.push(definition.spec.nodes.find((item) => item.id === target)); } }
  return result;
}
async function binding(alias) {
  const file = process.env.PROVIDER_BINDINGS_FILE; if (!file) throw new Error("Provider binding unavailable");
  const item = JSON.parse(await readFile(file, "utf8")).bindings?.[alias];
  if (!item || ![item.provider, item.baseUrl, item.apiKeyEnv, item.model].every((value) => typeof value === "string" && value)) throw new Error("Provider binding unavailable");
  const apiKey = process.env[item.apiKeyEnv]; if (!apiKey) throw new Error("Provider authentication failed");
  return { provider: item.provider, baseUrl: item.baseUrl, apiKey, model: item.model, parameters: item.parameters ?? {} };
}
async function addEvent(transaction, runId, sequence, type, nodeRunId = null, payload = {}) { await transaction`INSERT INTO execution_events (id, workflow_run_id, sequence, type, node_run_id, payload) VALUES (${`event-${randomUUID()}`}, ${runId}, ${sequence}, ${type}, ${nodeRunId}, ${transaction.json(payload)})`; }
async function claim() { return sql.begin(async (transaction) => { await transaction`UPDATE queue_jobs SET status='available',lease_owner=NULL,lease_expires_at=NULL WHERE status='leased' AND lease_expires_at<=now()`; const [job] = await transaction`WITH candidate AS (SELECT id FROM queue_jobs WHERE status='available' AND available_at<=now() ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE queue_jobs job SET status='leased',lease_owner=${owner},lease_expires_at=now()+(${leaseMs} * interval '1 millisecond') FROM candidate WHERE job.id=candidate.id RETURNING job.id,job.workflow_run_id`; return job; }); }
class LeaseLostError extends Error {}
async function writeWithLease(job, write) { return sql.begin(async (transaction) => { const [lease] = await transaction`SELECT id FROM queue_jobs WHERE id=${job.id} AND lease_owner=${owner} AND lease_expires_at>now() FOR UPDATE`; if (!lease) throw new LeaseLostError(); return write(transaction); }); }
async function skillPrompt(refs) {
  const sections = [];
  for (const ref of refs) {
    const [row] = await sql`SELECT definition FROM skill_definition_versions WHERE id=${ref}`;
    const definition = row?.definition;
    const text = definition && typeof definition === "object" ? definition.prompt ?? definition.content : null;
    if (typeof text !== "string") continue;
    const [skill] = await sql`SELECT definition.name FROM skill_definition_versions version JOIN skill_definitions definition ON definition.id=version.skill_definition_id WHERE version.id=${ref}`;
    if (typeof skill?.name === "string" && skill.name) sections.push(`### ${skill.name}\n\n${text}`);
  }
  return sections.length ? `## Skills\n\n${sections.join("\n\n")}` : "";
}
async function agentConfig(node, nodeRun) {
  const ref = nodeRun.agent_definition_version_id ?? node.config.agentVersionRef;
  if (!ref) return node.config;
  const [row] = await sql`SELECT definition FROM agent_definition_versions WHERE id=${ref}`;
  const definition = row?.definition;
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return node.config;
  return { ...node.config, ...definition };
}
function edgeActive(edge, nodes, branches, statuses) {
  const source = nodes.get(edge.from);
  return source && statuses.get(source.id) === "succeeded" && (source.type !== "logic.condition" || branches.get(source.id) === edge.sourcePort);
}
function mappedValue(edge, source, values, outputs, nodes) {
  const output = outputs.get(edge.from);
  const value = read(source, output ?? {});
  if (value !== undefined || nodes.get(edge.from)?.type !== "logic.condition") return value;
  return read(source, values);
}
async function execute(job) {
  const [run] = await sql`SELECT run.input,version.definition FROM workflow_runs run JOIN workflow_definition_versions version ON version.id=run.workflow_definition_version_id WHERE run.id=${job.workflow_run_id}`;
  if (!run) throw new Error("Run missing"); const definition = run.definition; const rows = await sql`SELECT id,node_id,agent_definition_version_id FROM node_runs WHERE workflow_run_id=${job.workflow_run_id}`; const runNode = new Map(rows.map((row) => [row.node_id, row]));
  let sequence = 2; const values = { input: { prompt: run.input.prompt }, "input.prompt": run.input.prompt, prompt: run.input.prompt }; const branches = new Map(); const outputs = new Map(); const statuses = new Map(rows.map((row) => [row.node_id, row.status])); const nodes = new Map(definition.spec.nodes.map((node) => [node.id, node]));
  await writeWithLease(job, async (transaction) => { await transaction`UPDATE workflow_runs SET status='running',started_at=now() WHERE id=${job.workflow_run_id} AND status='queued'`; await addEvent(transaction, job.workflow_run_id, sequence++, "workflow.run.started"); });
  try {
    for (const node of ordered(definition)) {
      const nodeRun = runNode.get(node.id); const incoming = definition.spec.edges.filter((edge) => edge.to === node.id); const active = incoming.filter((edge) => edgeActive(edge, nodes, branches, statuses));
      if (incoming.length && active.length === 0) { await writeWithLease(job, async (transaction) => { await transaction`UPDATE node_runs SET status='skipped',skip_reason='not_selected',completed_at=now() WHERE id=${nodeRun.id}`; await addEvent(transaction, job.workflow_run_id, sequence++, "node.run.skipped", nodeRun.id, { reason: "not_selected" }); }); statuses.set(node.id, "skipped"); continue; }
      const input = {}; for (const edge of active) for (const mapping of edge.mapping) { const value = mappedValue(edge, mapping.source, values, outputs, nodes); if (value !== undefined) input[mapping.target] = value; }
      await writeWithLease(job, async (transaction) => { await transaction`UPDATE node_runs SET status='running',input=${transaction.json(input)},started_at=now() WHERE id=${nodeRun.id}`; await addEvent(transaction, job.workflow_run_id, sequence++, "node.run.started", nodeRun.id); });
      let output;
      if (node.type === "input.prompt") output = { prompt: run.input.prompt };
      else if (node.type === "logic.condition") { const branch = node.config.branches.find((item) => item.condition === undefined || condition(item.condition, values)).id; branches.set(node.id, branch); output = { branch }; }
      else if (node.type === "task.agent") { const snapshot = await agentConfig(node, nodeRun); const config = await binding(snapshot.providerBindingRef); const skills = await skillPrompt(snapshot.skillVersionRefs); const prompt = typeof input.prompt === "string" ? input.prompt : run.input.prompt; output = { output: await runPiAgent({ prompt, systemPrompt: [snapshot.systemPrompt, skills].filter(Boolean).join("\n\n"), provider: config.provider, baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, parameters: config.parameters, tools: [] }) }; }
      else output = { markdown: typeof input.output === "string" ? input.output : typeof input.prompt === "string" ? input.prompt : "" };
      outputs.set(node.id, output); values[node.id] = output; Object.entries(output).forEach(([key, value]) => { values[`${node.id}.${key}`] = value; values[key] = value; });
      await writeWithLease(job, async (transaction) => { await transaction`UPDATE node_runs SET status='succeeded',output=${transaction.json(output)},completed_at=now() WHERE id=${nodeRun.id}`; await addEvent(transaction, job.workflow_run_id, sequence++, "node.run.succeeded", nodeRun.id); });
      statuses.set(node.id, "succeeded");
    }
    const outputNode = ordered(definition).find((node) => node.type === "output.markdown"); const result = outputNode ? outputs.get(outputNode.id)?.markdown : undefined;
    await writeWithLease(job, async (transaction) => { await transaction`UPDATE workflow_runs SET status='succeeded',output=${transaction.json({ markdown: result })},completed_at=now() WHERE id=${job.workflow_run_id}`; await transaction`UPDATE queue_jobs SET status='completed',completed_at=now() WHERE id=${job.id} AND lease_owner=${owner}`; await addEvent(transaction, job.workflow_run_id, sequence++, "workflow.run.succeeded"); });
  } catch (error) {
    if (error instanceof LeaseLostError) return;
    const message = error instanceof Error ? error.message : "Worker execution failed";
    await writeWithLease(job, async (transaction) => { await transaction`UPDATE workflow_runs SET status='failed',error_code='runtime_error',error_message=${message},completed_at=now() WHERE id=${job.workflow_run_id}`; await transaction`UPDATE queue_jobs SET status='completed',completed_at=now() WHERE id=${job.id} AND lease_owner=${owner}`; await addEvent(transaction, job.workflow_run_id, sequence++, "workflow.run.failed", null, { code: "runtime_error" }); });
  }
}
async function loop() { while (running) { try { const job = await claim(); if (job) await execute(job); else await wait(100); } catch { await wait(100); } } }
const server = createServer((request, response) => { if (request.method === "GET" && request.url === "/health/live") { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "live" })); return; } response.writeHead(404).end(); }).listen(port, "0.0.0.0");
process.once("SIGTERM", async () => { running = false; server.close(); await sql.end({ timeout: 1 }); }); process.once("SIGINT", async () => { running = false; server.close(); await sql.end({ timeout: 1 }); }); void loop();
