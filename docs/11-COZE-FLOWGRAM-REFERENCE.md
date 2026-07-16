# Reference：Coze Studio 与 FlowGram 的借鉴边界

- **版本**：v0.6
- **状态**：Reference Baseline
- **日期**：2026-07-17

## 1. 决策摘要

- FlowGram：采用为 Workflow Canvas Framework；
- Coze Studio：产品和工程参考；
- Coze Studio 不作为底座；
- 不整体 Fork；
- 不采用其 Runtime 替换 Pi Agent 和自有 Workflow Runtime；
- 不复制其业务层组件作为当前实现捷径。

## 2. FlowGram 适合解决的问题

官方资料将 FlowGram 描述为可组合、可集成、可扩展的工作流开发框架和工具集，并提供 Canvas、Form、Variable Scope 和 Materials。

本项目使用它解决：

- Workflow Canvas；
- node/edge presentation；
- node configuration UI；
- variable/mapping UI（M4）；
- layout；
- visual plugins；
- Design/Test/Run 的统一视觉语言。

FlowGram 不解决：

- Oncall 领域模型；
- Workflow Definition 事实来源；
- Pi Agent Runtime；
- Durable Execution；
- Tool Policy；
- Human Interaction；
- Evidence；
- Memory；
- Team Security。

## 3. Coze 可借鉴

- Workflow Studio 信息架构；
- 节点视觉状态；
- 运行调试体验；
- Inspector/Panel 组织；
- Variable 与 Mapping UX；
- 发布和版本体验；
- Tool/Plugin 产品表达；
- 节点材料体系；
- 错误诊断呈现。

## 4. Coze 不直接采用

- 整体产品模型；
- Runtime；
- Eino 或其他执行底座；
- Agent/RAG/Marketplace 全范围；
- 发布渠道体系；
- 账号和商业化体系；
- 大量业务组件；
- 复杂低代码平台范围。

## 5. 采用阶段

| 能力 | 阶段 | 方式 |
|---|---|---|
| FlowGram Free Layout | M1-A | read-only projection |
| Auto Layout / Fit View | M1-A | 视觉辅助 |
| Node detail panel | M1-A | 自有数据 |
| Runtime Overlay | M1-A | Run/NodeRun 投影 |
| Form/Inspector | M4 | Authoring Command |
| Variable/Mapping UI | M4 | 映射自有 DSL |
| Export | M4 可选 | 只导出自有 Definition |
| FlowGram Runtime | 不采用 | 自有 Runtime |
| Coze Studio Fork | 不采用 | Reference only |

## 6. 关键差异

| 维度 | Coze 类平台 | 本项目 |
|---|---|---|
| 定位 | 通用 Agent/Workflow 开发平台 | 可信 Oncall Workflow Platform |
| Runtime | 平台自有完整 Runtime | Pi Agent Adapter + 自有 Workflow Control |
| 价值核心 | 广泛构建和发布 | Evidence、Human、Test、Audit、Recovery |
| Builder | 早期核心入口 | M4，晚于执行和业务验证 |
| Tool | 通用插件生态 | Policy/Approval/Evidence 优先 |
| Memory | 通用平台能力 | Reviewed/Scoped/Revocable |
| 协作 | 可扩展多人场景 | 小团队版本协作，不做实时协同 |

## 7. 风险

- FlowGram API 变化；
- 类型泄漏；
- bundle 和前端复杂度；
- 视觉功能诱发 Scope Creep；
- Demo 代码被当成业务模型；
- Coze UI 相似导致产品范围膨胀。

## 8. 控制

- Adapter；
- lockfile；
- M1-A read-only；
- M4 前不写回；
- 官方 package；
- contract tests；
- Coze reference-only；
- Product Model 独立；
- 每个 FlowGram Goal 只交付一个视觉闭环。

## 9. Review 问题

- 真实 Definition 是否唯一？
- Canvas 是否只投影服务端数据？
- Runtime 是否不依赖 FlowGram？
- visual metadata 是否与业务语义分离？
- 当前 Goal 是否偷偷进入 Builder？
- 是否复制了 Coze 业务层而非使用公开框架？
