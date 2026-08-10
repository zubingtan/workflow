// deploy/scripts/nginx-wiring.mjs — nginx conf.d wiring helpers.
//
// Turns a standalone nginx config (or a conf.d fragment) into conf.d-compatible
// content: http-context only (map blocks + server blocks), legacy listeners
// dropped, and a workflow-location include inserted into the target server
// block. Also detects server_name collisions against existing conf.d files.
//
// Usage (CLI):
//   node nginx-wiring.mjs <src-config> <dst-conf-d> <include-path> [--server-name <name>]
//   node nginx-wiring.mjs --check-conflicts <conf-d-dir> <incoming-file>
//
// Exported for tests (test/nginx-wiring.test.mjs).

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Find the span of a brace-delimited block starting at the first '{' after `from`. */
function blockSpan(text, from) {
  const depth = { d: 0, i: text.indexOf('{', from) };
  if (depth.i < 0) return null;
  for (; depth.i < text.length; depth.i++) {
    const ch = text[depth.i];
    if (ch === '{') depth.d += 1;
    else if (ch === '}') {
      depth.d -= 1;
      if (depth.d === 0) return { start: from, end: depth.i + 1 };
    }
  }
  return null;
}

/** Extract the body of a top-level `http { ... }` block if present, else the whole text. */
function httpBody(text) {
  const m = text.match(/^http\s*\{/m);
  if (!m) return text;
  const span = blockSpan(text, m.index + m[0].length - 1);
  return span ? text.slice(text.indexOf('{', m.index) + 1, span.end - 1) : text;
}

/** Split http-body text into top-level blocks (`server { ... }`, `map { ... }`, directives). */
function topLevelBlocks(body) {
  const blocks = [];
  const re = /^\s*(server|map|upstream|limit_req_zone|geo)\s+/gm;
  let last = 0;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) blocks.push({ type: 'directive', text: body.slice(last, m.index) });
    const span = blockSpan(body, m.index + m[0].length - 1);
    if (!span) break;
    // keep the keyword prefix: slice from the match start, not from the brace
    blocks.push({ type: m[1], text: body.slice(m.index, span.end) });
    last = span.end;
    re.lastIndex = span.end;
  }
  if (last < body.length) blocks.push({ type: 'directive', text: body.slice(last) });
  return blocks;
}

/** Parse `listen <port>[ params];` inside a server block. */
function listenPort(serverText) {
  const m = serverText.match(/listen\s+(\d+)/);
  return m ? m[1] : null;
}

/** Parse `server_name a b c;` inside a server block (may be absent → default server). */
function serverNames(serverText) {
  const m = serverText.match(/server_name\s+([^;]+);/);
  if (!m) return [];
  return m[1].trim().split(/\s+/).filter(Boolean);
}

function isDefaultServer(serverText) {
  return /listen\s+\d+\s+[^;]*default_server/.test(serverText);
}

/**
 * Extract map blocks and server blocks from a config; legacy listeners
 * (8888 etc.) are dropped. Returns `{ maps, servers }` (strings).
 */
export function extractServerBlocks(configText, { dropListeners = ['8888'] } = {}) {
  const body = httpBody(configText);
  const blocks = topLevelBlocks(body);
  const maps = blocks.filter((b) => b.type === 'map').map((b) => b.text.trim());
  const servers = blocks
    .filter((b) => b.type === 'server')
    .filter((b) => !dropListeners.includes(listenPort(b.text)))
    .map((b) => b.text.trim());
  return { maps, servers };
}

/**
 * Build conf.d-compatible content: maps + servers + workflow include.
 * `includePath` is inserted before the closing brace of the server block
 * matching `opts.serverName` (default: the first kept server block).
 * Idempotent: no-op include insertion when the path is already present.
 */
