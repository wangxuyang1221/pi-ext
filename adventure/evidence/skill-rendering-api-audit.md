# Skill rendering API audit

## Decision

Pi `0.86.0` 的官方 extension API 不能替换原生 `/skill:name` 发送后的 `[skill] name (ctrl+o to expand)` 组件。`codex-ui` 若要在不改变消息角色、模型上下文、session 内容和历史恢复行为的前提下改造它，需要上游增加 skill renderer 或普通 user-message renderer 接口。

主题只能改颜色。Markdown transformer、custom message renderer 和 custom entry renderer 都不能替换这个原生组件。对 `SkillInvocationMessageComponent.prototype` 做补丁是一个依赖非公开实现的候选，维护风险高于上游正式接口；是否用于产品取决于用户能否接受锁版、启动检查和失效降级。

本结论针对 `@earendil-works/pi-coding-agent@0.86.0`。本地包版本为 `0.86.0`，官方 tag `v0.86.0` 指向 commit [`ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`](https://github.com/earendil-works/pi/commit/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc)。我比对了五个发布包 source map 的 `sourcesContent` 与该 commit 的官方源码，内容逐字节相同。

下文用 `PI_PACKAGE` 代指本地绝对路径 `/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.86.0/5813aee6dbf81477902199f3db54e13ab115c8902b3ab00a8b290b3e44dcb3c8/node_modules/@earendil-works/pi-coding-agent`。形如 `.../dist/...` 的引用均位于该目录下。

## Native message path

原生路径不是独立的 skill session entry。它是一个带特殊 XML 包装的普通 user message。

1. `AgentSession.prompt()` 先调用 extension `input` handlers，此时 extension 看到的是原始 `/skill:name ...` 文本。之后才调用 `_expandSkillCommand()`。官方文档也明确给出这个顺序。[官方源码 `agent-session.ts:1319-1336`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts#L1319-L1336)，本地生成代码见 `.../dist/core/agent-session.js:946-966`；文档见 [`extensions.md#input`](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/docs/extensions.md#input)。
2. `_expandSkillCommand()` 读取匹配 skill 的文件，去掉 frontmatter，把正文写成 `<skill name="..." location="...">...</skill>`。命令参数以两个换行追加在 XML 后面。[官方源码 `agent-session.ts:1476-1505`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts#L1476-L1505)，本地见 `.../dist/core/agent-session.js:1087-1115`。skill 命令的用户说明见 [`skills.md#skill-commands`](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/docs/skills.md#skill-commands)。
3. 展开文本进入普通 `role: "user"` 的 text content，并按普通消息持久化。[官方源码 `agent-session.ts:1386-1398`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts#L1386-L1398)，session 中 user message 的结构见 [`session-format.md#sessionmessageentry`](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/docs/session-format.md#sessionmessageentry)。因此模型收到的是完整 skill 正文和用户参数，不是只含名称的 UI 占位符。
4. TUI 遇到 user message 后先用 `parseSkillBlock()` 检测这段 XML。匹配时直接实例化 `SkillInvocationMessageComponent`，再把 XML 后的参数单独交给 `UserMessageComponent`。[官方源码 `interactive-mode.ts:3701-3731`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3701-L3731)，本地见 `.../dist/modes/interactive/interactive-mode.js:3007-3030`。
5. `SkillInvocationMessageComponent` 自己写死 collapsed 和 expanded 两种结构。collapsed 文案由 `[skill]`、skill 名称和 `app.tools.expand` 当前按键提示组成；expanded 状态显示标签、名称和完整 Markdown 正文。[官方源码 `skill-invocation-message.ts:11-64`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/components/skill-invocation-message.ts#L11-L64)，本地见 `.../dist/modes/interactive/components/skill-invocation-message.js:9-53`。
6. `app.tools.expand` 是共享展开状态，不是 skill 专属状态。Pi 的 `setToolsExpanded()` 遍历 loaded resources 和 chat 中所有带 `setExpanded()` 的组件，所以 Ctrl+O 会同时影响 skill、工具和其他 expandable 项；鼠标点击则只切换该 skill 组件。[官方源码 `interactive-mode.ts:4313-4332`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L4313-L4332) 与 [`skill-invocation-message.ts:56-61`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/components/skill-invocation-message.ts#L56-L61)。extension 可调用 `ctx.ui.setToolsExpanded()`，但只能改共享展开状态，不能改组件结构。

## Multiple skill boundary

单条原生消息只支持一个 skill invocation。

- `_expandSkillCommand()` 只在整段文本以 `/skill:` 开头时运行一次，并以第一个空格切出一个 skill 名称。空格后的全部内容都是参数，不会再次递归展开。参见 [`agent-session.ts:1481-1495`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts#L1481-L1495)。
- `parseSkillBlock()` 的正则从字符串开头锚定到结尾，返回值只有一个 `ParsedSkillBlock`。两个 XML block 不会变成两个独立折叠块。若 block 之间是两个换行，正则把首个 block 解析为 skill，把第二个完整 block 放进 `userMessage`；若只有一个换行，非贪婪 content 会回溯并吞入中间的 `</skill>\n<skill ...>`，最终仍只得到首个 skill 的一个折叠块。[官方源码 `agent-session.ts:137-150`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/agent-session.ts#L137-L150)，本地见 `.../dist/core/agent-session.js:42-57`。
- 例如 `/skill:a /skill:b` 经过原生命令展开时只会激活 `a`，`/skill:b` 成为 `a` 的用户参数。要得到两个原生 skill invocation，必须发送两条分别展开的 user message。这里没有发现一个 user message 中承载多个独立原生 skill 折叠块的接口。

我用与 `parseSkillBlock()` 相同的纯函数做了三个最小输入实验，未加载 Pi runtime：

```text
twoBlocksDoubleNewline {"name":"a","location":"/a","content":"A","userMessage":"<skill name=\"b\" location=\"/b\">\nB\n</skill>"}
twoBlocksSingleNewline {"name":"a","location":"/a","content":"A\n</skill>\n<skill name=\"b\" location=\"/b\">\nB","userMessage":undefined}
normalArgs {"name":"a","location":"/a","content":"A","userMessage":"hello"}
```

## History restore

历史恢复复用同一条渲染路径，不会重新读取 skill 文件。

Pi 启动或恢复时调用 `sessionManager.buildContextEntries()`，再通过 `renderSessionEntries()` 把保存的 message 交回 `addMessageToChat()`。[官方源码 `interactive-mode.ts:3863-3882`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3863-L3882) 与 [`interactive-mode.ts:3975-3979`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3975-L3979)。保存的 user text 已包含 skill 正文和当时的绝对 `location`，所以文件后来变化、移走或 skill 不再发现时，旧消息仍按保存内容展开。

这也带来两个边界：

- 压缩若把旧 user message 移出 `buildContextEntries()` 的可见范围，TUI 只显示压缩投影，不会凭 skill 文件重建那个旧折叠块。session 投影规则见 [`session-format.md#context-building`](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/docs/session-format.md#context-building)。
- 展开或折叠是当前 TUI 的共享内存状态，不写入 session。恢复后按当前 `toolOutputExpanded` 状态创建组件，默认是 collapsed。历史保留 skill 内容，不保留上次是否展开。

## Public API audit

| Candidate | 能否替换原生 skill 块 | 边界 |
| --- | --- | --- |
| Theme | 否，只能部分换肤 | 原生组件读取 `customMessageBg`、`customMessageLabel`、`customMessageText`、`dim` 和 Markdown palette。可以改变颜色，不能改变标签、布局、提示或交互。前三个 token 也供其他 custom messages 使用，改动不是 skill 专属。见 [`skill-invocation-message.ts:16-52`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/components/skill-invocation-message.ts#L16-L52) 与 [`themes.md#color-tokens`](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/docs/themes.md#color-tokens)。 |
| `registerMarkdownTransformer` | 否 | API 只声明 `user`、`assistant`、`assistant-thinking`。skill 分支不创建 `UserMessageComponent` 来渲染 skill 正文，而是直接创建自己的 `Markdown`；只有 XML 后的 user 参数继续经过普通 user transformer。[类型源码 `types.ts:1210-1216`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/extensions/types.ts#L1210-L1216)。 |
| `registerMessageRenderer` | 否 | renderer 的输入类型是 `CustomMessage`，查找键是 `customType`。`InteractiveMode` 只在 `role: "custom"` 分支查询它；skill 是 `role: "user"`。[类型源码 `types.ts:1222-1226`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/extensions/types.ts#L1222-L1226)，[分支源码 `interactive-mode.ts:3671-3683`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3671-L3683)。 |
| `registerEntryRenderer` | 否 | 只渲染 extension 通过 `appendEntry()` 保存的 custom entry，这类 entry 明确不进入模型上下文。它不能接管或隐藏已有 user message。强行另加 entry 只会产生重复 UI。[类型源码 `types.ts:1228-1232`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/extensions/types.ts#L1228-L1232)，文档见 [`extensions.md#piappendentrycustomtype-data`](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/docs/extensions.md#piappendentrycustomtype-data)。 |
| `input` hook 加 custom message | 否，不保持语义 | extension 可以在原生展开前拦截 `/skill:`，自己读取文件并发送 custom message，但这会把普通 user message 改成 custom role，或同时保留 user message而造成重复显示。还要复制 Pi 的读取、frontmatter、参数、错误和队列规则。这不是等价的显示替换。 |
| `message_end` 或 `context` hook | 否，不保持语义 | `message_end` 的替换必须保持原 role，仍走 user 分支；`context` 只修改发给模型的副本，不是 transcript renderer。把 XML 改成其他文本会同时改变持久化内容或模型上下文。 |
| 导入 `SkillInvocationMessageComponent` | 否 | Pi 确实从 package entry 导出这个类，但公开 API 没有 factory、registry 或 setter 能让 `InteractiveMode` 使用 extension 提供的子类。导出只允许 extension 自己创建组件，不构成内置组件替换点。 |

公开 renderer 的定义集中在 `ExtensionAPI` 的三个方法，没有 built-in user/skill renderer 注册项。[官方源码 `types.ts:1372-1383`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/extensions/types.ts#L1372-L1383)，本地声明见 `.../dist/core/extensions/types.d.ts:968-975`。`ExtensionRunner` 也只有 custom message、Markdown transformer 和 custom entry 三种查找路径。[官方源码 `runner.ts:667-688`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/core/extensions/runner.ts#L667-L688)。

## Missing upstream interface

最小且语义安全的上游改动是增加一个 skill 专属 renderer registry，例如：

```ts
pi.registerSkillRenderer((skillBlock, options, theme) => Component | undefined)
```

`options` 至少需要 `expanded` 和 `outputPad`。`InteractiveMode` 应在 `parseSkillBlock()` 成功后查询 registry，未注册或 renderer 返回 `undefined` 时回退到 `SkillInvocationMessageComponent`。返回组件还需要受 `app.tools.expand` 控制，做法可以是要求组件实现公开的 `Expandable` 接口，或把 `setExpanded` 回调和当前状态纳入 renderer context。

这个挂点位于解析之后、组件创建之前，因此不会触碰以下语义：

- session 仍保存原生 `role: "user"` 和完整展开 XML；
- 模型仍收到原生展开内容；
- 参数仍作为同一 user message 的尾部文本；
- live message 与 history restore 继续走同一 registry；
- 没有 extension 时行为完全不变。

更通用的 `registerUserMessageRenderer` 也能解决问题，但必须提供明确的 fallback 和优先级规则，并防止普通 user renderer 意外绕过 skill 解析。只给 Markdown transformer 增加 `messageType: "skill"` 仍不足以定制外框、标签、折叠提示和点击行为。

## Internal prototype patch risk

已由发布包证实的事实如下：

- `SkillInvocationMessageComponent` 从 package entry 顶层导出。本地 `PI_PACKAGE/dist/index.js:37` 和 `PI_PACKAGE/dist/index.d.ts:29` 都包含该导出。
- TypeScript 的 `private updateDisplay()` 在 `0.86.0` 产物中是普通 prototype 方法，不是 ECMAScript `#private`。本地实现见 `PI_PACKAGE/dist/modes/interactive/components/skill-invocation-message.js:9-53`。
- `InteractiveMode` 静态导入并直接实例化该类，没有 renderer factory 或替换注册点。[官方源码 `interactive-mode.ts:143`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L143) 与 [`interactive-mode.ts:3707-3715`](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L3707-L3715)。

据此，extension 可以尝试改写导出类的 `updateDisplay` prototype。下列事项是尚未用 prototype 实验验证的维护风险，不应写成已观测故障：

- patch 依赖非公开的 `expanded`、`skillBlock`、`markdownTheme` 和 `updateDisplay` 字段。上游改成 `#private`、改名、内联或重构组件后可能失效。
- prototype 改写会影响同一 class object 的全部实例。`/reload` 若重复安装 wrapper，可能叠加补丁；官方没有 patch 卸载或冲突仲裁协议。
- 当前源码和发布包表明宿主与 package entry 指向同一导出链，但未来打包方式可能产生不同模块实例，使 extension patch 不再命中宿主持有的 class object。
- 自定义实现需要保留 `invalidate()`、主题切换、MouseRegion、共享 Ctrl+O 展开协议和宽度约束。遗漏时可能在历史恢复、换主题或 resize 后出现不一致。
- 多个 extension 同时修改该 prototype 时，结果可能受加载顺序影响。

推荐优先推动上游正式 renderer 接口，因为它有明确生命周期和 fallback。若用户接受锁定 Pi `0.86.0` 及内部补丁的维护成本，可以另做隔离 prototype，验证 class identity、重复 reload、卸载恢复、主题切换、resize、历史恢复和补丁冲突。实现还应检查版本和目标方法形状，失配时恢复原生 renderer，而不是继续改写未知实现。在这些实验完成前，只能把 prototype patch 记为候选，不能宣称已经可发布。

## Verification boundary

已完成：

- 完整阅读 Pi `0.86.0` 的 `docs/extensions.md`、`docs/tui.md`、`docs/skills.md`、`docs/themes.md`、`docs/session-format.md`，以及 `message-renderer.ts`、`entry-renderer.ts` 示例。
- 检查发布包 JS、`.d.ts` 与 source maps。
- 在线核验官方 tag、commit 和锁定 commit 源码；五个关键 source map 的 `sourcesContent` 与官方源码 SHA-256 内容一致。
- Context7 已 resolve 到 `/earendil-works/pi`，但没有返回 `0.86.0` 版本化 library ID；其查询结果来自 main 文档。因此接口结论以锁定 commit 源码为准，不以 Context7 摘要为版本证据。
- 已运行 `parseSkillBlock()` 等价纯函数的最小多 block 实验；未加载 Pi runtime。

未执行：

- 未启动真实模型会话。
- 未运行交互式 TUI 或 PTY 视觉验收。
- 未编写或运行 prototype patch。
- 未验证未来 Pi 版本是否已增加 renderer API。本报告只回答 `0.86.0`。
