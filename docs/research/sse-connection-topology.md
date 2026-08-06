# Workflow Run SSE 连接拓扑研究

## 结论

对本仓库的 Workflow Run 场景，推荐的目标架构是：**每个页面维护一条 Workflow Run SSE 连接，页面内维护订阅表，服务端按 `workflowId`、`runID` 和事件 `type` 过滤后再发送**。

这不是 SSE 的通用最佳实践，而是本场景在以下约束下的取舍：管理页会同时观察多个 Workflow，Workflow Run 事件是单向低延迟通知，REST snapshot 已经承担最终一致性，且 HTTP/1.1 浏览器连接上限会让“每个可见 Workflow 一条连接”随页面规模增长而失效。

三种方案的判断如下：

| 方案                     | 连接数                         | 带宽与服务端工作                                                     | 隔离与维护                                                  | 判断                                          |
| ------------------------ | ------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| 每 Workflow 一条连接     | 单页面约为可见 Workflow 数 `W` | 每条流较窄，但连接和心跳开销随 `W` 增长                              | Workflow 隔离自然，消费者容易理解                           | 适合少量 Workflow，不能作为本仓库长期默认方案 |
| 每页面单连接、全量流     | 每页面 1 条                    | 页面会收到不关心的 Workflow 事件，带宽和客户端丢弃成本随全量事件增长 | 需要事件携带可靠的 `workflowId`；客户端丢弃不能构成权限边界 | 不推荐                                        |
| 每页面单连接、服务端过滤 | 每页面 1 条                    | 只发送授权且已订阅的 Workflow/Run/type，带宽更可控                   | 服务端过滤、鉴权、重连对账和动态订阅需要明确契约            | **推荐**                                      |

因此，**推荐实施页面级单连接加服务端过滤这一架构方向，但不建议把当前 per-Workflow URL 直接改成未经鉴权的全局全量流**。实现必须同时锁定动态订阅更新、删除语义、REST 对账和多进程边界；当前代码按该决策实现了页面连接、服务端过滤和断线对账。

## 已发布决策

