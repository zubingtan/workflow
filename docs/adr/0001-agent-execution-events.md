# Agent Execution produces ordered events

Agent Execution is a local module that receives a resolved stored Agent or a transient configuration with a prompt. Its caller performs stored-Agent lookup; Agent Execution resolves the named environment variable at call time and produces ordered generic events with one terminal outcome: success, failure, or Cancellation. Failure retains any content already produced.

The SSE adapter and FlowGram task adapter consume that shared event sequence. Default presentation exposes text and tool lifecycle status only; Execution Detail is explicit, may show permitted structured tool detail, and never includes credential or environment-variable values. This decision does not add a Debug interface or durable execution history.

FlowGram task Cancellation reaches Agent Execution through a pinned `@flowgram.ai/runtime-js@1.0.12` patch. The patch creates one abort signal per workflow task, aborts it before marking the task cancelled, shares it with subcontexts, and supplies it to every node executor; the LLM executor relays that signal to its Pi session.

Deterministic tests use an in-memory fake Agent session through the Agent Execution interface. Real providers remain outside the default test suite; the adapters receive narrow contract checks.
