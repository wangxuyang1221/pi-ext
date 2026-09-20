# Multi-skill lifecycle audit

## Follow-up

后续用户已确认消费时加载快照。新增历史编辑适配与压缩反向边界实验见[历史与恢复审计](skill-history-recovery-audit.md)，生命周期实验现为 21 项，组合实验为 45 项。下文保留前轮结论；其中历史编辑、压缩边界和加载时点的待办以新报告为准。

## Result

本轮新增 18 项离线生命周期实验，使用真实 `DefaultResourceLoader`、extension runner、`AgentSession`、session entries 和官方 faux provider。全部通过。加上既有输入与组件实验，共 38/38 通过。

新发现的公开入口 `message_end` 可以替换普通 user 的最终内容，同时保留 role。替换发生在持久化和模型请求之前。配合 `message_start` 提前创建展示 entry，可保留原生卡片在正文之前的顺序，也能避免把完整 skill 正文塞进待发送队列。

这补充了此前调查遗漏的路线。[上一轮审计](multi-skill-api-audit.md) 对 input transform 的验证仍成立，但“只能依赖 input transform 承载快照”和“必须 context 后追加展示”的候选不再完整。这里没有修改产品，也没有认定整个功能已经完成。

## Confirmed behavior

本轮用户已确认此前三项局部交互：重复引用只加载一次，关闭候选不删除引用，光标在名称中间不弹候选。Tab/Enter 选择且不发送、失败静默回退、代码与转义排除、空白分隔、多个 skill 同一消息的决定均保持不变。

后续 #5 已通关，输入规则移交 [Spec Behavior](https://github.com/wangxuyang1221/pi-ext/issues/2#behavior)，剩余兼容主题由 [Planning #7](https://github.com/wangxuyang1221/pi-ext/issues/7) 承接。本报告只记录可行性和兼容证据，不作为第二份 Spec。

## Environment and sources

- 锁定 `@earendil-works/pi-coding-agent@0.86.0`，Node.js 22.22.2，pnpm 11.9.0。
- Context7 返回 main 文档，支持发现 API，但不能单独证明 0.86.0 行为。本轮按安装包文档、实现和真实离线执行核验。
- 原始源码固定在此前已核验的 tag commit `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`。
- [Extension message events](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/docs/extensions.md)：`message_end` 支持返回同 role 的替换消息。
- [AgentSession](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts)：`_handleAgentEvent` 先消费队列、派发 extension，再向 listeners 通知，最后持久化；`_replaceMessageInPlace` 同步 agent state 和最终持久化对象；`appendEntry` 发出 `entry_appended`。
- [Interactive mode](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts)：user 在 `message_start` 显示，user `message_end` 不重绘；恢复时使用最终持久化内容。
- [SDK](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/docs/sdk.md)：inline extension factories、隔离 resource loader 和 in-memory session。

## Routes compared

### Input transform and late display

此前候选已经在真实生命周期中验证：input transform 将完整快照放进一条 user，context 后按 user entry id 追加展示。

结果：

- idle 一次请求包含两份完整正文、真实路径、相对引用目录、用户任务和图片。
- steer/followUp 仍是一条逻辑 user 消息，不拆成每 skill 一次请求。两次 provider 调用分别属于原任务和排队任务。
- 队列里保存的是完整封装，`clearQueue()` 返回的也是完整封装。
- live transcript 是正文在前、卡片在后。两条 queued user 同批到达时出现 `U1 U2 D1 D2`。
- `before_agent_start` 仅在原 idle 任务运行一次，不能覆盖随后消费的队列任务。

这条路线有效，但用户可见的队列文本和卡片位置代价已实测，不能称为原生行为完全不变。

### Finalized user replacement and late display

将加载改为 `message_end`，返回同 role 的 user，图片保留。其余展示不变。

结果：

- idle、steer、followUp 仍把完整快照放入同一条最终 user 和对应模型请求。
- 队列待消费期间仍是原始输入，不含快照。
- 依然是 user 正文在前、context 后追加卡片。
- reload 和 JSON entries 恢复不需要重新读取 skill 文件。

### Early display and finalized user replacement

本轮新增候选，产品采用尚未确认：

1. `message_start` 中，从真实 skill 文件读取本次快照，生成一次性的 request id。
2. 用当前 message 对象作为内存关联键，暂存这份完整封装。它只跨越该 user 的 start/end 事件，不把队列提交与消费靠文本字符串匹配。
3. 提前 `appendEntry` 保存展示快照及 request id。公开 renderer 返回原生 skill 组件容器。
4. Pi 随后显示原始 user 正文。因此顺序是卡片在前、正文在后。
5. `message_end` 返回完整 user 封装，request id 与展示 entry 一致，图片原样保留。完整快照进入最终 user 和模型请求。
6. user Markdown transformer 在恢复时只显示原始任务，避免展示完整封装。
7. renderer 只显示能关联当前有效 user 的展示 entry，或当前正在 start/end 之间处理的临时项。恢复时不显示只有展示 entry、没有 user 的孤立项。

