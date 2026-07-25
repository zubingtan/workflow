/**
 * lint-staged configuration.
 *
 * Why a JS config (instead of the package.json "lint-staged" field):
 *   The stylelint entry needs a function form to invoke
 *   scripts/check-staged-stylelint.mjs, which only fails on violations in
 *   NEWLY staged lines (D8 / issue #79 intent: "gate for NEW and MIGRATED
 *   code"). The default `stylelint --fix` command lints the whole file and
 *   trips on the 83 pre-existing violations in the D6 migration backlog,
 *   blocking every commit that touches a .css/.less file.
 *
 *   Other entries mirror the previous package.json config unchanged.
 *
 * NOTE: package.json's "lint-staged" field is intentionally removed to avoid
 * ambiguity (lint-staged prefers lint-staged.config.js when both exist, but
 * keeping them in sync is error-prone).
 */
module.exports = {
  'src/**/*.{ts,tsx,js,jsx}': 'eslint --fix',
  'src/**/*.{less,css}': (files) => `node scripts/check-staged-stylelint.mjs ${files.join(' ')}`,
  'src/**/styles.tsx': 'stylelint',
  '*.{ts,tsx,js,jsx,json,less,css,md,yml,yaml}': 'prettier --write',
};
