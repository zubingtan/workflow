import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_PROVIDER_PORT ?? 4010);
const controls = new Map();
let calls = 0;
let authorizationMatched = false;
// Last received chat completion payload — lets tests assert the structured
// output tool injection (tools:[StructuredOutput], no response_format)
// without a network proxy.
let lastPayload = null;

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function streamCompletion(response, content = 'Fake provider response') {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  response.writeHead(200, {
    'cache-control': 'no-cache',
    'content-type': 'text/event-stream',
    connection: 'keep-alive',
  });
  response.write(
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model: 'fake-m0',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content },
          finish_reason: null,
        },
      ],
    })}\n\n`
  );
  response.write(
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model: 'fake-m0',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 },
    })}\n\n`
  );
  response.end('data: [DONE]\n\n');
}

/**
 * Stream a tool_calls response (SSE): the assistant calls the StructuredOutput
 * tool with `arguments` (chunked so pi's parseStreamingJson accumulation is
 * exercised), then finishes with finish_reason=tool_calls.
 */
function streamToolCalls(response, args) {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const argumentsJson = JSON.stringify(args);
  response.writeHead(200, {
    'cache-control': 'no-cache',
    'content-type': 'text/event-stream',
    connection: 'keep-alive',
  });
  const chunk = (delta, finish_reason) =>
    `data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created, model: 'fake-m0',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
  response.write(
    chunk(
      {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: `call_${randomUUID().slice(0, 8)}`,
            type: 'function',
            function: { name: 'StructuredOutput', arguments: '' },
          },
        ],
      },
      null
    )
  );
  // Stream arguments in slices to exercise streaming JSON accumulation.
  for (let i = 0; i < argumentsJson.length; i += 12) {
    response.write(
      chunk(
        {
          tool_calls: [{ index: 0, function: { arguments: argumentsJson.slice(i, i + 12) } }],
        },
        null
      )
    );
  }
  response.write(
    `data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created, model: 'fake-m0',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 },
    })}\n\n`
  );
  response.end('data: [DONE]\n\n');
}

/** JSON (non-streaming) tool_calls response. */
function jsonToolCalls(response, args) {
  json(response, 200, {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion',
    model: 'fake-m0',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call_${randomUUID().slice(0, 8)}`,
              type: 'function',
              function: { name: 'StructuredOutput', arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 },
  });
}

function jsonCompletion(response, content = 'Fake provider response') {
  json(response, 200, {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion',
    model: 'fake-m0',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 },
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let source = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      source += chunk;
    });
    request.once('end', () => {
      try {
        resolve(JSON.parse(source));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    request.once('error', reject);
  });
}

function systemText(payload) {
  if (!Array.isArray(payload?.messages)) return '';
  return payload.messages
    .filter((message) => message?.role === 'system')
    .map((message) => {
      if (typeof message.content === 'string') return message.content;
      if (!Array.isArray(message.content)) return '';
      return message.content
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');
    })
    .join('\n');
}

function completionContent(payload) {
  const system = systemText(payload);
  if (system.includes('Use Skill A.')) return 'Agent A output';
  if (system.includes('Use Skill B.')) return 'Agent B output';
  return 'Fake provider response';
}

/** True when the payload carries the StructuredOutput tool (tool route, #320). */
function hasStructuredOutputTool(payload) {
  return Array.isArray(payload?.tools) && payload.tools.some((t) => t?.function?.name === 'StructuredOutput');
}

/** Parse rawDetail as tool arguments; falls back to the default {result:'ok'}. */
function toolArguments(rawDetail) {
  try {
    const parsed = JSON.parse(rawDetail);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { result: 'ok' };
  } catch {
    return { result: 'ok' };
  }
}

/** Text of the LAST user message (pi sends content as text-part arrays). */
function lastUserText(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');
    }
    return '';
  }
  return '';
}

function matchingControl(payload) {
  // Only the LAST user message decides the control: turn prompts (e.g. the
  // refusal retry) intentionally drop the correlationId, so the retry falls
  // through to the default success behavior instead of re-triggering the
  // original control.
  const lastUser = lastUserText(payload);
  for (const [correlationId, control] of controls) {
    if (lastUser.includes(correlationId)) return control;
  }
  return null;
}

