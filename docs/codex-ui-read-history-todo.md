# Codex UI Read history grouping fixes

## Understanding

在插件内将 Read 的逻辑分组与显示组件分离，修复唯一 ID 的 Read 在真实历史重建后退化为独立行的问题。基线为提交 `16a79e5`、Pi `0.86.0`，保留其他会话已完成的升级修复；已获准按下述边界实施。

Pi 0.86.0 的 Ctrl+T 已改为原位更新 assistant 组件，不能再用它代替真实历史重建验收。核查及隔离实验见 [Read history API audit](codex-ui-read-history-api-audit.md)。不修改宿主、不拦截快捷键、不读取宿主私有行列表，不增加版本分支或升级依赖。

## User visible changes

- 来源明确、ID 唯一的连续文本 Read 在历史组件重建后仍保持分组，包含本轮刚完成调用；不再需要额外 `/reload` 恢复。现有 Ctrl+T、reload、展开和收起行为不回归。
- 流式结果和最终结果按实际事件更新，旧组件重绘不能让完成结果回退，也不能把另一会话或分支的内容带回来。
- 图片、真实重复 ID、无法确认归属或承载视图的调用仍独立显示并断开分组；不跨正文或其他工具。保留既有路径、预览、错误及截断信息，不改工具执行、权限或持久化结果。

## Todo

### 1. Locate

- [x] 明确逻辑记录、来源出现次数和视图本地状态的职责与生命周期；确定事件去重、最终结果优先级及 reload 先建行后初始化的处理方式。区分缺失来源、缺失结果与完整逻辑记录但没有宿主视图的情况，确定不依赖组件存活探测的保守断组规则。若公开接口无法满足某个既有边界，先说明并确认，不静默放宽验收。

### 2. Implement

- [x] 重构 `read-groups.ts`，让分组、参数、结果与数据版本属于会话逻辑记录，不保存组件或其 invalidate 回调。从公开 `buildContextEntries()` 初始化 active history；唯一 ID 可直接关联，真实重复 ID 按来源出现次数判为歧义，不把组件重建或重复消息快照算成新调用。分组始终按 assistant 来源顺序，不按结果到达顺序。
- [x] 在 `tools.ts` 接入公开消息和工具执行事件，增量维护当前 Read 参数、流式状态和最终结果。直接使用事件携带的数据，避免在尚未持久化的 `message_end` 中重扫并漏掉当前消息；重复投递不得重复计数或让完成结果回退。普通事件只处理当前消息或受影响记录，不扫描整段历史。
- [x] 调整 Read 自有视图及 `read-group-layout.ts` 的数据接入。`context.state` 只保留本地绑定、展示状态和宿主提供的本行数据；唯一来源读取逻辑记录，歧义来源使用本行数据。版本检查必须早于宽度缓存命中返回，分组变化和兄弟结果更新可在宿主下一帧显现，稳定重绘不重复提取、计数或高亮。优先使用 Read 专用版本化视图，不为此改变其他工具的缓存契约。
- [x] 接通 session_start、tree、compaction、reload 和 shutdown 的模型重建或清理，使用会话代次隔离旧视图与新数据；历史组件重建本身只创建新视图，不重置逻辑事实。保留图片、从未绑定视图和重复 ID 屏障，不把可见行隐藏到不存在的 owner 下；不增加定时器、历史轮询或跨会话全局状态。

### 3. Deliver

- [x] 更新 README 和前两轮记录，区分 Pi 0.86.0 已避免的 Ctrl+T 触发路径与本次修复的真实重建问题。只有正式行为、边界和成本测试通过后，才撤销对应已知限制；保留未覆盖项和宿主重复 ID 限制，记录实际验收结果。

## How to test

### Workflow

按 Red → Green → Refactor 逐项推进。先在正式测试目录补真实重建失败用例，再实现逻辑数据与视图分离；后续分别覆盖实时更新、归属边界和生命周期。既有测试里仅因创建第二个组件就判为重复调用的假设需要改为真实来源重复，同时另测同一来源重建视图，不能删掉真实重复 ID 的保护。