已通过：

- 正常 live 与恢复均是卡片在正文前，多 skill 仍在一次请求内。
- 两条 steer 或 followUp 同批消费时保持 `D1 U1 D2 U2`，不再集中追加所有卡片。
- 排队期间保留干净的原始输入。
- user 最终内容保存真实路径和正文快照，删除原文件后仍可恢复卡片。
- 模拟进程在展示 entry 已存在、user 尚未持久化时中断，恢复后孤立卡片被隐藏。
- 一个 skill 文件读取失败时静默保留引用文本，另一项正常加载，不显示失败项卡片。

此候选在队列实际被消费时读取文件，不是在刚入队时锁定快照。若文件在等待期间变化，使用消费时版本。该时间语义尚未写入已确认规格。

## Recovery findings and limits

后置展示路线验证了 append 失败不损失模型正文，reload 可补写一次缺失 entry。补写发生在当前 leaf，不保证恢复后的卡片还在原始位置。不能把这项恢复测试当作提前展示路线的所有恢复场景都已通过。

真实 `session.navigateTree(userId)` 与直接 `SessionManager.branch(userId)` 不同。前者移到 user 的 parent，把该 user 原始持久化内容交回 editor；它不是停留在包含该 user 的分支。实测返回的是完整封装，不是清理后的任务文本。产品仍需设计历史编辑的原文还原，否则用户会看到封装。原生 slash 同样存在展开后文本，但不能因此忽略新协议的体验。

compaction 实验使用公开 `session_before_compact` 提供受控摘要及 firstKeptEntryId，未调用真实摘要模型。实测 user 被压缩移除、展示 entry 留下时，renderer 能隐藏孤立卡片。提前展示路线中“展示被移除但 user 被保留”的反向边界仍待验证和设计，不能承诺恢复/压缩的显示位置全部不变。

## Source boundary

`input` 事件提供 `source`，但 `message_start`/`message_end` 只提供 message，不携带交互、RPC、extension 来源标记。

当前提前展示探针以 `ctx.mode === "tui"` 限定终端会话，并对其中的普通 user 消息应用识别。因此其他插件通过 `sendUserMessage()` 发送的普通 user 消息也可能被识别。它不会处理 custom role，也不会把 assistant/tool 输出当输入。

后续用户已选择允许处理这些插件生成的普通 user 消息，要求已移交 Spec Scope，来源边界不再阻碍此候选。仅手工输入的备选不再推进；也不需要用按 text 建立的松散缓存区分来源。

RPC/print 本来不在本批 TUI 输入框范围内。本探针的默认 input 路线仅供比较，不代表把其他模式纳入产品。

## Verification

- [Lifecycle experiment](../experiments/multi-skill-lifecycle.test.ts)：18/18 通过。
- [Combined experiment log](multi-skill-lifecycle-tests.log)：三个文件共 38/38 通过。
- 新生命周期实验与原生组件实验使用独立 `tsc --noEmit --target ESNext --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions --skipLibCheck --esModuleInterop --types node` 类型检查，通过。补齐了原组件夹具缺失的 `ParsedSkillBlock.userMessage`，未改产品。
- [Full check log](multi-skill-lifecycle-check.log)：类型检查通过，1953 项测试通过、5 项跳过，仍因基准缺失 `prototypes/mcp-status-ui-prototype/src/codex-startup.js` 导致一个 suite 失败。build/package:check 因测试失败未执行；前轮发布包基准缺口仍未修复。
- 所有 credentials、models store 和 session 都在内存。临时真实 skill 文件位于 worktree 的 `adventure/experiments/.lifecycle-*`，测试后删除。没有网络模型请求或常驻服务。

## Remaining verification

这些是实际 extension/session 生命周期实验，不是完整产品或真实 PTY 验收：

- 实验解析器只识别固定空白分隔夹具，未实现完整代码、转义、名称、光标语法。
- transcript 使用实际 InteractiveMode 方法及原生组件，但替代 terminal/editor 宿主，没有启动整套交互界面，也未加载其他全局插件。
- 提前展示方案仍需覆盖展开状态、主题、reload 中途操作、外部 transformer 链、自定义快捷键、`/skill:` 原入口隔离、fork/runtime 切换、压缩反向边界和实际磁盘 JSONL 失败。
- 历史编辑原文还原与加载时间语义须在 #7 明确后再实施；来源边界已移交 Spec。
- 缺失展示修复不能制造重复模型内容或伪造路径；显示一致性异常不等同于用户选择的“读取 skill 失败静默回退”。
