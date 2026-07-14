# Specification：Milestone Automated Acceptance

- **版本**：v0.4
- **状态**：Active Acceptance Baseline
- **日期**：2026-07-14
- **适用阶段**：M0–M5
- **关联文档**：[Roadmap](./04-ROADMAP.md) · [Workflow Testing UX](./07-WORKFLOW-TESTING-UX.md) · [Feasibility Analysis](./08-FEASIBILITY-ANALYSIS.md)

---

## 1. 目标

每个 Milestone 必须有一条最直观的验收命令：

```bash
make verify-m0
make verify-m1
make verify-m2
make verify-m3
make verify-m4
make verify-m5
```

命令负责：

- 搭建隔离环境；
- 准备 Fixture；
- 运行测试；
- 注入故障；
- 收集证据；
- 生成报告；
- 给出阶段结论。

用户不需要理解每个测试框架或 Web 实现细节。

---

## 2. 验收原则

1. 验收必须可重复；
2. 普通 CI 不依赖真实模型；
3. 确定性断言优先；
4. 真实模型评测与平台 CI 分开；
5. 故障路径与 Happy Path 同等重要；
6. 每项 Requirement 必须映射到 Test 和 Evidence；
7. 失败必须可定位和可复现；
8. 不允许通过重跑掩盖 Flaky Test；
9. 安全失败不能被 LLM Judge 分数抵消；
10. Milestone 结论必须由报告生成，不凭演示口头宣布。

---

## 3. 执行层级

### Fast

每个 Pull Request 运行，目标数分钟：

- Schema；
- Compiler；
- 状态机；
- Policy；
- 纯逻辑；
- 文档链接和示例。

### Integration

每个 Pull Request 或主分支运行：

- PostgreSQL；
- Worker；
- Fake Provider；
- API；
- Queue；
- Event；
- Test Service。

### Nightly

每天运行：

- 批量与长时间测试；
- Crash Matrix；
- Backup/Restore；
- Browser Matrix；
- Resource Leak；
- Dependency/Security Scan。

### Release Acceptance

Milestone 退出前运行：

- 完整 `make verify-mN`；
- 隔离环境；
- 从空数据开始；
- 生成不可变 Evidence Bundle；
- 由 Owner Review 结论。

---

## 4. 标准测试替身

### Fake Provider

支持可配置响应：

- 正常文本；
- 结构化输出；
- 鉴权失败；
- Rate Limit；
- 延迟和超时；
- 流式中断；
- 空输出；
- 非法 Schema；
- Human Interaction 请求；
- Tool Call；
- 固定 Token/Cost 元数据。

### Tool Stub

支持：

- 固定成功结果；
- 空结果；
- 超时；
- 可重试失败；
- 不可重试失败；
- side effect 已发生但响应丢失；
- 大输出；
- 包含测试 Secret；
- Evidence 不完整。

### Human Script

支持：

- 正常回复；
- 多轮回复；
- Invalid Schema；
- Wrong Actor；
- Wrong Thread；
- Duplicate Reply；
- Late Reply；
- No Reply / Timeout。

### Channel Simulator

支持：

- Trigger；
- Ack；
- Interaction Delivery；
- Reply；
- Output；
- Duplicate Event；
- Out-of-order Event；
- Invalid Signature；
- Replay Attack；
- Delivery Retry。

### Test Clock

允许立即推进到：

- Queue Lease Expiry；
- Interaction Timeout；
- Retry Backoff；
- Schedule Time；
- Memory TTL；
- Artifact Expiry。

测试不得真实等待数小时或数天。

---

## 5. 标准故障注入点

系统在测试构建中提供命名故障点：

```text
after_run_created
before_node_started
after_node_started
before_model_request
after_model_request_before_persist
after_tool_request
before_tool_result_persist
after_interaction_created
before_signal_consumed
after_signal_consumed
before_run_finalize
```

每个故障点可以：

- 终止 Worker；
- 抛出错误；
- 断开数据库；
- 延迟；
- 重复投递；
- 丢弃响应。

验收程序通过配置启用，不要求用户修改代码。

---

## 6. Evidence Bundle

标准目录：

```text
artifacts/acceptance/<milestone>/<run-id>/
├── report.md
├── report.json
├── requirement-matrix.csv
├── environment.json
├── versions.json
├── test-results/
├── event-exports/
├── logs/
├── screenshots/
├── metrics/
└── support-bundle/
```

`environment.json` 至少记录：

- Git Commit；
- 文档版本；
- Workflow Schema Version；
- Database Migration Version；
- Pi Agent Version；
- Container Image Digests；
- OS / Architecture；
- 测试配置 Hash。

不得记录真实 Secret。

---

## 7. Requirement Traceability

每个阶段要求使用稳定 ID：

```text
M0-R01 Docker bootstrap
M0-R02 Workflow validation
M0-R03 Happy path
...
```

矩阵：

| Requirement | Test | Evidence | Result | Blocking |
|---|---|---|---|---|
| M0-R01 | M0-T01 | compose-health.json | PASS | Yes |
| M0-R02 | M0-T02 | validation-response.json | PASS | Yes |

