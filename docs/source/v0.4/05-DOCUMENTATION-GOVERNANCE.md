# Documentation Governance：长期项目文档管理机制

- **版本**：v0.4
- **状态**：Active
- **日期**：2026-07-14
- **适用项目**：基于 Pi Agent 的 Oncall Workflow Platform

---

## 1. 核心结论

采用：

> **稳定文档层级 + 单一事实来源 + Docs-as-Code + ADR 单向追加 + Milestone 自动化证据。**

不同文档回答不同问题：

| 文档 | 回答的问题 |
|---|---|
| PRD | 为什么做、为谁做、做什么、如何判断价值 |
| Design Doc | 系统边界、执行语义和风险是什么 |
| ADR | 为什么选择某个重要且难逆的决策 |
| Roadmap | 先验证什么、阶段退出门槛是什么 |
| Implementation Plan | 当前 Milestone 如何落地 |
| Acceptance Spec | 如何自动证明阶段达标 |
| API / Schema Spec | 可执行契约是什么 |
| Runbook | 如何部署、运维、排障和回滚 |
| Feasibility Analysis | 方案是否现实、依赖和风险是什么 |

不要让一种文档承担其他文档的职责。

## 2. 推荐目录

```text
docs/
├── README.md
├── product/
│   ├── PRD.md
│   ├── metrics.md
│   └── use-cases/oncall-golden-workflow.md
├── design/
│   ├── system-overview.md
│   ├── workflow-runtime.md
│   ├── workflow-dsl.md
│   ├── pi-runtime-integration.md
│   ├── context-policy.md
│   ├── interaction-runtime.md
│   ├── tool-skill-subagent.md
│   ├── artifact-workspace-sandbox.md
│   ├── memory.md
│   ├── workflow-testing-ux.md
│   └── integrations/feishu.md
├── adr/
│   ├── README.md
│   └── NNNN-title.md
├── roadmap/
│   ├── ROADMAP.md
│   └── milestone-history.md
├── plans/
│   ├── M0/
│   │   ├── implementation-plan.md
│   │   ├── acceptance-test.md
│   │   ├── rollout.md
│   │   └── retrospective.md
│   └── ...
├── specs/
│   ├── workflow-schema/
│   ├── events/
│   ├── api/
│   └── errors/
├── runbooks/
│   ├── local-development.md
│   ├── deployment.md
│   ├── backup-restore.md
│   └── incident-response.md
├── research/
├── references/
└── archive/superseded/
```

v0.4 仍可暂时使用八份汇总文档，但进入编码后应按上面目录逐步拆分。

## 3. 单一事实来源

- 产品目标：PRD；
- 总体架构：System Overview / Design Doc；
- 决策状态：ADR Index；
- 当前阶段：Roadmap；
- 自动验收：Acceptance Spec；
- Workflow Schema：版本化 Schema；
- Interaction：Interaction Design；
- Memory：Memory Design；
- Test UX：Workflow Testing UX。

外部研究、聊天和 Agent Memory 不能成为强制项目规则的唯一来源。

## 4. 文档元数据

正式文档应包含：

```yaml
title: ...
version: ...
status: draft | proposed | accepted | deprecated | superseded | archived
owner: ...
reviewers: [...]
created: YYYY-MM-DD
last_reviewed: YYYY-MM-DD
next_review: YYYY-MM-DD
related: [...]
supersedes: [...]
superseded_by: [...]
```

决策状态与实施阶段必须分开：

```yaml
status: accepted
implementation_stage: M4
```

禁止 `Accepted / Deferred` 组合状态。

## 5. 文档生命周期

- **Draft**：不能作为实施依据；
- **Proposed**：等待 Review；
- **Accepted**：当前基线；
- **Deprecated**：仍可使用但不新增依赖；
- **Superseded**：被新文档替代；
- **Archived**：仅保留历史。

禁止：

- 静默修改历史 ADR；
- 删除导致历史链接失效；
- 两个 Accepted PRD 并存；
- 用文件名堆叠 `final-v7-new`；
- 让研究报告自动升级为决策。

## 6. PRD 管理

PRD 保持长期稳定，包含：

- 问题；
- 用户；
- 目标与非目标；
- 核心场景；
- 原则；
- 功能域；
- 成功指标；
- 约束和开放问题。

