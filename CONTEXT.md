# Workflow

Workflow lets users compose FlowGram workflows and run their LLM nodes through configured Agents.

## Language

**Agent**:
A persisted provider and model configuration that a Workflow LLM node can reference. Its credential is represented by an environment-variable name, never by the credential value.
_Avoid_: provider profile

**Agent Execution**:
One invocation of an Agent with a prompt, from start until a terminal outcome. It has ordered progress as well as a final outcome, rather than only a final text value.
_Avoid_: agent run, session

**Cancellation**:
A terminal Agent Execution outcome requested before normal completion. It is distinct from both a successful outcome and a failed outcome.
_Avoid_: stop, abort

**Execution Detail**:
An explicitly requested view of one Agent Execution's permitted structured tool activity, including inputs, results, and failures but never credential values. It is not the default presentation of an execution.
_Avoid_: debug workflow
