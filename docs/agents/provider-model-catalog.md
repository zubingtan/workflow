# Provider 模型列表与模型能力元数据调研

> 调研日期：2026-08-05
> 范围：OpenAI-compatible `GET /v1/models`、常见 Provider/网关的模型目录、pi-coding-agent 0.81.0 / pi-ai 0.81.0，以及本项目当前的 Provider 配置实现。
> 目的：确定“选择 model 后哪些配置可以从 Provider 元数据驱动”，并为将 Thinking Level 放到 Provider tab 提供依据。

## 结论摘要

1. **OpenAI 标准模型列表不是能力描述协议。** 官方 Model 对象目前只有 `id`、`object`、`created`、`owned_by` 四个字段；标准 `/v1/models` 不承诺返回 reasoning、Thinking Level、上下文窗口、最大输出、模态、工具能力或定价。
2. **模型目录能力由 Provider/网关自行扩展。** OpenRouter 的目录包含上下文、模态、定价、顶层 Provider 限制、支持的请求参数以及 reasoning effort；Together 返回上下文和定价等字段；Ollama 的原生 `/api/tags` 与 `/api/show` 返回本地模型文件、能力、参数和模型信息，但其 OpenAI-compatible `/v1/models` 仍只提供兼容字段。
3. **“未返回”不能等同于“不支持”。** 扩展字段没有跨 Provider 的统一语义；聚合网关的能力还可能取决于实际路由 endpoint、账户、请求参数和兼容层。未知能力应保持 `unknown`，不能无条件归类为 `false`。
4. **pi-ai 的 `Model` 元数据正好覆盖运行时需要的核心字段。** 它需要 `reasoning`、`thinkingLevelMap`、`input`、`contextWindow`、`maxTokens`、`cost` 和 `compat`；本项目当前却把这些值中的 reasoning、contextWindow、maxTokens、input 固定写死。
5. **Thinking Level 应与 model 放在 Provider tab。** 它是所选 model 的能力/请求参数，不是与模型无关的通用 runtime 开关。建议保存为 Provider 配置中的用户选择，运行时再映射到 pi 的 `createAgentSession({ thinkingLevel })`；模型目录只负责提供候选范围和默认值，不应覆盖用户显式选择。

## 1. OpenAI 标准 `/v1/models` 能提供什么

### 1.1 官方协议字段

OpenAI 官方 OpenAPI 中，`GET /models` 返回 `{ object: "list", data: Model[] }`。`Model` schema 的必填字段只有：

| 字段               | 语义                  | 可用于产品                                |
| ------------------ | --------------------- | ----------------------------------------- |
| `id: string`       | 可传给 API 的模型标识 | 是；作为选择值和请求 `model`              |
| `object: "model"`  | 对象类型              | 可用于协议校验，不用于 UI 能力判断        |
| `created: number`  | Unix 秒级创建时间     | 可用于排序/显示，但不代表模型版本或可用性 |
| `owned_by: string` | 所属组织              | 可用于显示/筛选，不代表实际路由 Provider  |

官方文档：

