/**
 * SSE adapter: a thin iterate-and-push loop over the shared Agent Execution
 * module's event sequence. Owns NO pi session, subscribe handler, or event
 * translation — only SSE framing + terminal projection (#76).
 *
 * Credential boundary: the route resolves apiKey from environment and binds it
 * into a createSession closure BEFORE calling this adapter. The adapter (and
 * the shared module it calls) never resolves credentials.
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
 * @param {(agentConfig: object, apiKey: string, agentDir: string) => Promise<object>} deps.createAgentSessionForAgent
 * @param {string} deps.agentDir
 * @param {object} deps.environment
 * @param {(c: object, handler: (stream: object) => Promise<void>) => Promise<void>} [deps.streamSSE]
 *   Defaults to hono/streaming's streamSSE. Tests pass a fake that invokes
 *   the handler with a fake stream.
 */
export function createRunAgentSse({
  runAgentExecution,
  createAgentSessionForAgent,
  agentDir,
  environment,
  streamSSE: streamer = streamSSE,
}) {
  return async function runAgentSse(c, agentConfig, prompt) {
    const apiKey = environment[agentConfig.provider_api_key_env];
    if (!apiKey) {
      return c.json({ error: `missing env var: ${agentConfig.provider_api_key_env}` }, 500);
    }

    c.header("X-Accel-Buffering", "no");

    // Bind apiKey into the createSession closure — shared module never resolves
    // credentials (#66 rule, aligned with #77 calibration). 2-arg form.
    const createSessionBound = (cfg, dir) => createAgentSessionForAgent(cfg, apiKey, dir);

    const run = async (stream) => {
      // Bridge Hono's stream.onAbort → an AbortController whose signal feeds the
      // shared module. Hono's c.req.raw.signal is NOT wired to stream.aborted on
      // @hono/node-server, so we use stream.onAbort as the cancellation source.
      const ac = new AbortController();
      stream.onAbort(() => ac.abort());

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
            break;
          }
          // Non-terminal events (content_delta / tool_start / tool_end) pass
          // through to the browser as-is.
          await stream.writeSSE({ data: JSON.stringify(ev) });
        }
      } catch (err) {
        // Defensive: the shared module classifies all errors into a terminal,
        // so this catch should not fire. If it does, surface a generic error
        // event rather than crashing the stream.
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
