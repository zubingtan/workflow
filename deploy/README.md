# workflow 部署 runbook（通用版）

把 workflow 部署到**你自己的服务器**并用飞书 bot 验证闭环。**单实例**生产构建
（#295），挂载 `/workflow` 子路径（#297 base path），supervisord 管进程，nginx
保前缀反代。所有环境相关值用环境变量覆盖（见下方「可配置项」），下文用
`<占位符>` 表示需要你收集/决定的值。

## 拓扑

```
浏览器 ── https://<host>/workflow ──▶ nginx (80)
                                     └─▶ :4000 workflow (NODE_ENV=production, BASE_PATH=/workflow)
supervisord: [program:workflow] + [program:fake-provider] (:4010, 验证期 LLM 替身)
数据: <data-dir>/（SQLite + agents，默认 ~/.config/workflow）
飞书: 长连接（事件订阅 im.message.receive_v1）→ 唯一自建应用（#295 单连接）
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

> 历史实例参考值（作者部署的 w8）：不再维护在文档中；按上表自行收集即可。

## 一次性部署（bootstrap）

在服务器上：

```bash
git clone https://github.com/zubingtan/workflow.git
cd workflow
bash deploy/bootstrap.sh
```

bootstrap 依次做（幂等，可重跑）：

1. **工具链**：校验 Node 22（`NODE_BIN`）+ corepack pnpm
2. **仓库**：`WF_DIR` 拉 main + `pnpm install --frozen-lockfile`
3. **旧栈下线**：停掉端口 3000/4010 上像 workflow 的遗留进程（按 cmdline 匹配，不误杀）
4. **nginx 接入**：把 `deploy/nginx/workflow-location.conf` 接进 `NGINX_SITE`
   （conf.d 片段）里匹配 `SERVER_NAME` 的 server 块（默认第一个）：
   - `NGINX_SITE` 不存在且 `NGINX_SRC` 指向一个独立完整 nginx 配置时，先转换成
     conf.d 片段（自动剔除 `listen 8888` 等遗留监听、保留 map 指令）
   - **server_name 冲突检测**：与 conf.d 其他文件的同名 server 会静默遮蔽，
     脚本检测到会报错并要求你处理（不自动禁用）
   - `sudo nginx -t` 验证后 reload（检测到旧 master 则重启）
5. **supervisord**：安装 `deploy/supervisord/workflow.conf`（workflow + fake-provider）
   并 reread/update

### 可配置项（全部可用环境变量覆盖）

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

> w8 迁移示例：`NGINX_SRC=/tmp/workflow-nginx.conf SERVER_NAME=zubingtan-w8.corp.pony.ai bash deploy/bootstrap.sh`

## 配置（UI 操作）

打开 `https://<host>/workflow`：

1. **导入模板**（服务器上）：
   ```bash
   node deploy/import-template.mjs --base http://localhost:4000/workflow
   # 已存在则跳过；--update 覆盖。--base 需带 /workflow 前缀（#297：根路径 404）
   ```
   导入后 Dashboard 出现 workflow「Feishu Echo Reply」：Trigger → LLM → Feishu Bot → End。
2. **填凭证**（三处，同一自建应用）：
   - Feishu Trigger 节点：App ID / App Secret（填了才建长连接；#295 单连接纪律：只有一个环境填）
   - Feishu Bot 节点：App ID / App Secret（app 模式发消息）
   - LLM 节点：选 agent——验证期指向 fake-provider 的 agent（base_url
     `http://127.0.0.1:4010/v1`，任意 api_key/model）；验收后换真实供应商，模板不用改（#294）
3. **飞书应用侧**（#298）：事件订阅方式为长连接；已订阅 `im.message.receive_v1`；
   权限含"接收群聊中 @机器人消息事件"；bot 已在验证群（`<chat-id>`）；权限变更需发布版本
4. 保存 trigger 后确认日志出现长连接建立（`<data-dir>/logs/`）

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
- supervisord 反复重启 + `EADDRINUSE`：端口被遗留进程占用——`ss -ltnp | grep :4000`
  找到占用者停掉后 `sudo supervisorctl restart workflow`

## 更新部署

```bash
# 服务器上
bash deploy/deploy.sh    # git reset main → install → build(BASE_PATH=/workflow) → supervisorctl restart → 健康检查
```

## 关键决策索引

| #    | 决策                                                                                |
| ---- | ----------------------------------------------------------------------------------- |
| #292 | 应用感知 base path（nginx 不剥前缀）；nginx 剥前缀判死                              |
| #293 | 服务器拉代码构建；deploy/ 模板；停旧栈；nginx 接 conf.d                             |
| #294 | 单模板 Trigger→LLM→Feishu Bot（话题内回复）；fake-provider 确定性验证（零代码扩展） |
| #295 | 单实例部署（无 dev/prod）；allowlist 限验证群；长连接归属不可探测                   |
| #296 | feishu-im 验证道路（本 runbook 第 3 节）；不进 CI                                   |