新增或修改 Milestone Requirement 时，必须同步更新测试映射。

---

# 8. M0 Acceptance Suite

## 命令

```bash
make verify-m0
```

## Blocking Tests

| ID | 场景 | 通过条件 |
|---|---|---|
| M0-T01 | Clean Bootstrap | 空环境一键启动，所有 readiness 通过 |
| M0-T02 | Doctor | 缺失配置能给出明确诊断 |
| M0-T03 | Valid Definition | 导入并生成不可变版本 |
| M0-T04 | Invalid Definition | 返回节点/字段级错误 |
| M0-T05 | Happy Path | 三个节点按序成功，输出可查看 |
| M0-T06 | Provider Auth Failure | Agent Failed、Output Skipped、Run Failed |
| M0-T07 | Provider Timeout | 明确超时分类，不永久 Running |
| M0-T08 | Worker Crash | 租约恢复后明确完成或失败 |
| M0-T09 | Full Restart | 历史 Run 和输出仍存在 |
| M0-T10 | Browser Smoke | 页面运行和查看详情成功 |
| M0-T11 | Secret Redaction | 日志/API/DB 导出无 Secret |
| M0-T12 | Support Bundle | 可生成且已脱敏 |

## 结论规则

任一 Blocking Test 失败：`REWORK`。

---

# 9. M1 Acceptance Suite

## 命令

```bash
make verify-m1
```

## Blocking Tests

| ID | 场景 | 通过条件 |
|---|---|---|
| M1-T01 | 100-run Batch | 无状态泄漏，结果与 Fixture 一致 |
| M1-T02 | Attempt History | Retry 不覆盖旧 Attempt |
| M1-T03 | Crash Matrix | 每个故障点有可解释终态 |
| M1-T04 | Duplicate Claim | 不产生重复节点业务效果 |
| M1-T05 | Cancel | Running/Queued 均可终止 |
| M1-T06 | SSE Resume | 断线续传无遗漏，重复事件无副作用 |
| M1-T07 | Completion Contract | 空输出/非法 Schema 不得成功 |
| M1-T08 | Budget | Token/Time/No-progress 超限终止 |
| M1-T09 | Model Capability | 不支持的配置在 Preflight 阻断 |
| M1-T10 | Test Isolation | 不触发生产 Output/Secret/Tool |
| M1-T11 | Replay/Compare | 输出路径、版本、成本差异可见 |
| M1-T12 | Backup/Restore | 恢复后历史和测试可查询 |
| M1-T13 | Pi Compatibility | 支持版本通过统一契约 |
| M1-T14 | Durable Spike | 等待、Signal、Timer、重启验证完成 |

---

# 10. M2 Acceptance Suite

## 命令

```bash
make verify-m2
```

## Blocking Tests

| ID | 场景 | 通过条件 |
|---|---|---|
| M2-T01 | No Interaction | Agent 直接完成，无额外等待 |
| M2-T02 | Agent A Asks | 正确进入 Waiting |
| M2-T03 | Agent B Asks | 正确进入 Waiting |
| M2-T04 | Restart While Waiting | 重启后 Interaction 仍存在 |
| M2-T05 | Valid Reply | 恢复同一 Node 并继续 |
| M2-T06 | Duplicate Reply | 重放十次只消费一次 |
| M2-T07 | Invalid Reply | Wrong Actor/Thread/Schema 被拒绝 |
| M2-T08 | Timeout | Test Clock 推进后按定义转移 |
| M2-T09 | Max Turns | 达到上限后终止或备用分支 |
| M2-T10 | Cancel Waiting | Run 与 Interaction 正确取消 |
| M2-T11 | Controlled Loop | Exit 和 Max Iteration 均有效 |
| M2-T12 | Child Workflow | 成功、失败、取消传播正确 |
| M2-T13 | Thread Concurrency | 符合 serialize/queue 策略 |
| M2-T14 | Context Continuity | 压缩后关键问题、回复、Evidence 保留 |

---

# 11. M3 Acceptance Suite

## 命令

```bash
make verify-m3
```

它依次运行：

```bash
make verify-m3-ci
make evaluate-m3
```

## 平台 Blocking Tests

| ID | 场景 | 通过条件 |
|---|---|---|
| M3-T01 | Feishu Signature | 无效签名拒绝 |
| M3-T02 | Trigger Dedup | 重复事件仅创建一次 Run |
| M3-T03 | Reply Correlation | 回复绑定正确 Thread/Interaction |
| M3-T04 | Delivery Retry | 重试不产生重复用户可见输出 |
| M3-T05 | Tool Policy | 未授权 Tool 被阻断 |
| M3-T06 | Tool Failure | 不伪装成功，Evidence 状态清晰 |
| M3-T07 | Large Tool Output | 完整内容进 Artifact，Context 只含摘要 |
| M3-T08 | Evidence | 关键结论能链接来源 |
| M3-T09 | Skill Version | 运行绑定正确 Skill 版本 |
| M3-T10 | Artifact Security | 越权和主动内容风险被阻断 |
| M3-T11 | Memory Hard Gates | Secret/Scope/TTL/Conflict 正确处理 |
| M3-T12 | Channel Security | Allowlist、Replay、Responder 规则有效 |

