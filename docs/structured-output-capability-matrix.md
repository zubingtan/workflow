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

## Result matrix (probed 2026-08-05; tool-route columns 2026-08-11, G4 series)

| Model                                        |                      json_schema stream:false                       | json_schema stream:true |              json_object              | tools + response_format (共存) | tools-only StructuredOutput 工具路线 | Conclusion                                       |
| -------------------------------------------- | :-----------------------------------------------------------------: | :---------------------: | :-----------------------------------: | :----------------------------: | :----------------------------------: | ------------------------------------------------ |
| gpt-4o-mini                                  |                   ✗ 400 (gateway stream_options)                    |            ✓            |      ✗ 400 (same gateway limit)       |               —                |                  —                   | **supported** (stream path)                      |
| gpt-5.5 / gpt-5.6-luna                       |                     ✗ 400 (same gateway limit)                      |            ✓            |      ✗ 400 (same gateway limit)       |      ✓ **共存** (G2 3/3)       |            ✓ (E5-E7 3/3)             | **supported** (stream path)                      |
| deepseek-v4-flash / pro                      |                                  ✓                                  |            —            |                   —                   |     ✗ **互斥** (K2/K3 3/3)     |            ✓ (E1-E3 3/3)             | **supported — 必须走工具路线**                   |
| qwen3.5-flash / 3.6-plus / 3.7-max / 3.8-max |                                  ✓                                  |            ✓            | 3.8-max ✗ 400 (Dashscope param error) |               —                |           ✓ (G4 2/2 each)            | **supported**                                    |
| claude-sonnet-5                              |                                  ✓                                  |            —            |                   —                   |               —                |              ✓ (G4 2/2)              | **supported**                                    |
| kimi-k3                                      |                                  ✓                                  |            —            |                   —                   |               —                |              ✓ (G4 2/2)              | **supported**                                    |
| glm-5.2                                      |                                  ✓                                  |            —            |                   —                   |               —                |              ✓ (G4 2/2)              | **supported**                                    |
| doubao-seed-2.0-lite                         | ✗ 400 `volcengine does not support parameters: ['response_format']` |            ✗            |                   ✗                   |               —                |              ✓ (G4 2/2)              | **response_format: not supported; 工具路线可用** |

## Key conclusions

0. **Tool-route columns (2026-08-11, G4 series)** — `tools-only` = the
   StructuredOutput tool route (#320): no `response_format`, the model's answer
   is a toolCall validated by a customTool with a capped retry loop. **Every
   probed model succeeds** (8 model families, 20/20 rounds, zero failures),
   including doubao which strict-rejects `response_format` — the tool route is
   the universal mechanism and the sole route for DashScope models (deepseek /
   qwen), whose `response_format × tools` combination is mutually exclusive
   (K2/K3, both API shapes). `tool_choice:"required"` 400s on DashScope models
   (thinking mode); claude/kimi/glm/doubao/gpt accept it (G4-3).
1. **This gateway (litellm proxy) has no JSON-Mode-only endpoint**: every probed
   OpenAI-compatible model either honors `json_schema` (Structured Outputs) or
   rejects even `json_object` (doubao). So the contract's (#238) "unsupported →
   capability error / provider error fail-fast" path covers every real shape;
   there is no "JSON Mode only" branch to special-case. (Since #320 the
   contract rides the tool route, so the json_schema columns document the
   mechanism that was replaced.)
2. **GPT models (Azure gateway)**: with `stream:false` the gateway injects
   `stream_options` causing 400 (`The 'stream_options' parameter is only allowed
when 'stream' is enabled`); `stream:true` works. pi agents stream by default,
   so GPT models are usable in practice. gpt-5.6-luna also keeps tool calls
   WITH `response_format` on completions (G2, 3/3) — the exclusivity is a
   DashScope family trait, not an Azure one.
3. **Responses API endpoint is absent on this gateway** (E8, 2026-08-11):
   `/openai/responses` and `/responses` both 405 — `provider.api:
"openai-responses"` is NOT usable in production here; completions is the
   only real shape (the store-compat extension remains for other gateways).
4. **Unsupported models (doubao, response_format route only)**: after injecting
   `response_format` the endpoint 400-rejects; the error text contains
   `response_format` / `does not support parameters`. The error reaches the
   execution layer via the pi assistant message (`stopReason:"error"` +
   `errorMessage`) and is classified as `kind:"provider_error"` — run fails, no
   retry, no downgrade, no consumable outputs. On the tool route doubao works
   (G4, 2/2).
5. **Real end-to-end validation** (dev server + OpenWebUI):
   - deepseek-v4-flash: `{"city":"Beijing","weather":"sunny","temperature":25}`
     all fields exact types (integer) pass validation; downstream `llm_main.city`
     reference succeeds.
   - qwen3.6-plus: same, succeeds.
   - qwen3.5-flash: returned JSON but omitted a required field → one correction
     still failed → `structured output validation failed: missing required field
"temperature"`, no half-baked outputs (contract correctly rejects).
   - doubao-seed-2.0-lite: 400 reject (response_format route) → `provider_error`,
     run failed; tool route succeeds (G4).

## Mapping to code

- Tool registration: `server/structured-output.mjs` `createStructuredOutputTool`
  (customTool: loose parameters for pi's uncapped pre-validation, strict
  validation + capped retry in execute) + `createStructuredOutputPayloadExtension`
  (restores the strict compiled schema on the wire).
- Capability decision: `server/runtime-adapter.mjs` fails fast at session creation
  by `provider.api` shape (openai-completions / openai-responses); endpoint-level
  rejection is classified by the execution layer as provider_error.
- Strict validation: `server/structured-output.mjs` `validateStructuredOutput`
  (exact primitives, no extra fields, all required) — in the tool's execute and
  again defensively in the execution layer.
- E2E coverage: `e2e/structured-output.spec.ts` (fake-provider payload assertions
  - tools + no response_format, retry-cap failure semantics); this matrix is the
    real-endpoint behavior evidence layer.
