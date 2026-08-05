# Structured Output Provider Capability Matrix

> Issue #251 — Provider capability conclusions come from endpoint behavior/docs,
> never from model-name guessing. Reproduce with
> [scripts/probe-structured-output-capability.mjs](../scripts/probe-structured-output-capability.mjs).

## How it is probed

Send a Chat Completions request carrying the exact payload shape the extension
injects (`response_format: {type:"json_schema", json_schema:{strict:true, schema}}`)
to the OpenWebUI gateway (`https://open-webui.corp.pony.ai/api/v1`, key from `.env`
`LLM_API_KEY`), and record the endpoint behavior. A `json_object`-only probe
distinguishes JSON-Mode-only endpoints.

```bash
LLM_API_KEY=$(grep '^LLM_API_KEY=' .env | cut -d= -f2) \
  node scripts/probe-structured-output-capability.mjs
```

## Result matrix (probed 2026-08-05)

| Model                                        |                      json_schema stream:false                       | json_schema stream:true |              json_object              | Conclusion                        |
| -------------------------------------------- | :-----------------------------------------------------------------: | :---------------------: | :-----------------------------------: | --------------------------------- |
| gpt-4o-mini                                  |                   ✗ 400 (gateway stream_options)                    |            ✓            |      ✗ 400 (same gateway limit)       | **supported** (stream path)       |
| gpt-5.5 / gpt-5.6-luna                       |                     ✗ 400 (same gateway limit)                      |            ✓            |      ✗ 400 (same gateway limit)       | **supported** (stream path)       |
| deepseek-v4-flash / pro                      |                                  ✓                                  |            —            |                   —                   | **supported**                     |
| qwen3.5-flash / 3.6-plus / 3.7-max / 3.8-max |                                  ✓                                  |            ✓            | 3.8-max ✗ 400 (Dashscope param error) | **supported**                     |
| claude-sonnet-5                              |                                  ✓                                  |            —            |                   —                   | **supported**                     |
| kimi-k3                                      |                                  ✓                                  |            —            |                   —                   | **supported**                     |
| glm-5.2                                      |                                  ✓                                  |            —            |                   —                   | **supported**                     |
| doubao-seed-2.0-lite                         | ✗ 400 `volcengine does not support parameters: ['response_format']` |            ✗            |                   ✗                   | **not supported** (strict reject) |

## Key conclusions

1. **This gateway (litellm proxy) has no JSON-Mode-only endpoint**: every probed
   OpenAI-compatible model either honors `json_schema` (Structured Outputs) or
   rejects even `json_object` (doubao). So the contract's (#238) "unsupported →
   capability error / provider error fail-fast" path covers every real shape;
   there is no "JSON Mode only" branch to special-case.
2. **GPT models (Azure gateway)**: with `stream:false` the gateway injects
   `stream_options` causing 400 (`The 'stream_options' parameter is only allowed
when 'stream' is enabled`); `stream:true` works. pi agents stream by default,
   so GPT models are usable in practice.
3. **Unsupported models (doubao etc.)**: after injecting `response_format` the
   endpoint 400-rejects; the error text contains `response_format` /
   `does not support parameters`. The error reaches the execution layer via the
   pi assistant message (`stopReason:"error"` + `errorMessage`) and is classified
   as `kind:"provider_error"` (see the provider-error branch in
   [server/agent-execution.mjs](../server/agent-execution.mjs)) — run fails, no
   retry, no downgrade, no consumable outputs.
4. **Real end-to-end validation** (dev server + OpenWebUI):
   - deepseek-v4-flash: `{"city":"Beijing","weather":"sunny","temperature":25}`
     all fields exact types (integer) pass validation; downstream `llm_main.city`
     reference succeeds.
   - qwen3.6-plus: same, succeeds.
   - qwen3.5-flash: returned JSON but omitted a required field → one correction
     still failed → `structured output validation failed: missing required field
"temperature"`, no half-baked outputs (contract correctly rejects).
   - doubao-seed-2.0-lite: 400 reject → `provider_error`, run failed.

## Mapping to code

- Injection: `server/structured-output.mjs` `createStructuredOutputExtension` →
  `response_format.json_schema` (openai-completions shape).
- Capability decision: `server/runtime-adapter.mjs` fails fast at session creation
  by `provider.api` shape (openai-completions / openai-responses); endpoint-level
  rejection is classified by the execution layer as provider_error.
- Strict validation: `server/structured-output.mjs` `validateStructuredOutput`
  (exact primitives, no extra fields, all required).
- E2E coverage: `e2e/structured-output.spec.ts` (fake-provider payload assertions
  - failure semantics); this matrix is the real-endpoint behavior evidence layer.