优先使用真实 SDK、事件分发、`InteractiveMode` 历史方法和 `ToolExecutionComponent`，只省略无关 editor/footer。测试夹具调用宿主方法不等于在产品中挂接私有方法。临时 `.tmp/review-verification/` 脚本仅作前期证据，不作为正式测试依赖，也不把未取得的 14 项原型测试视为已验收。

### Behavior checks

| 场景 | 通过条件 |
| --- | --- |
| 已完成历史 | 原生历史恢复后显示连续 Read 分组；重复调用真实 `rebuildChatFromMessages()` 至少三次，仍按原顺序显示路径和结果。旧实例 invalidate、更新本地参数/结果及重绘均不污染新视图的逻辑数据。 |
| 当前调用与流式更新 | 通过真实会话完成 Read，立即重建历史；最终结果不丢失。覆盖部分结果、执行结束后及结果 message 尚待持久化的事件顺序、并行乱序完成、重复事件，确保逻辑事实只更新一次，不回退。 |
| 原生交互与 reload | 连续 Ctrl+T 保持当前行为；真实 `session.reload()`、恢复会话、展开/收起、resize 后分组和内容仍正确。覆盖新行先于新 runtime 首次 session_start 创建的顺序，不能只测初次启动。 |
| 分支及压缩 | tree、切换会话、fork、manual/auto compaction 后只使用当前 context projection；已摘要掉或另一分支的调用不复活。清理后的旧视图不能重新写入新模型或缓存。 |
| 真正重复 ID | 同一来源快照反复更新不增加出现次数；同一或不同 assistant 消息实际多次使用相同 ID 时独立显示本行数据，不共享其他调用的参数或结果。覆盖后续才出现重复的情况，不承诺修复宿主本身的重复 ID 行复用。 |
| 图片与内容屏障 | text、thinking、其他工具、消息边界和图片保持屏障；图片附件与本行文件名相邻，结果从文本变为图片时正确拆组。 |
| 缺失数据与缺失视图 | 分别构造无来源结果、无结果调用，以及逻辑记录完整但 owner 或中间视图从未绑定的情况；不得吞掉相邻可见内容或跨这些缺失行分组。按用户确认的边界，不承诺探测宿主无通知移除曾绑定视图；公开接口没有行卸载通知，绑定只代表曾观察到该行，不代表持续挂载。 |
| 展示与执行回归 | 保留同文件不同范围的独立记录、三行预览、每行 512 个 UTF-16 单元上限、展开最多 40 行、长路径、错误/取消/截断提示及 low-power 相关既有行为。Read 执行配置、权限拒绝、磁盘及持久化结果不变，其他工具回归通过。 |

### Cost and resource checks

- 初始化或会话投影变化允许一次与 active history 大小线性相关的扫描；通过 `buildContextEntries()` 调用计数，证明普通工具事件、组件绑定和 paint 不触发全历史扫描。100/1000 条历史下更新一个调用，仅处理该记录及受影响分组；流式来源更新最多扫描当前 assistant 消息，不重算此前所有消息。
- 统计源码提取、行数计算和布局构建次数。版本、宽度、展开及主题均未变化时重绘不重新计算；兄弟调用变化只使对应数据及必要的组合布局失效。版本检查必须位于 `ResponsiveLinesComponent` 等本地缓存的提前返回之前。
- 逻辑记录数量随 active history 增长是必要成本；不为每次重建复制整份结果正文，不按组件创建次数扩张会话记录，不保存宿主组件引用。派生布局继续遵守既有共享缓存预算，重复重建和稳定重绘不累积逻辑记录；reset/shutdown 后失效代次不能重新填充缓存。
- 依靠宿主消息与工具事件后的重绘，不假定普通 `ctx.ui.requestRender()` 存在，不增加定时刷新。逻辑变更只发生在有明确后续重绘路径的事件或生命周期步骤；缺少该路径时先补足设计依据。
- 所有假配置、会话和临时文件放仓库内隔离目录；不调用在线模型服务。若启动测试进程或终端服务，结束后停止并确认端口释放。

