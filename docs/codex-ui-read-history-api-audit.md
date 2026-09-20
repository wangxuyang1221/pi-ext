# Codex UI Read history grouping API audit

## Implementation status

以下为 `16a79e5` 上实施前的核查记录，行号与失败实验均针对该基线。后续已完成插件内实现及正式测试，见 [Read history grouping fixes](codex-ui-read-history-todo.md#results)。重复 ID 采用各视图本地数据降级，不承诺修复宿主的精确 occurrence 归属。用户另行接受不检测宿主无通知移除曾绑定视图；本文提出的缺失视图风险按此边界验收。

## Scope and baseline

本文只评估以下 Read 历史分组方案，不实现产品修改：

- 从 `ctx.sessionManager.buildContextEntries()` 初始化逻辑记录；
- 用 `message_*` 与 `tool_execution_*` 事件增量更新；
- `context.state` 只保存当前工具行的本地视图绑定；
- 逻辑记录优先按 `toolCallId` 关联，重复 ID 按 assistant 来源中的实际出现次数判别；
- 自有组件在 `render(width)` 中检查逻辑版本，不在逻辑模型中保存宿主组件引用，也不修改宿主。

正式基线是当前 commit `16a79e55efb848492f63741bb32492e7327d6260` 和 Pi `0.86.0`。`package.json:136-144` 将 `@earendil-works/pi-ai`、`pi-coding-agent`、`pi-tui` 的 peer 与 dev dependency 固定为 `0.86.0`。本文引用的安装源码为：

```text
$PI=/Users/wangxuyang/Code/t3code/pi-ext/node_modules/.pnpm/@earendil-works+pi-coding-agent@0.86.0_@modelcontextprotocol+sdk@1.29.0_zod@4.4.3__ws@8.21.3_zod@4.4.3/node_modules/@earendil-works/pi-coding-agent
$CORE=/Users/wangxuyang/Code/t3code/pi-ext/node_modules/.pnpm/@earendil-works+pi-agent-core@0.86.0_@modelcontextprotocol+sdk@1.29.0_zod@4.4.3__ws@8.21.3_zod@4.4.3/node_modules/@earendil-works/pi-agent-core
$TUI=/Users/wangxuyang/Code/t3code/pi-ext/node_modules/.pnpm/@earendil-works+pi-tui@0.86.0/node_modules/@earendil-works/pi-tui
```

原报告基线 `d5b057d6` 使用 Pi `0.84.3`，只作为历史背景。旧版源码核查得到的关键事件和重绘机制与 0.86.0 相同，但本文不据此声明继续支持 0.84.3。

## Verdict

推荐采用逻辑数据与视图分离的方向，但目前没有取得 6-pro 的原型代码，不能确认其 14 项测试。原方案已要求真实重复 ID 保守独立显示，并未要求修复宿主对重复 ID 的实时精确归属；下文的宿主限制不构成否定这个方案的理由，也不应扩大为本次必须修改宿主的任务。

方案对以下范围可行，且不需要修改宿主：

- `toolCallId` 唯一；
- 文本 Read；
- 当前 active branch 和 compaction 可见范围；
- 最终一致的历史视图；
- 依赖宿主既有消息或工具事件触发下一帧。

公开 API 足以支持初始化、增量更新、row-local 绑定和版本化渲染。`ToolExecutionComponent`、`Container` 和 `Markdown` 的缓存不会阻止设计正确的自有 `render(width)`。

硬阻碍是“重复 ID 的实时、逐次、精确归属”：

1. `tool_execution_end` 有最终 `result` 和 `isError`，但没有 `args` 或 occurrence key。
2. 并行执行时 end 按完成顺序到达，相同 ID 无法据此判定属于第几次来源出现。
3. 宿主实时 UI 以 `Map<toolCallId, ToolExecutionComponent>` 管理行，相同 ID 会复用同一行；历史结果绑定也按 ID 使用 Map。

所以正式实施必须选择一种产品边界：

- 将重复 ID 视为歧义和分组边界，等 source-ordered `toolResult` message 到齐后只保证最终历史一致；或
- 修改宿主，让事件和行绑定携带 occurrence key。

如果需求坚持“不修改宿主”且要求重复 ID 在并行执行中实时精确显示，则方案不可行。

## Current thinking toggle versus actual rebuild

Pi 0.86.0 的 `toggleThinkingBlockVisibility()` 已不再重建工具行，而是通过 `updateThinkingBlockVisibility()` 原位更新 assistant 组件：`$PI/dist/modes/interactive/interactive-mode.js:3558-3573`。所以当前 `Ctrl+T` 保持 Read 分组是宿主避开了原触发路径，不代表插件已解决新旧 Read 组件归属。

主代理用当前真实 SDK、`InteractiveMode` 历史方法和工具组件做了另一个隔离复现：初次历史显示 `Read 2 files`，连续三次 thinking toggle 后仍分组；随后直接执行真实 `rebuildChatFromMessages()`，立即退化为两条独立 Read，内容仍在。脚本和输出为 `.tmp/review-verification/read-native-rebuild.mjs`、`read-native-rebuild.log`。正式修复应以实际历史重建及刚完成的工具数据为验收条件，不能仅用新版本的 Ctrl+T 测试替代。

## Confirmed API surface

### History projection

`buildContextEntries()` 是公开的只读 SessionManager API。它沿当前 leaf 构建 active branch，并应用最新 compaction；被摘要替代的旧 entry 不会返回：`$PI/dist/core/session-manager.js:193-228`。`sessionEntryToContextMessages()` 对 message、custom message、branch summary 和 compaction 的投影见同文件 `:162-191`。

宿主初始历史和后续 transcript rebuild 也使用这一投影：`$PI/dist/modes/interactive/interactive-mode.js:3234-3239`、`:3270-3272`。因此逻辑模型应与 `buildContextEntries()` 保持同一可见边界，不应从 `getEntries()` 擅自复活已被摘要覆盖的 Read。

### Renderer context

公开 `ToolRenderContext` 包含 `args`、`toolCallId`、`invalidate()`、`lastComponent`、row-local `state`、执行状态和错误状态：`$PI/dist/core/extensions/types.d.ts:315-340`。

宿主每行创建一个 `rendererState`，call/result slot 共用它。`context.invalidate()` 会 invalidate 当前工具行并调用宿主 `ui.requestRender()`：`$PI/dist/modes/interactive/components/tool-execution.js:13-16`、`:71-88`。

因此建议的职责分离成立：

```text
extension session state: logical records, occurrence queues, grouping, logical version
context.state:       { generation, occurrenceKey, lastSeenVersion }
```

`context.state` 不应成为跨行事实源，也不需要保存 `ToolExecutionComponent`。

### Request render access

普通事件 handler 的 `ctx.ui` 没有公开 `requestRender()`；`ExtensionUIContext` 的公开方法见 `$PI/dist/core/extensions/types.d.ts:65-140`。TUI 对象只注入 custom UI、widget、header/footer 等 factory。工具 renderer 可用的公开重绘入口是 `context.invalidate()`。

这不是当前事件驱动方案的硬阻碍。宿主在 `message_update`、`message_end`、`tool_execution_start/update/end` 后请求重绘：`$PI/dist/modes/interactive/interactive-mode.js:2675-2699`、`:2701-2743`、`:2747-2776`。只要逻辑变更发生在这些事件 handler 中，就能搭宿主的下一帧执行自有 render。

限制是：若逻辑状态在这些事件之外异步变化，并且设计又不保留某行的公开 `context.invalidate` 回调，则没有公开的全 transcript repaint 方法。正式实现应禁止这种更新路径，或调整“不保留回调”的约束。

## Confirmed event payloads and order

### Payloads

0.86.0 类型声明给出的 payload 为：

| Event | args | result | isError |
| --- | --- | --- | --- |
| `tool_execution_start` | 有 | 无 | 无 |
| `tool_execution_update` | 有 | `partialResult` | 无 |
| `tool_execution_end` | 无 | 有 | 有 |
| `message_end` 的 `toolResult` | 无 | message 内有 `content`、`details`、`usage`、`isError` | 有 |

依据：`$PI/dist/core/extensions/types.d.ts:592-630`。AgentSession 转发 end 时也只复制 ID、名称、result 和 isError：`$PI/dist/core/agent-session.js:571-579`。

end 中的 result 是 after-tool hook 完成后的最终结果。执行结果先经过 `afterToolCall`，再产生 `tool_execution_end`，最后构造 `toolResult` message：`$CORE/dist/agent-loop.js:534-600`。

args 有一个必须记录的限制。start 和 update 暴露 assistant 原始 arguments；实际 execute 使用 `prepareArguments` 和 schema validation 后的 `validatedArgs`：`$CORE/dist/agent-loop.js:430-461`、`:488-493`、`:503-516`。如果分组只按 assistant 来源中的 Read path 工作，这没有问题；若 UI 必须展示工具实际收到的改写后参数，现有 execution events 不足。

### Extension versus host order

AgentSession 对 agent event 的顺序是：先 await extension handlers，再通知 InteractiveMode 等 listeners，`message_end` 最后才持久化：`$PI/dist/core/agent-session.js:380-420`。

直接后果：

- extension 可在宿主 `ToolExecutionComponent.updateResult()` 前更新逻辑版本；宿主随后更新行并请求重绘。
- `message_end` handler 内的 `buildContextEntries()` 尚不包含当前 message。增量更新必须消费 `event.message`，不能立即全量扫描并假设当前 message 已写入。宿主同样注明这一点：`$PI/dist/modes/interactive/interactive-mode.js:3189-3196`、`:3210-3216`。

### Parallel order

0.86.0 文档明确说明：start 按 assistant source order，updates 可交错，end 按完成顺序，最终 `toolResult` message 稍后按 assistant source order：Pi 0.86.0 `docs/extensions.md:654-674`。

安装源码与文档一致。并行 preflight 依来源顺序发 start，各任务完成时发 end，`Promise.all` 后再按原数组顺序发送结果 message：`$CORE/dist/agent-loop.js:373-425`。

这足以稳定处理唯一 ID。重复 ID 只能在最终 message 阶段按“第 N 个同 ID 来源”与“第 N 个同 ID result”配对；不能在 completion-ordered end 阶段精确配对。

## Confirmed rendering and cache behavior

### Host row lifecycle

每次 `updateDisplay()` 都会清空 render container，重调 `renderCall`，并通过 `lastComponent` 传回该 slot 上次的组件；有 result 时才调用 `renderResult`：`$PI/dist/modes/interactive/components/tool-execution.js:224-281`。

正式方案应让 call slot 的自有组件读取完整逻辑分组，result slot 返回空或只承担无歧义内容。否则重复 ID 的宿主历史误绑定会让正确逻辑结果没有可渲染位置。

`ToolExecutionComponent.render(width)` 在 self-shell 下调用 `selfRenderContainer.render(width)`，其他情况调用父容器：同文件 `:180-212`。`Container.render(width)` 每次遍历 children 并调用 child `render(width)`，容器没有输出缓存：`$TUI/dist/tui.js:69-125`。因此宿主不会跳过自有组件的版本检查。

主代理还在当前 Pi 0.86.0 上用真实 `ToolExecutionComponent` 做了公开 renderer 烟测。自有版本化组件在相同 width 的后续 paint 中仍会进入 `render(width)` 并读到新逻辑版本；替换的新视图能读取同一份 logical data；旧行的 `updateResult()` 不写 logical model 时不会让新视图回退；版本和 width 均未变化时，十次 paint 没有重复计算：`.tmp/review-verification/read-view-feasibility.mjs:8-49`。这证实渲染机制可行，不等于完整 Read 分组或所谓 14 项原型验收。

### Local caches

`Markdown` 只按 text 和 width 命中缓存；`setText()` 和 `invalidate()` 会清空缓存：`$TUI/dist/components/markdown.js:150-194`、`:245-257`。

所以“在 `render(width)` 检查逻辑版本”可行，但检查必须发生在自有 width-only cache 的提前返回之前。版本变化后至少要执行一项：

- 更新子 Markdown text；
- invalidate 子组件；
- 把逻辑版本放入自有 cache key。

当前仓库的 `ResponsiveLinesComponent.render()` 在调用 renderer 闭包之前就按 width 返回缓存：`extensions/codex-ui/src/responsive-lines.ts:36-48`。对应测试也确认稳定 key 会保留旧视觉，直到 invalidation 或 key 变化：`extensions/codex-ui/__tests__/responsive-lines.test.ts:18-38`。因此不能只把版本检查放进传给它的 renderer 闭包；检查必须位于 `ResponsiveLinesComponent` 外层，或让该组件的 cache key/version 机制本身感知逻辑版本。这是正式实现必须防守的本地缓存边界，不是 Pi 宿主阻碍。

### Images

宿主从 result 中提取 image block，创建独立 `Image` child；self-shell 下图片也在自定义文本内容之后单独输出：`$PI/dist/modes/interactive/components/tool-execution.js:188-209`、`:288-315`。

因此图片 Read 必须保持独立并成为分组边界。让后续自定义文本行返回空数组不能接管或正确归并宿主图片。

## History and lifecycle boundaries

### Startup and reload

0.86.0 启动时先初始化、绑定 extensions，再渲染初始历史：`$PI/dist/modes/interactive/interactive-mode.js:657-723`。因此 `session_start` 扫描 `buildContextEntries()` 可以在正常 startup 的历史行创建前准备逻辑模型。

真实 reload 还有一个顺序边界：宿主可以先构建新行，再发新 runtime 的首次 `session_start`。当前仓库已为该顺序保留 fresh row scopes：`extensions/codex-ui/src/tools.ts:177-199`。无组件引用方案不能依赖“所有 session_start 都早于行创建”，必须允许 row-local binding 在模型重建后按 generation/occurrence key 重新解析。

### Tree and compaction

`session_start` 不是唯一初始化点。`session_tree` 和 `session_compact` 后 active branch 或 compaction projection 已变化，逻辑模型必须重新扫描 `buildContextEntries()`，递增 generation，并使旧 row-local binding 失效。当前注册位置可见 `extensions/codex-ui/src/tools.ts:182-200`。

compaction 前的 Read 若未出现在新 projection 中，不得保留或参与 occurrence 计数。tree 切换后的另一个分支同理。

### Missing views

正式语义必须覆盖：

- assistant 有 Read call、没有 toolResult：`error`/`aborted` 可标为失败或中断，其他情况只能标为 unknown/pending；
- toolResult 没有 active history 中的来源：孤立显示，不参与分组；
- text、thinking、其他工具、非相邻 Read、无法绑定的 occurrence：断开分组；
- 某一来源行未被自定义 renderer 接管：视为分组边界，不能把可见内容隐藏到不存在的 owner 行；
- 必须区分“逻辑调用或结果数据缺失”和“逻辑记录完整但宿主没有创建对应视图”。前者可从来源/result 配对识别，后者不能只靠来源数据确认，必须观察实际 row binding；
- 图片结果：独立显示；
- compaction 已摘要掉的调用：不恢复。

尤其是第二类缺失视图，逻辑模型即使完整也不代表 transcript 中存在可承载它的组件。现有公开 API 没有可枚举宿主工具行的只读视图；正式方案需要通过 row-local bind 事实保守断组，并以真实宿主实验验证 reload、重复 ID 和异常历史下不会隐藏相邻行。

## Duplicate ID limitation

### Logical identity

唯一 ID 可直接索引逻辑记录；来源中发现重复后，不应再用该 ID 将共享结果投射到所有视图，应回退各行本地参数与结果。若未来还希望精确还原重复调用的历史 occurrence，则需要更细的身份，例如：

```text
(session generation, assistant source ordinal or entry id, content block index)
```

精确还原路线可另建 `toolCallId -> occurrence[]` 索引，在来源和结果配对有充分依据时使用。当前建议的保守降级方案不必为修复普通唯一 ID 历史分组而实现完整 occurrence 恢复。

### Host limitation

实时路径在 assistant update 时以 `pendingTools.has(content.id)` 决定是否创建行，在工具事件中以 ID 查找并删除行：`$PI/dist/modes/interactive/interactive-mode.js:2679-2695`、`:2747-2776`。同 ID 的第二次 call 不会获得独立实时行。

历史路径会为每个 source block创建行，但 `renderedPendingTools.set(content.id, component)` 会由后一个同 ID 行覆盖前一个，结果仍按 ID 绑定：同文件 `:3073-3117`。

自有 call renderer可以在 settled history 中绕开错误的 result slot，直接按 occurrence 读取逻辑内容；它不能迫使实时宿主创建已省略的第二行。这是公开 API 的硬限制，重绘和缓存策略无法解决。

## Current repository evidence

当前仓库已经有与本评估相关的行为测试，但现有实现不等于所评方案：

- 连续 Read 在 result 乱序时仍按 source order 分组：`extensions/codex-ui/__tests__/grouped-read.test.ts:220-240`。
- text、thinking、其他工具、缺失行和 assistant 边界断组：同文件 `:96-108`。
- 图片保持独立宿主行：同文件 `:83-94`。
- reload、tree、compaction 仅恢复 active branch：同文件 `:129-151`。
- 原生 transcript rebuild 和真实 SDK reload 保留 Read 分组：`extensions/codex-ui/__tests__/history-rebuild.test.ts:10-48`。
- 响应式组件的缓存命中和 invalidation 行为：`extensions/codex-ui/__tests__/responsive-lines.test.ts:18-63`。

主代理为本审计提供的当前全仓运行结果是：1937 tests passed、5 skipped、138 files passed、1 failed suite、3 skipped。失败 suite 是既有缺失 MCP prototype，不是本方案回归；已知缺口见 `docs/pi-0.86.0-compatibility-validation.md:71-78`。这不是全绿结果，也没有覆盖下面所有重复 ID 和真实终端场景。

当前产品实现还保存 `component` 与 `invalidate` 回调：`extensions/codex-ui/src/read-groups.ts:6-21`、`:105-109`、`:153-164`。因此现有测试能证明分组、生命周期和缓存边界已有覆盖，不能证明“完全不持有组件引用”的替代架构已经落地或通过。

## Historical 0.84.3 note

原 commit `d5b057d6` 和本机 pnpm store 中的 Pi `0.84.3` 曾作为报告基线。旧版核查也显示：end 无 args、parallel end 按完成顺序、宿主按 ID 管理工具行、renderer context 有 state/lastComponent/invalidate。当前正式支持与结论以 0.86.0 为准；不再把当前测试结果标成 0.84.3 证据。

## Required implementation boundaries

正式实施前应把以下内容写进 acceptance criteria：

1. 首要支持范围是唯一 ID 的文本 Read。
2. 重复 ID 保守降级，或只承诺全部 source-ordered toolResult 到达后的最终历史一致性。
3. `session_start`、`session_tree`、`session_compact` 都重建模型并递增 generation；reload 允许行先于首次 session_start 出现。
4. `message_end` 使用 `event.message` 增量更新，不假设 SessionManager 已持久化当前 message。
5. 分组只按 assistant source block 邻接，不按 result 完成顺序。
6. call slot 承担完整逻辑组视图；`context.state` 只保存本地 occurrence binding。
7. 自有 `render(width)` 在任何本地 cache early return 前比较逻辑版本。
8. 图片、缺失来源、缺失 result、孤立 result、未接管行和歧义重复 ID 都是显式边界；不能从逻辑来源存在推断宿主视图必然存在。
9. 更新只发生在宿主会请求下一帧的事件中；不得假设普通 `ctx.ui.requestRender()` 存在。
10. 不读取或修改宿主私有 `pendingTools`、`chatContainer` 或 `ToolExecutionComponent` 字段。

## Experiments still required

以下项目尚不能仅凭现有测试标为已证实：

- 构造两个或三个相同 `toolCallId`，并让并行完成顺序反转，验证保守降级和最终 occurrence 配对；
- 在 Pi 0.86.0 真实 regular TUI 与 fullscreen TUI 中分别验证 streaming、resize、reload、resume、tree、fork、manual/auto compaction；
- 验证 assistant error/aborted、缺失 toolResult、孤立 toolResult、图片 Read 和截断结果；
- 分别构造“缺失逻辑调用/结果”和“逻辑记录完整但宿主未创建视图”，验证后者只能以实际 bind 事实识别，并确认不会错误隐藏相邻行；
- 为“不保存组件或 invalidate 引用”的新架构单独运行 history rebuild、缓存和真实 CLI smoke。现有实现仍保存这些引用，不能用现有通过结果代替该实验；
- 取得所称 14 项原型及其验收定义后逐项核对。当前没有该原型，不能声称上述 smoke 或现有 suites 已覆盖这 14 项。

## Final assessment

唯一 ID、文本 Read、active history 的方案可行，没有发现必须修改宿主的阻碍。正式实施必须补足 reload 先建行、tree/compaction generation、message_end 持久化时序、图片、缺失视图和本地 cache version key。

重复 ID 应继续作为歧义边界，使用各视图本地数据而不串用共享结果。不额外承诺纠正宿主本身的重复 ID 行复用或并行结果归属。这个限制不妨碍修复唯一 ID 的历史重建问题。
