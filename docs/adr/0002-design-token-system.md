# ADR-0002: Design token system

Date: 2026-07-25
Status: Accepted
Supersedes: —
Referenced by: Issue #91 (Ticket A — token layer skeleton), Issue #90 (Spec — unified design language)

## Context

The workflow editor had no shared visual token layer. At least 4 different primary colors coexisted (FlowGram `#4d53e8`, Semi default blue, node-selection `#4e40e5`, testrun green `rgba(0,178,60,1)`); spacing/radius/font-size values were hardcoded and drifted across 29 files (165 raw hex occurrences, 83 stylelint-violating hardcoded values); and there was no dark mode despite the app being a long-session desktop workbench. Every new component reinvented its own color/spacing values because there was no shared layer to draw from, making the UI feel cobbled-together and future visual changes expensive.

Decision tickets #68–#74 and #79 (wayfinder map #67, all closed) produced a spec (#90) for a unified design-token layer with light/dark dual palettes. This ADR records the architectural decisions behind that token system.

## Decision

Land a shared design-token layer under `src/theme/` that owns all color/spacing/radius/font/shadow variables with light + dark dual palettes, wire it into the app entry ahead of the editor, add a FOUC-safe theme initialization script, and expose a `useTheme` hook for theme-state. Business components continue to use hardcoded values in Ticket A; they migrate to consume the tokens in Ticket B.

### Architecture: primitive + semantic two-layer model

Tokens are split into two layers, both owned by `src/theme/`:

1. **Primitives** — raw scales that carry no app meaning. Defined on `:root` so they cascade everywhere and never flip with theme. Includes spacing (4px base × 10 tiers), radius (4 tiers), font-size (5 tiers), font-weight (3 tiers), shadow (3 tiers), and the primary family hex values (locked by D4). The primary family lives on `:root` (not `body`) because it's raw hex that doesn't reference Semi variables; `body[theme-mode="dark"]` overrides win via higher specificity.
2. **Semantics** — app-meaningful wrappers that route through Semi's `--semi-color-*` variables for grayscale/status. Defined on `body` (see "Host selector" below). Dark overrides hang off `body[theme-mode="dark"]`. The primary family is NOT re-declared on `body` — `:root` cascades through automatically, and re-declaring would be a drift risk.

No component layer. Components consume semantic tokens directly (`var(--app-color-canvas)`, `var(--app-space-4)`, etc.). Adding a component layer would be premature — the spec only tokenizes 5 categories and explicitly defers z-index/line-height/letter-spacing.

### Namespace: `--app-*`

All app-owned tokens use the `--app-*` namespace. This coexists with Semi's `--semi-color-*` and FlowGram's `--g-*` / `--g-workflow-*` without collision. The namespace is enforced by code review + the `src/theme/` directory convention, NOT by a stylelint `custom-property-pattern` rule (that rule would false-positive on legitimate `--g-workflow-*` / `--semi-color-*` definitions in the bridge files).

### Host selector: `body`, not `:root`

Semantic color tokens are defined on `body`, NOT `:root`. This is critical (D6 pitfall 2): Semi defines `--semi-color-*` on `body`. CSS custom property cascade is parent → child, so `:root` cannot see `body` variables — defining `--app-color-canvas: var(--semi-color-bg-1)` on `:root` resolves to empty. Defining on `body` lets the wrapper reference Semi's body-mounted variables.

Primitives (spacing/radius/font/shadow) stay on `:root` because they don't reference Semi variables and don't flip with theme.

### Semi bridge strategy

Semi's primary family (8 tokens + focus) is overridden to the brand color (`#4d53e8` light / `#8a8cff` dark) in `semi-bridge.css`. The override selector is `:root body` (light) and `body[theme-mode="dark"]` (dark) — `:root body` guarantees cascade ordering over Semi's `body` defaults without `!important`. Pure CSS variable override path (no DSM, no `@semi-rspack-plugin`, no SCSS) — research #R2 confirmed this is stable and account-free.

### Dark mode: single source of truth

Dark mode uses Semi's native `body[theme-mode="dark"]` attribute. All dark overrides hang off this single selector. No separate `data-theme` attribute. The attribute is set by:

1. An inline synchronous `<script>` in `index.html` that runs BEFORE React mounts (FOUC prevention).
2. The `useTheme` hook / `theme-controller` for runtime toggles.

Priority: `localStorage['workflow-theme']` > `prefers-color-scheme` > default light. The `auto` mode follows `matchMedia('(prefers-color-scheme: dark)')` in real time via a subscription.

### FOUC prevention

A pure function `applyInitialTheme` in `src/theme/fouc.mjs` reads localStorage + matchMedia and sets `body[theme-mode]` before first paint. The inline `<script>` injected via rsbuild's `html.tags` config (in `rsbuild.config.ts`) is a hand-minified duplicate of this function — kept inline because it must execute before the bundle loads, and rsbuild strips inline scripts from the source `index.html` template. The pure function is extracted so it can be unit-tested under mocked globals (Layer 3). The duplication is a known trade-off: the inline script can't `import` the module (it runs before the bundle), and shipping the function in the bundle would defeat the FOUC purpose. The two implementations are kept in sync by the Layer 3 test, which asserts the resolution contract both implementations must satisfy.