Milestone 的详细任务、自动测试和退出门槛放在 Roadmap 与 Plan，不在 PRD 重复。

## 7. Design Doc 管理

总体设计只保留稳定边界。满足以下任一条件应新增子系统 Design Doc：

- 跨两个以上模块；
- 新增持久化模型；
- 改变 API / Schema；
- 引入外部基础设施；
- 有迁移和兼容风险；
- 改变安全边界；
- 需要多个方案比较；
- 预计实现超过一个开发周期。

实现完成后记录：

- 实际差异；
- 未实现项；
- 性能结果；
- 遗留风险；
- 新 ADR。

不能把实现偏差偷偷改成“原本设计”。

## 8. ADR 管理

一个重要决策一个文件，最小结构：

```markdown
# ADR-NNNN: Title

- Status:
- Date:
- Owners:
- Implementation Stage:
- Related:

## Context
## Decision
## Alternatives Considered
## Consequences
## Migration / Rollback
## Validation
```

适合 ADR 的内容：

- Runtime；
- Execution Backend；
- Storage；
- DSL；
- Security；
- Versioning；
- Sandbox；
- Channel；
- Context Policy；
- Memory Governance。

不适合：

- 变量名；
- 一次性 Bug；
- 小组件样式；
- 容易改回的局部实现。

决策改变时新建 ADR，旧 ADR 标记 Superseded 并双向链接。

## 9. Roadmap 管理

Roadmap 管：

- 关键问题；
- Outcome；
- Scope；
- Non-goals；
- Dependencies；
- 自动化验收；
- Exit / Rework / Pivot Criteria。

Issue Tracker 管具体任务。

更远阶段只锁 Outcome 和风险，不伪造精确日期。

## 10. Milestone Plan 与验收证据

每个阶段必须有：

```text
implementation-plan.md
acceptance-test.md
rollout.md
retrospective.md
```

Milestone 完成条件：

1. `make verify-mN` 返回成功；
2. 验收报告已保存；
3. 所有 Exit Criteria 有 Test ID 或人工证据；
4. 已记录 Design 与实现差异；
5. 已知限制和残余风险被批准；
6. Roadmap 和 ADR 已同步；
7. Retrospective 完成。

演示成功不能代替验收。

## 11. 自动化文档门禁

CI 至少检查：

- Markdown 链接；
- 必需元数据；
- 版本号一致；
- ADR 编号唯一；
- Superseded 链接；
- Accepted 文档 Owner；
- Workflow JSON 示例通过 Schema；
- Event 和 API 示例通过契约；
- Mermaid / Code Block 基础语法；
- 文档索引无遗漏；
- Roadmap 每个 Milestone 有主验收命令；
- Exit Criteria 能映射到 Acceptance Test；
- 禁止出现过期的组合状态；
- 引用的文件路径真实存在。

## 12. 文档可行性 Review

每次重大版本更新需要一份 Feasibility Review，至少检查：

- 产品范围是否过宽；
- 核心依赖是否已验证；
- 阶段顺序是否正确；
- 是否重复实现 Pi 或外部基础设施能力；
- 每个阶段是否有可自动验证的退出门槛；
- 哪些结果不能全自动判断；
- 安全边界是否早于真实接入；
- Migration 和 Rollback 是否存在；
- 实施团队是否能理解文档。

## 13. Review Cadence

### 每个 PR

检查：文档、Schema、ADR、Migration、安全、验收测试和 Runbook。

### 每周

检查：当前 Milestone 阻塞、新 Proposal、文档与代码漂移、自动验收失败和 Scope Creep。

### 每月

检查：PRD Scope、Roadmap、ADR Index、Open Questions、Metrics、Pi 和关键依赖版本。

### 每个 Milestone

- 运行完整验收；
- 归档 Evidence；
- 完成 Retrospective；
- 更新 Feasibility；
- 做 Go / Rework / Pivot 决策。

## 14. 文档与 Agent 的关系

Coding Agent：

- 先读取 docs/README；
- 只加载当前 Milestone、相关 Design 和 ADR；
- 不默认读取 Archive、Rejected 或无关 Research；
- 不从聊天推导新需求；
- 不自行把 Proposal 改为 Accepted；
- 改变公开契约时同步 Schema 和验收；
- 生成文档后必须由 Owner Review。

Context Engineering 的文档也遵守最小加载原则：不要把全部项目文档无差别注入 Agent。
