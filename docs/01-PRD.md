# Product requirements

## Goal

Let a small team define, inspect, version, and safely test a compact workflow
without editing implementation code.

## User flow

1. Create or open a workflow.
2. Add or edit the four supported node types in the visual editor, or edit the
   canonical JSON directly.
3. Save a new immutable definition version.
4. Test with a prompt and inspect node status and Markdown output.

## Contract

Definitions use `workflow/v1alpha1`. `input.prompt` supplies the prompt;
`task.agent` invokes the Pi runtime through its adapter; `logic.condition`
selects one branch; `output.markdown` renders the selected upstream value.
Condition expressions support nested `all`/`any` groups and leaf clauses.

Agent nodes store immutable `agentVersionRef`, Skill version refs, MCP version
refs, and a provider binding reference. The editor snapshot is the boundary:
the run uses the selected versions even if newer resources are later created.

## Acceptance

- Invalid definitions are rejected with a field path.
- Saving preserves old versions and makes the new version addressable.
- JSON and visual editing describe the same definition.
- A condition selects the first matching branch; non-selected descendants are
  `skipped`.
- A join waits for all incoming dependencies and preserves mapped values.
- Pi receives Agent/Skill context; MCP definitions are not executed.
- The PR Gate is typecheck plus the fast contract suite, and one browser E2E
  covers the editor-to-run path.
