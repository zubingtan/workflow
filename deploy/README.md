# workflow 部署 runbook

把 workflow 部署到**你自己的服务器**并用飞书 bot 验证闭环。**单实例**生产构建
（#295），挂载 `/workflow` 子路径（#297 base path），supervisord/systemd 管进程，
nginx 保前缀反代。

**快速开始**（clone 之后）：

```bash
./install.sh                      # 交互式：按提示填域名等
# 或全自动：
./install.sh --yes --host app.example.com
```

## 部署前收集（你的环境值）

| 值                          | 说明                                     | 示例                   |
| --------------------------- | ---------------------------------------- | ---------------------- |
| `<host>`                    | 服务器对外域名                           | `workflow.example.com` |
| `<server>`                  | ssh 地址                                 | `user@10.0.0.5`        |
| `<app-id>` / `<app-secret>` | 飞书自建应用凭证（trigger/bot 节点共用） | `cli_xxx`              |
| `<chat-id>`                 | 验证群 chat_id（bot 已加入）             | `oc_xxx`               |
| `<bot-open-id>`             | 被 @ 的 bot open_id                      | `ou_xxx`               |
| `<data-dir>`                | 数据目录                                 | `~/.config/workflow`   |

## 一键部署（install.sh）

```bash
./install.sh [选项]
```

**选项**：

| 选项               | 默认值               | 说明                                     |
| ------------------ | -------------------- | ---------------------------------------- |
| `--host <域名/IP>` | 交互询问             | nginx server_name（`--yes` 时取本机 IP） |
| `--port <n>`       | `4000`               | workflow 端口                            |
| `--base-path <p>`  | `/workflow`          | 子路径（构建与 nginx 一致）              |
| `--data-dir <d>`   | `~/.config/workflow` | 数据目录（SQLite + agents + logs）       |
| `--yes` / `-y`     | 关                   | 跳过交互，全部用默认值                   |
| `--skip-nginx`     | 关                   | 不动 nginx                               |
| `--skip-process`   | 关                   | 不注册进程管理器（nohup 手动启动）       |
| `--help` / `-h`    | —                    | 帮助                                     |

**它做什么**（每步有日志，缺依赖会提示怎么装）：

1. **检测工具链**：Node 22（版本校验）、pnpm（corepack 自动启用）、nginx、
   进程管理器（supervisord → systemd → nohup 兜底）
2. **安装 + 构建**：`pnpm install --frozen-lockfile` → `BASE_PATH=... pnpm build`
3. **注册进程**：
   - supervisord：渲染 `deploy/supervisord/workflow.conf`（workflow + fake-provider）
   - systemd：渲染 `deploy/systemd/workflow.service.example`（无 supervisord 时）
   - nohup：直接启动（警告：不会自动重启）
4. **接入 nginx**：
   - 无配置时：从 `deploy/nginx/workflow-server.conf.example` 生成完整 server 块
     （`server_name <host>` + `/workflow` location，含 SSE 调优）
   - 已有配置时：server_name 冲突检测（nginx 会静默遮蔽后加载者，这里失败即报错）
   - `nginx -t` 验证 → reload
5. **导入模板**：Feishu Echo Reply workflow（幂等）
6. **健康检查 + 下一步指引**（填凭证、验证命令）

> 手动接入 nginx（不想用 install.sh 的 nginx 部分）：把
> `deploy/nginx/workflow-location.conf`（location 片段）include 进你的 server 块，
> 或直接参考 `deploy/nginx/workflow-server.conf.example` 写一个完整的 server 块。

## 配置（UI 操作）

打开 `https://<host>/workflow`：

1. **填凭证**（三处，同一自建应用）：
   - Feishu Trigger 节点：App ID / App Secret（填了才建长连接；#295 单连接纪律：只有一个环境填）
   - Feishu Bot 节点：App ID / App Secret（app 模式发消息）
   - LLM 节点：选 agent——验证期指向 fake-provider 的 agent（base_url
     `http://127.0.0.1:<fake-provider-port>/v1`，任意 api_key/model）；验收后换真实供应商，
     模板不用改（#294）
2. **飞书应用侧**（#298）：事件订阅方式为长连接；已订阅 `im.message.receive_v1`；
   权限含"接收群聊中 @机器人消息事件"；bot 已在验证群（`<chat-id>`）；权限变更需发布版本
3. 保存 trigger 后确认日志出现长连接建立（`<data-dir>/logs/`）

## 验证闭环（#296）

