# ADR-0004: Base UI and Tailwind foundation

- Status: Accepted
- Date: 2026-08-10
- Supersedes: the new component-layer decisions in ADR-0002; the legacy token bridge remains during migration.

## Context

Issue #280 establishes the shared UI foundation for the incremental migration
from the existing Semi-based shell. The editor and its FlowGram engine must
remain operational while new production surfaces gain a stable component and
theme contract.

## Decision

- Use the standard shadcn CLI with the `base-nova` style and Base UI primitives.
- Keep generated components in `src/components/ui`, with `@/` resolving to
  `src` and shared `cn` composition in `src/lib/utils.ts`.
- Use Tailwind CSS v4 through Rsbuild's PostCSS hook and define new semantic
  variables (`--background`, `--foreground`, `--primary`, `--border`, and
  related names) in `src/theme/tokens.css`.
- Use Lucide for icons in migrated seams.
- Treat `html[data-theme]` and `html.dark` as the canonical new theme state.
  Continue synchronizing `body[theme-mode]` so unmigrated pages and FlowGram
  styles keep working until the compatibility layer is removed by #289.
- Preserve the FlowGram engine, upstream CSS, workflow JSON, backend APIs, and
  execution semantics. This ticket does not migrate complete product pages or
  remove the existing Semi bridge.

## Consequences

The new components can be adopted one surface at a time without changing
workflow data or editor behavior. The existing `--app-*` and `--semi-*`
variables remain compatibility infrastructure rather than the API for new
components. Standard CLI output is retained; the Button wrapper additionally
uses `forwardRef` because this repository is React 18 and Base UI trigger
composition requires a forwarded ref.
