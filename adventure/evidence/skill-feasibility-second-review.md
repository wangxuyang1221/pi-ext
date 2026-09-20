# Skill Feasibility Second Review

## Verdict

独立复核结论：**确认 Pi 0.86.0 没有直接替换原生 skill 组件的公开 renderer 入口；修正“因此应优先补上游接口”的路线判断。公开 API 组合存在更轻的候选，前一轮三项路线不是穷尽集合。**

优先候选是：`input transform` 将完整 skill 正文、路径提示、用户任务与图片保存在普通 `user` 消息中，使用不同于原生 skill XML 起始格式的自包含表示；`registerMarkdownTransformer` 仅把界面文本变为紧凑声明与任务。这不需要 `context` 还原，也不需要改变消息角色或修改 Pi。代价是声明融入普通用户消息、失去原生 skill 块的独立交互，并需要处理队列和历史输入中的原始封装文本。

这是一条有源码和最小实验支持的可行路线，**不是已完成产品，也不是已经选定的规格**。如果必须统一改造旧历史、保留原生独立折叠及所有既有用户消息行为，上游正式 renderer 仍是更合适的条件性候选。用户尚未确认这些要求，不能把实现偏好提前升级为硬约束。

本轮到复核结束；不进入产品实施，#4 保持 open，#5/#6 仍由 #4 阻塞。

## Scope and Evidence

