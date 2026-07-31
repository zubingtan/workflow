/**
 * Mem0 backend integration (map #198 → spec #212, D2/D4/D15).
 *
 * Owns the three pi-agnostic pieces `createAgentSessionForAgent` needs to
 * wire the self-hosted mem0 extension into a pi agent session:
 *
 *   1. buildMem0Config  — the per-run config written before every run (D4)
 *   2. writeMem0Config  — {agentDir}/mem0-config.json on disk
 *   3. ensureMem0Extension — {agentDir}/extensions/pi-extension-mem0/ exists
 *      (symlink from the packaged dist; no-op when unavailable = graceful
 *      degradation, D10)
 *
 * This module is pure (no pi imports) so host-side tests can drive it with a
 * temp dir — same pattern as server/db-schema.mjs.
 */
import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Extension directory name under {agentDir}/extensions/ (D2/D15). */
export const MEM0_EXTENSION_NAME = "pi-extension-mem0";

/** Mem0 config file name inside agentDir (D4). */
export const MEM0_CONFIG_FILENAME = "mem0-config.json";

/**
 * Build the per-run mem0 config object (D4). `settingsProvider` is the thin
 * settings helper (server/settings.mjs surface) — mem0_host / mem0_api_key
 * come from the settings table (D12), configured in the settings UI.
 *
 * @param {object} opts
 * @param {string} opts.agentId — workflow Agent SQLite id (D3 isolation dim)
 * @param {string} opts.runId — workflow runID (nanoid(12), queue-assigned)
 * @param {object|null} [opts.settingsProvider]
 * @returns {object} config JSON written to {agentDir}/mem0-config.json
 */
export function buildMem0Config({ agentId, runId, settingsProvider = null }) {
  const host = settingsProvider?.getSetting?.("mem0_host") ?? "";
  const apiKey = settingsProvider?.getSetting?.("mem0_api_key") ?? "";
  return {
    selfHosted: true,
    host,
    apiKey,
    agentId,
    runId,
    autoCapture: true,
    contextInjection: true,
    searchThreshold: 0.3,
    dream: { enabled: false }, // D9: MVP does not enable dream consolidation
  };
}

/**
 * Write the per-run mem0 config to {agentDir}/mem0-config.json (D4).
 * The pi extension reloads it on session_start from the agent dir.
 * Writes unconditionally (even when host is empty) so a cleared setting
 * disables memory for the next run instead of reusing a stale config.
 * The file may contain an API key — restrict to owner rw (0600).
 */
export function writeMem0Config(agentDir, config) {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, MEM0_CONFIG_FILENAME), JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

/**
 * Resolve the packaged extension dist directory (D15):
 *   1. MEM0_EXTENSION_DIR env (explicit override — dev/E2E)
 *   2. /opt/pi-extension-mem0 (Docker image install path)
 *   3. <repo>/packages/pi-extension-mem0/dist (workspace dev)
 * Returns null when no dist is available — the extension simply isn't
 * installed, which degrades memory to off without breaking agent runs (D10).
 */
export function resolveMem0ExtensionSource() {
  const candidates = [
    process.env.MEM0_EXTENSION_DIR,
    "/opt/pi-extension-mem0",
    // Workspace layout: <repo>/packages/pi-extension-mem0/dist. Resolve
    // relative to this file (server/ → repo root).
    resolve(dirname(new URL(import.meta.url).pathname), "..", "packages", "pi-extension-mem0", "dist"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Ensure {agentDir}/extensions/pi-extension-mem0/ exists for pi's
 * DefaultResourceLoader file discovery (D2). Symlinks the packaged dist so
 * the fork keeps its own directory structure (D1) and future upgrades are a
 * dist swap. A broken symlink is replaced (self-healing); a healthy existing
 * target (file, symlink, or dir) is left untouched.
 *
 * @param {string} agentDir
 * @param {object} [opts]
 * @param {string|null} [opts.sourceDir] — override the packaged dist location
 * @returns {string|null} the extension path when installed, else null
 */
export function ensureMem0Extension(agentDir, { sourceDir = null } = {}) {
  const target = join(agentDir, "extensions", MEM0_EXTENSION_NAME);
  if (existsSync(target) || lstatSync(target, { throwIfNoEntry: false })) {
    const healthy =
      !lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink() ||
      (() => {
        try {
          realpathSync(target);
          return true;
        } catch {
          return false; // dangling symlink — needs replacing
        }
      })();
    if (healthy) return target;
    // Broken symlink: remove and re-create below (self-healing).
    try {
      rmSync(target, { recursive: true, force: true });
    } catch {
      return target; // cannot remove — leave as-is (degrade)
    }
  }
  const src = sourceDir ?? resolveMem0ExtensionSource();
  if (!src || !existsSync(src)) return null;
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(src, target, "dir");
  return target;
}
