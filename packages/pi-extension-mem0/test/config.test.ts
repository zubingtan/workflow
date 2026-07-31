/**
 * F1b (#212 D4): config loading for self-hosted mode.
 *
 * Search order:
 *   1. MEM0_CONFIG_PATH env (explicit override — used by tests/E2E)
 *   2. {agentDir}/mem0-config.json (the workflow backend writes this before
 *      every run; agentDir is pi's session cwd)
 *   3. ~/.pi/agent/mem0-config.json (upstream compatibility)
 *
 * Self-hosted defaults: selfHosted=true, defaultScope="agent",
 * dream disabled (D9 — MVP does not enable dream consolidation).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config/index.ts';

describe('loadConfig (self-hosted)', () => {
  const originalEnv = { ...process.env };
  const dir = mkdtempSync(join(tmpdir(), 'mem0-config-test-'));

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns self-hosted defaults when nothing is configured', () => {
    delete process.env.MEM0_CONFIG_PATH;
    const cfg = loadConfig(join(dir, 'empty'));
    expect(cfg.selfHosted).toBe(true);
    expect(cfg.defaultScope).toBe('agent');
    expect(cfg.autoCapture).toBe(true);
    expect(cfg.contextInjection).toBe(true);
    expect(cfg.searchThreshold).toBe(0.3);
    expect(cfg.dream.enabled).toBe(false);
    expect(cfg.host).toBe('');
    expect(cfg.apiKey).toBe('');
  });

  it('reads MEM0_CONFIG_PATH when set', () => {
    const p = join(dir, 'mem0-config.json');
    writeFileSync(
      p,
      JSON.stringify({
        selfHosted: true,
        host: 'http://mem0:8000',
        apiKey: 'admin-secret',
        agentId: 'agent-1',
        runId: 'run-xyz',
      })
    );
    process.env.MEM0_CONFIG_PATH = p;
    const cfg = loadConfig();
    expect(cfg.host).toBe('http://mem0:8000');
    expect(cfg.apiKey).toBe('admin-secret');
    expect(cfg.agentId).toBe('agent-1');
    expect(cfg.runId).toBe('run-xyz');
  });

  it('reads {agentDir}/mem0-config.json when no env path is set', () => {
    delete process.env.MEM0_CONFIG_PATH;
    const agentDir = join(dir, 'agent-a');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'mem0-config.json'),
      JSON.stringify({
        host: 'http://localhost:8890',
        apiKey: 'local-key',
        agentId: 'agent-b',
        runId: 'run-2',
      })
    );
    const cfg = loadConfig(agentDir);
    expect(cfg.host).toBe('http://localhost:8890');
    expect(cfg.apiKey).toBe('local-key');
    expect(cfg.agentId).toBe('agent-b');
    expect(cfg.runId).toBe('run-2');
  });

  it('falls back to defaults on a corrupted config file', () => {
    delete process.env.MEM0_CONFIG_PATH;
    const agentDir = join(dir, 'corrupt-agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'mem0-config.json'), '{not json');
    const cfg = loadConfig(agentDir);
    expect(cfg.host).toBe('');
    expect(cfg.selfHosted).toBe(true);
  });

  it('keeps dream disabled unless explicitly enabled (D9)', () => {
    delete process.env.MEM0_CONFIG_PATH;
    const agentDir = join(dir, 'dream-agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'mem0-config.json'),
      JSON.stringify({ dream: { enabled: true, auto: false } })
    );
    const cfg = loadConfig(agentDir);
    expect(cfg.dream.enabled).toBe(true);
    expect(cfg.dream.auto).toBe(false);
  });
});
