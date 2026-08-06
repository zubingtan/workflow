import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_PROVIDER_PORT ?? 4010);
const controls = new Map();
let calls = 0;
let authorizationMatched = false;
// Last received chat completion payload — lets tests assert the structured
// output injection (response_format.json_schema) without a network proxy.
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

function promptText(payload) {
  if (!Array.isArray(payload?.messages)) return '';
  return payload.messages
    .filter((message) => message?.role === 'user')
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

function matchingControl(payload) {
  const prompt = promptText(payload);
  for (const [correlationId, control] of controls) {
    if (prompt.includes(correlationId)) return control;
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
    // the node timeout (default 1000ms for backwards compat).
    const sleepMs =
      typeof control?.sleepMs === 'number' && control.sleepMs > 0 ? control.sleepMs : 1_000;
    setTimeout(() => {
      if (!response.destroyed) streamCompletion(response, control?.rawDetail);
    }, sleepMs);
    return;
  }
  if (mode === 'empty_output') {
    if (payload.stream === false) jsonCompletion(response, '   \n');
    else streamCompletion(response, '   \n');
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
    const allowedModes = new Set(['auth_failure', 'timeout', 'empty_output', 'success', 'json_response', 'invalid_json', 'refusal', 'incomplete']);
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
