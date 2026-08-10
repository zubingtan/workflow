/**
 * Global skill library — filesystem management for agent skills.
 *
 * Layout: each skill is a flat top-level directory under the skills dir
 * (DATA_DIR/skills/<name>/), containing at least SKILL.md plus optional
 * resource files. pi-coding-agent discovers a skill by SKILL.md presence and
 * uses `frontmatter.name || parentDirName` as the skill name — the manager
 * keeps directory name, frontmatter name, and UI display in sync.
 *
 * All functions are pure against (db, skillsDir) so the module is unit-testable
 * without a server. Write paths are atomic (tmp + rename) per the API contract
 * decision (wayfinder #309).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, resolve, relative, sep, dirname } from 'node:path';
import { nanoid } from 'nanoid';
import { listAgents } from './agent-catalog.mjs';

const MAX_NAME_LENGTH = 64;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // per-file guard for tree reads/writes

/** Domain error carrying an HTTP status for the route layer. */
export class SkillError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'SkillError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Validate a skill name per pi-coding-agent rules (dist/core/skills.js):
 * lowercase a-z, 0-9, hyphens only; ≤64 chars; no leading/trailing/consecutive
 * hyphens. Returns an error message or null when valid.
 */
export function validateSkillName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return 'name is required';
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `name exceeds ${MAX_NAME_LENGTH} characters`;
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    return 'name must be lowercase a-z, 0-9, hyphens only';
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    return 'name must not start or end with a hyphen';
  }
  if (name.includes('--')) {
    return 'name must not contain consecutive hyphens';
  }
  return null;
}

/**
 * Lightweight frontmatter parser — only the fields pi consumes:
 * `name` and `description` (single-line YAML values).
 * Returns { name, description } plus raw frontmatter boundaries for rewrites.
 */
export function parseSkillFrontmatter(content) {
  const lines = String(content).split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { name: undefined, description: undefined, hasFrontmatter: false, body: content };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return { name: undefined, description: undefined, hasFrontmatter: false, body: content };
  const raw = lines.slice(1, end).join('\n');
  const readField = (key) => {
    const match = raw.match(new RegExp(`^${key}\\s*:\\s*(.+?)\\s*$`, 'm'));
    if (!match) return undefined;
    const v = match[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    return v;
  };
  return {
    name: readField('name'),
    description: readField('description'),
    hasFrontmatter: true,
    body: content,
  };
}

/**
 * Rewrite `name` inside the frontmatter to `newName`. When the frontmatter has
 * no name field (pi falls back to the directory name), the content is returned
 * unchanged — directory rename alone keeps the two in sync.
 */
export function syncFrontmatterName(content, newName) {
  const lines = String(content).split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return content;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return content;
  const hasName = lines.slice(1, end).some((l) => /^name\s*:/.test(l));
  if (!hasName) return content;
  const out = [...lines];
  for (let i = 1; i < end; i++) {
    if (/^name\s*:/.test(out[i])) {
      out[i] = `name: ${newName}`;
      break;
    }
  }
  return out.join('\n');
}

function skillDir(skillsDir, name) {
  return join(skillsDir, name);
}

function ensureSkillsDir(skillsDir) {
  mkdirSync(skillsDir, { recursive: true });
}

/** Guard a relative path inside the tree: no traversal, no absolute paths. */
function assertSafePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || path.includes('\\')) {
    throw new SkillError(`invalid file path: ${path}`, 'invalid_path');
  }
  const segments = path.split('/');
  if (segments.some((s) => s === '..' || s === '.' || s === '')) {
    throw new SkillError(`invalid file path: ${path}`, 'invalid_path');
  }
}

function isTextContent(buf) {
  // Reject NUL bytes and invalid UTF-8 sequences — the pragmatic binary probe.
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** Recursively collect all files under dir as { path, content, encoding }. */
function collectFiles(dir, root, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(root, full).split(sep).join('/');
    if (entry.isDirectory()) {
      collectFiles(full, root, out);
    } else if (entry.isFile()) {
      const buf = readFileSync(full);
      if (buf.length > MAX_FILE_SIZE) {
        throw new SkillError(`file exceeds size limit: ${rel}`, 'file_too_large', 413);
      }
      if (isTextContent(buf)) {
        out.push({ path: rel, content: buf.toString('utf-8') });
      } else {
        out.push({ path: rel, content: buf.toString('base64'), encoding: 'base64' });
      }
    }
  }
}

