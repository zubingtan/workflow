# w8 部署 runbook（#293/#294/#295/#296 决议落地）

把 workflow 部署到 w8（`zubingtan-w8.corp.pony.ai` → `10.8.184.96`）并用飞书 bot
验证闭环。**单实例**生产构建（#295），挂载 `/workflow` 子路径（#297 base path），
supervisord 管进程，nginx 保前缀反代。

## 拓扑

```
浏览器 ── https://zubingtan-w8.corp.pony.ai/workflow ──▶ nginx (80)
                                                        └─▶ :4000 workflow (NODE_ENV=production, BASE_PATH=/workflow)
supervisord: [program:workflow] + [program:fake-provider] (:4010, 验证期 LLM 替身)
数据: ~/.config/workflow/（SQLite + agents）
飞书: 长连接（事件订阅 im.message.receive_v1）→ 唯一自建应用（#295 单连接）
```

## 一次性部署（bootstrap）

在 w8 上（`ssh 10.8.184.96`）：

```bash
cd ~/projects/workflow        # 或先 git clone https://github.com/zubingtan/workflow.git
bash deploy/bootstrap.sh
```

bootstrap 依次做（幂等，可重跑）：

1. **工具链**：校验 nvm Node 22（`~/.nvm/versions/node/v22.23.1/bin/node`）+ corepack pnpm
2. **仓库**：`~/projects/workflow` 拉 main + `pnpm install --frozen-lockfile`
3. **旧栈下线**：停掉旧 dev 全家桶（:3000 后端 / :4010 旧 fake-provider；:8888 nginx 代理块随迁移删除）——#293/#295
4. **nginx 迁移**：把生效中的 `/tmp/workflow-nginx.conf`（root 启动、重启即丢）迁入
   `/etc/nginx/conf.d/zubingtan-w8.conf`；删除 8888 server 块；在
   `zubingtan-w8.corp.pony.ai` server 块内插入
   `include <repo>/deploy/nginx/workflow-location.conf;`（/workflow 反代，SSE 调优）；
   `nginx -t` 通过后切换/重载
5. **supervisord**：安装 `deploy/supervisord/workflow.conf`（workflow + fake-provider 两个
   program，Node 22 绝对路径、prod 构建、`BASE_PATH=/workflow`、`PORT=4000`）并 reread/update

## 配置（#298 清单，UI 操作）

打开 `https://zubingtan-w8.corp.pony.ai/workflow`：

1. **导入模板**（w8 上）：
   ```bash
   node deploy/import-template.mjs --base http://localhost:4000/workflow
   # 已存在则跳过；--update 覆盖。--base 需带 /workflow 前缀（#297：根路径 404）
   ```
   导入后 Dashboard 出现 workflow「Feishu Echo Reply」：Trigger → LLM → Feishu Bot → End。
2. **填凭证**（三处，同一自建应用）：
   - Feishu Trigger 节点：App ID / App Secret（填了才建长连接；#295 单连接纪律：只有一个环境填）
   - Feishu Bot 节点：App ID / App Secret（app 模式发消息）
   - LLM 节点：选 agent——验证期指向 fake-provider 的 agent（base_url `http://127.0.0.1:4010/v1`，
     任意 api_key/model）；验收后换真实供应商，模板不用改（#294）
3. **飞书应用侧**（#298）：事件订阅方式为长连接；已订阅 `im.message.receive_v1`；
   权限含"接收群聊中 @机器人消息事件"；bot 已在 Bot Testing 群
   （`oc_0da8b36e7656ca1768a04e720c190c15`）；权限变更需发布版本
4. 保存 trigger 后确认日志出现长连接建立（`/api/feishu` 相关，`~/.config/workflow/logs/`）

## 验证闭环（#296）

**本地机器**（feishu-im 依赖你的飞书登录态；`FEISHU_IM_MCP_URL` 已在 `~/.zshrc`）：

```bash
bash deploy/verify/verify-feishu-echo.sh
# 可选: --fake-base http://10.8.184.96:4010（默认即此）
```

脚本动作：

1. `PUT http://10.8.184.96:4010/test/control` 注册 `verify-<ts>` → `echo-<ts>`（确定性回复）
2. 真 @ Localization Team Bot 发消息 `verify-<ts>` 到 Bot Testing 群
3. 从群消息定位 thread_id，轮询话题（90s 超时）
4. 断言 bot 回复 == `echo-<ts>`（严格相等）

跑通即代表完整闭环：飞书事件 → 长连接 → trigger 匹配（allowlist 校验群）→ workflow run
→ LLM（fake-provider 确定性回复）→ Feishu Bot 话题内回复 → 断言。

**排障**：

- 无回复：先看 Dashboard Run 历史（`/workflow` → History）——run 未出现 = 事件没进来
  （凭证/权限/allowlist）；run 失败 = 看 LLM/Feishu Bot 节点报错
- `curl http://zubingtan-w8.corp.pony.ai/workflow/health/live` 应返回 JSON
- 长连接数哨兵（可选）：`event/v1/connection` 接口断言 App 级连接数 == 1

## 更新部署

```bash
# w8 上
bash deploy/deploy.sh    # git reset main → install → build(BASE_PATH=/workflow) → supervisorctl restart → 健康检查
```

## 关键决策索引

| #    | 决策                                                                                |
| ---- | ----------------------------------------------------------------------------------- |
| #292 | 应用感知 base path（nginx 不剥前缀）；nginx 剥前缀判死                              |
| #293 | w8 拉代码构建；deploy/ 模板；停旧栈；nginx 迁 conf.d                                |
| #294 | 单模板 Trigger→LLM→Feishu Bot（话题内回复）；fake-provider 确定性验证（零代码扩展） |
| #295 | 单实例部署（无 dev/prod）；allowlist 限验证群；长连接归属不可探测                   |
| #296 | feishu-im 验证道路（本 runbook 第 3 节）；不进 CI                                   |
| #297 | BASE_PATH 代码支持（已合入，`BASE_PATH=/workflow pnpm build`）                      |