### Final verification

- 运行 Read 分组、真实历史重建、响应式缓存及相关性能测试，再执行 `pnpm exec vitest run extensions/codex-ui/__tests__`。
- 运行 `pnpm exec tsc -p extensions/codex-ui/tsconfig.json --noEmit` 和 `pnpm run check`。
- 若全仓命令因无关失败提前停止，单独运行 `pnpm run build` 与 `pnpm run package:check`，分别记录结果，不将部分通过称为全仓通过。
- 用现有隔离终端设施检查普通及全屏模式的工具更新、历史重建和图片位置；无法实测的终端场景明确列为未覆盖。
- 检查改动及新增文件的空白，不手工修改 `dist/`；行为、边界和成本均通过后勾选实现项。

## Notes

- 实施及验收完成后，用户已批准本地提交并推送到 `origin/fix/codex-ui-review`。保留其他会话的 Pi 0.86.0 适配改动。
- 继续限制在插件公开 API 内。用户已明确接受“不检测宿主无通知移除曾绑定视图”的边界；其余缺失来源/结果、从未绑定视图和重复 ID 屏障不变。若需进一步变更，仍先确认。
- 不新增产品提示或改变现有文案；如实施确有需要，先按仓库语言策略确认。
- 前次当前基线检查有 1937 项测试通过，仍因缺少 `prototypes/mcp-status-ui-prototype/src/codex-startup.js` 失败；发布缺失文件见既有兼容性验收记录。本次已复核，未补造无关文件或削弱校验。

## Results