## 业务 Evaluation

固定数据集至少包含：

- 正常 Happy Path；
- 缺少关键输入；
- Tool 空结果；
- Tool 错误；
- 多原因相似症状；
- 过期 Runbook；
- 冲突 Evidence；
- 不应提问的简单问题；
- 必须提问才能继续的问题；
- 高风险误导案例。

报告指标：

- Time to First Useful Diagnosis；
- Evidence Coverage；
- Unnecessary Question Rate；
- Human Correction Rate；
- Severe Misleading Rate；
- Completion Rate；
- Cost and Latency；
- Run-to-run Variance；
- Memory Lift（启用后）。

业务结论不能仅由自动 Judge 决定。严重案例、Judge 分歧和抽样案例需要盲化人工复核。

---

# 12. M4 Acceptance Suite

## 命令

```bash
make verify-m4
```

| ID | 场景 | 通过条件 |
|---|---|---|
| M4-T01 | Visual Create | 不编辑 JSON 创建可运行 Workflow |
| M4-T02 | Save/Reopen | 重新打开结构一致 |
| M4-T03 | Round Trip | Builder↔JSON 无语义丢失 |
| M4-T04 | Invalid Graph | 非法连接和不可达节点被阻断 |
| M4-T05 | Loop Validation | 无退出条件不能发布 |
| M4-T06 | Integrated Test | Fixture、Interaction、Assertion 可完成 |
| M4-T07 | From Run | 失败 Run 可生成可复现 Test Case |
| M4-T08 | Version Diff | 解释路径、权限、版本和配置变化 |
| M4-T09 | Publish Gate | Required Suite 失败时阻断 |
| M4-T10 | Visual Regression | 关键页面无未批准变化 |
| M4-T11 | Accessibility | 键盘导航和基础检查通过 |
| M4-T12 | Browser Matrix | 支持浏览器 E2E 通过 |

---

# 13. M5 Acceptance Suite

## 命令

```bash
make verify-m5
```

| ID | 场景 | 通过条件 |
|---|---|---|
| M5-T01 | RBAC Matrix | 每个角色只拥有声明权限 |
| M5-T02 | Workspace Isolation | 跨 Workspace 读取全部被拒绝 |
| M5-T03 | Secret Rotation | 新凭据生效，旧凭据失效 |
| M5-T04 | Secret Scan | Log/Event/Artifact 无明文 Secret |
| M5-T05 | Sandbox Filesystem | 无法越界读取/写入 |
| M5-T06 | Sandbox Network | 网络策略有效 |
| M5-T07 | Resource Limits | CPU/Memory/Timeout 有效 |
| M5-T08 | Quota/Concurrency | 超限被排队或拒绝 |
| M5-T09 | Audit Immutability | 普通用户不能篡改 |
| M5-T10 | Artifact/Memory ACL | 越权访问被拒绝 |
| M5-T11 | Retention | 到期数据按规则处理 |
| M5-T12 | Load/Degradation | 达到目标容量且可降级 |
| M5-T13 | Upgrade/Rollback | 升级与回滚演练成功 |
| M5-T14 | Disaster Recovery | 从 Backup 恢复至目标点 |
| M5-T15 | Platform Oncall | 故障触发告警和 Runbook |
| M5-T16 | Supply Chain | 镜像和依赖门禁通过 |

---

## 14. Flaky Test Policy

- 同一测试一周内出现两次非产品原因失败即标记 Flaky；
- Flaky Test 不能作为 Release Gate 继续静默重跑；
- 必须有 Owner、Issue 和修复期限；
- 在修复前，将其结果标记为 Warning 需要架构 Owner 明确批准；
- 安全、数据完整性和幂等测试不得降级为非阻断。

---

## 15. 真实模型策略

### CI

使用 Fake Provider 或 Recorded Response。

### Nightly Evaluation

可以调用真实模型，但必须：

- 固定模型标识和参数；
- 记录 Provider、版本和时间；
- 设置成本上限；
- 重复运行；
- 不把随机措辞差异当失败；
- 保留原始结果用于分析。

### Release Business Evaluation

- 使用固定 Evaluation Set；
- 与基线比较；
- 评测者盲化版本；
- 严重安全案例全部人工复核；
- 报告模型波动和置信区间，不只给平均分。

---

## 16. 最终报告格式

```text
Milestone: M2
Result: GO | CONDITIONAL GO | REWORK | PIVOT
Commit: ...
Document Version: v0.4
Environment: ...

Blocking Tests: 14/14 passed
Warnings: 2
Flaky Tests: 0
Security Findings: 0 blocking
Evidence Bundle: ...

Exit Criteria Assessment
- Durable waiting: PASS
- Duplicate reply protection: PASS
- Restart recovery: PASS

Open Risks
- ...

Decision
- ...
```

---

## 17. 结论

这套验收机制的目标不是追求“测试数量最多”，而是建立一个直观的阶段证明：

> **运行一条命令，就能知道该 Milestone 的核心假设是否成立、哪里失败、证据在哪里，以及是否应该进入下一阶段。**