**本地机器**（feishu-im 依赖你的飞书登录态；`FEISHU_IM_MCP_URL` 配置见
`~/.agents/skills/feishu-im/SKILL.md`）：

```bash
# 1. 隧道（fake-provider 通常只在服务器内网可达；同机执行可跳过）
ssh -L 4010:127.0.0.1:4010 <server>

# 2. 跑验证（默认 FAKE_BASE=http://127.0.0.1:4010；按需覆盖群/机器人）
CHAT_ID=<chat-id> BOT_OPEN_ID=<bot-open-id> \
  bash deploy/verify/verify-feishu-echo.sh
```

脚本动作：

1. `PUT http://127.0.0.1:4010/test/control` 注册 `verify-<ts>` → `echo-<ts>`（确定性回复）
2. 真 @ bot 发消息 `verify-<ts>` 到验证群
3. 从群消息定位 thread_id，轮询话题（90s 超时）
4. 断言 bot 回复 == `echo-<ts>`（严格相等）

跑通即代表完整闭环：飞书事件 → 长连接 → trigger 匹配（allowlist 校验群）→ workflow run
→ LLM（fake-provider 确定性回复）→ Feishu Bot 话题内回复 → 断言。

**排障**：

- 无回复：先看 Dashboard Run 历史（`/workflow` → History）——run 未出现 = 事件没进来
  （凭证/权限/allowlist）；run 失败 = 看 LLM/Feishu Bot 节点报错
- `curl https://<host>/workflow/health/live` 应返回 JSON
- 长连接数哨兵（可选）：`event/v1/connection` 接口断言 App 级连接数 == 1
- 进程反复重启 + `EADDRINUSE`：端口被遗留进程占用——`ss -ltnp | grep :4000`
  找到占用者停掉后重启服务

## 更新部署

```bash
# 服务器上
bash deploy/deploy.sh    # git reset main → install → build(BASE_PATH=/workflow) → supervisorctl restart → 健康检查
```

## 高级：bootstrap（幂等初始化 / 历史迁移）

`deploy/bootstrap.sh` 是 install.sh 的前身，面向"已有一台在跑服务的服务器"（幂等重跑、
旧栈清理、历史 nginx 配置迁移）。新部署请直接用 install.sh；有历史遗留
（如独立完整 nginx 配置 `/tmp/workflow-nginx.conf` 需要正式化）时：

```bash
NGINX_SRC=/tmp/workflow-nginx.conf SERVER_NAME=<host> bash deploy/bootstrap.sh
```

**可配置项**（install.sh 与 bootstrap.sh 通用，环境变量覆盖）：

| 变量                  | 默认值                            | 说明                                                                            |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| `WF_USER` / `WF_HOME` | 当前用户 / `$HOME`                | 部署用户                                                                        |
| `WF_DIR`              | `$WF_HOME/projects/workflow`      | 仓库位置                                                                        |
| `NODE_BIN`            | `command -v node`                 | Node 22 可执行文件（nvm 环境建议显式指定绝对路径）                              |
| `NGINX_SITE`          | `/etc/nginx/conf.d/workflow.conf` | 写入的 conf.d 片段                                                              |
| `NGINX_SRC`           | 空                                | 可选：独立完整 nginx 配置（如历史遗留 `/tmp/*.conf`），存在则转换为 conf.d 片段 |
| `SERVER_NAME`         | 空（第一个 server 块）            | 承载 /workflow 的 server 块 server_name                                         |
| `SUPERVISOR_DIR`      | `/etc/supervisor/conf.d`          | supervisord 配置目录                                                            |
| `BASE_PATH`           | `/workflow`                       | 子路径（与构建时一致）                                                          |
| `PORT`                | `4000`                            | workflow 端口                                                                   |
| `FAKE_PROVIDER_PORT`  | `4010`                            | fake-provider 端口                                                              |

## 关键决策索引

| #    | 决策                                                                                |
| ---- | ----------------------------------------------------------------------------------- |
| #292 | 应用感知 base path（nginx 不剥前缀）；nginx 剥前缀判死                              |
| #293 | 服务器拉代码构建；deploy/ 模板；停旧栈；nginx 接 conf.d                             |
| #294 | 单模板 Trigger→LLM→Feishu Bot（话题内回复）；fake-provider 确定性验证（零代码扩展） |
| #295 | 单实例部署（无 dev/prod）；allowlist 限验证群；长连接归属不可探测                   |
| #296 | feishu-im 验证道路（本 runbook 第 3 节）；不进 CI                                   |
