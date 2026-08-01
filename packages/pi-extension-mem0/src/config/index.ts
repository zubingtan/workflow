import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DreamConfig, Mem0ExtensionConfig } from '../types.js';

const DEFAULT_DREAM: DreamConfig = {
  enabled: false,
  auto: false,
  minHours: 24,
  minSessions: 5,
  minMemories: 20,
};

const DEFAULT_CONFIG: Mem0ExtensionConfig = {
  host: 'http://localhost:8019',
  apiKey: '',
  agentId: '',
  autoCapture: true,
  defaultScope: 'agent',
  contextInjection: true,
  searchThreshold: 0.3,
  dream: DEFAULT_DREAM,
};

/**
 * Resolve the config file path.
 *
 * Priority:
 * 1. MEM0_CONFIG_PATH environment variable (explicit absolute path)
 * 2. ../../mem0-config.json relative to this module (i.e. {agentDir}/mem0-config.json
 *    when the extension lives at {agentDir}/extensions/pi-extension-mem0/)
 */
export function resolveConfigPath(): string | null {
  if (process.env.MEM0_CONFIG_PATH) {
    return process.env.MEM0_CONFIG_PATH;
  }
  try {
    const moduleDir = path.dirname(new URL(import.meta.url).pathname);
    const candidate = path.resolve(moduleDir, '..', '..', 'mem0-config.json');
    if (fs.existsSync(candidate)) return candidate;
  } catch {
    // fall through
  }
  return null;
}

export function loadConfig(): Mem0ExtensionConfig {
  let fileConfig: Partial<Mem0ExtensionConfig> = {};

  const configPath = resolveConfigPath();
  if (configPath && fs.existsSync(configPath)) {
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

  const config: Mem0ExtensionConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    dream,
  };

  // Environment variable overrides
  if (process.env.MEM0_API_KEY) config.apiKey = process.env.MEM0_API_KEY;
  if (process.env.MEM0_HOST) config.host = process.env.MEM0_HOST;
  if (process.env.MEM0_AGENT_ID) config.agentId = process.env.MEM0_AGENT_ID;

  return config;
}
