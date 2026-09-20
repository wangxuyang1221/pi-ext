# Multi-skill public API audit

## Verdict

**存在一条不改上游、不 monkey patch、可望在同一模型请求注入多个完整 skill 快照并复用原生 `SkillInvocationMessageComponent` 外观的纯公开 API 候选路线。** 源码支持它的生命周期推演，组件和消息层探针已经通过，但完整 input、queue、context append 和失败恢复尚未端到端证实。它不是把多份 `/skill:name` 串起来，而是组合以下公开能力：

1. `input` transform 把本次引用的全部 skill 正文、真实文件路径、相对引用目录、用户任务和图片保存在一条普通 `user` 消息中。
2. `registerMarkdownTransformer` 仅在普通 user transcript 中把自包含封装隐藏或还原为用户任务，避免界面同时显示完整正文和 skill 卡片。
3. `context` 事件在该 `user` 消息持久化后，为它追加一个不进入模型上下文的 custom entry。
4. `registerEntryRenderer` 返回一个 `Container`。容器内按引用顺序放置多个公开导出的 `SkillInvocationMessageComponent`。

`registerEntryRenderer` 的返回类型仍是单个 `Component | undefined`，不是组件数组。多个原生组件要作为 `Container` 的 children 返回。`SkillInvocationMessageComponent` 在 Pi 0.86.0 的包顶层公开导出，因此这不是深路径导入或私有类借用。

这条路线的必要代价也很具体：

- 模型看到的是插件定义的多 skill 自包含封装，不是 Pi 原生单 skill XML 的逐字复制。
- session 会多出派生 custom entry。插件必须处理幂等、恢复、分支、压缩和异常窗口。
- 多条 queued user 在一次上下文转换前一起到达时，持久化顺序可能是 `U1 → U2 → D1 → D2`，不能承诺每个展示 entry 永远紧跟其 user entry。
- 原生组件外观可以复用，但宿主插入位置和组件间距仍由 custom entry 路线决定。不能把“使用同一个 class”扩大成“整个 transcript 布局逐像素相同”。
- custom entry 不进入模型。完整快照必须留在普通 `user.content`，不能只放进 entry data。

因此，问题的答案不是“公开 API 已证明做不到”，也不能写成“整条公开 API 路线已经做得到”。准确结论是：公开 API 候选闭环已有源码依据，组件和消息层已经验证；完整 lifecycle 仍需最小实验确认。采用它还要接受显示 transformer、派生展示记录及其一致性成本。

验证边界需要拆开说。组件和消息层已经用实际安装包验证：公开 entry renderer 能组合两张原生卡，展开状态能传给两张卡，entry 不增加模型消息，JSON 快照恢复后仍可显示。完整 input → queue → context append → 失败恢复生命周期尚未验证，不能把前述结果写成端到端完成。

本轮不实施产品，不作真实模型调用。

## Confirmed user decisions

以下是本轮输入中已经确认的产品决定，不是由技术路线反推的规格：

- 本批只做 `$` 行内补全与激活，暂缓发送后美化。
- 允许 `$ad` 形式的名称过滤。
- 引用片段不能紧贴左右正文。
- 完整有效的手写、粘贴、菜单引用等价。
- 同一请求支持多个 skills。

由这些决定派生的技术约束：不能用多次 `sendUserMessage()` 冒充同一请求；实际快照必须引用真实 skill 文件，不能伪造来源路径。

这些决定推翻了“把整条输入改成一个 `/skill:name ...`”作为充分方案的前提。Pi 原生 `_expandSkillCommand()` 只识别消息开头的一次 `/skill:` 调用，没有递归或批量展开。

## Open product choices

下面仍是候选取舍，不能因为某条 API 可行就当作用户决定：

- `$` 单 skill 是否也统一走多 skill 自包含表示，还是仍转成原生 `/skill:name`。
- 多 skill 候选能否保持既定原生外观，若完整生命周期实验发现布局差异，需说明差异并由用户确认，不能据此自行删除卡片或恢复美化范围。
- 多个 skill 卡片之间是否保留原生消息级空行。
- queued user 的展示 entry 不能逐条邻接时，是否接受按批次排列。
- custom entry 缺失时，是恢复时补写、退回显示自包含 user 文本，还是只记录诊断。