Issue [#264](https://github.com/zubingtan/workflow/issues/264) 的已发布 Resolution 已明确：

- 浏览器侧采用页面级 `WorkflowRunEventHub`，每个页面默认维护一个 Workflow Run SSE 连接和本地订阅表。
- 服务端按订阅范围执行 `workflowId`、`runID` 过滤，不能依赖客户端丢弃事件作为权限边界。
- 领域边界保持在 Workflow Run 事件，不泛化成全局 EventBus。
- 多进程广播、鉴权和跨 tab 复用不会被连接拓扑自动解决。
- draft Test Run 保留轮询，saved Workflow Test Run 迁移到实时消费者。

Issue [#263](https://github.com/zubingtan/workflow/issues/263) 还记录了相关边界：REST snapshot 是最终一致性来源，`Last-Event-ID` 不承诺回放；跨 tab 共享和多进程扩展不属于当前范围。

Workflow 删除的已确认契约见 Issue [#266 的 Resolution](https://github.com/zubingtan/workflow/issues/266#issuecomment-5201328180)：管理页移除条目，已打开的 History Modal、ReadonlyViewer 和 saved Test Run 保留内存中的只读快照，显示“Workflow 已删除”，禁用操作，提供显式返回，并在删除后停止订阅。

## 规范事实

### 连接数与 HTTP 版本

[MDN EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) 和 [MDN SSE 指南](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)给出的事实是：

- HTTP/1.1 下，浏览器对同一域名的 SSE 连接上限通常是每浏览器约 6 条，而且这个上限跨 tab 共享。
- HTTP/2 下，限制转为客户端与服务端协商的并发 HTTP stream 数；MDN 提到默认值通常为 100，但这不是应用架构可以依赖的固定保证。
- SSE 是单向通信，数据只从服务端到客户端；`EventSource` 本身没有向已建立连接发送订阅变更消息的通道。
- `EventSource.close()` 才会停止连接；连接异常时浏览器默认会重连。

[WHATWG HTML EventSource 规范](https://html.spec.whatwg.org/multipage/server-sent-events.html)进一步规定：

- `EventSource` 保存最近处理的 event ID。
- 收到带 `id:` 的完整事件后，浏览器更新这个 ID；重连时自动发送 `Last-Event-ID` 请求头。
- 服务端是否根据该游标查询并回放历史，不由 SSE 规范自动提供。
- 规范的 authoring notes 提到，多个页面各自建立 EventSource 会遇到每服务器连接限制；跨文档共享连接需要额外机制，例如 SharedWorker。本仓库 #264 明确不把跨 tab 共享纳入当前方案。

这意味着页面级单连接主要解决单 tab 内的 `W` 次增长，也不能把多个 tab 合并成一条连接，更不能用 HTTP/2 替代生命周期和过滤设计。

### `Last-Event-ID` 与 REST snapshot

`id:` 只是游标，不是回放功能。若服务端不保存事件历史，也不实现按游标回放，断线期间丢失的事件不会因为浏览器发送 `Last-Event-ID` 而自动补回来。

本仓库应继续采用已在 [Issue #268 的 Resolution](https://github.com/zubingtan/workflow/issues/268#issuecomment-5201267644) 确认的组合：

- SSE `id` 使用单调递增的流游标，不使用 `runID` 代替事件序号。
- SSE 负责低延迟通知，REST snapshot 负责初始加载、重连对账和冲突时的最终一致性。
- 客户端必须幂等，并拒绝旧事件重新打开已经进入终态的 Run。
- 页面级连接重连后，应针对当前订阅范围重新获取相关 Workflow/Run snapshot；不能把 `Last-Event-ID` 当成历史事件来源。

当前工作区的 `server/runs-events.mjs:46-47` 和 `server/app.mjs:1102-1105` 已经发送 SSE `id`，但 event bus 没有历史缓存，也没有读取 `Last-Event-ID` 进行回放。因此，当前实现的 `id` 可用于游标和客户端去重，不能提供事件恢复。

### Hono 流生命周期

[Hono Streaming Helper](https://hono.dev/docs/helpers/streaming)规定的 `streamSSE()` 用法包含 `stream.writeSSE({ data, event, id })`、`stream.aborted` 和 `stream.onAbort()`。Hono 的[超时文档](https://hono.dev/docs/middleware/builtin/timeout)还明确示例了：SSE 不应依赖普通 timeout middleware，应该在 stream 内调用 `stream.close()`，并在 `onAbort()` 中停止循环和清理定时器。

本仓库当前 SSE 路由已经按这个方向清理 heartbeat、订阅和有界队列，见 `server/app.mjs:1055-1113`。页面级连接不会降低这些服务端清理要求；它只改变一个页面对应的订阅集合。

## 当前实现事实

以下判断以当前工作区的 on-disk source 为准。工作区存在其他未提交改动，本研究没有修改或回滚这些改动。

`src/workflow-run-event-hub.mjs` 以 `/api/runs/events` 建立页面级单连接，维护 Workflow、Run 和事件类型订阅表。订阅集合变化时重建连接，并在重连或连接错误后按 Workflow 拉取 REST snapshot。

`src/use-active-run-counts.ts`、History Modal、Test Run、ReadonlyViewer 和管理页删除监听器共同复用这条页面连接。管理页收到 `workflow_deleted` 后立即移除条目；已打开的详情视图保留内存中的运行记录或画布，并进入只读删除状态。

`server/app.mjs` 同时保留 `/api/workflows/:id/runs/events` 兼容路径，并提供 `/api/runs/events?workflowId=...` 页面级路径。Workflow、Run 和 type 过滤参数会传给 event bus；服务端只向已订阅 Workflow 的连接发送事件。页面流的 SSE sequence 会从重连请求的 `Last-Event-ID` 继续递增，但服务端不保存历史事件，也不提供回放。

`src/workflow-run-event-hub.mjs` 将 REST snapshot 的终态写入本地单调状态。迟到的 active status/progress 不能重新打开已确认终态；快照响应也不能覆盖已收到的终态事件。终态通知在运行服务和 LiveHistoryRuntimeService 中只处理一次。

`server/runs-events.mjs` 的 event bus 仍以 `workflowId` 管理订阅集合，这是领域隔离和删除定向广播的实现边界，不代表浏览器连接仍按 Workflow 创建。进度帧可以丢弃或 latest-wins；生命周期帧无法在有界队列中容纳时关闭连接，让客户端通过 REST snapshot 重新收敛，而不是静默丢失终态。

服务端当前只做资源存在性检查，没有独立的用户或 Workflow 权限校验；连接拓扑和过滤机制不能替代鉴权。event bus 仍是单进程状态，跨进程广播、跨 tab 复用和事件历史回放继续属于范围外。

## 当前实现的契约边界

页面级单连接和服务端过滤已经满足 #264 的连接拓扑要求，但以下边界仍需由部署和产品层明确处理：

1. URL 中的 Workflow 集合必须经过真实鉴权；当前应用没有多用户权限模型。
2. `Last-Event-ID` 只延续游标，不恢复断线期间的事件；恢复依赖 REST snapshot 和幂等消费者。
3. 事件 bus 不跨 Node 进程共享；多进程部署需要外部发布层才能提供一致事件流。
4. 删除 Workflow 后，页面可以继续为其他 Workflow 保持连接；删除后若无剩余订阅，Hub 关闭连接。

## 三种拓扑的边界

### 每 Workflow 一条连接

优点：

- URL、数据库查询和 event bus 都天然按 Workflow 隔离。
- 单条连接只接收一个 Workflow 的事件，带宽和客户端处理量容易估算。
- 删除和终态事件的归属简单。

代价：

- 连接数随可见 Workflow 数增长；多个 tab 还会把连接数继续相加。
- 每条连接都需要 heartbeat、abort cleanup、重连和 snapshot 对账。
- HTTP/2 可以缓解连接争用，但不能消除连接、内存和定时器数量增长。

适用边界：Workflow 数量严格很小、页面只观察单个 Workflow，或连接隔离优先于连接数量时可以接受；不适合当前管理页的任意数量可见 Workflow。

### 每页面单连接全量流

优点：

- 浏览器连接数固定为每页面一条。
- 客户端可以有统一的重连、heartbeat 和 snapshot 生命周期。

缺点：

- 服务端向页面传输页面不关心的 Workflow 事件，页面事件量高时带宽和解析成本都放大。
- 必须保证每个事件都有 `workflowId`；仅凭 `runID` 不足以表达跨 Workflow 归属。
- 客户端丢弃不能提供权限保护；任何已抵达浏览器的事件都已经越过了服务端数据边界。
- 删除、订阅范围变化和多租户场景会变成全量事件协议的复杂分支。

结论：不作为本仓库目标架构。

### 每页面单连接服务端过滤

优点：

- 连接数固定为每页面一条，同时保留服务端带宽控制。
- 连接仍限定在 Workflow Run 领域，不需要把 event bus 泛化成全局消息系统。
- `workflowId/runID/type` 可以作为三层过滤维度，页面本地 subscriber table 只负责分发给具体消费者。

必须明确的代价：

- 原生 EventSource 是单向的；订阅集合变化不能通过已建立连接发送控制消息。可以在 URL 中携带订阅集合并在变化时重建连接，也可以把“当前用户有权访问的 Workflow 集合”作为服务端授权范围，然后在页面内订阅过滤。
- URL 中的 Workflow 集合必须经过服务端鉴权，不能相信客户端声明的范围。
- 服务端需要在删除事件、init snapshot 和普通事件上使用同一套 Workflow/Run/type 过滤规则，不能用 `broadcastAll` 绕过规则。
- 重连时需要对整个当前订阅集合做 REST snapshot 对账，并用 generation 或等价机制防止旧请求覆盖新订阅和删除状态。

结论：这是本仓库在 #264 下的推荐方案，但它是明确的领域架构取舍，不是所有 SSE 应用都应采用的通用规则。

## 对关键语义的影响

### REST snapshot

- 初次加载仍使用 REST；SSE 连接只负责随后通知。
- 连接重连或 `onerror` 后，REST snapshot 是判断当前 active、terminal、deleted 状态的来源。
- 页面级连接需要按订阅的 Workflow 集合对账，而不是只拉当前 URL 路径下的一个 Workflow。
- 对 progress 使用 latest-wins 是可以接受的，但 terminal 状态不能依赖可能丢失的单个 SSE 帧；终态必须能从 `GET /api/runs/:runID` 或等价 snapshot 收敛。
- snapshot 返回后，旧 SSE 事件和旧 snapshot 都不能覆盖已经确认的删除或终态。

### `Last-Event-ID` 不回放

- 服务端应继续发送单调流游标，并让浏览器在重连时自然带上 `Last-Event-ID`。
- 在没有事件历史的实现中，服务端可以记录或观察该游标用于诊断，但不能向调用方承诺补发缺失事件。
- 页面级连接把多个 Workflow 合并后，游标应属于这条页面流，而不是复用某个 `runID`；多进程部署若需要严格游标，则必须引入共享发布/游标层。
- 断线恢复依靠 snapshot 和幂等消费者，不依靠客户端猜测漏掉了哪些事件。

### Workflow 删除与跨 Workflow 隔离

- `workflow_deleted` 必须只发送给该 Workflow 的已授权订阅者；不能把事件发送给所有页面连接后再让客户端过滤。
- 管理页收到删除事件后立即移除该 Workflow，并停止其订阅。
- 已打开的 History Modal、ReadonlyViewer 和 saved Test Run 应保留事件到达前的 canvas/report/运行详情，进入只读的“Workflow 已删除”状态，不自动关闭或导航。
- 删除状态优先于迟到的 REST/SSE 响应；旧响应不得重新加载 Workflow、恢复可操作按钮或覆盖快照。
- 页面级连接可以仍然保持以服务其他 Workflow，但必须从本地订阅表移除已删除 Workflow；若页面没有剩余订阅，再关闭连接。

### 鉴权边界

- `workflowId` 路由隔离、`runID` 过滤和事件 `type` 过滤都是数据路由机制，不是鉴权机制。
- 服务端必须先确定当前请求主体对每个 Workflow 的访问权，再应用订阅过滤；客户端丢弃事件不能修复错误的服务端授权。
- 本仓库当前 SSE 路由只检查 Workflow 是否存在，研究时未发现独立的用户/Workflow 权限检查。因此在当前本地单用户边界下可以讨论拓扑，但不能宣称该连接设计已经满足多用户安全边界。
- 若未来由反向代理提供身份，应用仍需要把身份和 Workflow 授权关系传递到 SSE 路由的过滤层；页面单连接不会自动继承或扩大授权。

### 多 tab 与多进程

- #264 明确不引入 SharedWorker 或 BroadcastChannel，所以每个 tab 仍是一个页面连接；这降低单 tab 的 `W` 增长，但不消除跨 tab 连接上限。
- 当前 event bus 是进程内 `Map`。多进程下，连接落在进程 A 而事件在进程 B 发布时，单连接拓扑本身不能保证收到事件。
- 多进程广播、共享游标、服务器重启恢复需要独立的 broker 或持久化事件/状态方案，不应偷偷塞进本次连接拓扑改动。

## 推荐实施边界

建议把后续实现拆成以下可验证边界，而不是一次性改成全量全局流：

- 页面 Hub 只维护一条 Workflow Run EventSource 和本地订阅表；订阅记录包含 `workflowId`、可选 `runID` 和 `type`。
- 服务端 SSE 入口接收页面订阅范围，先做身份与 Workflow 授权，再按 `workflowId/runID/type` 过滤事件和 init 数据。
- 事件封套始终包含 `workflowId`、事件 `type` 和适用于整条流的单调 `id/sequence`。
- `workflow_deleted` 使用同一过滤链路，不使用绕过过滤的全局广播；删除后服务端连接和客户端订阅都幂等清理。
- `Last-Event-ID` 只作为重连游标；没有历史存储时，重连后强制 REST snapshot 对账。
- 每次订阅集合变化、重连和删除都需要测试旧响应不能覆盖新状态。
- 保留 draft Test Run 的 polling 边界；saved Workflow Test Run 才使用页面级实时连接。
- 单独为多 tab、多进程、鉴权和事件历史建立后续决策，不把它们伪装成连接复用已经解决的问题。

## 来源

### 仓库决策与研究

- [Issue #264：页面级共享 SSE 与订阅过滤的架构边界](https://github.com/zubingtan/workflow/issues/264)
- [Issue #264 Research 评论](https://github.com/zubingtan/workflow/issues/264#issuecomment-5201232611)
- [Issue #264 Resolution 评论](https://github.com/zubingtan/workflow/issues/264#issuecomment-5201265466)
- [Issue #263：Workflow Run 实时事件架构](https://github.com/zubingtan/workflow/issues/263)
- [Issue #266：Workflow 删除时实时查看界面语义 Resolution](https://github.com/zubingtan/workflow/issues/266#issuecomment-5201328180)
- [Issue #268：EventSource/Hono 重连、游标与最新快照恢复 Research](https://github.com/zubingtan/workflow/issues/268#issuecomment-5201232429)
- [Issue #268 Resolution](https://github.com/zubingtan/workflow/issues/268#issuecomment-5201267644)

### 第一方与规范资料

- [WHATWG HTML Standard：Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [WHATWG：Last-Event-ID header](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-last-event-id-header)
- [WHATWG：EventSource processing model](https://html.spec.whatwg.org/multipage/server-sent-events.html#sse-processing-model)
- [WHATWG：EventSource authoring notes](https://html.spec.whatwg.org/multipage/server-sent-events.html#authoring-notes)
- [MDN：EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)
- [MDN：Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)
- [Hono：Streaming Helper / `streamSSE`](https://hono.dev/docs/helpers/streaming)
- [Hono：Timeout Middleware 与 SSE abort cleanup](https://hono.dev/docs/middleware/builtin/timeout)

### 当前工作区代码依据

- [`src/workflow-run-event-hub.mjs`](../../src/workflow-run-event-hub.mjs)：连接 map、Workflow URL、本地订阅过滤和 snapshot 对账。
- [`src/use-active-run-counts.ts`](../../src/use-active-run-counts.ts)：管理页按可见 Workflow 建立订阅。
- [`src/manage.tsx`](../../src/manage.tsx)：管理页把 Workflow 列表传给 active-run 订阅。
- [`server/app.mjs`](../../server/app.mjs)：SSE 路由、查询过滤、heartbeat、abort cleanup 和 Workflow 删除通知。
- [`server/runs-events.mjs`](../../server/runs-events.mjs)：进程内 event bus、Workflow 分组、Run/type 过滤和 `broadcastAll`。
- [`server/index.mjs`](../../server/index.mjs)：每个 Node 进程创建一个 event bus。