/** List skills in the library: [{ name, description }] ordered by name. */
export function listSkills(skillsDir) {
  if (!existsSync(skillsDir)) return [];
  const out = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillMd = join(skillDir(skillsDir, entry.name), 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    const fm = parseSkillFrontmatter(readFileSync(skillMd, 'utf-8'));
    out.push({ name: entry.name, description: fm.description ?? '' });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Read a skill's full file tree: { name, files: [{ path, content, encoding? }] }. */
export function readSkillTree(skillsDir, name) {
  const dir = skillDir(skillsDir, name);
  if (!existsSync(dir)) {
    throw new SkillError(`skill not found: ${name}`, 'not_found', 404);
  }
  const files = [];
  collectFiles(dir, dir, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { name, files };
}

/**
 * Write a skill tree (upsert). `files` is the complete snapshot — files absent
 * from the payload are removed. Staging dir + rename keeps the write atomic:
 * a failure during staging leaves the previous tree untouched.
 */
export function writeSkillTree(skillsDir, name, files) {
  const nameError = validateSkillName(name);
  if (nameError) throw new SkillError(nameError, 'invalid_name');
  if (!Array.isArray(files)) throw new SkillError('files must be an array', 'invalid_files');
  const hasSkillMd = files.some((f) => f.path === 'SKILL.md');
  if (!hasSkillMd) {
    throw new SkillError('skill must contain SKILL.md', 'missing_skill_md');
  }
  for (const f of files) {
    assertSafePath(f.path);
    if (typeof f.content !== 'string') throw new SkillError(`invalid content for ${f.path}`, 'invalid_files');
    if (f.content.length > MAX_FILE_SIZE && f.encoding !== 'base64') {
      throw new SkillError(`file exceeds size limit: ${f.path}`, 'file_too_large', 413);
    }
  }

  ensureSkillsDir(skillsDir);
  const staging = join(skillsDir, `.${name}.tmp-${nanoid(6)}`);
  try {
    mkdirSync(staging, { recursive: true });
    for (const f of files) {
      const target = resolve(staging, f.path);
      if (!target.startsWith(resolve(staging) + sep)) {
        throw new SkillError(`invalid file path: ${f.path}`, 'invalid_path');
      }
      mkdirSync(dirname(target), { recursive: true });
      const buf = f.encoding === 'base64' ? Buffer.from(f.content, 'base64') : Buffer.from(f.content, 'utf-8');
      writeFileSync(target, buf);
    }
    const target = skillDir(skillsDir, name);
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
    renameSync(staging, target);
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  return { name };
}

/** Rename a skill: directory rename + frontmatter name sync. */
export function renameSkill(skillsDir, oldName, newName) {
  const nameError = validateSkillName(newName);
  if (nameError) throw new SkillError(nameError, 'invalid_name');
  if (oldName === newName) return { name: newName };
  const from = skillDir(skillsDir, oldName);
  const to = skillDir(skillsDir, newName);
  if (!existsSync(from)) throw new SkillError(`skill not found: ${oldName}`, 'not_found', 404);
  if (existsSync(to)) throw new SkillError(`skill already exists: ${newName}`, 'already_exists', 409);

  // Sync frontmatter name before the rename so the two never diverge.
  const skillMd = join(from, 'SKILL.md');
  if (existsSync(skillMd)) {
    const updated = syncFrontmatterName(readFileSync(skillMd, 'utf-8'), newName);
    const tmp = join(from, `.SKILL.md.tmp-${nanoid(6)}`);
    writeFileSync(tmp, updated);
    renameSync(tmp, skillMd);
  }
  renameSync(from, to);
  return { name: newName };
}

/** Delete a skill directory. Caller (route layer) checks references first. */
export function deleteSkillDir(skillsDir, name) {
  const dir = skillDir(skillsDir, name);
  if (!existsSync(dir)) throw new SkillError(`skill not found: ${name}`, 'not_found', 404);
  rmSync(dir, { recursive: true, force: true });
  return { name };
}

/**
 * Find agents whose pi_settings.skills references a skill name.
 * Returns [{ id, name }] — the agents blocking deletion.
 */
export function skillReferences(db, skillName) {
  const refs = [];
  for (const agent of listAgents(db)) {
    let config;
    try {
      config = JSON.parse(agent.config);
    } catch {
      continue;
    }
    const skills = config.pi_settings?.skills;
    if (Array.isArray(skills) && skills.includes(skillName)) {
      refs.push({ id: agent.id, name: agent.name });
    }
  }
  return refs;
}

/**
 * Resolve an agent's skill name list to absolute paths for pi-coding-agent.
 * - entries that already exist as paths pass through (legacy compat)
 * - names found in the library resolve to DATA_DIR/skills/<name>
 * - anything else is skipped and reported (skill will not load)
 * Returns { paths, skipped }.
 */
export function resolveSkillPaths(skillsDir, names) {
  const paths = [];
  const skipped = [];
  for (const entry of Array.isArray(names) ? names : []) {
    if (typeof entry !== 'string' || entry.length === 0) continue;
    if (existsSync(entry)) {
      paths.push(entry); // absolute path passthrough
      continue;
    }
    const candidate = join(skillsDir, entry);
    if (existsSync(candidate)) {
      paths.push(candidate);
    } else {
      skipped.push(entry);
    }
  }
  return { paths, skipped };
}