- 用户仓库：`wangxuyang1221/pi-ext`，分支 `adventure/skill-mentions`。本轮读取时远端 HEAD 为 `af0c0a2d30d4a5376453877abbe8defdceb068c8`，已经包含 handoff；`2897ceb` 是 handoff 写入前的历史状态。
- 官方 tag `v0.86.0` 实际解析为 commit [`ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`](https://github.com/earendil-works/pi/commit/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc)。项目 package.json 的 coding-agent、pi-tui 依赖仍锁定 `0.86.0`。
- 本轮环境没有用户 Mac worktree 或其 node_modules；通过 GitHub connector 读取锁定源码及远端分支证据，在隔离目录离线执行源码探针。Node 为 `v24.19.0`，不同于前一轮的 `v22.22.2`。没有真实模型调用。
- 已完整读取两份原审计、输入 11 项实验代码、#4、仓库语言策略与 AGENTS.md。复核成员完整读取锁定版 `extensions.md`、`tui.md`、`skills.md`、`themes.md`、`session-format.md` 及相关 autocomplete/input/message/entry 示例。
- 本轮获取的 `agent-session.ts` SHA-256 为 `3ea88a751cd830db66ae9348be9f8dfbd5218a01e74b445f3aee9fb87ad3e865`；Editor 为 `241695859d48f49c6aaba9b9cfc14c6cd28639c6c247adb4fe2c202a9e2c6e20`。与前一报告已比对安装包的值相同。本轮没有重新宣称完成全部发布包逐字节比对。
- 原报告保留不覆盖：[输入审计](skill-input-api-audit.md)、[渲染审计](skill-rendering-api-audit.md)。前报告中的推荐、条件分析与待验风险均未视为用户决定。

## Claim Review

下表同时包含原报告明确判断与本次需要排除的扩大推论，并非声称前一代理逐字作过每项推论。前一报告在“保持全部原生语义不变”的附加条件下有充分依据；本轮修正的是把该条件作为默认路线筛选标准的做法。

| Claim or inference | Verdict | Evidence boundary |
| --- | --- | --- |
| `addAutocompleteProvider` 可与 CodexEditor 共存 | 确认，限默认 token 边界体验 | 当前 CodexEditor 继承公开 Editor 链；宿主合并 provider 与 trigger characters。既有 11 项实验没有验证完整插件生命周期。 |
| 输入框任意位置只加 `triggerCharacters: ["$"]` 即可 | 需要修正 | 紧邻普通汉字默认不触发。新增探针放宽 provider 正则后仍不触发，隔离了 Editor 的边界限制。 |
| 从默认边界限制推导出紧邻汉字必须改 Pi 或用私有方法 | 不应作此推导 | 公开 editor factory 包装与 SelectList 已有 5 项离线探针支持；但需要额外输入状态与生命周期工作。 |
| `getCommands()` 可取得已发现 skill | 确认 | 返回名称、描述、来源和 sourceInfo；与原生 slash 菜单的 enableSkillCommands 过滤有差别，策略尚待确认。 |
| 单 skill 可用 input transform 转入原生展开 | 确认 | transform 在展开、入队之前；只返回 text 时保留 images。原 11 项结果按其替代 host 边界接受，本轮未原样重跑。 |
| 没有公开原生 skill renderer 替换入口 | 确认 | 原生 user skill 分支直接构造组件；现有三个 renderer/transformer API 均不接管该组件。证据足以支持 0.86.0 的直接替换限制。 |
| 缺少这个接口意味着无法用公开 API 完成两个体验 | 需要修正 | 普通 user + Markdown 显示转换，以及 custom message + renderer，均是可验证的替代表示。可用性取决于接受的行为代价。 |
| 原生一次只展开/解析一个 skill 块 | 确认，但限原生表示 | 本轮调用实际 parser 验证双换行与单换行差异；插件自定义内容可容纳多个 skill，规则仍需设计。 |
| 将 session 的 custom role 等同于模型角色也发生变化 | 需要区分 | Pi 内建 convertToLlm 将 custom 转为 user；session 角色和部分宿主行为确实改变。 |
| prototype 补丁可发布 | 未能确认 | 只确认类导出与普通 prototype 方法存在；本轮未验证 class identity、reload、冲突、恢复或升级。 |
| 全仓检查通过 | 不成立 | 前一轮 check/package:check 的基准缺口仍存在；本轮未获得原 worktree 依赖环境，未重新执行完整仓库检查。 |

## Native Rendering Boundary

源码链路与前审计一致：`prompt()` 先运行 input，原生展开将 skill 正文写入普通 user 文本；TUI 对其调用 `parseSkillBlock()`，匹配就直接 `new SkillInvocationMessageComponent`。该组件自己创建 Box、标签、Markdown 与点击区域。user Markdown transformer 只接收到 XML 后面的任务文本。现有 `registerMessageRenderer` 按 customType 处理 custom role，`registerEntryRenderer` 处理不进入模型的 custom entry。

原始证据：[input 与展开顺序](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts#L1319-L1336)、[TUI 分派](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3671-L3744)、[原生组件](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/components/skill-invocation-message.ts#L11-L64)、[公开 renderer 类型](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/extensions/types.ts#L1205-L1232)。

主题仍是最轻的部分美化入口。如果最终需求只是颜色或去掉背景色，主题可能已足够；目前没有视觉设计，不能排除这种情况。但原生 skill 的 `Box(1,1)` 结构留白是固定的，主题与 outputPad 不会把它改成任意紧凑行。普通 user 则使用 `Box(outputPad,1)`。这也是“美化”尚不能直接等同于“必须替换组件”的另一项边界。

`message_end` 不是更简单的显示替换入口：它允许替换同 role 消息，且发生于持久化前；但 TUI 已在 user 的 `message_start` 创建组件，user 的 `message_end` 直接跳过。这种改写可能改变后续状态/恢复显示，却不能刷新当场原生 skill 块。不能以此声称 live/history 一致的替换成立。[message_start](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3294-L3303)、[message_end](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3353-L3355)。

## Public Route A: User Content and Display Transformation

候选链路为：识别已发现的 skill → input transform 生成完整且自包含的用户消息 → 原生 prompt/queue/session → user Markdown transformer 只精简显示。

自定义封装不匹配原生 `^<skill name="..."` 起始格式即可进入普通 user 分支。实验分别使用额外的外层标签和“任务在前、skill 正文在后”的夹具证明分派；两者都不是选定的产品协议。

正文可从 `pi.getCommands()` 的 `sourceInfo.path` 读取；`stripFrontmatter` 本身从 Pi 顶层公开导出，不必复制其实现或调用私有展开方法。相对引用目录应以 skill 文件所在目录为准，保留当时正文快照。多个 skill 可以在同一消息中各自保存正文、来源和顺序，避免全局“最近一次 skill”状态导致队列错配。[getCommands](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts#L2685-L2707)、[SourceInfo](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/source-info.ts)、[公开导出](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/index.ts)。

这条路线的保留项与变化项：

| Concern | Behavior |
| --- | --- |
| 模型内容 | 完整 skill 正文、路径提示、任务和 images 都在 user content。显示转换不会把摘要声明送给模型。整个文本的封装/次序与原生 XML 不同，不能声称模型请求逐字节相同。 |
| 持久化 | 仍是普通 user message，保存完整快照；session 文本格式发生变化。正文不会因 skill 文件日后修改而自动变化。 |
| 正常发送 | 保留 prompt 的鉴权准备、before_agent_start 和原生 user 路径。 |
| 队列关联 | 每条消息自包含，沿现有 steer/followUp 队列走；图片可由 input transform 的默认保留逻辑携带。不需要另设按文本或时间戳猜测的关联表。 |
| 队列界面/撤回 | 原生队列显示直接读取 raw text；撤回编辑拿到完整封装，Markdown transformer 不覆盖这些位置。原生 skill 队列本来也保存展开 XML，仍需实际比较并决定编辑表示。 |
| 历史输入与 fork | 普通 user 消息保留原生入口，但 envelope 会进入相关原始文本路径；不等于原有短输入的显示/编辑体验不变。 |
| 新的 /skill: | 只有明确在 input 中接管它才使用新表示；否则继续原生行为。不可宣称自动覆盖。 |
| 旧历史 | 旧原生 XML 仍匹配原生 skill 分支，保持旧外观；本路线本身不能统一改造全部旧块。新表示恢复后可由相同 transformer 显示。 |
| 多 skill | 表示与分派可行；顺序、去重、冲突、未知引用和转义未确定。 |
| 展示交互 | 可将 skill 声明与任务合并进一个普通 user box；该 box 的背景与上下 padding 仍存在。原生独立 Ctrl+O/点击展开不再自然适用，需要另外设计详情访问。 |
| 压缩与分支 | 完整正文在 content，因此内建 token 估算和摘要路径可见。被正常 compaction 摘要掉的旧消息不保证继续逐字保留在有效上下文。 |
| 缺少插件 | 模型上下文仍有完整正文；TUI 将显示原始封装，精简外观依赖 transformer。 |

[显示转换文档](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/docs/extensions.md#piregistermarkdowntransformertransformer)、[UserMessageComponent](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/components/user-message.ts#L33-L59)、[原生队列显示与恢复](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L4439-L4510)、[会话投影](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/session-manager.ts#L401-L493)。

不要把 skill 正文只存入 metadata，然后假定一个 context hook 能无代价恢复所有消费者。内建 compaction 与 branch summary 直接转换持久化消息，不走正常主模型的 context 映射。完整正文保存在 content 是更轻且更容易核验的方案。[compaction 摘要输入](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/compaction/compaction.ts#L693-L700)、[branch summary 输入](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/compaction/branch-summarization.ts#L315-L327)。

## Public Route B: User Content and Custom Entry

如果希望声明仍是独立组件，可以保留路线 A 的完整 user 内容，再组合以下公开 API：user Markdown transformer 隐藏封装；在后续 `context` 事件中，通过只读 `ctx.sessionManager.getBranch()` / `buildContextEntries()` 找到已持久化的 user entry；按真实 entry.id 去重追加 `appendEntry`；由 `registerEntryRenderer` 绘制独立声明与详情。这里 context 不改模型 messages，custom entry 只负责展示，完整正文仍在普通 user content。

这比将整条用户输入改为 custom message 更能保留原生发送语义。renderer 的组件/间隔能力和隐藏 user 的效果已由渲染探针验证；**整套 context 关联流程只有源码依据，尚未运行生命周期实验**，因此不能与路线 A 的简单组合混称为已验成品。

公开关联时点有依据：Agent 逐个 await 事件 listener；AgentSession 在 user message_end 的 listener 内持久化；agent-loop 等待这些消息事件后才调用 transformContext。到 context 阶段可获取真实 entry.id，避免全局 pending 或按任务文本/时间戳猜关联。[事件处理](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/agent/src/agent.ts#L553-L605)、[持久化](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts#L697-L727)、[消息事件顺序](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/agent/src/agent-loop.ts#L204-L219)、[context 转换时点](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/agent/src/agent-loop.ts#L344-L353)。

不要直接在 user message_end handler 里 appendEntry：该 handler 早于 user 持久化，追加 entry 会先推进 session leaf，产生“展示 entry → user”的树序。延后到 context，正常单条 prompt 可形成“user → 展示 entry → assistant”。这仍有必须补验的成本：

- 多条 queued user 同批到达时，可能形成 U1、U2、D1、D2 的顺序；分支/压缩后必须按 userEntryId 和当前有效 entries 判断，防止孤立或缺少展示。
- user 已保存、展示 entry 尚未保存之间有失败窗口；原 user 完全隐藏时要有可恢复的显示策略，避免重启后上下文存在而界面暂时不可见。
- context 重复调用时应幂等，处理取消、重试、session 切换与恢复；不能仅维护一份进程内“已经展示”集合。
- user 的宿主间隔与展示 entry 的间隔叠加，live/history 重建需 PTY 验证。
- 队列预览、撤回编辑、旧原生 XML 历史仍有路线 A 的边界；此变体没有自动解决它们。

这条变体有望同时获得普通 user 的发送语义和独立声明的自由度，但比只做 Markdown 摘要多出派生展示的一致性管理。它应进入候选集合，不能因 custom entry 本身不参与模型就排除。

## Alternative Considered: Custom Message Renderer

`input handled + sendMessage + registerMessageRenderer` 也有公开接口支持。将完整正文、用户任务与图片放入 custom 的 content，展示元数据放 details，即可分离显示与模型内容。**custom 的 session role 与模型 role 应分开讨论**：内建 `convertToLlm` 把 custom 转为 user，保留 content，不发送 details。无需为了这件事额外注册 context hook。[messages.ts](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/messages.ts#L148-L196)。

custom renderer 成功返回组件时会绕开默认 Box，能自行使用 Text/MouseRegion 等组件；宿主仍有一行 Spacer，不能声称完全控制全部外层间距。renderer 可接收共享 expanded 状态。比路线 A 有更大的视觉和详情交互自由。[CustomMessageComponent](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/components/custom-message.ts#L21-L92)。

但直接把用户输入改由 sendMessage 投递存在已确认的源码差异：

- 正在生成时可投递到 agent 的 steer/followUp，却不维护 AgentSession 的普通用户队列列表。原生待发送显示、pendingMessageCount、clearQueue 返回的可恢复文本不会自动包含这些 custom 消息。本轮源码探针实际观测到这一点。
- idle 的 triggerTurn 直接进入 _runAgentPrompt，绕过普通 prompt 的 before_agent_start、model/auth preflight 以及该轮 prompt/tool loadout 准备。不能把这条注入链路当作完全等价的用户发送链路。
- 原生 /fork 用户消息候选、会话首条提示与部分会话搜索文本只收普通 message/user。custom prompt 不自动参与同样的入口。
- 历史新表示可恢复为 custom，并由注册 renderer 显示；旧 native user skill 仍不会自动换肤。图片要显式放入 custom content，不能只交给 details。

这些是可查证的行为差异，并非已观测产品故障。为弥补它们增加控制逻辑会提高复杂度，因此本轮将它列为已审查的替代实现，不列入优先的三项路线；完整 user 加展示 entry 更值得先补验。[custom 投递](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts#L1622-L1666)、[clearQueue](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts#L1728-L1742)、[fork 候选](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts#L3457-L3472)、[会话摘要提取](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/session-manager.ts#L745-L763)。

## Input Boundary Review

默认 token 边界上的句中和后续行输入仍可直接使用 addAutocompleteProvider。紧邻汉字需要额外工作，不能通过放宽 provider 正则就完成。

原负向测试中 provider 的匹配也要求空格边界，单独看该测试无法区分是 provider 还是 Editor 阻止触发。本轮使用放宽的 provider 再测，仍不自动弹出，结合 Editor 源码确认宿主限制。

公开 `getEditorComponent()` 返回既有 factory，`setEditorComponent()` 可包装它；官方文档明确提供此组合。对当前 `CodexEditor → CustomEditor → Editor` 继承链，公开 getLines/getCursor/insertTextAtCursor/handleInput 加 SelectList 可实现紧邻汉字的候选选择。本轮验证了 `请用$ad帮我规划 → 请用$adventure帮我规划`，以及保留 slash 补全与提交 callback。[官方 factory 包装示例](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/docs/extensions.md#L2843-L2857)、[公开 Editor 方法](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/tui/src/components/editor.ts#L1104-L1137)。

用公开 handleInput 模拟 Tab 可以绕过触发边界，但单个候选会直接填入，不弹菜单；因此不是无代价的一行解法。包装 factory 还会新建 editor，不能推导出当前 cursor/undo/history 全部自动复制。安装顺序、codex-ui session_start、reload 后重新注册及其他编辑器能力都需要后续验证。[Tab 特例](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/tui/src/components/editor.ts#L2390-L2409)、[宿主安装 editor](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L2719-L2777)。

实验中的名称正则只是夹具。真实 skills 加载器有部分名称校验仅发 warning，不能把夹具字符集当成最终 skill 命名或引用语法。手写、选择、转义、取消、未知引用和多 skill 仍归 #5。

## Executed Probes and Limits

本轮新增 21 个离线断言场景，分为三组，各自全部通过。它们不是同一套 21 项端到端测试。

| Probe | Result | Actual code and substitutions |
| --- | --- | --- |
| [输入边界](../experiments/skill-editor-boundary-review.test.mjs) | 5/5 | 实际 Editor/SelectList 及相关源码；替代 TUI host。验证邻接边界、Tab 行为、公开包装和后缀/slash/callback。未安装完整插件或真实 CodexEditor factory。 |
| [渲染分派](../experiments/skill-renderer-dispatch-review.test.mjs) | 8/8 | 执行实际原生/普通 user/custom 组件、addMessageToChat、transform chain、convertToLlm；Markdown 解析、主题和 ASCII 宽度 helper 替代。 |
| [消息表示](../experiments/skill-message-representation-review.test.mjs) | 8/8 | 从锁定源码逐字提取实际 prompt/input/queue/custom 方法，以及完整 convertToLlm 和会话投影函数；runner、资源加载、鉴权、agent queue/发送接收端替代。 |

日志：[输入](skill-editor-boundary-review.log)、[渲染](skill-renderer-dispatch-review.log)、[消息表示](skill-message-representation-review.log)。

消息表示探针覆盖了普通 user 封装及图片、两种队列独立快照、raw queue 恢复、JSON 往返后的真实会话投影、分支叶子选择、compaction 保留/移除，以及 custom→user 转换和 custom 队列/钩子差异。未启动摘要模型。首次实验装载的 stripTypeScriptTypes 顶层 return 夹具错误已修正，不是产品缺陷记录。

渲染夹具在固定 80 列、ASCII、不换行条件下得到：原生 skill 加任务 7 行；声明与任务同一行的普通 user box 3 行；两段为 5 行；单行 custom 内容加宿主间隔 2 行。这些数字只说明组件结构可减少占用，**不是截图复刻或 PTY 视觉验收**。真实 Markdown、中文宽度和终端重排仍需验证。

在原仓库已有锁定依赖时，可复现：

```bash
pnpm exec node --test adventure/experiments/skill-editor-boundary-review.test.mjs
pnpm exec node adventure/experiments/skill-renderer-dispatch-review.test.mjs
pnpm exec node --test adventure/experiments/skill-message-representation-review.test.mjs
```

当前隔离环境使用 `PI_REVIEW_SOURCE_ROOT` 指向官方源码快照；输入组另用 `PI_REVIEW_TUI_SOURCE_ROOT`。脚本记录或校验所用源码身份。实验里访问私有方法是审计手段，不是候选产品依赖。

尚未完成：真实 extension 装载、真实 session/provider 循环、PTY/IME、实际 codex-ui 包装、reload、鼠标/快捷键配置、undo、队列编辑体验、完整恢复/compaction 生命周期、多插件 transform 顺序、内部 prototype。未运行真实付费模型请求；未修改产品代码。前一轮全仓 check/build/package:check 的结果与限制沿用原报告，不转述为本轮通过。

## Route Recommendation

| Option | Suitable when | Main cost |
| --- | --- | --- |
| A. 公开 input + 普通 user Markdown 摘要，优先候选 | 接受 skill 声明融入用户消息，并另外设计详情访问 | 新封装、raw queue/历史输入处理；不自动改旧原生块，原生 skill 独立交互改变。 |
| B. 公开 user 快照 + context 关联 + custom entry renderer | 希望保留普通 user 发送语义，同时拥有独立声明/详情组件 | 新增派生展示记录、分支/压缩/失败恢复和间隔管理；整条组合目前只有源码依据，需优先补验。 |
| C. 原生 skill renderer 扩展 | 必须统一新旧原生块并保留原生存储、发送与展开行为 | 正式上游接口/定制 Pi 的维护成本；内部 prototype 只保留为未验证的兼容实验，不作为已可发布方案。 |

推荐先按 A 的实际视觉效果与编辑代价做路线选择，不能提前承诺它满足尚未确定的外观。若独立展开和旧历史统一是必要条件，再转向 C；如果需要独立的新声明、但没有要求旧原生块统一改造，先补验 B 的生命周期更合理；不应直接跳到修改 Pi。暂缓展示不再列为默认候选，因为两项目标已确认一起推进。

下一次 #4 的补验应围绕所选路线的真实插件装载、队列与恢复场景，并用 PTY 展示具体效果。当前不关闭 #4，不推进实施切片，也不将任何路线移交为已确认 Spec。
