import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Mem0Config, DreamConfig } from '../types.ts';

const AGENT_ROOT = path.join(os.homedir(), '.pi', 'agent');
export const CONFIG_DIR = AGENT_ROOT;
const LEGACY_CONFIG_PATH = path.join(AGENT_ROOT, 'mem0-config.json');

/**
 * Self-hosted config search order (#212 D4):
 *   1. MEM0_CONFIG_PATH env (explicit override — used by tests/E2E)
 *   2. {agentDir}/mem0-config.json — the workflow backend writes this file
 *      before every run (agentDir is pi's session cwd; the extension reloads
 *      config on session_start with ctx.cwd)
 *   3. ~/.pi/agent/mem0-config.json (upstream path, kept for compatibility)
 *
 * The backend never relies on the process-wide MEM0_CONFIG_PATH env at
 * runtime (concurrent runs would race on a single env var) — it writes
 * per-agent config files under {agentDir} and the extension picks them up
 * via the agentDir search above.
 */
function resolveConfigPath(agentDir?: string): string | null {
  const envPath = process.env.MEM0_CONFIG_PATH;
  if (envPath) return envPath;
  if (agentDir) {
    const candidate = path.join(agentDir, 'mem0-config.json');
    if (fs.existsSync(candidate)) return candidate;
  }
  return fs.existsSync(LEGACY_CONFIG_PATH) ? LEGACY_CONFIG_PATH : null;
}

const DEFAULT_DREAM: DreamConfig = {
  enabled: false, // D9: MVP does not enable dream consolidation
  auto: false,
  minHours: 24,
  minSessions: 5,
  minMemories: 20,
};

const DEFAULT_CONFIG: Mem0Config = {
  selfHosted: true,
  host: '',
  apiKey: '',
  agentId: '',
  runId: '',
  userId: '',
  autoCapture: true,
  defaultScope: 'agent',
  contextInjection: true,
  searchThreshold: 0.3,
  dream: DEFAULT_DREAM,
};

export function loadConfig(agentDir?: string): Mem0Config {
  const configPath = resolveConfigPath(agentDir);
  let fileConfig: Partial<Mem0Config> = {};

  if (configPath) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(raw);
    } catch {
      // Corrupted config — use defaults
    }
  }

  const dream: DreamConfig = {
    ...DEFAULT_DREAM,
    ...(fileConfig.dream ?? {}),
  };

  const config: Mem0Config = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    dream,
  };

  if (process.env.MEM0_API_KEY) {
    config.apiKey = process.env.MEM0_API_KEY;
  }
  if (process.env.MEM0_HOST) {
    config.host = process.env.MEM0_HOST;
  }

  return config;
}