已确认真正的 `/skill:name` 输入和旧原生历史保持原样，不属于待选项。

## Version and evidence boundary

- 安装包：`@earendil-works/pi-coding-agent@0.86.0`。
- 官方 tag `v0.86.0` 对应 commit [`ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`](https://github.com/earendil-works/pi/commit/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc)。
- 本轮完整读取安装包的 `docs/extensions.md`、`docs/tui.md`、`docs/session-format.md`、`docs/skills.md`，以及 input transform、streaming input、entry renderer、message renderer、send user message 示例。
- 本轮复用了 [Skill feasibility second review](skill-feasibility-second-review.md) 和 [Skill input API audit](skill-input-api-audit.md) 已核验的源码映射，不再广泛搜索。
- 本轮直接核对安装包 JS、类型声明与 source map 中的锁定源码。未运行真实 provider 或付费模型。
- 主代理新增的 [multi-skill native components probe](../experiments/multi-skill-native-components.test.ts) 使用实际安装包的 `SessionManager.inMemory`、`CustomEntryComponent` 宿主和公开 `SkillInvocationMessageComponent`。5 项全部通过。`CustomEntryComponent` 的深路径导入只用于审计宿主，不是候选产品依赖。
- 该 5 项与既有 input feasibility 11 项合计 16 项通过。它们是两组边界探针，不是 16 项端到端 lifecycle 测试。
- 主代理还在本机 Node 22 重跑 [skill message representation probe](../experiments/skill-message-representation-review.test.mjs)，8/8 通过。该次重跑没有写入新日志；现有 `skill-message-representation-review.log` 来自先前独立复核环境，不能当作本机重跑日志。重跑结果继续支持 idle、steer、followUp 的自包含 user 快照和 session 投影判断。

主要原始证据：

- [AgentSession input、prompt、skill 展开与 queue 源码](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts)
- [Agent loop 的 user 事件与 context transform 顺序](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/agent/src/agent-loop.ts)
- [SessionManager entry 投影](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/session-manager.ts)
- [Skill loader 的 filePath 与 baseDir](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/skills.ts)
- [Resource loader 重新标注 sourceInfo](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/resource-loader.ts)
- [Custom 与普通消息的模型转换](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/messages.ts)
- [Interactive transcript 分派](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts)
- [原生 skill 组件](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/components/skill-invocation-message.ts)
- [包顶层公开导出](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/index.ts)
- [扩展类型](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/extensions/types.ts)
- [Extension 文档](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/docs/extensions.md)
- [Session format 文档](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/docs/session-format.md)

## Relevant public contracts

### Input transform

`input` 在 extension command 检查之后、skill/template 展开之前运行。它收到 `text`、`images`、`source`，以及 busy 状态下的 `streamingBehavior`。transform 只返回 text 时，AgentSession 保留原 images。

Pi 的 idle `prompt()` 和 busy `_queueUserInput()` 都先调用同一个 `_runInputHandlers()`。因此，若完整多 skill 快照直接写进 transform 后的普通 user 文本，这个表示覆盖：

- idle prompt
- `steer`
- `followUp`
- 交互输入、RPC 输入，以及扩展再次调用 `sendUserMessage` 时的 `source: "extension"`，前提是插件明确决定是否处理该 source

这条覆盖不依赖 `before_agent_start`。

结论：**可行。** 多 skill 激活的可靠基础应是自包含 input transform，而不是旁路状态表。

### Before-agent-start messages

`before_agent_start` 可以返回持久化 custom message。AgentSession 会把 custom message 放进本轮消息数组，session role 是 `custom`。Pi 的 `convertToLlm()` 再把它转换成模型可接收的 `user` message，保留 content，不发送 details。

普通/session role 与模型 role 必须分开：

| Stage | Role and behavior |
| --- | --- |
| Session/runtime | `role: "custom"`，有 `customType`、`display`、`details` |
| `convertToLlm()` 后 | `role: "user"`，只保留模型内容与 timestamp |
| Plain custom entry | 没有消息 role，不进入模型上下文 |

但 `before_agent_start` 只出现在 idle `prompt()` 的 preflight 路径。AgentSession 在 `isStreaming` 时会在展开后直接 `_queueSteer()` 或 `_queueFollowUp()` 并 return；`_queueUserInput()` 也只做 input、展开和入队。两条 busy 路径都不触发 `before_agent_start`。

因此：

- idle：**可行**，可注入一个包含全部 skill 快照的 custom message。
- steer：**不覆盖**。
- followUp：**不覆盖**。

一个 extension handler 的结果字段是单个 `message`，不是 message 数组。ExtensionRunner 可以汇总多个 handler 的结果，但动态注册多个 handler 来模拟一个批量 API没有必要，也不能修复 busy 路径缺失。

结论：**不适合作为统一的多 skill 注入主路线。** 它可做 idle-only 方案或附加上下文，但不能独立满足本轮的 idle/steer/followUp 等价要求。

### Display transformation and session entry rendering

自包含 user content 若不做显示转换，会先作为普通 user 消息显示完整 envelope，随后再显示 derived skill 卡片。这会重复展示正文。候选路线必须注册 `registerMarkdownTransformer`，只在 `messageType === "user"` 且识别出本插件自包含格式时，将 Markdown 转成用户任务或约定的简短显示文本。

该 transformer 只影响 Markdown 显示，不改 session 与模型内容。它覆盖新 user 消息、恢复消息和终端宽度变化，但不覆盖所有 raw text 消费者。queue preview、clearQueue 恢复到 editor、历史编辑等路径仍可能看到完整 envelope；多个 extension transformer 还会按加载顺序串联。插件未加载或 transformer 解析失败时，也会显示原始封装。因此，即便 skill 卡本身使用原生组件，也不能声称整条消息的原生显示完全不变。

`pi.appendEntry(customType, data)` 调用 `SessionManager.appendCustomEntry()`。custom entry：

- 持久化并推进 session leaf。
- 不参与 `buildSessionContext()` 的模型消息投影。
- 在 interactive mode 中通过 `registerEntryRenderer()` 渲染。
- 恢复 session 时仍按当前 active branch 和 compaction 结果渲染。

`EntryRenderer` 的公开签名是：

```ts
type EntryRenderer<T = unknown> = (
  entry: CustomEntry<T>,
  options: EntryRenderOptions,
  theme: Theme,
) => Component | undefined;
```

`SkillInvocationMessageComponent` 和 `ParsedSkillBlock` 相关类型由 `@earendil-works/pi-coding-agent` 顶层导出。`Container`、`Spacer` 等布局组件由 `@earendil-works/pi-tui` 公开导出。于是 renderer 可以合法构造：

```ts
const container = new Container();
for (const snapshot of entry.data.skills) {
  container.addChild(new SkillInvocationMessageComponent({
    name: snapshot.name,
    location: snapshot.location,
    content: snapshot.content,
  }));
}
return container;
```

这段只是 API 形状推演，不是产品代码。`location` 必须来自已发现 command 的真实 `sourceInfo.path`。相对引用目录必须使用 `dirname(sourceInfo.path)`，它对应 skill loader 的 `skill.baseDir = dirname(filePath)`。不能把 `sourceInfo.baseDir` 当作 skill 相对引用目录：resource loader 在为资源重新标注 provenance 时可能替换整个 `sourceInfo`，该字段可能是资源或 package 基目录。不能为了匹配组件输入而填写不存在的路径。

实际安装包探针进一步确认：

- 一个 renderer 返回的 `Container` 可同时显示 `research` 与 `adventure` 两张未修改的原生 skill 卡。
- `CustomEntryComponent.setExpanded(true)` 通过 renderer options 重建组件，两张卡都显示正文；收起后正文都隐藏。
- 同一 session 的模型投影仍只有一条普通 user message，derived entry 没有复制 skill 正文。
- session entries 做 JSON 往返并恢复后，仍只有一份 user payload，同时测试 renderer 可重建两张卡。当前 renderer 从固定夹具闭包取 snapshots，尚未证明产品从恢复后的 user/entry data 解析快照的过程。
- branch 回到 user entry 时，位于其后的 derived entry 会从 active branch 消失。模型内容仍在，但展示 entry 必须按当前分支重建。

结论：**组件和消息层已验证可行。** 这是本轮找到的“同请求多 skill + 原生组件外观”的公开渲染入口。完整 context 追加时机、排队和失败恢复仍未验证。

## Route comparison

### Route 1: input transform plus before-agent-start custom messages

候选做法是把用户任务留在普通 user 消息，并在 `before_agent_start` 注入包含多个 skill 快照的 custom message。custom renderer 也可以返回一个含多个原生 skill 组件的 `Container`。

| Concern | Finding |
| --- | --- |
| Same model request | idle 时可行，user 与 custom 都进入同一次 agent prompt。 |
| Multiple full snapshots | 可放进一个 custom message content。 |
| Native appearance | custom renderer 可组合公开的原生 skill 组件。 |
| Idle | 覆盖。 |
| Steer | `before_agent_start` 不运行，不覆盖。 |
| FollowUp | `before_agent_start` 不运行，不覆盖。 |
| Session role | skill snapshot message 是 `custom`。 |
| Model role | `convertToLlm()` 后是 `user`。 |
| Queue UI and clearQueue | custom message 不等同于 AgentSession 的普通 user queue 文本。 |

也可以在 input handler 中针对 busy 状态额外调用 `pi.sendMessage(..., { deliverAs })` 来补洞，但这会把一条逻辑输入拆成独立 queued custom 与 user messages，引入顺序、失败和撤回语义。它不再是简单的“input + before”路线，也没有比自包含 user 更小。

判定：**不适用，作为统一主路线。** 原因不是模型不能接收多个 skill，而是生命周期只覆盖 idle。

### Route 2: self-contained user plus context-linked custom entry

候选流程：

1. input transform 解析一条输入中的全部有效 `$name` 引用。
2. 从 `pi.getCommands()` 过滤 `source === "skill"`，以 `sourceInfo.path` 为真实文件读取正文并去掉 frontmatter，以 `dirname(sourceInfo.path)` 作为相对引用目录。
3. 生成一条普通 user 自包含内容。每个快照至少保存 name、真实 location、真实 reference base、正文和引用顺序。用户任务和 images 保持在同一 user message。
4. user Markdown transformer 在 transcript 中把该 envelope 显示为用户任务，不改变持久化内容和模型内容。
5. user 消息的 `message_end` 完成后，AgentSession 先等待 extension/listener，再持久化该 user entry。
6. agent loop 随后调用 context transform。context handler 此时通过只读 `ctx.sessionManager` 可以看到真实 user entry id。
7. 对尚无展示 entry 的目标 user，调用 `pi.appendEntry()`。entry data 记录 `userEntryId` 和该 user 消息内的 snapshots。
8. entry renderer 返回一个含多个 `SkillInvocationMessageComponent` 的 `Container`。
9. context handler 不改 `event.messages`。模型仍收到普通 user 自包含内容，custom entry 不进入模型。

关键顺序有源码支持：agent loop 对初始或 queued messages 逐个 await `message_start` 和 `message_end`，之后才进入 `streamAssistantResponse()`；`transformContext` 位于 provider 转换之前。AgentSession 在自己的 awaited listener 中完成 user 持久化。因而 context 阶段能看到刚才持久化的 user entry。

| Concern | Finding |
| --- | --- |
| Same model request | 可行。所有 skill 快照在同一 user content 中。 |
| Multiple full snapshots | 可行。数量由插件表示决定，不受原生单 block parser 限制。 |
| Native appearance | 可行。renderer 的 Container 内复用公开原生组件。 |
| Idle | 自包含 user 消息层已覆盖；context append lifecycle 待验证。 |
| Steer | 自包含 queued user 已覆盖；消费后的 context append lifecycle 待验证。 |
| FollowUp | 自包含 queued user 已覆盖；消费后的 context append lifecycle 待验证。 |
| Session role | 模型内容仍是普通 `user`；展示是无 role 的 custom entry。 |
| Model conversion | 普通 user 直接保留为 user；custom entry 被 session 投影排除。 |
| Images | input transform 不提供替代 images 时保留原图片。 |
| User transcript | Markdown transformer 可隐藏 envelope，但这是插件显示转换，不是原生 user 表示。 |
| Queue UI | pending 阶段显示 raw 自包含文本，entry 尚不存在；Markdown transformer 不覆盖该路径。 |
| Recovery | custom entry 可恢复渲染，但需要按 `userEntryId` 做持久化幂等；插件缺失时显示 raw envelope。 |
| Compaction | 被 compaction 移出 active entries 的 user 与 entry 都不应继续显示；边界需实测。 |

判定：**这是目前唯一有源码依据、同时指向“同一请求、多 skill、普通 user 语义、原生 skill 组件外观”的纯公开 API 候选。** 其中，组件组合、expanded 转发、模型内容不重复、JSON 恢复已经通过实际安装包探针；Markdown 显示转换有公开 API 依据；完整输入排队和 context lifecycle 仍未验证，不能断言整体路线已经做得到。

它仍有待验证项：

- idle、steer、followUp 的真实 extension 装载是否都在正确 context 时点 append 一次展示 entry。
- 两条或更多 queued user 在一次 context 前到达时，展示 entry 的顺序和可接受布局。
- user 已持久化但 context handler 尚未 append 的崩溃窗口。
- session_start 补写缺失 entry 时的 leaf 与当前 branch 行为。
- branch 回到 user 时，探针已确认 derived entry 会消失；何时、以何种 parent 重建仍待验证。
- fork、tree navigation 和 compaction 后，按 `userEntryId` 去重时是否会产生孤立 entry。
- Markdown transformer 与其他 extension 的顺序，以及 queue preview、撤回和 editor history 中 raw envelope 的体验。
- interactive live 添加和 session restore 的 Spacer 差异。

### Route 3: simpler batch user delivery API

Pi 0.86.0 没有公开的“提交一组 user messages，但只触发一次模型请求”扩展 API。

`pi.sendUserMessage()` 接受：

- 一个 string，或
- 一个 `(TextContent | ImageContent)[]`

这里的数组是同一 user message 的 content blocks，不是多条 user messages。AgentSession 会把所有 text blocks 用换行连接，再走一次 `prompt()`。这可以承载一个自包含多 skill envelope，但它没有原生多 skill 语义，也不会自动生成多张原生 skill 卡片。

多次调用 `sendUserMessage()` 会触发多次发送或多个 queued user。按本轮约束，它不能称为“同一请求”。

`before_agent_start` 的 custom message 也不是 batch user API。它创建 session custom role，之后才由 `convertToLlm()` 映射为模型 user role。

判定：**不存在更简单的公开批量 user 投递 API。** 最简单的同请求模型表示仍是一条普通 user message 内保存多个快照。

## Native parser boundary

Pi 的 `parseSkillBlock()` 使用锚定正则，只接受整条文本是一个：

```text
<skill name="..." location="...">
...
</skill>

optional user task
```

它返回单个 `ParsedSkillBlock`。两个连续 `<skill>` block 会被第一个 block 的非贪婪内容与末尾 user text 规则误归类或整体不匹配，不能作为受支持的多 skill 协议。原生 `_expandSkillCommand()` 也只处理消息开头的一个 `/skill:name`。

因此不能通过以下方式声称获得可靠多 skill：

- 串联多个 `/skill:name`。
- 拼接多个原生 `<skill>` block 并期待 TUI 自动生成多个组件。
- 为多个 snapshot 合成一个不存在的 location。

Route 2 绕过的是原生文本 parser 的单 block 限制，不是绕过组件本身。每个真实 snapshot 各构造一个 `ParsedSkillBlock`，再交给同一个公开原生组件。

## Existing single-skill native slash behavior

**已确认保持不变。** 插件让真正以 `/skill:name` 开头的输入继续走 Pi 原生展开与原生 user 分派，不对它做 transform。这样：

- 已有单 skill slash 命令继续保存为普通 user message。
- TUI 继续由 `parseSkillBlock()` 直接创建原生 `SkillInvocationMessageComponent`。
- 旧历史也保持原生外观。

对于 `$skill` 单引用有两个技术候选，尚未由用户选择：

1. 单 `$skill` 转成 `/skill:name task`，多 `$skill` 走 Route 2。优点是单引用完全沿用原生 session 表示；缺点是 `$` 的单、多引用产生两套存储与恢复语义。
2. 所有 `$skill` 都走 Route 2。优点是手写、粘贴、菜单以及单、多引用使用同一表示；缺点是即使只有一个 `$skill`，它也是普通 user envelope 加派生 entry，不是原生 slash session 表示。

两者都能显示同一个公开原生组件。是否统一行为是产品取舍，不是 API 限制。

## Source and path integrity

skill 清单应来自 `pi.getCommands()`，并过滤 `source === "skill"`。每项有 canonical `sourceInfo`：

```ts
{
  path: string;
  source: string;
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
  baseDir?: string;
}
```

路径规则：

- `location` 使用该已发现 skill 的真实 `sourceInfo.path`。
- 正文从该真实文件读取并用公开 `stripFrontmatter()` 去除 frontmatter。
- 相对引用目录使用 `dirname(sourceInfo.path)`。skill loader 本身以 `dirname(filePath)` 设置 `skill.baseDir`；`sourceInfo.baseDir` 可能在 resource loader 标注 provenance 时被替换为资源或 package 基目录，不可作为该值的依据。
- 未知 `$name` 不得生成快照或伪造路径。它应按后续输入规则处理。
- snapshot 保存在当次 user content 中，避免 skill 文件之后改变导致历史请求含义漂移。

## Executed probes

| Probe | Result | Proven boundary |
| --- | --- | --- |
| [multi-skill native components](../experiments/multi-skill-native-components.test.ts) | 5/5 | 两张公开原生卡的 Container 组合、expanded 转发、entry 不进入模型、JSON 恢复、branch 到 user 后 derived entry 消失。 |
| [skill input feasibility](../experiments/skill-input-feasibility.test.ts) | 11/11 | input transform、单 skill 原生展开、steer/followUp queue 与图片保留等既有边界。 |
| [skill message representation review](../experiments/skill-message-representation-review.test.mjs) | Node 22 上 8/8 | 自包含 user 在 idle、steer、followUp、session 投影、compaction 中的消息表示，以及 custom/user queue 差异。 |

前两组合计 16 项通过。三组探针使用受控 host 或替代边界，不能相加后称为完整 extension lifecycle 已通过。特别是 multi-skill 组件探针直接使用了私有 `CustomEntryComponent` 来模拟真实宿主，这证明公开 renderer 返回值与真实宿主兼容，但产品实现不应导入该私有组件。

## Minimum next verification

不需要真实模型。组件和消息层不必重测。下一步只补一个真实 extension lifecycle 探针：

1. 建两个临时测试 skills，每个文件有不同正文和可核对的真实路径。
2. 安装测试 extension，输入一条包含两个 `$skill` 的消息。
3. 用替代 provider 或截获 `before_provider_request`，断言只有一次请求，且同一 user 请求包含两份完整快照与用户任务。
4. 分别走 idle、steer、followUp，断言三条路径都经过 input transform；断言 `before_agent_start` 只在 idle 运行。
5. 注册 user Markdown transformer，断言 live 与恢复 transcript 隐藏 envelope，同时记录 queue preview 和恢复到 editor 仍是 raw text 的边界。
6. 在 context handler 追加一个关联 entry，断言只追加一次，parent 链在目标 user 之后，且模型上下文不包含该 entry。
7. 补两条 queued user 同批到达，记录实际 `U/D` 顺序。
8. 模拟 append 前失败、恢复和 branch 回到 user，验证缺失 entry 的幂等重建。

通过这组验证后，才适合把 Route 2 拆成产品实现切片。当前不需要重做两卡渲染、expanded 或 JSON 快照实验，也不需要验证发送后美化或修改 Pi。

## Decision prompt enabled by this audit

报告可以据此向用户只问一个取舍问题：

> `$` 引用是否要统一采用“普通 user 完整快照 + 持久化展示 entry”，以换取单、多 skill 一致且能复用原生卡片；还是单 `$skill` 继续转原生 `/skill:name`，接受单、多引用使用两套 session 表示？

这个问题决定存储与恢复语义，不替用户决定卡片间距、文案或发送后美化。