以下为首版 `ed18fb6` 的实施记录。复核发现该版本会忽略最终消息修订，后续修复见 [Final message priority follow-up](#final-message-priority-follow-up)。

实现基于 Pi `0.86.0`，未改依赖、宿主或 Bash 分组实现。`ReadGroups` 保存来源记录、出现次数、候选组和版本，不保存组件引用。`ReadViewComponent` 在宽度缓存前检查逻辑版本；旧视图回调只更新本地后备数据。来源、执行和最终结果直接消费公开事件，初始化与投影变化才扫描 active history。

分组重算延迟到下一次 paint，并合并同组连续变更。100/1000 条记录的批量初始化、绑定保持线性；更新一个记录不访问其他历史组。工具执行结果、图片附件仍由宿主管理。

### Regression evidence

- 先加入实际 `rebuildChatFromMessages()` 断言，旧实现失败；重构后通过。随后加入真实 SDK 完成 Read 后立即重建，未接入执行事件时失败，接入后通过。
- 新增 7 项 `read-model.test.ts`，覆盖结果未持久化时更新、重复快照、真正重复 ID、旧回调与迟到 partial、图片拆组、缺失来源/结果/从未绑定视图、投影代次及成本。批量成本测试曾测得 100 条记录需要 31602 次 Map 查询，延迟合并重算后通过线性上限。
- `history-rebuild.test.ts` 使用真实 SDK 和宿主组件，验证三次实际重建、Ctrl+T、本轮完成读取、reload 先建行后初始化、实际 tree 往返及手动压缩。压缩后被摘要的 Read 不再出现。
- 现有分组测试改为分别发送来源事件与组件回调，不再把 renderer 回调当成会话事实。正文/思考/其他工具屏障、乱序结果、相同文件不同范围、错误、取消、截断和缓存回归继续通过。

### Verification

| 检查 | 结果 |
| --- | --- |
| codex-ui 测试 | 28 个文件，226 项通过 |
| codex-ui TypeScript | 通过 |
| `pnpm run check` | 全仓类型检查通过；1944 项测试通过、5 项跳过；1 个 MCP suite 因基线缺失 prototype 文件失败，后续步骤未执行 |
| `pnpm run build` | 单独执行通过 |
| `pnpm run package:check` | 基线发布文件缺失，首次报错 `docs/goal-descendant-acceptance.md` |
| 普通 PTY | `--production --play --restart` 通过 |
| 全屏 PTY | `--production --play --fullscreen --restart` 通过 |

PTY 使用现有 `prototypes/tool-status-prototype/smoke.py` 和新构建的生产模块，工作目录、HOME、settings、session 全部隔离于仓库 `.tmp`，禁用网络和真实 shell 执行。检查流式 Read batch、成功/失败/中断状态、展开、宽度及主题变化、reload 和持久化重启；两种模式保存的 reload/restart 屏幕均包含 `Read 3 files`。测试进程已退出，无残留 runtime。

实际重建与 live→rebuild 的 Red/Green、全仓检查及 PTY 日志保存在本地 `.tmp/review-verification/read-model-*`，不是正式测试依赖。`git diff --check` 及新增文件空白检查通过。

### Remaining boundaries

- 不检测宿主无通知移除曾绑定视图，保留用户明确接受的限制。
- 重复 ID 只保证插件不串用共享结果；不纠正宿主本身的行复用或精确并行归属。
- session replacement、auto compaction 共用已测的重建与投影处理；本轮未分别跑真实 fork/switchSession 和自动阈值触发的端到端流程。
- 图片屏障通过真实工具组件测试，但没有在真实支持图片协议的终端验证像素附件。未覆盖在线 provider 或所有终端平台。
- 全仓检查与发布校验未全部通过，不将本轮定向通过写成全仓通过。

## Final message priority follow-up

`ed18fb6` 复核确认：前置扩展通过公开 `message_end` 返回值修订 Read 消息时，监听器和历史已经是新内容，逻辑记录却因执行阶段的 `final` 锁而保留旧内容。这是首版引入的回归，不属于重复 ID 或缺失视图的妥协。

- [x] 先补真实 SDK 回归。未修订消息的对照通过；开启前置修订后，历史已更新而首次真实重建仍显示旧内容，测试失败。
- [x] 将结果更新入口改为显式来源，优先级为 `partial < execution < message`。最终消息可修订 content、details 和状态；同级终态只接收一次，迟到低优先级事件不覆盖。历史投影直接按 message 优先级初始化。
- [x] 沿用原有版本和图片标志更新，变更只影响对应记录及候选组，不新增历史扫描或组件引用。
- [x] 补验无执行事件直接收到最终消息、历史初始化后的迟到事件、重复事件幂等、同宽缓存刷新，以及文本/图片双向变更的逻辑屏障。

修复后，真实 SDK 的修订与未修订两组测试都通过，包括立即连续三次重建、reload、tree 往返和手动压缩。逻辑层验证最终 content、details、错误状态均更新，迟到 start/partial/end 不回退；重复最终消息不增加版本或缓存 miss。图片测试不重新调用 renderer slot，验证模型事件本身即可在下一帧更新文本布局。

本轮检查结果：codex-ui 28 个文件、231 项测试通过；全仓类型检查和独立构建通过。`pnpm run check` 中 1949 项通过、5 项跳过，仍有 1 个 suite 因缺失 `prototypes/mcp-status-ui-prototype/src/codex-startup.js` 失败；独立发布校验仍缺失 `docs/goal-descendant-acceptance.md`。未修改这些基线问题。Red/Green 及验证日志在本地 `.tmp/review-verification/read-final-*`，正式测试不依赖这些日志。

本轮未重跑 PTY 或图片协议终端。修复更新插件已经观察到的最终消息，不新增观察后置扩展返回值的机制，也不改变宿主管理图片附件的生命周期。图片相关断言限于逻辑分组和文本布局，不将其当成像素附件的端到端验收。验收后，用户已批准将本轮修复单独提交并推送到 `origin/fix/codex-ui-review`。
