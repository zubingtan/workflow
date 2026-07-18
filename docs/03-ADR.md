# Architectural decisions

1. **The JSON definition is the source of truth.** Visual state is a
   projection and JSON authoring is a first-class editing path.
2. **The schema is closed at four node types.** New behavior requires an
   explicit contract change rather than an ad-hoc node.
3. **Versions are immutable.** CRUD changes metadata; edits append a version;
   runs pin the selected version.
4. **Condition is a recursive data structure.** Nested `all`/`any` groups and
   ordered branches keep routing deterministic and serializable.
5. **Pi is behind an adapter.** It owns agent looping and provider calls;
   workflow scheduling, persistence, and status projection stay in the app.
6. **Agent, Skill, and MCP references are snapshots.** A run cannot drift when
   a resource receives a newer version.
7. **MCP is non-executing in this scope.** MCP metadata may be selected and
   displayed, but the Pi core receives no MCP tools.
8. **Runtime status is explicit.** Selected work executes; non-selected branch
   descendants are `skipped`; joins wait for all incoming dependencies.
9. **Quality is intentionally small.** One PR Gate runs typecheck, unit
   contracts, and one Playwright E2E on Compose with PostgreSQL, the Fake
   Provider, and Chromium; it protects the complete editor-to-run journey.
   The recorded screenshot review passed.