export function buildConfDContent(configText, includePath, { serverName } = {}) {
  const { maps, servers } = extractServerBlocks(configText);
  const out = [];
  out.push(...maps);
  if (out.length) out.push('');

  const includeLine = `    include ${includePath};`;
  let inserted = false;
  for (const server of servers) {
    let block = server;
    if (!inserted && !block.includes(`include ${includePath};`)) {
      const matches = serverName
        ? serverNames(block).includes(serverName)
        : out.filter((s) => s.startsWith('server')).length === 0; // first server block
      if (matches) {
        const closeAt = block.lastIndexOf('}');
        block = block.slice(0, closeAt) + includeLine + '\n' + block.slice(closeAt);
        inserted = true;
      }
    }
    out.push(block);
  }
  return out.join('\n') + '\n';
}

/**
 * Detect server_name collisions between `existingText` (current conf.d content)
 * and `incomingText` (the content about to be written). A collision is:
 * - same listen port + overlapping server_name, or
 * - incoming server collides with an existing `default_server` on the same port.
 */
export function findServerNameConflicts(existingText, incomingText) {
  const parse = (text) => {
    const body = httpBody(text);
    return topLevelBlocks(body)
      .filter((b) => b.type === 'server')
      .map((b) => ({
        listen: listenPort(b.text),
        names: serverNames(b.text),
        defaultServer: isDefaultServer(b.text),
      }));
  };
  const existing = parse(existingText);
  const incoming = parse(incomingText);
  const conflicts = [];
  for (const inc of incoming) {
    if (!inc.listen) continue;
    for (const ex of existing) {
      if (ex.listen !== inc.listen) continue;
      const overlap = inc.names.some((n) => ex.names.includes(n));
      if (overlap || ex.defaultServer || inc.defaultServer) {
        conflicts.push({
          listen: inc.listen,
          serverName: inc.names.join(' ') || '_',
          collidesWith: ex.names.join(' ') || '(default server)',
        });
      }
    }
  }
  return conflicts;
}

// --- CLI (only when run directly; tests import the helpers) ---
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const [cmd, a, b, ...rest] = process.argv.slice(2);
  const flag = (name) => rest[rest.indexOf(`--${name}`) + 1] ?? undefined;

  if (cmd === '--check-conflicts') {
    const dir = a;
    const incomingFile = b;
    const incomingBase = incomingFile.split('/').pop();
    const incomingText = readFileSync(incomingFile, 'utf8');
    // compare against every conf.d file EXCEPT the incoming one itself — by
    // path (same basename) OR by identical content (idempotent re-run of our
    // own wiring, not a conflict)
    const all = readdirSync(dir)
      .filter((f) => f.endsWith('.conf') && !f.endsWith('.disabled') && f !== incomingBase)
      .filter((f) => {
        try {
          return readFileSync(join(dir, f), 'utf8') !== incomingText;
        } catch {
          return true;
        }
      })
      .map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8') }));
    const conflicts = all.flatMap(({ file, text }) =>
      findServerNameConflicts(text, incomingText).map((conf) => ({ file, ...conf }))
    );
    if (conflicts.length) {
      for (const conf of conflicts) {
        console.error(
          `CONFLICT: ${conf.file} listens :${conf.listen} (${conf.collidesWith}) — ` +
            `incoming ${conf.serverName} would be ignored by nginx`
        );
      }
      process.exit(1);
    }
    console.log('no server_name conflicts');
  } else if (cmd) {
    const [src, dst, includePath] = [cmd, a, b];
    const serverName = flag('server-name');
    const srcText = readFileSync(src, 'utf8');
    const out = buildConfDContent(srcText, includePath, { serverName });
    writeFileSync(dst, out);
    console.log(`wrote ${dst} (${out.length} bytes)`);
  } else {
    console.error('usage: node nginx-wiring.mjs <src> <dst> <include-path> [--server-name <name>]');
    console.error('       node nginx-wiring.mjs --check-conflicts <conf.d> <incoming-file>');
    process.exit(2);
  }
}
