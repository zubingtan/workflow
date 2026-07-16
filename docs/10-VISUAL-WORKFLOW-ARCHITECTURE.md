# Design Doc：FlowGram Visual Workflow Architecture

- **版本**：v0.6
- **状态**：Target Architecture / M1-A Implementation Plan
- **日期**：2026-07-17
- **目标阶段**：M1-A read-only；M4 Authoring

## 1. 结论

FlowGram 是选定的 Workflow Canvas Framework，但不再作为 M0 Functional Gate。

阶段安排：

- M0：简单 Workflow 结构和 Run UI；
- M1-A：FlowGram 只读 Board + Run Overlay；
- M4：完整 Authoring、Test 和 Publish。

FlowGram 官方定位是工作流开发框架和工具集，而不是开箱即用的完整平台，因此本项目仍需自有 Definition、Compiler、Runtime 和 Product Model。

## 2. 为什么移到 M1-A

此前把 FlowGram、Runtime Hardening 和 M0 Web 同时设为退出门槛，导致 UI 集成阻塞最小闭环。

新的顺序：

```text
M0: Definition → Run → Result
M1-A: Definition → FlowGram Projection → Run Overlay
M4: FlowGram ChangeSet → Draft → Validate → Publish
```

这样先保证数据和执行真实，再引入画布，不会用 mock Canvas 掩盖后端问题。

## 3. M1-A 用户体验

一个页面包含：

- Workflow Header；
- FlowGram Canvas；
- Input Panel；
- Run Controls；
- Node Detail；
- Output/Error；
- Run status。

最小路径：

```text
打开 Workflow
→ Canvas 显示 Input / Agent / Output
→ 输入 Prompt
→ Run
→ 节点依次变化
→ 点击节点查看 Input/Output/Error
→ 查看最终结果
```

## 4. Adapter 边界

### 4.1 Definition → Visual

```ts
interface VisualProjectionMapper {
  project(definition: WorkflowDefinitionView): VisualWorkflowDocument
}
```

映射：

- product node ID → visual node ID；
- node type → material/component；
- edge → visual connection；
- visual metadata → position/layout；
- validation diagnostics → visual marker。

### 4.2 Runtime → Overlay

```ts
interface RuntimeOverlayMapper {
  project(run: WorkflowRunView): VisualRuntimeOverlay
}
```

Overlay：

- pending；
- running；
- succeeded；
- failed；
- waiting；
- selected attempt；
- error/evidence indicator。

Overlay 不写回 Definition。

## 5. ID 和 Hash

- Product Node ID 是稳定主键；
- FlowGram 内部 Entity ID 不成为平台 ID；
- position、viewport、selection、fold 不进入业务 Hash；
- M1 引入 DefinitionVersion 后，Canvas/Run Header 显示相同 Version；
- M4 View Metadata 可以独立版本化。

## 6. M1-A 允许

- Free Layout；
- Auto Layout；
- Fit View；
- nodes/edges；
- read-only node；
- click/selection；
- node detail；
- status overlay；
- minimap（可选）；
- basic error boundary。

## 7. M1-A 禁止

- 创建/删除节点；
- 创建/删除边；
- 拖拽写回业务 Definition；
- Inspector 编辑；
- Variable Engine 业务接入；
- Canvas `toJSON()` 直接执行；
- 前端发布；
- FlowGram Runtime；
- 复制 Coze Studio 业务组件。

## 8. M4 Authoring

M4 才实现：

```text
FlowGram ChangeSet
→ Authoring Command
→ Server Validation
→ Draft Definition
→ Compiler Diagnostics
→ Test
→ Publish Version
```

能力：

- Palette；
- Typed Ports；
- Inspector；
- Mapping；
- Loop/Branch；
- Undo/Redo；
- Version Diff；
- Test Mode；
- Publish Gate。

Canvas History 不替代服务端 Version。

## 9. 失败隔离

- Canvas 加载失败：显示 fallback Definition list；
- Projection 失败：显示 diagnostics；
- Canvas JS error：不影响 Run API；
- Runtime 失败：Canvas 仍可查看 Definition；
- Overlay 失败：不修改 Run 状态。

## 10. 测试策略

M1-A 实现顺序：

```text
先显示真实 Canvas
→ 手动验证真实 Run
→ 添加 projection contract
→ 添加一个 browser smoke
```

不先创建大规模 visual fixture 或 DOM snapshot。

应测试：

- stable node ID；
- node/edge mapping；
- status mapping；
- Canvas failure isolation。

不测试：

- FlowGram 框架本身默认行为；
- 每个 DOM class；
- 所有像素布局；
- 当前未开放的编辑能力。

## 11. 依赖策略

- 使用官方 FlowGram packages；
- 锁定兼容版本；
- 通过 Adapter 隔离；
- 记录升级检查项；
- 不依赖 Coze 私有业务层；
- License 和 bundle 影响在 M1-A Review。

## 12. 官方参考

- https://flowgram.ai/
- https://github.com/bytedance/flowgram.ai