async function handleCompletion(request, response) {
  let payload;
  try {
    payload = await readJson(request);
  } catch {
    json(response, 400, { error: { message: 'Invalid request' } });
    return;
  }

  calls += 1;
  lastPayload = payload;
  const expectedApiKey = process.env.FAKE_PROVIDER_EXPECTED_API_KEY;
  if (expectedApiKey) {
    authorizationMatched = request.headers.authorization === `Bearer ${expectedApiKey}`;
  }
  const control = matchingControl(payload);
  if (control) control.calls += 1;
  const mode = control?.mode ?? 'success';

  if (mode === 'auth_failure') {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: control.rawDetail } }));
    return;
  }
  if (mode === 'timeout') {
    // sleepMs lets E2E simulate a long-running provider call that exceeds
    // the node timeout (default 1000ms for backwards compat). When the
    // payload carries the StructuredOutput tool, answer with a toolCall (the
    // tool route's success shape) after the sleep.
    const sleepMs =
      typeof control?.sleepMs === 'number' && control.sleepMs > 0 ? control.sleepMs : 1_000;
    setTimeout(() => {
      if (response.destroyed) return;
      if (hasStructuredOutputTool(payload)) {
        streamToolCalls(response, toolArguments(control?.rawDetail));
      } else {
        streamCompletion(response, control?.rawDetail);
      }
    }, sleepMs);
    return;
  }
  if (mode === 'empty_output') {
    if (payload.stream === false) jsonCompletion(response, '   \n');
    else streamCompletion(response, '   \n');
    return;
  }
  // Tool route (#320): when the payload carries the StructuredOutput tool, the
  // model's answer is a toolCall — emit tool_calls with `arguments` parsed
  // from rawDetail (or the default). This covers json_response / invalid_json /
  // success modes in one branch; 'text_only' forces a plain-text answer so
  // fail-fast (no toolCall) can be exercised. refusal/incomplete keep their
  // own finish_reason semantics (checked below).
  if (hasStructuredOutputTool(payload) && mode !== 'refusal' && mode !== 'incomplete') {
    if (mode === 'text_only') {
      if (payload.stream === false) jsonCompletion(response, 'plain text answer');
      else streamCompletion(response, 'plain text answer');
      return;
    }
    const args = toolArguments(control?.rawDetail);
    if (payload.stream === false) jsonToolCalls(response, args);
    else streamToolCalls(response, args);
    return;
  }
  // Structured output modes (#249/#251): rawDetail carries the exact body
  // (JSON text, refusal text, ...). finish_reason controls incomplete.
  if (mode === 'json_response' || mode === 'invalid_json' || mode === 'refusal' || mode === 'incomplete') {
    const content = control?.rawDetail ?? '{"result":"ok"}';
    if (mode === 'incomplete') {
      const id = `chatcmpl-${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);
      response.writeHead(200, {
        'cache-control': 'no-cache',
        'content-type': 'text/event-stream',
        connection: 'keep-alive',
      });
      response.write(
        `data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', created, model: 'fake-m0',
          choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
        })}\n\n`
      );
      response.write(
        `data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', created, model: 'fake-m0',
          choices: [{ index: 0, delta: {}, finish_reason: 'length' }],
          usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 },
        })}\n\n`
      );
      response.end('data: [DONE]\n\n');
      return;
    }
    if (mode === 'refusal') {
      const id = `chatcmpl-${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);
      response.writeHead(200, {
        'cache-control': 'no-cache',
        'content-type': 'text/event-stream',
        connection: 'keep-alive',
      });
      response.write(
        `data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', created, model: 'fake-m0',
          choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
        })}\n\n`
      );
      response.write(
        `data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', created, model: 'fake-m0',
          choices: [{ index: 0, delta: {}, finish_reason: 'refusal' }],
          usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 },
        })}\n\n`
      );
      response.end('data: [DONE]\n\n');
      return;
    }
    if (payload.stream === false) jsonCompletion(response, content);
    else streamCompletion(response, content);
    return;
  }
  if (payload.stream === false) jsonCompletion(response, completionContent(payload));
  else streamCompletion(response, completionContent(payload));
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/health/live') {
    json(response, 200, { status: 'live' });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v1/models') {
    const expectedApiKey = process.env.FAKE_PROVIDER_EXPECTED_API_KEY;
    if (expectedApiKey && request.headers.authorization !== `Bearer ${expectedApiKey}`) {
      json(response, 401, { error: { message: 'Unauthorized' } });
      return;
    }
    json(response, 200, {
      object: 'list',
      data: [
        {
          id: 'fake-m0',
          object: 'model',
          max_input_tokens: 32768,
          max_output_tokens: 4096,
          info: {
            meta: {
              capabilities: { vision: false, code_interpreter: false },
            },
          },
        },
      ],
    });
    return;
  }
  if (url.pathname === '/test/stats' && request.method === 'GET') {
    const correlationId = url.searchParams.get('correlationId');
    json(response, 200, {
      calls: correlationId === null ? calls : controls.get(correlationId)?.calls ?? 0,
      authorizationMatched,
      lastPayload,
    });
    return;
  }
  if (url.pathname === '/test/stats' && request.method === 'DELETE') {
    calls = 0;
    authorizationMatched = false;
    lastPayload = null;
    for (const control of controls.values()) control.calls = 0;
    json(response, 200, { calls });
    return;
  }
  if (url.pathname === '/test/control' && request.method === 'PUT') {
    let body;
    try {
      body = await readJson(request);
    } catch {
      json(response, 400, { error: { message: 'Invalid request' } });
      return;
    }
    const allowedModes = new Set(['auth_failure', 'timeout', 'empty_output', 'success', 'json_response', 'invalid_json', 'refusal', 'incomplete', 'text_only']);
    if (typeof body?.correlationId !== 'string' || !allowedModes.has(body?.mode)) {
      json(response, 400, { error: { message: 'Invalid control' } });
      return;
    }
    controls.set(body.correlationId, {
      mode: body.mode,
      rawDetail: typeof body.rawDetail === 'string' ? body.rawDetail : '',
      sleepMs: typeof body.sleepMs === 'number' && body.sleepMs > 0 ? body.sleepMs : undefined,
      calls: 0,
    });
    json(response, 200, { status: 'configured' });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
    await handleCompletion(request, response);
    return;
  }
  json(response, 404, { error: { message: 'Not found' } });
}).listen(port, '0.0.0.0', () => {
  console.log(`fake provider listening on ${port}`);
});
