/**
 * SSE adapter: a thin iterate-and-push loop over the shared Agent Execution
 * module's event sequence. Owns NO pi session, subscribe handler, or event
 * translation — only SSE framing + terminal projection (#76).
 *
 * Credential resolution is handled inside createAgentSessionForAgent
 * (config.provider.api_key with $ENV_VAR support).
 */
import { streamSSE } from "hono/streaming";
import { projectTerminal } from "./agent-execution.mjs";

/**
 * Factory: returns a `runAgentSse(c, agentConfig, prompt)` Hono handler bound
 * to a specific `runAgentExecution` (real or fake) and `streamSSE` (real or
 * fake). Tests inject a fake `streamSSE` to drive a fake stream without Hono.
 *
 * @param {object} deps
 * @param {(opts: object) => AsyncGenerator} deps.runAgentExecution
 * @param {(agent: object, agentDir: string) => Promise<object>} deps.createAgentSessionForAgent
 * @param {string} deps.agentDir
 * @param {(c: object, handler: (stream: object) => Promise<void>) => Promise<void>} [deps.streamSSE]
 */
export function createRunAgentSse({
  runAgentExecution,
  createAgentSessionForAgent,
  agentDir,
  streamSSE: streamer = streamSSE,
  onTerminal = null,
}) {
  return async function runAgentSse(c, agentConfig, prompt) {
    c.header("X-Accel-Buffering", "no");

    // New interface: createAgentSessionForAgent(agent, agentDir) resolves credentials internally
    const createSessionBound = (cfg, dir) => createAgentSessionForAgent(cfg, dir);

    const run = async (stream) => {
      const ac = new AbortController();
      stream.onAbort(() => ac.abort());
      const startedAt = new Date().toISOString();

      try {
        const events = runAgentExecution({
          agentConfig,
          prompt,
          signal: ac.signal,
          createSession: createSessionBound,
          agentDir,
        });
        for await (const ev of events) {
          if (stream.aborted) break;
          if (ev.type === "terminal") {
            if (!stream.aborted) {
              await stream.writeSSE({ data: JSON.stringify(projectTerminal(ev)) });
            }
            // Persist execution record
            if (onTerminal) {
              onTerminal({ terminal: ev, agentConfig, startedAt, endedAt: new Date().toISOString() });
            }
            break;
          }
          await stream.writeSSE({ data: JSON.stringify(ev) });
        }
      } catch (err) {
        if (!stream.aborted) {
          await stream.writeSSE({
            data: JSON.stringify({ type: "error", message: err?.message ?? "internal error", kind: "internal_error" }),
          });
        }
      }
    };

    return streamer(c, async (stream) => run(stream));
  };
}
