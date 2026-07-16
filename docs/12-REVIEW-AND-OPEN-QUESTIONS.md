# Review and Open Questions：v0.6 Revised Baseline

- **版本**：v0.6
- **状态**：Self-reviewed
- **日期**：2026-07-17

## 1. Review 结论

本次重写确认：

1. 产品仍然是完整 Oncall Workflow Platform；
2. 问题不在平台范围，而在旧执行指令把多个风险阶段混成一个 Goal；
3. strict TDD 不适合所有工作；
4. M0 应先完成 Web Run 纵向闭环；
5. FlowGram 仍是正式选型，但移到 M1-A；
6. Durable Runtime 移到 M2；
7. Functional Gate 和 Hardening Gate 分离；
8. Evidence Bundle 只在稳定发布和高风险门禁使用；
9. 一个 Codex Goal 只交付一个用户结果；
10. 文档更新不再成为产品代码前置条件。

## 2. 已解决的主要冲突

### 完整平台 vs 快速交付

不是二选一。完整平台写入 PRD/Design/Roadmap；当前 Goal 只实现一个纵向切片。

### TDD vs 无测试

不采用 strict TDD，也不等于不测试。采用行为、风险和 Regression 驱动。

### FlowGram 早接入 vs 阻塞 Web

M0 先稳定 Definition/Run/Result；M1-A 用真实数据接入 FlowGram。它仍然早于 Builder。

### Durable Runtime vs 单进程

逻辑 API 和 Port 从 M0 稳定；物理 Durable Runtime 在 M2 实现。

### 验收严格 vs 交付速度

Functional Gate 优先；高风险阶段和稳定发布使用 Hardening Gate。

## 3. 对旧 v0.6 的 Review

旧草案存在以下系统性问题：

- 要求先完成 Code Conformance Matrix；
- 要求 M0 同时有 FlowGram、Queue、Lease、Crash、Event、SSE；
- 要求完整 Evidence Bundle；
- 要求连续多次 clean verification；
- 要求同一 Goal 通过 M0 后自动进入 M1；
- 要求同步更新大量文档；
- 容易诱导文件存在性、fixture 和未来接口测试。

这些要求已被本版 Supersede。

## 4. 当前无法确认的代码问题

由于当前环境无法读取 tag 归档，以下必须由本地 Codex 轻量确认：

- 实际启动命令；
- Web 技术栈和当前页面；
- API 路由；
- Workflow Definition 位置；
- Agent Runtime 接入方式；
- Fake Provider；
- Run 状态模型；
- 数据是否持久化；
- 当前测试；
- Docker 配置；
- `m0-v0.1.0` 实际 happy path。

确认这些事实不应先生成全量报告，只需找到阻塞 M0 Functional Gate 的最少问题。

## 5. 当前开放问题

### OQ-01 M0 状态存储

- 现有代码使用内存、文件还是数据库？
- 决策原则：不为替换而替换；能支持 M0 即保留，M1-B 再统一 PostgreSQL。

### OQ-02 当前 Web 是否已有节点视图

- 若已有，直接完善；
- 若没有，使用最简单可理解结构；
- 不在 M0 引入 FlowGram。

### OQ-03 Pi Agent Adapter

- 现有代码是否已接入真正 Pi Runtime？
- 若阻塞，可先保留 Fake Adapter，但必须有明确 Port；
- 不伪造真实 Provider 已完成。

### OQ-04 M2 Durable Backend

- PostgreSQL Queue 还是 Temporal？
- M2 Spike 后决策。

### OQ-05 M4 Builder 写回协议

- Command-based 还是 patch-based？
- M4 前保持 Deferred。

## 6. 下一 Review 触发

M0 Functional Gate 完成后 Review：

- 实际用户路径；
- 当前代码边界；
- 是否有明显技术债阻塞 M1；
- FlowGram 接入入口；
- PostgreSQL 是否应在 M1-B 引入；
- 下一 Goal 是否只包含 M1-A。

## 7. Review Checklist

- [x] PRD 保留完整产品范围；
- [x] Design 支持阶段演进；
- [x] ADR 明确 Supersede 旧策略；
- [x] Roadmap 有 Functional/Hardening Gate；
- [x] Testing 文档禁止低价值测试；
- [x] FlowGram 移至 M1-A；
- [x] Durable Runtime 移至 M2；
- [x] Codex Goal 只做 M0；
- [x] 文档不声明未知代码事实；
- [x] 文档间状态一致。

## 8. 当前决策

```text
Decision: EXECUTE M0 FUNCTIONAL GATE
Current code status: UNKNOWN UNTIL LOCAL RUN
FlowGram: M1-A
Durable Runtime: M2
Testing: BEHAVIOR + RISK + REGRESSION
Next bounded slice: WEB RUN VERTICAL SLICE
```