- [List models](https://developers.openai.com/api/reference/resources/models/methods/list)
- [Retrieve model](https://developers.openai.com/api/reference/resources/models/methods/retrieve)
- [官方 OpenAPI `Model` schema](https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml)，约 43944 行；`ListModelsResponse` 约 42551 行。

本地 OpenAI SDK 也只声明这四个字段：

- `node_modules/.pnpm/openai@6.26.0_ws@8.21.1_zod@3.25.76/node_modules/openai/src/resources/models.ts:38-64`

因此，面向任意 OpenAI-compatible endpoint 时，以下信息**不能从标准 `/v1/models` 合同可靠获得**：

- 是否支持 reasoning、reasoning effort、Thinking Level，以及支持哪些级别；
- context window、最大输出 token；
- text/image/audio/video 输入输出模态；
- tools、tool choice、structured outputs、JSON schema 等能力；
- pricing、缓存价格、速率限制、延迟或吞吐；
- API 方言、`max_tokens` 与 `max_completion_tokens` 的选择、developer/system role 兼容性；
- 是否需要特殊 reasoning payload（例如 `reasoning`、`enable_thinking`、`chat_template_kwargs`）。

模型详情页或 Provider 自己的模型目录可能展示其中部分信息，但这不是标准 `/v1/models` 的跨 Provider 保证。例如 [OpenAI GPT-5 模型文档](https://developers.openai.com/api/docs/models/gpt-5) 会单独展示上下文、最大输出、reasoning effort 和模态；这类页面不能替代兼容 API 的模型列表协议。

### 1.2 对解析器的影响

**事实：** OpenAI-compatible 服务通常允许在标准四字段之外返回 JSON 扩展字段，但官方协议没有统一扩展命名或语义。
**建议：** 解析时至少要求 `id`，对 `object` 做宽容校验；未知字段原样保留到 `raw`，不要因存在扩展字段而拒绝响应，也不要把缺失能力字段解释为不支持。

## 2. Provider/网关的扩展模型目录

下面的字段均来自 Provider 自己的一手文档或源码，不能当成 OpenAI 标准字段。

### 2.1 OpenRouter

官方模型目录：[Models API](https://openrouter.ai/docs/guides/overview/models)；接口：[https://openrouter.ai/api/v1/models](https://openrouter.ai/api/v1/models)。

OpenRouter 的标准化目录模型包含：

- `id`、`canonical_slug`、`name`、`created`、`description`；
- `context_length`；
- `architecture.input_modalities`、`architecture.output_modalities`、`tokenizer`、`instruct_type`；
- `pricing.prompt`、`completion`、`request`、`image`、`web_search`、`internal_reasoning`、`input_cache_read`、`input_cache_write` 及可选价格覆盖；
- `top_provider.context_length`、`top_provider.max_completion_tokens`、`top_provider.is_moderated`；
- `supported_parameters`（例如 `tools`、`tool_choice`、`structured_outputs`、`reasoning`、`reasoning_effort`、`response_format`）；
- `default_parameters`、`expiration_date`、`per_request_limits`、`links`、可选 `benchmarks`；
- `reasoning.mandatory`、`reasoning.default_enabled`、`reasoning.supported_efforts`、`reasoning.default_effort`，部分模型还提供 `supports_max_tokens`。

OpenRouter 文档明确说明：

- `supported_efforts` 用来过滤 effort selector；缺失时表示模型没有公开 effort 选择；为 `null` 时表示网关接受所有 effort 值；
- `mandatory: true` 时隐藏关闭 reasoning 的控件，并且不能发送 `effort: "none"`；
- 模型级字段是网关能力的标准化视图，实际 endpoint 可能仍有更具体的限制；需要 endpoint 详情时可读取模型 `links.details` 指向的 endpoint 列表。

这使 OpenRouter 成为“可以直接驱动 Thinking Level UI”的较完整例子，但其字段仍是 OpenRouter 合同，不能假设其他 Provider 会返回同样结构。

### 2.2 Together AI

官方接口文档：[List all models](https://docs.together.ai/reference/models.md)，官方 OpenAPI 地址为 `GET https://api.together.ai/v1/models`。

Together 的响应是**数组**而不是 OpenAI 常见的 `{ data: [] }` 包装。`ModelInfo` 字段包括：

- 必填 `id`、`object: "model"`、`created`、`type`；`type` 可为 `chat`、`language`、`code`、`image`、`embedding`、`moderation`、`rerank`；
- `display_name`、`organization`、`link`、`license`；
- `context_length`；
- `pricing.base`、`finetune`、`hourly`、`input`、`output`、可选 `cached_input`。

Together 目录可驱动 model label、模型类型、上下文和价格，但该文档没有声明一个统一的 `reasoning.supported_efforts` 字段。reasoning 是否可用仍需结合 Together 的 API/模型文档或请求测试。

### 2.3 Ollama

Ollama 官方 OpenAI 兼容文档：[OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility.md)。

Ollama 明确将两类目录分开：

1. **OpenAI-compatible `/v1/models`**：只保证兼容字段；`created` 表示模型最后修改时间，`owned_by` 默认对应 Ollama 用户名 `library`。文档没有把 context、vision 或 thinking 能力放入该列表协议。
2. **Ollama 原生 `/api/tags`**（[官方文档](https://docs.ollama.com/api/tags.md)）：返回本地模型 `name`、`model`、`modified_at`、磁盘 `size`、内容 `digest`，以及 `details.format/family/families/parameter_size/quantization_level`。
3. **Ollama 原生 `/api/show`**（[官方文档](https://docs.ollama.com/api-reference/show-model-details.md)）：按 model 查询 `parameters`、`license`、`template`、`capabilities`（例如 `completion`、`vision`）、`details` 和可选的详细 `model_info`；示例中 `model_info` 包含 `general.context_length` 等模型架构信息。

Ollama 文档还列出 OpenAI-compatible chat endpoint 支持的 reasoning/thinking 控制和 `reasoning_effort` 值，但这是 endpoint 能力说明，不是 `/v1/models` 返回的能力字段。若接入 Ollama，应使用原生接口补充元数据，不能只依赖 `/v1/models`。

### 2.4 vLLM

官方文档：[OpenAI-Compatible Server](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server.html)；官方源码：[OpenAI model protocol](https://github.com/vllm-project/vllm/blob/main/vllm/entrypoints/openai/engine/protocol.py) 和 [model serving](https://github.com/vllm-project/vllm/blob/main/vllm/entrypoints/openai/models/serving.py)。

vLLM 的 `/v1/models` 使用 OpenAI 风格的 `ModelList`，但 `ModelCard` 额外返回：

- `root`：实际基础模型路径；
- `parent`：LoRA adapter 的父模型；
- `max_model_len`：服务端配置的最大模型长度；
- `permission[]`：`allow_sampling`、`allow_logprobs`、`allow_fine_tuning`、`organization` 等权限信息。

源码中 `max_model_len` 来自服务端 `ModelConfig`，而非一个统一的远端模型注册表。因此它可以作为当前 vLLM deployment 的有效 context 上限，但不能推断原始模型的全部能力或 reasoning 支持。

### 2.5 Open WebUI（当前内部实例观察）

本次对内部 Open WebUI 实例进行了 Bearer 认证请求，观察到以下两个接口都返回 `{ data: Array }`：

- [`GET https://open-webui.corp.pony.ai/api/models`](https://open-webui.corp.pony.ai/api/models)
- [`GET https://open-webui.corp.pony.ai/api/v1/models`](https://open-webui.corp.pony.ai/api/v1/models)

> 以上 URL 需要有效的 `Authorization: Bearer <token>`；没有认证凭证时不能把响应形状当成匿名公共 API 的保证。以下是 2026-08-05 对该部署的实际观察，不代表所有 Open WebUI 版本或配置。

当时两个接口的 `data` 均为 36 条模型记录。顶层记录观察到的字段包括：

- `id`、`name`、`object`、`created`、`owned_by`；
- `connection_type`、`openai`、`urlIdx`；
- `tags`、`actions`、`filters`；
- `max_input_tokens`、`max_output_tokens`；
- `info`，其中 `info.meta` 可包含 `capabilities`、`builtinTools`、`filterIds` 等部署元数据。

该实例的 `deepseek-v4-flash` 记录中，`info.meta.filterIds` 观察到：

- `move_thinking_to_extra_body`
- `move_reasoning_effort_to_extra_body`

这些 filter ID 表明当前网关可能通过 Filter 将 Thinking/Reasoning 参数从标准请求位置搬到 `extra_body`；它们是该实例的请求变换线索，**不是**一个标准的 `supported_efforts` 或 `reasoning` 能力声明。实际支持哪些 level、参数名称及参数值仍需读取 Filter 配置或执行能力测试。

这次响应没有观察到 pricing、`supported_efforts` 或独立的 `reasoning` 字段；`text-embedding-v4` 的 `max_output_tokens` 为 `null`。该实例的 36 条记录还共享相同的 `created` 和 `owned_by: "openai"`，说明这两个字段在此兼容层中不能作为真实厂商或模型发布时间的可靠依据。`info` 可能包含用户 ID、访问授权等内部字段，不能直接下发到前端或持久化到 Agent 配置。

因此，Open WebUI 适配建议如下：

1. 只把 `id` 视为跨部署稳定的模型选择值；`name`、`created`、`owned_by` 用于展示，其他未知字段原样保留。
2. `max_input_tokens` / `max_output_tokens` 可以作为该 Open WebUI 连接层的上下文和输出上限候选值，但应标记来源为 deployment metadata，不应推断底层模型的完整能力。
3. `info.meta.capabilities`、`builtinTools` 可作为 UI 能力提示；缺失不能解释为不支持，且必须区分网关暴露能力与实际 upstream endpoint 能力。
4. `filterIds` 应进入 compatibility/request-transform 线索，而不是直接生成 `thinkingLevelMap`。对于 `move_*_to_extra_body`，需要 Provider-specific adapter 明确 payload 位置后再发送；未知 filter 不应自动执行。
5. Open WebUI 的模型记录、`actions`/`filters` 和 `info.meta` 属于网关部署数据，不宜完整写入 Agent config；建议只缓存带认证连接指纹和 `fetchedAt` 的规范化快照，并保留 raw 供诊断。

本次实现先收敛在确定范围内：后端仅返回安全的规范化元数据，Provider tab 展示上下文上限、最大输出和能力提示；这些元数据留在当前编辑草稿和短期模型列表令牌中，不写入 Agent 配置。Thinking Level 控件已移到 Provider tab，但仍兼容读取和保存既有的 `session_options.thinkingLevel`；不会根据 `filterIds` 自动生成或发送 reasoning 参数。Pricing 仍保留手工配置，因为该 Open WebUI 模型列表没有提供价格字段。Provider-specific Filter adapter、reasoning level 自动映射、价格自动填充和元数据持久化暂不实现。

## 3. pi-coding-agent / pi-ai 当前需要的模型信息

### 3.1 pi-ai `Model` 字段

本地类型定义：`node_modules/.pnpm/@earendil-works+pi-ai@0.81.0_ws@8.21.1_zod@3.25.76/node_modules/@earendil-works/pi-ai/dist/types.d.ts:604-623`。

pi-ai 的 `Model` 要求：

| pi 字段                      | 用途                                             | 可由目录元数据驱动的程度                                                   |
| ---------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| `id`、`name`                 | 请求标识和展示                                   | 高；`id` 是最低可靠字段，`name` 依 Provider                                |
| `api`、`provider`、`baseUrl` | 选择 API 实现和 endpoint                         | 低；由连接配置/Provider 类型决定，不应从普通 `/v1/models` 猜测             |
| `reasoning`                  | 是否启用 reasoning 路径                          | 中；只有 Provider 明确声明时才设为 true；缺失应为 unknown                  |
| `thinkingLevelMap`           | pi level 到 Provider 值的映射，`null` 表示不支持 | 高（当目录提供 supported efforts 时）                                      |
| `input`                      | `text`/`image` 输入类型                          | 中高；可从 `architecture.input_modalities` 映射，但未知模态要保留 raw      |
| `contextWindow`              | 请求上下文上限                                   | 中高；优先使用 deployment/endpoint 的有效上限                              |
| `maxTokens`                  | 最大输出 token                                   | 中高；优先使用 endpoint/deployment 的上限                                  |
| `cost`                       | 输入、输出、缓存价格                             | 中；需确认单位和路由，不能将未知价格填成真实的 0                           |
| `compat`                     | OpenAI 方言和 thinking/tool/cache 兼容开关       | 低到中；多来自 Provider 配置或 pi 的已知 Provider 规则，不能从标准列表推断 |

### 3.2 Thinking Level 的 pi 语义

pi-ai 类型定义：

- `ThinkingLevel = minimal | low | medium | high | xhigh | max`；
- `ModelThinkingLevel = off | ThinkingLevel`；
- `ThinkingLevelMap = Partial<Record<ModelThinkingLevel, string | null>>`；
- `SimpleStreamOptions.reasoning` 和 `thinkingBudgets`：`node_modules/.pnpm/@earendil-works/pi-ai@0.81.0_ws@8.21.1_zod@3.25.76/node_modules/@earendil-works/pi-ai/dist/types.d.ts:22-35, 213-217`。

pi-coding-agent 的 SDK 明确说明 `createAgentSession({ thinkingLevel })` 的默认值来自设置或 `medium`，并会按模型能力 clamp：

- `node_modules/.pnpm/@earendil-works/pi-coding-agent@0.81.0_ws@8.21.1_zod@3.25.76/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.d.ts:10-25`。

pi 自带模型目录文档还规定：

- model `reasoning` 默认 false；
- `thinkingLevelMap` 缺失时使用 Provider 默认映射，`null` 表示隐藏/跳过/钳制该级别；
- `xhigh`、`max` 等扩展级别需要显式映射；
- OpenAI-compatible Provider 可通过 `compat.supportsReasoningEffort`、`thinkingFormat`、`chatTemplateKwargs` 等字段描述请求方言。

来源：本地一手文档 `node_modules/.pnpm/@earendil-works/pi-coding-agent@0.81.0_ws@8.21.1_zod@3.25.76/node_modules/@earendil-works/pi-coding-agent/docs/models.md:197-279, 412-459`。

### 3.3 本项目当前实现的差距

当前 runtime adapter 在 `server/runtime-adapter.mjs:109-135`：

- 只取 `provider.model` 和可选的 `provider.pricing`；
- 将 `reasoning` 固定为 `false`；
- 将 `input` 固定为 `["text"]`；
- 将 `contextWindow` 固定为 `128000`；
- 将 `maxTokens` 固定为 `8192`；
- API 固定注册为 `openai-completions`。

Thinking Level 当前从 `config.session_options.thinkingLevel` 透传（`server/runtime-adapter.mjs:171-185`，类型在 `src/api.ts:18-25`）。这意味着当前 UI 不能根据所选 model 的能力自动裁剪选项，也不能支持 Provider 需要 `reasoning`、`enable_thinking` 或特殊 chat-template 的模型。

## 4. 建议的统一模型元数据契约

不要把每个 Provider 的原始响应强行压缩成只有 `string[]`，也不要把原始响应直接当成 pi `Model`。建议在后端建立“统一可选字段 + 原始扩展”的轻量适配层：

```ts
type ProviderModel = {
  id: string; // 必填，来自 Provider
  name?: string;
  description?: string;
  created?: number | string;
  owned_by?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  context_window?: number;
  max_output_tokens?: number;
  pricing?: Record<string, unknown>;
  capabilities?: {
    tools?: boolean;
    tool_choice?: boolean;
    structured_outputs?: boolean;
    response_format?: boolean;
  };
  reasoning?: {
    supported?: boolean;
    mandatory?: boolean;
    default_enabled?: boolean;
    supported_efforts?: string[] | null;
    default_effort?: string;
    supports_max_tokens?: boolean;
  };
  raw?: Record<string, unknown>; // 保留 Provider 未识别字段
};
```

适配规则：

1. `id` 是跨 Provider 唯一必需字段；数组响应（Together）和 `{ data: [] }` 响应（OpenAI/OpenRouter/Ollama/vLLM）分别适配，返回给前端统一为 `models[]`。
2. `name`、`description`、`owned_by`、`created` 只用于展示/筛选，不参与运行时能力判断。
3. `context_window` 优先使用实际 endpoint/deployment 限制（例如 OpenRouter `top_provider.context_length` 或 vLLM `max_model_len`），再回退到模型级 `context_length`；不得把缺失值静默写成真实上限。
4. `max_output_tokens` 采用 endpoint 的 `max_completion_tokens` 或等价字段；没有该字段时保持 unknown，由 pi/Provider 默认策略处理。
5. `input_modalities` 映射为 pi 的 `input: ["text", "image"]`；无法表达的 audio/video 等模态必须保留在 raw，不应错误映射成 image。
6. pricing 只有在确认单位、币种和路由后才转换成 pi 的 `$ / 1M tokens`；未知、免费和未上报必须区分，不能统一写成 `0`。
7. `supported_parameters` 只能作为“Provider 声明支持”，不能证明请求在当前账户/endpoint 一定成功；可映射为能力提示并由实际测试覆盖。
8. `reasoning` 缺失时状态应为 `unknown`。只有 Provider 明确给出 reasoning 对象、或明确列出 reasoning 参数时，才将其标为 supported；不要因 pi 默认值为 false 而把未知能力永久关闭。
9. Provider/模型 raw 元数据不应完整持久化到 Agent config：目录会变化、体积不可控且聚合网关路由会改变。建议只保存选中的 `model`、用户选择的 thinking level 和显式 override；目录结果保存在当前 Provider 会话缓存中，并带 `fetchedAt`/指纹用于测试令牌关联。

## 5. Thinking Level 放置与保存建议

### 5.1 UI 位置

将 Thinking Level 放在 Provider tab，与 `base_url`、API Key、模型选择连续展示：

1. Load Models 成功后，选择 model；
2. 根据该 model 的 `reasoning` / `supported_efforts` / `thinkingLevelMap` 更新可选项；
3. 只有模型支持或能力未知时显示相应状态；能力明确不支持时隐藏并清除不兼容的选择；
4. 如果 `mandatory=true`，隐藏 `off`，并显示“该模型强制 reasoning”；
5. 如果目录提供 `default_effort`，只用于首次选择的建议值；已有用户选择不得被刷新目录覆盖；
6. 切换到不支持当前 level 的 model 时，优先提示并自动 clamp 到最近支持级别，或要求用户重新选择，不能静默发送无效值。

### 5.2 配置边界

建议形态（字段名可按现有命名规范调整）：

```json
{
  "provider": {
    "base_url": "https://provider.example/v1",
    "api_key": "$PROVIDER_KEY",
    "model": "provider/model-id",
    "thinking_level": "high"
  },
  "session_options": {
    "tools": ["read", "bash"]
  }
}
```

- `provider.model` 与 `provider.thinking_level` 是同一个模型选择上下文内的用户配置；Provider tab 单独保存。
- `session_options` 保留工具、超时、运行行为等与具体模型无关的设置。
- 运行时将 `provider.thinking_level` 转换为 pi 的 `createAgentSession({ thinkingLevel })`；如果 Provider 返回映射，则先转换为 Provider API 所需值。
- 原始目录里的 `default_effort` 只能作为默认建议，不能成为不可见的强制写入。

### 5.3 未知能力的安全策略

推荐把能力分为 `supported`、`unsupported`、`unknown` 三态：

- `supported`：显示目录声明的级别；可以在测试请求中验证；
- `unsupported`：不显示对应控件，并避免发送该参数；
- `unknown`：显示“Provider 未声明能力”，默认不发送 reasoning 参数；如产品需要，可在高级选项中允许用户显式尝试，并把失败留在草稿/测试结果中。

这样既不会把普通 OpenAI `/v1/models` 的缺失字段误判为“不支持”，也不会在未知方言上自动发送可能被拒绝的 reasoning payload。

## 6. Provider 测试应验证什么

现有测试模块 `server/provider-testing.mjs:18-72` 只执行：获取模型列表、确认所选 `id` 存在、发送不带工具的最小非流式 completion。这足以验证连接、认证、模型 ID 和基础文本生成，但不能证明高级能力。

建议将测试结果分层：

| 测试                    | 目的                               | 是否保存必需                   |
| ----------------------- | ---------------------------------- | ------------------------------ |
| `GET /models`           | 连接、认证、目录可用、选中 ID 存在 | 是（当前产品决策）             |
| 最小 text completion    | 模型可实际生成文本                 | 是（当前产品决策）             |
| tool-call probe         | 工具协议和 tool result 兼容性      | 仅当启用工具能力时             |
| reasoning probe         | reasoning 参数/返回格式/级别映射   | 仅当用户选择 Thinking Level 时 |
| structured-output probe | JSON schema/response_format 兼容性 | 仅当产品暴露该能力时           |

探测请求应遵循模型目录给出的参数；不要对所有 OpenAI-compatible 服务盲发 `reasoning_effort`、`developer` role、`max_completion_tokens` 或工具字段。失败时记录“该能力测试失败”，但不覆盖旧 Provider 配置。

## 7. 最终工程判断

- **可直接从标准列表拿到的只有 model 选择基础信息。** 任何跨 Provider 自动化都必须以 `id` 为硬依赖，以其他字段为可选扩展。
- **可由扩展目录驱动的配置包括**：展示名称/描述、输入模态、context/max output、价格提示、tools/structured output/reasoning 的能力提示，以及 model-specific Thinking Level 候选项。
- **不能仅靠列表可靠决定的配置包括**：API 方言、兼容开关、真实路由、账户级可用性、工具调用端到端成功、reasoning 返回格式和最终计费。
- **Provider tab 应拥有 model + Thinking Level。** Thinking Level 的候选范围来自所选 model 的元数据；用户的选择持久化在 Provider 配置，运行时再转换到 pi session。
- **保留 raw、区分 unknown、测试高级能力**是面向未知 Provider 的最小稳健边界。

## 来源索引

### 官方协议/Provider 文档

- OpenAI List models：<https://developers.openai.com/api/reference/resources/models/methods/list>
- OpenAI Retrieve model：<https://developers.openai.com/api/reference/resources/models/methods/retrieve>
- OpenAI OpenAPI：<https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml>
- OpenRouter Models API：<https://openrouter.ai/docs/guides/overview/models>
- OpenRouter reasoning：<https://openrouter.ai/docs/api_reference/parameters.md>
- OpenRouter live endpoint：<https://openrouter.ai/api/v1/models>
- Together List all models：<https://docs.together.ai/reference/models.md>
- Ollama OpenAI compatibility：<https://docs.ollama.com/api/openai-compatibility.md>
- Ollama List models：<https://docs.ollama.com/api/tags.md>
- Ollama Show model details：<https://docs.ollama.com/api-reference/show-model-details.md>
- vLLM OpenAI-compatible server：<https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server.html>
- vLLM ModelCard 源码：<https://github.com/vllm-project/vllm/blob/main/vllm/entrypoints/openai/engine/protocol.py>
- Open WebUI（需 Bearer 认证，内部实例观察）：<https://open-webui.corp.pony.ai/api/models>、<https://open-webui.corp.pony.ai/api/v1/models>

### 仓库本地一手源码/类型

- OpenAI SDK Model 类型：`node_modules/.pnpm/openai@6.26.0_ws@8.21.1_zod@3.25.76/node_modules/openai/src/resources/models.ts:38-64`
- pi-ai Model 类型：`node_modules/.pnpm/@earendil-works/pi-ai@0.81.0_ws@8.21.1_zod@3.25.76/node_modules/@earendil-works/pi-ai/dist/types.d.ts:22-35, 213-217, 604-623`
- pi-coding-agent session 选项：`node_modules/.pnpm/@earendil-works/pi-coding-agent@0.81.0_ws@8.21.1_zod@3.25.76/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.d.ts:10-25`
- pi-coding-agent 自定义模型/兼容文档：`node_modules/.pnpm/@earendil-works/pi-coding-agent@0.81.0_ws@8.21.1_zod@3.25.76/node_modules/@earendil-works/pi-coding-agent/docs/models.md:197-279, 412-459`
- 当前 runtime adapter：`server/runtime-adapter.mjs:109-135, 171-189`
- 当前 Provider 测试：`server/provider-testing.mjs:18-72`