### `useTheme` hook + React-free controller

Following the #54 pattern (`execute-agent-run.mjs` + `use-agent-execution.ts`), the theme state machine lives in `src/theme/theme-controller.mjs` — a React-free pure core that owns localStorage, matchMedia subscription, and body attribute application. The `useTheme` hook (`src/theme/use-theme.ts`) wraps it in React state. This makes the state machine node-testable without jsdom/RTL (Layer 2).

The controller accepts an optional `onChange` callback in its env. Every resolved-theme change (from `setThemeMode`, `toggleTheme`, or OS preference flip while in `auto` mode) routes through a single `notify()` point that invokes the callback. The hook passes a `rerender` function as `onChange`, so React re-renders pick up the mutation without the hook needing its own matchMedia listener (single subscription point — the controller owns the platform API).

### App entry wiring

`src/app.tsx` imports CSS in this exact order (enforced by Layer 1 test):

1. `@douyinfe/semi-ui/dist/css/semi.min.css` — Semi's prebuilt CSS (fixes the pre-existing bug where `--semi-color-*` resolved to empty because Semi CSS was never imported).
2. `./theme/semi-bridge.css` — overrides Semi primary family.
3. `./theme/tokens.css` — primitive + semantic tokens + body reset.
4. `./theme/theme-dark.css` — dark overrides for app-layer tokens.
5. `./theme/flowgram-bridge.css` — bridges FlowGram `--g-workflow-*` (port + line colors) to `--app-*` tokens so they auto-flip with theme.
6. `./styles/index.css` — existing project CSS (port/line colors, demo layout).
7. App code.

### Global resets

`tokens.css` sets `body { background-color: var(--app-color-canvas); color: var(--app-color-text-1); margin: 0; }`. This fixes two D6 pitfalls:

- Semi doesn't set a page background-color, so dark mode showed white patches behind transparent containers.
- The browser default `body { margin: 8px }` was never cleared and caused accidental page scroll (the immediate cause of issue #95's fix, now folded into the token layer).

## Consequences

- **One source of truth for visual decisions.** All color/spacing/radius/font/shadow values live in `src/theme/`. Future visual changes edit one file.
- **Working dark mode covering the whole app.** Sidebar + canvas + panels + node cards all flip via `body[theme-mode="dark"]`. No white flash on first paint (FOUC script).
- **Theme preference persisted.** `localStorage['workflow-theme']` stores `light` | `dark` | `auto` across sessions. `auto` follows OS preference in real time.
- **Semi components follow the brand automatically** via the `--semi-color-primary-*` override. No DSM account, no SCSS build chain.
- **FlowGram port/line colors follow the theme** via `--g-workflow-port-color-*` / `--g-workflow-line-color-*` bridges in `flowgram-bridge.css`. These were previously hardcoded hex values in `src/styles/index.css`; the bridge overrides them on `body` (higher specificity than the `:root` definitions) so they route through `--app-color-primary` and flip with theme.
- **Token definition files exempt from `color-no-hex`.** `src/theme/*.css` is where hex values are DEFINED — `stylelint.config.js` has an override that nulls `color-no-hex` for that directory. The namespace convention is enforced by review.
- **Business components migrated.** Ticket B (PR #100, commit 79e6a69 on main, 2026-07-26) migrated ~25 components from `--semi-color-*` to `--app-color-*` tokens (testrun, node-status-bar, base-node, comment, node-panel, add-node, sidebar, problem-panel, save, mouse-pad-selector, form-content/header/item, variable-panel, app.tsx inline styles). `pnpm lint:style` now reports 0 violations (down from 83). FlowGram `--g-editor-background` is also bridged to `--app-color-canvas` so the canvas root follows the theme; canvas grid dots are dimmed in dark mode via `body[theme-mode='dark'] .gedit-grid-svg circle { opacity: 0.3; }`.
- **Minimap canvasStyle follows theme via public API (PR #103, commit 24cde45).** `@flowgram.ai/minimap-plugin@1.0.12` renders the minimap via 2D canvas drawing — `canvasStyle` is a one-shot snapshot consumed only in `FlowMinimapService.init()` → `initStyle()`, with no runtime update CSS path. A first attempt (PR #99, closed/rejected) used `key={resolvedTheme}` on `<FreeLayoutEditorProvider>` to force remount, but this loses editor runtime state (undo/redo, scroll, selection) — unacceptable. The landed fix (PR #103) uses the `FlowMinimapService.init({ canvasStyle }) + render()` public API for runtime style updates — no remount, no state loss. The `<Minimap>` component calls `useTheme()` + `useClientContext().get(FlowMinimapService)` in a `useEffect`, and the `useTheme` controller was promoted to a module-scope singleton with multi-subscriber support so that `<Minimap>` (rendered inside `panel-manager-plugin`'s `layerProps.children`) sees `<App>`'s `toggleTheme()`.
- **z-index, line-height, letter-spacing NOT tokenized.** D4 defined no tokens for these; they remain per-component. A future ticket may add z-index layering semantics (base/content/overlay/modal/popover).
