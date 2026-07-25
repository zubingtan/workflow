/**
 * Stylelint configuration — design token enforcement (D8 / issue #79).
 *
 * Enforces the 3 lintable constraint categories from D5 (#73):
 *   1. Token consumption — forbid hardcoded hex colors (use var(--app-*) / Semi tokens)
 *   2. !important        — forbid by default; allow via line-level disable comment
 *   3. z-index scale     — see note below; NOT enforced here (D4 defined no z-index tokens)
 *
 * Coverage (D5 decision 3): .less / .module.less (native) + styles.tsx (styled-components
 * via postcss-styled-syntax). Inline style={{...}} is NOT linted (D5 — relies on review).
 *
 * Existing code is expected to produce a controlled violation list; this config is the
 * gate for NEW and MIGRATED code. Run `pnpm lint:style` to see current violations.
 *
 * Deviations from the #79 spec (resolved during implementation — task ticket, AFK):
 *
 *  - Processor: spec said stylelint-processor-styled-components. That processor used the
 *    `processors` config array, which stylelint REMOVED in v14. Modern equivalent is
 *    `customSyntax: 'postcss-styled-syntax'` (same maintainers' ecosystem, same goal).
 *    Registered below via overrides for .tsx.
 *
 *  - !important exemption: spec proposed a `stylelint-allow: important` custom comment.
 *    stylelint's built-in `stylelint-disable-next-line declaration-no-important` comment
 *    achieves the same per-line exemption without a custom plugin — used here.
 *
 *  - z-index: spec proposed `declaration-property-value-allowed-list` limited to
 *    `--app-z-*` tokens. D4 (#72) defined NO z-index tokens (only space/radius/font/
 *    shadow/color). Constraining to non-existent tokens would block all existing code
 *    with no migration path. z-index tokenization is a separate design decision and is
 *    NOT enforced by this config. Recommendation logged for a future ticket.
 *
 *  - custom-property-pattern (--app-* prefix): spec marked this "optional, new vars only".
 *    stylelint's `custom-property-pattern` applies to ALL custom property definitions in
 *    linted files, including legitimate non-app vars (--g-workflow-*, --semi-color-*).
 *    Enforcing `^--app-` would false-positive on FlowGram/Semi bridges. NOT enabled.
 *    Token namespace is enforced by code review + the src/theme/ directory convention.
 *
 *  - pnpm lint merge: `lint:style` is a SEPARATE script, NOT merged into `pnpm lint`.
 *    Rationale: eslint runs on ./src with --cache and is fast; stylelint scans 3 file
 *    types including .tsx (styled-components parsing is slower). Keeping them separate
 *    avoids slowing down the pre-commit `lint-staged` eslint pass. CI should run both.
 *    lint-staged is updated to run stylelint on staged style files.
 */
/** @type {import('stylelint').Config} */
module.exports = {
  extends: ['stylelint-config-recommended'],

  rules: {
    // === Category 1: token consumption — no hardcoded hex colors ===
    // Catches #fff, #4d53e8, #4e40e5, etc. Use var(--app-color-*) or Semi --semi-color-*.
    'color-no-hex': true,

    // === Category 2: !important — forbidden by default ===
    // Per-line exemption: `/* stylelint-disable-next-line declaration-no-important */`
    // (used where overriding Semi's own !important is unavoidable, e.g. testrun buttons).
    'declaration-no-important': true,

    // CSS Modules :global(...) is valid in .module.less — allow it.
    'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global', 'local'] }],
  },

  overrides: [
    {
      // .less / .module.less — parse with postcss-less so `//` line comments and
      // Less nesting/variables don't trip CssSyntaxError.
      files: ['**/*.less'],
      customSyntax: 'postcss-less',
    },
    {
      // styled-components template literals in .tsx — parse with postcss-styled-syntax.
      // Covers src/components/**/styles.tsx + src/form-components/**/styles.tsx +
      // src/nodes/**/styles.tsx (D5 decision 3). Other .tsx files without styled-components
      // imports are safe to pass through this syntax (it no-ops on non-tagged templates).
      files: ['**/styles.tsx', '**/*.styles.tsx'],
      customSyntax: 'postcss-styled-syntax',
    },
    {
      // src/theme/*.css — token DEFINITION files. The whole point of this
      // directory is to own the hex values that other files consume via
      // var(--app-*). `color-no-hex` would defeat the purpose here. The
      // namespace convention (--app-*) is enforced by code review, per the
      // stylelint config comment above. Semi bridge tokens (--semi-color-*)
      // are also defined here as hex overrides.
      files: ['src/theme/*.css'],
      rules: {
        'color-no-hex': null,
      },
    },
  ],
};
