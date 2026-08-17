# ADR-0004: Base UI and Tailwind foundation

- Status: Accepted
- Date: 2026-08-10
- Supersedes: the new component-layer decisions in ADR-0002.

## Context

Issue #280 established the shared UI foundation for migrating the product
shell. The editor and its FlowGram engine remain operational while production
surfaces use a stable component and theme contract.

## Decision

- Use the standard shadcn CLI with the `base-nova` style and Base UI primitives.
- Keep generated components in `src/components/ui`, with `@/` resolving to
  `src` and shared `cn` composition in `src/lib/utils.ts`.
- Use Tailwind CSS v4 through Rsbuild's PostCSS hook and define new semantic
  variables (`--background`, `--foreground`, `--primary`, `--border`, and
  related names) in `src/theme/tokens.css`.
- Use Lucide for icons in migrated seams.
- Treat `html[data-theme]` and `html.dark` as the canonical new theme state.
  Continue synchronizing `body[theme-mode]` because FlowGram styles use that
  existing selector contract.
- Preserve the FlowGram engine, upstream CSS, workflow JSON, backend APIs, and
  execution semantics.

## Consequences

The new components can be adopted one surface at a time without changing
workflow data or editor behavior. The editor's `--app-*` aliases now resolve
from the canonical palette and no longer depend on a third-party UI package.
Standard CLI output is retained; the Button wrapper additionally uses
`forwardRef` because this repository is React 18 and Base UI trigger
composition requires a forwarded ref.
