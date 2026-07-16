# Validation Report：v0.6 Revised Documentation Package

- **版本**：v0.6
- **日期**：2026-07-17
- **结果**：Documentation Review PASS / Code Validation NOT EXECUTED
- **Review 类型**：跨文档架构、范围、里程碑和 Agent 执行策略 Review

## 1. Review 范围

检查：

- README；
- PRD；
- Design Doc；
- ADR；
- Roadmap；
- Documentation Governance；
- Memory；
- Testing UX；
- Feasibility；
- Milestone Acceptance；
- Visual Architecture；
- Coze/FlowGram Reference；
- Review/Open Questions；
- Code Baseline；
- Codex Goal；
- Changelog。

## 2. 核心一致性

### 产品范围

PASS：

- 仍然设计 M0–M5 完整 Oncall Workflow Platform；
- Tool、Human、Channel、Evidence、Test、Memory、Security 均保留；
- 未把平台降级成单纯 Demo。

### 实施顺序

PASS：

```text
M0 Web Run
→ M1 FlowGram/Persistence/Events
→ M2 Durable Runtime
→ M3 Golden Oncall
→ M4 Builder/Test
→ M5 Team/Memory/Production
```

### FlowGram

PASS：

- M0 不作为硬门槛；
- M1-A read-only；
- M4 Authoring；
- JSON Definition 仍是事实来源；
- FlowGram 不作为 Runtime。

### Runtime

PASS：

- M0 可单进程；
- M1 持久化和事件；
- M2 Worker/Attempt/Retry/Recovery；
- 当前实现不预建完整 Durable Infrastructure。

### Testing

PASS：

- 不强制 strict TDD；
- 明确 Contract/Integration/Regression/Smoke；
- 高风险状态机、migration、安全边界适合 test-first；
- 明确禁止文件存在性、DTO、框架默认行为和未来接口测试；
- M0 只要求核心 integration/smoke。

### Milestone

PASS：

- Functional Gate 与 Hardening Gate 分开；
- Stable Release 和高风险能力仍有严格 Hardening；
- 普通切片不强制 Evidence Bundle；
- 不要求连续多次 clean verify 作为功能前置。

### Codex Goal

PASS：

- 只有一个用户结果；
- 只做 M0；
- 先运行产品；
- 不先写测试/文档；
- 有明确允许简化、禁止项和停止条件；
- 完成后不自动进入 M1。

## 3. 冲突检查

已消除：

- M0 同时要求 FlowGram 和简单 Web；
- M0 同时要求单进程快速闭环和 Durable Worker；
- 平台完整设计被误解为当前一次实现；
- 所有代码 strict TDD；
- 全量文档和 Evidence 成为代码前置；
- 同一 Goal 跨多个里程碑。

## 4. 机械检查

- 所有核心 Markdown 使用 v0.6；
- 日期统一为 2026-07-17；
- README 本地文档链接有效；
- 文件命名与导航一致；
- 活跃包不包含 v0.4/v0.5 文档；
- Changelog 明确本版取代早期 v0.6 草案；
- Manifest 和 SHA256 在打包阶段生成；
- ZIP 内仅包含现行 v0.6 基线。

## 5. 自行 Review 后的关键修改

在初稿 Review 后确认并保留：

1. M0 的简单 UI 必须由共享/服务端 JSON Definition 驱动，避免纯硬编码 Demo；
2. M0 即使单进程，也必须保留 Run ID、Agent Adapter、State Repository 等演进边界；
3. FlowGram 移到 M1-A，但仍早于完整 Authoring；
4. Hardening 不能永久推迟：进入外部 Channel、写 Tool、团队使用和稳定发布前有明确 Gate；
5. 测试并非减少到没有，而是按行为和风险选择；
6. Codex 更新文档限制为 README、Roadmap 和轻量 Code Baseline。

## 6. 代码验证限制

未执行：

- `m0-v0.1.0` 文件审计；
- build；
- Docker；
- Web；
- Runtime；
- tests。

原因：当前环境无法解析 GitHub 主机，GitHub 连接器也无该仓库访问权限。

因此本报告只验证产品文档，不声明代码已经达到 M0。

## 7. 结论

本 v0.6 Revised Baseline 可以替代早期 v0.6 草案，并作为本地 Codex 的现行计划。

当前唯一执行动作：

```text
完成 M0 Web Run Functional Gate
```

完成后应基于真实代码更新轻量基线，再创建独立 M1-A Goal。
