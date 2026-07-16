# Current Code Baseline：`m0-v0.1.0`

- **文档版本**：v0.6
- **状态**：Local Inspection Required
- **日期**：2026-07-17
- **目标 ref**：`m0-v0.1.0`

## 1. 当前限制

本次文档环境无法访问 GitHub tag 归档，因此没有文件级代码结论。

这不表示代码不存在，也不表示 M0 未实现；只表示需要在本地仓库运行和观察。

## 2. 轻量基线原则

不要先创建全量 Requirement Matrix。只确认完成当前 Goal 所需的事实：

| 问题 | 结果 | 证据 |
|---|---|---|
| 项目如何启动？ | Unknown | command/output |
| Web 入口在哪里？ | Unknown | file/path |
| API 入口在哪里？ | Unknown | file/path |
| 当前 Workflow Definition 在哪里？ | Unknown | file/path |
| Agent Runtime 如何调用？ | Unknown | symbol/path |
| Fake Provider 是否存在？ | Unknown | symbol/path |
| Run 状态在哪里？ | Unknown | symbol/path |
| happy path 是否工作？ | Unknown | browser/API result |
| 当前阻塞是什么？ | Unknown | exact error |

本地 Codex 只需填充这些项目，不需要为每个文件和未来 Requirement 创建矩阵。

## 3. 代码状态

对能力使用：

- Unknown
- Implemented
- Demonstrated
- Verified
- Blocked

### M0 Functional Gate

| Capability | Status | Notes |
|---|---|---|
| startup | Unknown | |
| Web page | Unknown | |
| workflow view | Unknown | |
| prompt input | Unknown | |
| run action | Unknown | |
| agent execution | Unknown | |
| output display | Unknown | |
| fake provider | Unknown | |
| smoke/integration | Unknown | |
| README reproduction | Unknown | |

## 4. 本地检查步骤

建议直接执行仓库已有命令：

```bash
git status --short
git rev-parse HEAD
git describe --tags --always
```

然后：

1. 阅读 README；
2. 找到 package/compose/Makefile；
3. 启动项目；
4. 打开 Web；
5. 执行一次最小 Workflow；
6. 记录第一个真实阻塞；
7. 立即修复产品代码。

不要先：

- 写架构报告；
- 补齐全部测试；
- 生成 Evidence Bundle；
- 更新所有文档；
- 设计 M2 数据库。

## 5. 完成后更新

完成 M0 Goal 后，只需填写：

```text
Ref/Commit:
Startup command:
Web URL:
Workflow used:
Provider:
Observed user path:
Tests run:
M0 Functional Gate: DEMONSTRATED / VERIFIED / BLOCKED
Remaining blocker:
```

## 6. 进入 M1 的判断

只有 M0 Functional Gate 真实可运行，才创建新的 M1-A Goal。

无需等待：

- Crash Recovery；
- Evidence Bundle；
- 完整 Test Matrix；
- FlowGram；
- M2 Durable Hardening。
