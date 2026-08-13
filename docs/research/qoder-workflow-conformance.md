# Qoder Dynamic Workflow helper 与控制语义核查

> 核查日期：2026-08-13（Asia/Shanghai）  
> 文档对象：Qoder 官方 CLI 文档在核查日可访问的版本  
> 黑盒对象：Qoder CLI `1.1.20`，Linux x86_64  
> 结论范围：本文只把官方文档明示内容和可复现观察称为“已确认”；未观察到的行为不从 helper 名称或一次运行外推。

## 结论摘要

1. 官方文档确认 Workflow 是受控 JavaScript orchestration，公开了 `agent()`、`parallel()`、`pipeline()`、`phase()`、`log()`、`workflow()` 和 `args` 的名称，但**没有公开完整的 helper API reference 或兼容版本**。[Dynamic workflows](https://docs.qoder.com/cli/workflows)
2. 在 CLI `1.1.20` 的纯 JavaScript 探针中，`parallel()` 会并发启动输入 thunk、按输入位置返回结果；单分支抛错被转为同位置 `null`，其他分支继续，错误进入 run 的 `logs` 与 `failures`。
3. 在同一版本的探针中，`pipeline()` 是逐 item 推进：较快 item 可进入下一 stage，而较慢 item 仍在上一 stage；返回值保持输入位置。某 item 抛错后该位置为 `null`，其他 item 继续完成。
4. `phase()` 和 `log()` 在 snapshot 中形成有序 progress/log 记录；`workflow(name, args)` 可同步返回 child 结果，并把 child phase 标为 `kind: "child"`。这些是 `1.1.20` 的观察，不是官方的跨版本承诺。
5. 官方只承诺运行详情中“仍可控制”的 agent 可 skip/retry；没有定义何时可控、running skip 是 abort 还是逻辑跳过、retry 是否创建新 session/attempt、下游是否失效。cancel 的层级传播同样未定义。[Dynamic workflows](https://docs.qoder.com/cli/workflows#monitor-workflows)
6. 官方说明 project workflow 覆盖 plugin 和 built-in 同名项，但没有给出 user 相对 project/plugin/built-in 的完整 workflow catalog 总序。Settings 的合并优先级不能被当作 workflow discovery 优先级。[Dynamic workflows](https://docs.qoder.com/cli/workflows#saved-workflows) [Configuration Files and Application Order](https://docs.qoder.com/cli/settings#merge-precedence)
7. 因此，本项目当前只能诚实承诺“对固定 Qoder CLI 版本、经 conformance fixture 验证的子集兼容”，不能据现有公开资料承诺任意 Qoder JavaScript 的等价执行。

## 1. 证据等级与可复现基线

本文使用四种标签：

- **官方事实**：Qoder 官方文档直接陈述。
- **版本绑定观察**：本文探针在下列固定 CLI/平台上实际产生的 artifact。
- **推断**：由事实或观察支持，但并非上游合同。
- **未知**：现有官方材料和本轮探针均不足以回答。

### 1.1 固定环境

| 项目           | 值                                                                                  |
| -------------- | ----------------------------------------------------------------------------------- |
| 核查时间       | `2026-08-13T16:20:55+08:00`                                                         |
| CLI            | `qoder --version` → `1.1.20`                                                        |
| 可执行文件     | `~/.qoder/bin/qodercli/qodercli-1.1.20`                                             |
| 可执行 SHA-256 | `323a91b2ee0ebf9142169f17d9b4914c936d438bc193fb8f6eb16a75d0525525`                  |
| 平台           | Ubuntu 22.04 系列，Linux `6.8.0-45-generic`, x86_64                                 |
| 仓库基线       | `24974b0e1d772044a2ccf37020815ca573fa70ff`                                          |
| 启动方式       | `qoder -p --permission-mode <mode> --output-format json -w <fixture-root> <prompt>` |

官方文档没有在页面上暴露版本号或 revision SHA，因此仅能按抓取日期与内容哈希冻结：

| 官方页面                                                                            | 核查日 Markdown SHA-256                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Dynamic workflows](https://docs.qoder.com/cli/workflows.md)                        | `23b87425ece481053b492dd2bfbf67b113aaab89afafe64defd5d8b24bfdaf21` |
| [Sandbox](https://docs.qoder.com/cli/sandbox.md)                                    | `0499e9ee2818152062599c5b109863525cecb30e73fdc8ae1f0138a0c3f0e065` |
| [Hooks](https://docs.qoder.com/cli/hooks.md)                                        | `ac7465950b33ddb3d0415125bc251a93f2518449c9596fd4b953bb9147be5254` |
| [Permissions](https://docs.qoder.com/cli/permissions.md)                            | `012c97ed3d29f3667da976c2c3ed0520f20d4a913cb8dd8799b186ff3213f944` |
| [Configuration Files and Application Order](https://docs.qoder.com/cli/settings.md) | `4f603ba5e5e5da1572cbcba0f3af9c4f4df5a22a1077c357750b59db646c56a6` |

## 2. 官方公开合同

### 2.1 Workflow、保存格式与运行流程

**官方事实：** Dynamic Workflow 是后台运行的结构化多 agent 过程；JavaScript 脚本决定启动哪些 subagent、怎样分 phase、如何组合中间结果以及向 session 返回什么。官方能力表列出 scripted orchestration、multi-agent fan-out、phased execution、parallel/pipelined work、background execution 和 reusable flows。[Dynamic workflows](https://docs.qoder.com/cli/workflows#what-workflows-do)

**官方事实：** 动态生成的 workflow 在运行前可展示计划；用户可以运行、查看 raw script、带反馈拒绝或取消。启动后获得 workflow run ID，并可继续使用 CLI。[Dynamic workflows](https://docs.qoder.com/cli/workflows#run-a-workflow)

**官方事实：** Saved Workflow 是 JavaScript 文件，以导出的 `meta` 对象开头；公开字段包括 `name`、`description`、`phases`，示例还包含可选 `whenToUse`，正文说明可选 input schema。每次运行的变化值通过全局 `args` 提供。[Dynamic workflows](https://docs.qoder.com/cli/workflows#saved-workflows)

**官方事实：** 文档列举 helper 名称 `agent()`、`parallel()`、`pipeline()`、`phase()`、`log()`、`workflow()` 与 `args`，但没有给出参数、返回值、错误模型、默认并发或 dialect version。[Dynamic workflows](https://docs.qoder.com/cli/workflows#how-workflows-run)

### 2.2 Catalog scope

**官方事实：** discovery scope 包括 project `.qoder/workflows`、user `~/.qoder/workflows`、plugin 和 built-in。官方只明确 project 同名 workflow 优先于 plugin 与 built-in。[Dynamic workflows](https://docs.qoder.com/cli/workflows#saved-workflows)

**未知：** user 相对 project、plugin、built-in 的完整顺序；同 scope 多文件冲突；名称大小写/扩展名规则；plugin 间冲突；版本选择；递归与循环依赖。

**注意：** settings 文档确实给出 built-in defaults → user → project → local → CLI 的配置合并顺序，但该页面讨论 `settings.json`，不是 workflow registry，因此不能用它补齐 workflow scope 规则。[Configuration Files and Application Order](https://docs.qoder.com/cli/settings#merge-precedence)

### 2.3 监控与控制

**官方事实：** `/workflows` 可查看运行中和已完成任务的 status、phase、agents、logs、output paths、errors 和 final results；`/tasks` 也显示 workflow task。详情页允许对“still controllable”的 agent 执行 skip 或 retry。[Dynamic workflows](https://docs.qoder.com/cli/workflows#monitor-workflows)

**未知：**

- “controllable”的状态集合；
- skip pending 与 running agent 的差别；
- running skip 是否 abort、是否等待 settle、返回 `null` 还是专门状态；
- retry 是复用原 session 还是新 session/attempt；
- retry 次数、backoff 和可重试错误；
- 已消费旧结果的下游如何处理；
- run cancel 对 phase、agent、tool、network request 的传播与超时；
- stop/pause 后是否以及如何 resume。

### 2.4 产物与主会话边界

**官方事实：** 中间结果留在 workflow runtime；最终输出写入 workflow run output，并摘要回主 session。文档称 scripts、manifests、journals、transcripts 与 output 保存在 `.qoder/sessions` 的 session directory 下。[Dynamic workflows](https://docs.qoder.com/cli/workflows#how-workflows-run)

**版本绑定观察：** `1.1.20` 的 saved project workflow artifact 布局比上述概述更分散：run 目录保存 `manifest.json`、`snapshot.json`、`output.json`，存在 agent 时另有 `journal.jsonl`；manifest 的 `scriptPath` 仍指向 project `.qoder/workflows/*.js`，agent transcript 指向用户配置树下的 `~/.qoder/projects/.../subagents/*.jsonl`。因此不要把文档中的目录描述当作稳定文件 schema 或“所有正文都物理复制进 run 目录”的承诺。

### 2.5 安全边界

**官方事实：** Workflow script 本身不直接获得 shell、filesystem、network、Node.js API 或 MCP；副作用通过 child agent 发生，仍受 tools、permissions、hooks 与 sandbox 约束。[Dynamic workflows](https://docs.qoder.com/cli/workflows#permissions-and-safety)

**官方事实：** permission modes 包括 `default`、`accept_edits`、`auto`、`bypass_permissions` 与 `dont_ask`；headless 环境无法交互，最终的 `ask` 会 auto-deny。决策顺序优先处理 deny 与安全规则，宽泛 allow 并不保证静默执行。[Permissions](https://docs.qoder.com/cli/permissions#how-decisions-are-made)

**官方事实：** `PreToolUse` 可在工具执行前返回 allow/deny/ask；`PermissionRequest` 可在权限管线得出 ask 后用 allow/deny 替代交互。Hook 决策优先于 permission mode。[Permissions](https://docs.qoder.com/cli/permissions#hooks-and-permissions) Hook 生命周期还覆盖 session、tool、permission、subagent、compaction、notification、worktree 等事件。[Hooks](https://docs.qoder.com/cli/hooks#event-reference)

**官方事实：** Sandbox 将 command/tool 的文件系统和网络访问限制在配置边界内；`allowedPaths` 可追加绝对路径，`networkAccess` 默认 false；可选 backend 包括 Docker、Podman、sandbox-exec、runsc 等。[Sandbox](https://docs.qoder.com/cli/sandbox#isolation-capabilities)

## 3. CLI `1.1.20` 黑盒观察

所有 fixture 都是无文件/网络副作用的 project workflow。除 agent 探针外，只执行 JavaScript、计时器与 helper。每个源文件在运行前记录 SHA-256；判断依据是 Qoder 自己生成的 manifest、snapshot、journal、output 和 child transcript，而不是主 agent 对结果的自然语言总结。

### 3.1 `args`、`phase()` 与 `log()`

fixture `wf-observe.js` SHA-256：

```text
62f23c4915a23ce1a5557a9e98f90f585cd8a5d30d87f961a0c0e8867f5fd55d
```

输入 `{"value":"sentinel-20260813"}`，run `wf_148f620a-7ed` 观察到：

- manifest `source` 为 `project`，`args` 是对象而不是 JSON 字符串；
- 脚本中 `typeof args === "object"`，返回值保留原对象；
- `phase("One")` 产生 `workflow_phase` progress，index 为 1、kind 为 `root`；
- `log()` 同时进入 snapshot progress、`logs` 和最终 output 的 `logs`；
- 零 agent workflow 的 output 记录 `agentCount: 0`、`totalToolCalls: 0`。

**边界：** 这只确认对象参数和一次 root phase；未覆盖 primitive/array/null、input schema 拒绝、重复 phase title、phase 嵌套或动态 phase。

### 3.2 `parallel()`：启动、顺序与失败

成功 fixture `wf-order.js` SHA-256：

```text
0c666ed753cceebf79326d9f7efe6784a4885d724039a4936c5500d1f41cf3af
```

run `wf_c6a6412e-6c6` 使用一个约 80 ms 的 slow thunk 和约 10 ms 的 fast thunk：

```json
{
  "result": ["slow", "fast"],
  "trace": ["slow:start", "fast:start", "fast:end", "slow:end"]
}
```

**版本绑定观察：** 两 thunk 在 slow 完成前都已启动，完成顺序不同于输入顺序，但结果数组保持输入顺序。

失败 fixture `wf-failure.js` SHA-256：

```text
53ce1f2c0ff8532e9e65ae1121f2048621e59c485daf15bdb25b73959b4264cf
```

run `wf_c6b4fca2-88d` 中 index 0 抛出 `parallel-sentinel`：

```json
{
  "parallelResult": [null, "sibling"],
  "parallelTrace": ["throw:start", "sibling:start", "throw:now", "sibling:end"],
  "failures": ["parallel[0] failed: Error: parallel-sentinel"]
}
```

**版本绑定观察：** helper 没有向脚本抛出该分支异常；失败位置为 `null`，sibling 正常完成，错误进入 logs/failures。

**未知：** 默认/最大并发、空数组、非函数输入、外层 cancel、agent skip/retry 与 `parallel()` 的交互、多个失败的排序、是否跨版本保持 all-settled 行为。

### 3.3 `pipeline()`：逐 item progression 与失败隔离

同一 `wf-order` run 对 `['a', 'b']` 执行两个异步 stage：

```json
{
  "pipelineResult": ["a12", "b12"],
  "pipelineTrace": [
    "s1:a:start",
    "s1:b:start",
    "s1:b:end",
    "s2:b1:start",
    "s2:b1:end",
    "s1:a:end",
    "s2:a1:start",
    "s2:a1:end"
  ]
}
```

**版本绑定观察：** item `b` 已完成 stage 2 时，item `a` 仍在 stage 1；因此此版本不是“所有 item 完成 stage 1 后再统一进入 stage 2”的 batch barrier。结果仍按输入位置排列。

失败 run `wf_c6b4fca2-88d` 中 bad item 在 stage 1 抛错：

```json
{
  "pipelineResult": [null, "good12"],
  "pipelineTrace": [
    "s1:bad:start",
    "s1:good:start",
    "s1:bad:throw",
    "s1:good:end",
    "s2:good1:start",
    "s2:good1:end"
  ],
  "failures": ["pipeline[0] failed: Error: pipeline-sentinel"]
}
```

**版本绑定观察：** bad item 不进入后续 stage，并在原位置返回 `null`；good item 完成全部 stage；异常没有从 `await pipeline(...)` 抛回脚本。

**未知：** stage concurrency 与总 concurrency cap、buffer/backpressure、streaming、空 item、某 stage 返回 `null` 的专门含义、cancel/drain、agent control 对 item 的影响。

### 3.4 `agent()` 与 structured output

fixture `wf-agent.js` SHA-256：

```text
b927845d6dc65b62c47f654a2ef294fc574e8593df24f26926bea375e4023cb7
```

脚本采用 `agent(prompt, { label, phase, model: "lite", schema })` 连续调用两个 child。run `wf_c47cb08e-050` 观察到：

- 第一个 child 调用 `StructuredOutput`，脚本获得经 schema 校验的对象 `{"answer":"nonce-7f4c2a"}`；
- manifest 为两个调用保存独立 agent index；成功 child 有独立 `agentId`、`outputPath`、`transcriptPath`；
- 第二个 child 的 transcript 只包含自身 prompt，回答 `UNKNOWN`，没有出现仅给第一个 child 的 nonce。**推断：** 默认 child context 至少没有自动注入前一个 child 的对话正文；这不是对所有 session 隔离细节的证明；
- 第二个 child 用普通文本回答而没有调用 `StructuredOutput`，错误为 `agent({schema}): subagent completed without calling StructuredOutput`；该异常未被脚本捕获，因此整个 workflow 终态为 `failed`；
- journal 记录 `attempt_started` 和错误事件；snapshot/manifest 有 attempt 字段，但本轮没有验证自动 retry、人工 retry 或 session reuse。

**未知：** 完整 options schema；无 schema 返回值的稳定形态；错误分类；retry 默认值；同一 logical agent 的人工 retry 是否换 session；skip 返回；tool/permission 继承；model fallback；token 统计定义。

### 3.5 `workflow()`

fixture hashes：

```text
wf-child.js  5d1b2bd6525709b5b51882c8f408d97b784e7e103e96a0e61efbb07e2eb870f6
wf-parent.js 0d0b406f4330f1a02346754382e73f3fa5cbc0f2e5b62bfb7aedd9ce2a7feae8
```

parent 执行 `await workflow('wf-child', { value: 'child-sentinel' })`。run `wf_19d141c2-628` 观察到：

- parent 收到 child 返回值 `{"childArgs":{"value":"child-sentinel"}}`；
- child 名称和 child 声明的 phase 都进入 parent snapshot progress，`kind` 为 `child`；
- child log 进入 parent run logs；
- 该无 agent child 没有产生单独的 child run manifest。

**未知：** name resolution 全序、`{scriptPath}` 形式、version binding、递归/循环、最大嵌套、child budget/permission/cancel 继承、child failure 是否总是抛出、是否有独立运行身份。

### 3.6 运行前权限行为

同一个 `wf-observe`：

- `--permission-mode dont_ask` 的 headless 调用没有启动 run；主 session 报告 workflow 启动需要授权而被自动拒绝；
- `--permission-mode auto` 启动并完成 run。

该观察与官方“headless ask → deny”及 `dont_ask` 的说明一致。[Permissions](https://docs.qoder.com/cli/permissions#how-ask-is-consumed-in-different-environments)

**边界：** 这不是对 TUI pre-run review UI 的验证；本轮没有自动操作交互式 `/workflows`，也没有执行 skip/retry/cancel，以避免把不可重复的人工时序当作合同。

## 4. 能力核查矩阵

| 能力            | 官方确认                                                     | `1.1.20` 本轮观察                                                                      | 仍未知                                         |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `args`          | saved workflow 可接收每次运行输入                            | 对象值原样进入 manifest/script/output                                                  | 全类型、schema coercion/default                |
| `agent()`       | helper 存在；用于 child agent                                | `prompt + options` 可用；schema 由 `StructuredOutput` 满足；调用有独立 transcript path | 完整签名、session/retry/skip 合同              |
| `parallel()`    | 独立分支可并行                                               | 并发启动；结果 input-order；失败 → `null`，siblings 继续                               | concurrency/cancel/version stability           |
| `pipeline()`    | item 可 staged processing                                    | 逐 item stage progression；input-order；item 失败隔离为 `null`                         | backpressure/buffer/stage limits               |
| `phase()`       | named phases 与进度                                          | 产生有序 root/child progress                                                           | nesting、重复名、terminal state                |
| `log()`         | logs 可监控并保存                                            | 进入 progress/logs/output                                                              | level/schema/上限/redaction                    |
| `workflow()`    | helper 与 saved scopes 存在                                  | name+args inline child 返回；child phases/logs 合入 parent                             | resolver、version、递归、failure/cancel        |
| planning/review | 动态生成 workflow 可预览/拒绝/取消                           | headless permission mode 影响能否启动                                                  | saved workflow review 条件、run options schema |
| monitoring      | `/workflows` 显示状态、phase、agent、log、路径、错误、结果   | snapshot 含相应基础字段                                                                | 大规模增量/事件稳定 schema                     |
| skip/retry      | 可对仍可控 agent 操作                                        | 未测                                                                                   | 状态机、attempt/session、下游失效              |
| cancel          | pre-run 可 cancel；background task 可管理                    | 未测                                                                                   | 层级传播、force timeout、partial artifact      |
| artifacts       | 文档列出 scripts/manifests/journals/transcripts/output       | 实际路径跨 run dir/project/user config tree                                            | schema/version/retention/atomicity             |
| safety          | script 无直接 Node/FS/network/MCP；child 受权限/Hook/Sandbox | `dont_ask` headless 阻止需授权启动                                                     | script VM limits、resource quotas              |

## 5. 必须保留为未知、不能写进兼容承诺的语义

1. `agent()` 完整参数/返回 schema，以及每次调用是否必然 fresh session。
2. automatic/manual retry 的错误分类、次数、attempt identity、transcript reuse。
3. pending/running skip 的状态转换及下游数据形态。
4. workflow cancel 对等待中的 branch、running child、tool call 和网络请求的传播。
5. `parallel()` / `pipeline()` 的默认与硬并发上限、配额、公平性和取消行为。
6. `pipeline()` 的 buffer/backpressure/streaming；目前只确认有限数组探针。
7. phase 是否可嵌套、phase 的成功/失败聚合和生命周期。
8. `workflow()` 的 version binding、递归、循环、嵌套限制与 child 独立身份。
9. user/project/plugin/built-in 的完整 catalog precedence。
10. manifest、snapshot、journal、output、transcript 的稳定 schema/version 与迁移策略。
11. TUI 中 “still controllable” 的精确谓词。
12. generated workflow 与 saved workflow 的 pre-run review 条件和 run options。

## 6. 推荐的可持续 Conformance Suite

每个 fixture 都必须保存：CLI exact version、binary SHA、平台、配置摘要、source SHA、args、run ID、manifest/snapshot/journal/output 的脱敏副本以及事件时间线。

### P0：执行语义

1. **Args matrix**：undefined/null/string/number/boolean/object/array；合法和非法 input schema。
2. **Parallel matrix**：0/1/N、输入顺序与完成顺序、1/N failures、并发 hard limit、cancel。
3. **Pipeline matrix**：0/1/N item、0/1/N stage、stage overlap、每一 stage 失败、`null` 返回、cancel、并发限制。
4. **Agent matrix**：schema/no-schema、nested schema、普通返回、tool failure、provider error、stall、permission deny、自动 retries。
5. **Phase/log matrix**：重复/动态/未知 phase、child phase、log 量与截断、敏感信息 redaction。
6. **Subworkflow matrix**：name/path、missing、syntax error、child failure、嵌套/循环、args/schema、cancel。

### P0：人工控制状态机

在可脚本化的 PTY/TUI harness 中，对每个 agent 状态执行：

- skip：queued、starting、running tool、waiting permission、completed；
- retry：running、failed、skipped、completed；
- cancel：run 创建前、fan-out 中、tool call 中、child workflow 中；
- 逐次对比 agent ID、attempt number、transcript path、下游是否重跑、最终 output。

### P1：Catalog resolver

使用相同名称在 project/user/plugin/built-in 放置不同 sentinel，覆盖：

- 每一对冲突与四方冲突；
- trusted/untrusted project；
- 多 plugin；
- 大小写、扩展名、invalid file；
- parent `workflow(name)` 与顶层自然语言选择是否同序。

### P1：安全与产物

- permission mode × headless/TUI/SDK；
- `PreToolUse` / `PermissionRequest` allow/deny/ask；
- Sandbox FS/network 越界；
- script 的 CPU/memory/timer/无限循环限制；
- secrets 在 log/journal/transcript/output 的 redaction；
- crash/kill -9 后 artifact 完整性与 resume/retry 行为。

## 7. 对本项目架构决策的直接约束

1. 把当前观察到的 `parallel()` all-settled/null 和 `pipeline()` item-isolation 作为 **Qoder 1.1.20 compatibility profile**，不要未经测试升级为永久 canonical semantics。
2. 内部模型必须显式表达 output ordering、failure policy、item identity 和 attempt identity；否则无法兼容不同 Qoder 版本或提供更严格语义。
3. Qoder artifact 只作为导入/审计证据，不作为本项目稳定数据库 schema；上游当前路径已经跨 run/project/user 配置树。
4. UI 应把“官方已承诺”与“固定版本已验证”分开显示；unsupported/unknown 行为必须阻止“等价”声明。
5. 在 skip/retry/cancel 和 catalog precedence 的 PTY 黑盒测试完成前，不应锁定相应产品状态机。

## 参考资料

- Qoder, [Dynamic workflows](https://docs.qoder.com/cli/workflows)
- Qoder, [Permissions](https://docs.qoder.com/cli/permissions)
- Qoder, [Hooks](https://docs.qoder.com/cli/hooks)
- Qoder, [Sandbox](https://docs.qoder.com/cli/sandbox)
- Qoder, [Configuration Files and Application Order](https://docs.qoder.com/cli/settings)
- Qoder, [Documentation index](https://docs.qoder.com/llms.txt)
