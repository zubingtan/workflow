/**
 * Execution persistence —集中 persist 函数 + 查询 helpers。
 *
 * agent-execution.mjs 保持 pi-free、无 DB 依赖。
 * SSE adapter / runtime adapter 在消费 terminal 事件后调用 persistExecution()。
 */

import { nanoid } from "nanoid";
import { readFileSync, existsSync } from "node:fs";

/**
 * Write an execution record to SQLite.
 */
export function persistExecution(db, {
  agentId,
  status,
  triggerType,
  workflowRunId = null,
  sessionFile = null,
  startedAt,
  endedAt = null,
}) {
  const id = nanoid(12);
  db.prepare(`
    INSERT INTO agent_executions (id, agent_id, status, trigger_type, workflow_run_id, session_file, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, agentId, status, triggerType, workflowRunId, sessionFile, startedAt, endedAt);
  return id;
}

/**
 * List executions for an agent (paginated, optional status filter).
 */
export function listExecutions(db, agentId, { limit = 50, offset = 0, status = null } = {}) {
  let sql = "SELECT * FROM agent_executions WHERE agent_id = ?";
  const params = [agentId];
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  sql += " ORDER BY started_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

/**
 * Get a single execution by id.
 */
export function getExecutionById(db, id) {
  return db.prepare("SELECT * FROM agent_executions WHERE id = ?").get(id);
}

/**
 * Delete an execution record.
 */
export function deleteExecution(db, id) {
  const result = db.prepare("DELETE FROM agent_executions WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Parse a pi session JSONL file to extract conversation detail.
 * Returns { messages, toolEvents, prompt } or null if unreadable.
 *
 * Session file format: one JSON object per line. Entry types:
 *   "session" — header (first line)
 *   "message" — user/assistant message ({ message: { role, content } })
 *   "thinking_level_change" / "model_change" / "compaction" — metadata
 */
export function parseSessionFile(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const messages = [];
    let prompt = null;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "message" && entry.message) {
          const msg = entry.message;
          messages.push({
            role: msg.role,
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
            timestamp: entry.timestamp,
          });
          if (!prompt && msg.role === "user") {
            prompt = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
          }
        }
      } catch { /* skip malformed lines */ }
    }
    return { messages, prompt };
  } catch {
    return null;
  }
}

/**
 * Compute stats for an agent: overview (all-time) + daily (last 30 days).
 */
export function getAgentStats(db, agentId) {
  const overview = db.prepare(`
    SELECT
      COUNT(*) as totalExecutions,
      AVG(CASE WHEN status = 'succeeded' THEN 1.0 ELSE 0.0 END) as successRate,
      AVG(CASE WHEN ended_at IS NOT NULL THEN (julianday(ended_at) - julianday(started_at)) * 86400000 END) as avgDurationMs
    FROM agent_executions
    WHERE agent_id = ?
  `).get(agentId);

  const daily = db.prepare(`
    SELECT
      date(started_at) as date,
      COUNT(*) as count,
      SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) as succeeded,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM agent_executions
    WHERE agent_id = ? AND started_at >= datetime('now', '-30 days')
    GROUP BY date(started_at)
    ORDER BY date
  `).all(agentId);

  return {
    overview: {
      totalExecutions: overview.totalExecutions,
      successRate: overview.successRate ?? 0,
      avgDurationMs: Math.round(overview.avgDurationMs ?? 0),
    },
    daily,
  };
}
