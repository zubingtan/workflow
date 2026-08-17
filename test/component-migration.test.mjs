import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/**
 * Layer 5 — inline-style migration guard.
 *
 * stylelint (Layer 4) only lints .less / .module.less / styles.tsx. Inline
 * `style={{...}}` JSX attributes are NOT linted (D5 decision 3 — relies on
 * review). This test guards the migrated inline styles against regressions
 * by asserting no hardcoded hex/rgb/rgba colors remain in the files that
 * Ticket B explicitly migrated to `--app-*` tokens.
 *
 * If a future edit re-introduces `background: '#fff'` etc. in these files,
 * this test fails before the regression ships.
 */

const MIGRATED_INLINE_FILES = [
  // problem-panel: per spec AC — migrated from rgb(251,251,251) / #999 / rgba(82,100,154,0.13)
  'src/components/problem-panel/problem-panel.tsx',
  // app.tsx sidebar + editor header: migrated to app semantic tokens
  'src/app.tsx',
  // sidebar-node-renderer: migrated from rgb(251,251,251) / rgba(82,100,154,0.13)
  'src/components/sidebar/sidebar-node-renderer.tsx',
  // comment container: migrated from #FF811A / #F2B600 / #FFF3EA / #FFFBED / rgb(159 159 158 / 65%)
  'src/components/comment/components/container.tsx',
  // save button: migrated from rgba(171,181,255,0.3) / rgba(255,179,171,0.3)
  'src/components/tools/save.tsx',
  // add-node button: migrated from rgba(171,181,255,0.3)
  'src/components/add-node/index.tsx',
  // form-item required asterisk: migrated from #f93920
  'src/form-components/form-item/index.tsx',
];

// Match literal hex (#fff, #ffffff, #1f1f2e) or rgb()/rgba() color values,
// but NOT `var(--app-color-*)` references.
const HARDCODED_COLOR_RE = /(['"`])(#(?:[0-9a-fA-F]{3,4}){1,2}|rgba?\(\s*\d)/;

test('Layer 5: migrated inline-style files contain no hardcoded hex/rgb/rgba colors', () => {
  for (const rel of MIGRATED_INLINE_FILES) {
    const full = path.join(ROOT, rel);
    assert.ok(fs.existsSync(full), `missing file: ${rel}`);
    const src = fs.readFileSync(full, 'utf8');
    // Strip line comments and block comments so commented-out examples
    // don't trip the check.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(
      stripped,
      HARDCODED_COLOR_RE,
      `${rel} still contains a hardcoded hex/rgb/rgba color in an inline style — migrate to var(--app-color-*)`
    );
  }
});

test('Layer 5: migrated inline-style files reference --app-* tokens', () => {
  for (const rel of MIGRATED_INLINE_FILES) {
    const full = path.join(ROOT, rel);
    const src = fs.readFileSync(full, 'utf8');
    assert.match(
      src,
      /var\(--app-(color|space|radius|font|shadow)-/,
      `${rel} should reference at least one --app-* token after migration`
    );
  }
});

/**
 * Layer 4 complement — verify the styled-components / .less files that were
 * migrated don't reintroduce hardcoded colors. stylelint already enforces
 * this at commit time, but a unit test gives a faster, more localised
 * failure message. The list below is the migration scope from Ticket B
 * (issue #92) — the same 13 files that had 83 stylelint violations.
 */
const MIGRATED_STYLE_FILES = [
  'src/components/base-node/styles.tsx',
  'src/form-components/form-header/styles.tsx',
  'src/form-components/form-content/styles.tsx',
  'src/components/tools/styles.tsx',
  'src/components/testrun/testrun-form/index.module.less',
  'src/components/testrun/testrun-json-input/index.module.less',
  'src/components/testrun/testrun-panel/index.module.less',
  'src/components/testrun/node-status-bar/group/index.module.less',
  'src/components/testrun/node-status-bar/header/index.module.less',
  'src/components/testrun/node-status-bar/render/index.module.less',
  'src/components/testrun/node-status-bar/viewer/index.module.less',
];

test('Layer 4: migrated style files exist on disk', () => {
  for (const rel of MIGRATED_STYLE_FILES) {
    const full = path.join(ROOT, rel);
    assert.ok(fs.existsSync(full), `missing migrated style file: ${rel}`);
  }
});

test('Layer 4: migrated style files use app tokens (not raw hex in declarations)', () => {
  // For each migrated file, parse declarations and assert no bare hex/rgb
  // values appear OUTSIDE of stylelint-disable-next-line allowances.
  // This is a coarse guard — stylelint is the authoritative gate.
  for (const rel of MIGRATED_STYLE_FILES) {
    const full = path.join(ROOT, rel);
    const src = fs.readFileSync(full, 'utf8');
    // For each line, check it doesn't contain a raw hex literal UNLESS the
    // previous line is a `stylelint-disable-next-line color-no-hex` comment
    // (which is the legitimate escape hatch for syntax-highlight colors etc.).
    // NOTE: do NOT strip block comments before scanning — the disable
    // comments themselves ARE block comments and must be visible to the
    // previous-line check.
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prev = i > 0 ? lines[i - 1] : '';
      const hasDisable = /stylelint-disable-next-line color-no-hex/.test(prev);
      if (hasDisable) continue;
      // Bare hex value (e.g. `#fff`, `#1f1f2e`) — but NOT inside var(--...).
      // Strip var(...) references first, then look for hex.
      const withoutVars = line.replace(/var\(--[^)]+\)/g, '');
      assert.doesNotMatch(
        withoutVars,
        /#(?:[0-9a-fA-F]{3,4}){1,2}\b/,
        `${rel}:${i + 1} contains a hardcoded hex color outside a var() reference — use var(--app-color-*) or add a stylelint-disable-next-line comment`
      );
    }
  }
});
