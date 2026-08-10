// Minimal timestamped logger for server-side diagnostics.
//
// supervisord appends stdout/stderr to plain files without adding
// timestamps, so raw console.log lines cannot be ordered across a
// crash/restart or correlated with other evidence (SQLite timestamps,
// Feishu event create_time). Every line from the critical paths goes
// through log()/err() so it carries a UTC ISO timestamp + scope.
//
// Format: [2026-08-10T05:10:15.123Z] [scope] message {"json":true}

function ts() {
  return new Date().toISOString();
}

export function log(scope, message, data) {
  const detail = data === undefined ? '' : ` ${JSON.stringify(data)}`;
  console.log(`[${ts()}] [${scope}] ${message}${detail}`);
}

export function err(scope, message, error) {
  const detail =
    error instanceof Error ? ` ${error.stack ?? error.message}` : ` ${String(error)}`;
  console.error(`[${ts()}] [${scope}] ERROR ${message}${detail}`);
}
