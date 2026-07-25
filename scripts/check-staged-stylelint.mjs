#!/usr/bin/env node
/**
 * Pre-commit stylelint gate that only fails on violations in NEWLY staged lines.
 *
 * Why this exists:
 *   stylelint.config.js (D8 / issue #79) enforces `color-no-hex` and
 *   `declaration-no-important`. The project has 83 pre-existing violations
 *   (the D6 migration backlog). lint-staged's default `stylelint --fix` runs
 *   against the WHOLE file, so those pre-existing violations block every
 *   commit that touches a .css/.less file — even when the new lines are clean.
 *
 *   The D8 config comment states: "this config is the gate for NEW and
 *   MIGRATED code". This script implements that intent: run stylelint on each
 *   staged file, then filter violations to those whose `line` falls inside a
 *   staged-added hunk. Pre-existing violations are reported as warnings but
 *   do not block the commit.
 *
 * Usage (from lint-staged.config.js):
 *   node scripts/check-staged-stylelint.mjs <file1> <file2> ...
 *
 * Exit codes:
 *   0 — no new violations (commit proceeds)
 *   1 — one or more new violations in staged lines (commit blocked)
 */

import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { argv, cwd, exit } from 'node:process';

import stylelint from 'stylelint';

const files = argv.slice(2);
if (files.length === 0) {
  exit(0);
}

/**
 * Get the added-line ranges for a staged file.
 * @param {string} file - absolute or repo-relative path
 * @returns {Array<[number, number]>} array of [startLine, endLine] (inclusive)
 */
function getStagedAddedRanges(file) {
  // -U0: no context lines, so every +line in the diff is a staged addition.
  // --diff-filter=AM: only added/modified files.
  const diff = execSync(
    `git diff --cached -U0 --diff-filter=AM --no-color -- ${JSON.stringify(file)}`,
    { encoding: 'utf8', cwd: cwd() }
  );
  const ranges = [];
  // Hunk header format: @@ -lOld,sOld +lNew,sNew @@
  for (const line of diff.split('\n')) {
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count === 0) continue;
    ranges.push([start, start + count - 1]);
  }
  return ranges;
}

/**
 * @param {[number, number]} range
 * @param {number} line
 */
function inRange(range, line) {
  return line >= range[0] && line <= range[1];
}

let hasNewViolations = false;

for (const file of files) {
  const absPath = resolve(cwd(), file);
  let ranges;
  try {
    ranges = getStagedAddedRanges(file);
  } catch (err) {
    console.error(`[stylelint-diff] git diff failed for ${file}:`, err.message);
    exit(1);
  }
  if (ranges.length === 0) continue; // no added lines → skip

  let result;
  try {
    result = await stylelint.lint({
      files: [absPath],
      configFile: resolve(cwd(), 'stylelint.config.js'),
    });
  } catch (err) {
    // stylelint.lint rejects on config/syntax errors — these SHOULD block.
    console.error(`[stylelint-diff] stylelint failed on ${file}:`, err.message);
    exit(1);
  }

  if (result.errored) {
    for (const r of result.results) {
      const filePath = r.source;
      for (const w of r.warnings) {
        const isNew = ranges.some((range) => inRange(range, w.line));
        const label = isNew ? 'NEW' : 'pre-existing';
        const prefix = isNew ? '✖' : '·';
        console.error(`${prefix} ${filePath}:${w.line}:${w.column}  ${w.text}  [${label}]`);
        if (isNew) hasNewViolations = true;
      }
    }
  }
}

if (hasNewViolations) {
  console.error(
    '\n[stylelint-diff] New stylelint violations found in staged lines. ' +
      'Fix them or use `/* stylelint-disable-next-line <rule> */` if intentional.'
  );
  exit(1);
}
console.log('[stylelint-diff] No new stylelint violations in staged lines.');
exit(0);
