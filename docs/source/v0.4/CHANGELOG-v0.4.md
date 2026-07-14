# v0.4 Documentation Changelog

- **日期**：2026-07-14
- **基线来源**：v0.3 文档集
- **变更类型**：全文一致性、可行性和自动验收增强

## 核心变化

1. 明确 `Workflow controls the process; Agent controls the reasoning`。
2. 纠正 Context Engineering 表述：Pi Agent/插件实现机制，平台定义 Policy、Scope、权限、版本、Provenance 和 Replay。
3. 不再建议平台重造通用 Agent Harness。
4. 增加 DeerFlow 借鉴边界：复用 Harness 工程经验，不采用全局 Lead Agent 替代 Workflow Engine。
5. 增加 Thread、Incident、Node Run Attempt、Execution Event 和 Artifact 语义。
6. 明确 Tool、Skill、Subagent 和 Workflow Node 的区别。
7. 增加 Agent Budget、Completion Contract 和 No-progress 终止。
8. 将 M2 的决策从“无条件采用 Temporal”调整为“必须采用 Durable Execution，Temporal 经 M1 Spike 后确认”。
9. Memory 改为 Episode Only → Shadow → Offline A/B → Controlled Retrieval。
10. 完整 Builder 保持在 M4，不提前锁死 DSL。
11. 任意代码路径延后到具备 Sandbox 和团队安全能力之后。
12. 每个 Milestone 增加一键自动验收命令和明确 Evidence Bundle。
13. M3 区分平台确定性验收与真实业务价值评测，不使用单一 LLM Judge 代替人工风险复核。
14. 增加全文可行性分析和阶段 Go/Rework/Pivot 规则。
15. 文档内容改为面向产品与工程决策者，减少不必要的 TypeScript/Web 实现细节。

## 新增文件

- `08-FEASIBILITY-ANALYSIS.md`
- `09-MILESTONE-AUTOMATED-ACCEPTANCE.md`
- `CHANGELOG-v0.4.md`
- `VALIDATION.json`

## Milestone 主验收命令

```bash
make verify-m0
make verify-m1
make verify-m2
make verify-m3
make verify-m4
make verify-m5
```

## 迁移建议

v0.4 应作为新的 Active Development Baseline。v0.3 保留历史，但不得继续作为 Coding Agent 的默认实施依据。
