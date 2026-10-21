# Hidden declarations API research

## Conclusion

第一项 cross-model thinking 修复不需要改 Pi 上游。provider/API/model 身份和 thinking block 已在消息中，插件只需对齐 Pi 1.3.0 的转换规则，并验证可见文本的 item ID。保留同模型 signed/encrypted reasoning，不再把跨模型 thinking 转成普通文本。[S10]

第二项 hidden declarations，在标准 Pi 1.3.0 中直接加载 `codex-compact`，若要求同时支持任意 `prepareLoadout`、轮内变化、恢复后首次请求前手动 `/compact` 和已有 V2 checkpoint，现有扩展接口不足。需要宿主提供有效声明快照及请求所用快照的关联。不能只把 command context 的 getter 搬到普通 context，也不需要修改压缩协议、放宽前缀校验或重写工具执行机制。

这里的“需要上游”有范围。受控配置下的插件可以自己计算声明策略；自有 SDK 宿主也可以向插件注入状态。这些都不等于一个独立扩展能完整支持标准 Pi 1.3.0。宿主能力也可以通过扩充现有 context/event 提供，不一定要建立一套新的事件系统。本次没有修改宿主或提出 PR。

最强证据是恢复后立即压缩的反例。两个真实 SDK session 使用相同合成历史，普通扩展在 `session_before_compact` 读取的工具列表、active names、system prompt、session projection 和 preparation messages 完全相同。它们还没有触发 `before_agent_start` 或 provider request，但一个 loadout 隐藏 `victim`，另一个不隐藏。后续真实 provider converter 分别生成不同声明集合；隐藏的会话经过现有 coordinator 时在 index 1 抛出 `HistoryPrefixMismatchError`。[E1]

## Scope and evidence

实际版本是 Node.js `v22.22.2`、pnpm `11.9.0`。已安装 `pi-coding-agent`、`pi-ai`、`pi-agent-core`、`pi-tui` 均为 `1.3.0`，全量检查也打印了这四个版本。

本次没有 Context7 工具。接口依据是已安装 1.3.0 官方文档、发布源码和声明文件；文末给出固定 `v1.3.0` 官方源码链接。链接用于标明版本和源码归属，没有把 `main` 上的行为当作 1.3.0。源码行号指本地发布文件，不是 GitHub TypeScript 文件的行号。

已完整阅读相关 skills、仓库语言政策，以及 Pi 的 extensions、SDK、codemode、compaction、message types、session format、MCP、virtual models、TUI、sessions、settings、configuration、CLI integration、custom providers 文档。另读了官方 dynamic-tools 和 SDK codemode/MCP 示例，并核对本仓库 F1/F2 审查、todo 和指定插件调用链。

下文区分三种证据。

- 已证实：真实 SDK session、resource loader、内置 codemode、官方 Codex converter 和现有 coordinator 的离线实验，或已安装的接口声明。
- 源码推断：执行顺序、真实 MCP 后台连接、尚未实现的接口设计。
- 未验证：真实服务、远程 V2 压缩质量及未执行的组合测试。

## Public API audit

| API or observation | What it provides | Why it is insufficient |
| --- | --- | --- |
| `pi.getActiveTools()` | 当前 active names | hidden declaration 工具仍 active。它不是最终发送集合。[S1] |
| `pi.getAllTools()` | 原始描述、schema、exposure、namespace、annotations、reachesTools 等 | 不返回 `prepareLoadout` 的结果，也不返回 hook 改写后的描述。`exposure: "hidden"` 是不可达工具，和 active-but-hidden-declaration 不同。[S1][S2] |
| `ctx.tools` | tool execute context 中的 callable tools | 普通事件没有它；callable 不等于向模型声明。[S2] |
| 自己注册观察用 `prepareLoadout` hook | declared/callable/registered 和 exposure 等输入 | 各 hook 看到相同原始 loadout，不看到之前 hook 的返回值。宿主在循环外聚合描述和隐藏集合，增加一个排最后的观察工具也读不到聚合结果。[S1] |
| `before_agent_start.systemPromptOptions.hiddenTools` | 本次启动的可变 options | handler 执行后还会计算 loadout；后续 handler、异步注册和轮内工具执行都能使读取值过期。[S3][S4] |
| `ExtensionCommandContext.getSystemPromptOptions()` | 当前 base options | 普通 `ExtensionContext` 没有该方法。即便保存 command context，getter 也读 `_baseSystemPromptOptions`，不是当前 run options 或已生成请求的快照。[S2][S3] |
| `ctx.getSystemPrompt()` | 当前有效 prompt 文本 | 文本不是声明清单。自定义 prompt 可以让两个不同 hidden 集合得到相同文本，实验已证实。[E1] |
| `ctx.sessionManager.getBranch()` / `buildSessionProjection()` | 持久历史及 context-edit/compaction 投影 | transcript 故意保留隐藏声明，用于恢复 active tools；这不是请求时 hidden projection。[S1][S6] |
| `context` | 不含 system messages 的对话 | 没有声明；宿主还会恢复 system 状态。[S3] |
| `context_with_system` | 含 system messages 的请求中间态 | 后面仍有其他 handler、宿主 hidden projection、forced prompt projection 和 provider 转换。[S3][S4] |
| `before_provider_request.payload` | provider 生成、之前 handler 已修改的 payload | 对本次请求有价值，但不是所有 handler 之后的最终 payload；未请求过的恢复会话没有这份数据，历史压缩和模型切换也不能复用无版本缓存。[S3][S4] |
| headers、response、stream events | headers、状态、provider stream 数据 | 不携带请求投影的隐藏状态。stream event 虽有实际模型身份，但已经晚于请求准备和手动压缩。[S2] |
| `pi.events` | 扩展间消息总线 | 只有声明策略的所有者主动发布可靠状态才有用，不会自动提供内置宿主状态。 |
| `session_start`、`model_select`、`turn_start`、`turn_end`、`agent_settled` | 生命周期通知及各自数据 | 可以清理缓存，不能读取隐藏集合，也不能保证后面没有新的注册或 loadout 计算。[S4][S5] |

`ToolInfo` 的元数据不是 `ToolDefinition`。SDK 的 `AgentSession.getToolDefinition()`、`session.agent` 或 `ExtensionRunner` 对象不在普通 `ExtensionContext`/`ExtensionAPI` 中，不能把 SDK 宿主能访问它们当作插件已经具备该能力。[S1][S2]

官方部分注释把 active 集合简称为 declared 集合；同一版本的 `ToolLoadoutChanges.hiddenDeclarations` 文档明确规定例外。实际源码保留 active tools，再在请求时过滤声明，不能按前一句注释推翻后一条契约。[S1][S2]

## Execution order

### Request path

1. 创建 session 时先建立 registry/loadout，再按 transcript 恢复 active names。恢复不是恢复一份持久化 hidden 集合；当前 hook 会重新决定隐藏策略。[S4]
2. 启动 run 时，宿主可能先检查自动压缩，再执行 `before_agent_start`。runner 将 base options 规范化为本次可变 options，按扩展加载和 handler 注册顺序依次 `await`。[S3][S4]
3. 全部启动 handler 返回后，宿主解析 selected tools，调用 `_preparePromptAndToolLoadout()`，运行 active tools 的 `prepareLoadout`，覆盖 options 的 `hiddenTools`。直接修改事件的 `hiddenTools` 不是权威隐藏控制方式。[S1][S4]
4. agent loop 记录工具差异。执行 `context`、再执行所有 `context_with_system` handler。[S3][S7]
5. 宿主在这些异步变换完成后读取当前 hidden 集合，过滤每条 system message 的 `toolsAdded` 和 `toolsRemoved`。它不删除消息、不删除 sections/content，也不删除 tool calls/results。[S1]
6. forced prompt projection 随后执行。若设置了 `forceSystemPrompt`，它会把 system messages 折叠为一个 head，带上当时的 current tools。[S1][S4]
7. `convertToLlm`、`normalizeContext` 和 provider transcript 转换生成 wire payload。Codex 调用 `onPayload`，SDK 在其中派发 `before_provider_request`，再序列化 body 和发送。[S4][S7][S8]

`prepareLoadout` 本身是同步 hook，不应返回 Promise。但它的输入会因异步注册而改变。`registerTool()` 在绑定后同步调用 registry refresh，随后重新计算 loadout。MCP 在 `session_start` 后后台连接，逐个注册工具；首次 prompt 只有限等待 direct servers，其余可能在工具调用前或更晚注册。只监听 `mcp_servers_change` 也不够，它不是每次 tool-list/loadout 变化通知。[S1][S5]

### Snapshot caveats

“`before_agent_start` 只是启动时快照”需要说得更准确。复制 `hiddenTools` 得到的是过早的快照；保存整个 options 对象的引用，在当前实现中会看到首次 `_preparePromptAndToolLoadout()` 对它的更新。但轮间 `_installAgentNextTurnRefresh()` 会新建 options，对旧引用的持续读取不再可靠。[S3][S4]

实验中，后加载的启动 handler 加入 hider，早期复制值仍为 `[]`，保留的 options 引用后来变为 `['victim', 'late']`。保存的 command getter 仍返回 `[]`，而实际请求已经隐藏 `victim`。另一个三请求 run 中，保留的启动引用一直是 `[]`，实际声明却依次显示、隐藏、重新显示 `victim`。[E3][E4]

实时 getter 也不等于本次请求快照。实验让较晚的 `before_provider_request` handler 在 `await` 后注册工具并启用隐藏。已生成的 payload 仍带 `victim`，command getter 已变成隐藏 `victim`。即使新增普通 context getter，如果只在 provider handler 内读取“此刻最新值”，也会把新 loadout 错套到旧 payload。[E5]

### Compaction path

手动 `AgentSession.compact()` 先 abort，再从 raw branch 调用 `prepareCompaction()`，随后派发 `session_before_compact`。这条路径没有先执行 `before_agent_start`、context 变换或 provider request。preparation 不是 hidden-projected transcript。[S4][S6]

轮间自动压缩也可能先于下一次 prompt/loadout refresh。不能假定每次 `session_before_compact` 前一定刚收到一份当前声明的请求快照。[S4]

## Offline experiments

探针是 `.tmp/hidden-declarations-api-research/probe.mjs`。最终证据是同目录 `probe-final.jsonl` 和空的 `probe-final.stderr`；早期日志仅用于开发，不作为最终结论依据。

实验使用 `SessionManager.inMemory()` 的合成分支、内存 credential/model stores、伪 JWT、隔离的 agent directory 和 `DefaultResourceLoader`。关闭资源自动发现、模型联网、retry、cache warming；固定 SSE，替换 fetch 为本地合成 response，另将全局 fetch 设为抛错。没有访问真实凭据、真实会话或模型服务。

与旧探针不同，这次没有调用宿主私有投影函数。隐藏状态由真实 `prepareLoadout`、真实内置 codemode 和真实 registry refresh 产生。provider 转换、事件链及 coordinator 都是已安装或本仓库编译后的代码。原插件整套 UI/远程压缩 adapter 没有加载；探针在 SDK payload hook 调用现有 coordinator，检查它是否接受请求。

| Evidence | Experiment | Result |
| --- | --- | --- |
| E1，日志 1-3 行 | 相同恢复分支，hider 的闭包分别返回空集合或隐藏 `victim`；首次 prompt 前调用真实 `session.compact()`，在 hook 取消 | 普通扩展的上述观察值 `deepEqual`；两者都没有启动事件或 payload。后续请求只有隐藏分支在 prefix index 1 被拒绝。原 fallback tools 在两者中都含 `victim` |
| E2，日志 4-5 行 | 注册官方 `createCodemodeExtension()`，分别选择 `on` 和 `only` | `on` 保留 victim，coordinator 接受；`only` 不发送 victim，active/exposure 仍相同，coordinator 在 index 1 拒绝 |
| E3，日志 6 行 | 一个 run 中真实执行两次合成工具；经 `await` 注册 late tool，隐藏 victim，再将 late 改为 hidden exposure 并重新显示 victim | 三次请求中 victim 可见性为 `true/false/true`；coordinator 为接受/拒绝/接受；启动快照和保存的启动引用都没有跟进 |
| E4，日志 8 行 | 较晚启动 handler 修改 selected tools，启用 hider | command base getter 和早期复制值为 `[]`，实际请求已隐藏 victim；保存事件对象只偶然覆盖首个请求 |
| E5，日志 9 行 | 较晚 provider handler 在异步点后注册新工具，改变隐藏集合 | 当前 loadout 已改变，刚生成的请求仍含 victim。证明 live getter 需要与 request-bound snapshot 区分 |
| E6，日志 10 行 | 不隐藏任何声明，只把 victim 从 active tools 中移除 | payload 不含 victim，但 hidden 集合为空；历史有 removal，provider 改用 current tool list；coordinator 正常接受 |
| E7，日志 7 行 | 真实 `session.reload()` 后，不再发 prompt，直接 compact | 没有新增 provider 请求或启动事件，compact hook 仍没有声明 getter。此次 reload 保留相同策略，没有模拟外部配置文件变化 |
| E8，日志 11 行 | 已有 V2 checkpoint 的分支从 `gpt-5.5` 切换到 `gpt-5.6-sol`，先 compact 再请求 | 实际请求继续隐藏 victim，插件 raw 重建仍含 victim，coordinator 在 index 1 拒绝。历史不含 thinking，因此不是 F1 干扰 |

所有上述分支都携带格式有效的合成 V2 checkpoint。encrypted content 是不透明测试字符串，探针没有让服务器验证它，也没有执行真正的模型转换压缩。

E6 还解释了为什么不能根据“请求缺声明”推断 hidden。`resolveTranscriptTools()` 在纯增量路径中把初始工具放在顶层，把后续工具放入 `additional_tools` 或 tool-search items；遇到 removal/redeclaration 则发送 current tool list。只看 `payload.tools` 会漏掉正常增量工具；连同整个 input 看，已移除的历史工具仍可能正常消失。[S8]

## Coverage by scenario

| Scenario | Status | Remaining boundary |
| --- | --- | --- |
| 普通请求，无隐藏声明 | E1 visible、E2 on、E6 已通过现有 coordinator | 不是全部 provider compat 组合 |
| 自定义 `prepareLoadout` | E1/E4 已证实隐藏差异 | 多 hook union 和描述 last-wins 来自源码，未穷举组合 |
| 轮内新增、隐藏、重新显示、移除 | E3 已执行 | 不等于真实 MCP 连接实测 |
| codemode `on/only` | E2 使用官方内置扩展 | 未执行 QuickJS 脚本或嵌套 MCP 调用 |
| resume，首次请求前手动 compact | E1 使用已有合成 entries 创建 SDK session | 未打开真实 session 文件或操作 TUI `/resume`；手动 compact 的底层路径相同 |
| reload，首次新请求前 compact | E7 已执行 | 未测试每种设置文件改动、工具迟到顺序 |
| 模型切换，已有 V2 checkpoint | E8 已执行 | 未完成服务端 model-transition compaction |
| 异步注册跨过 provider handler 的 await | E5 已执行 | 不支持把 live state 当作原请求快照 |
| 远程压缩进行中注册工具、切换 session/model | 生命周期风险有源码依据 | 没有远程压缩，因此迟到响应拒绝/重试仍需实现后的专项测试 |
| 下游 context/payload 扩展继续改写 | 顺序已由源码确认 | 未穷举第三方扩展；新增声明接口也不能自动证明任意改写安全 |

## Plugin-only alternatives

### Derive from public metadata

只在策略完全由插件控制时成立。例如明确限定官方 codemode 版本、固定 `only` 模式、没有其他 loadout hook，并在每次注册和 active 变化时同步计算同一规则。它不是一般解法。任意 hook 可从闭包决定隐藏，`getAllTools()` 不暴露 hook；宿主也不把已聚合隐藏集合交给其他 hook。[S1][S2]

即便限定 codemode，不能简单删除全部 direct 工具。官方 `only` 只隐藏 callable、direct、且 active 的交集；model-only 工具仍声明，codemode/deferred 有另外的可达性规则。[S9]

### Cache events or a command context

启动快照能用于固定 loadout 的普通请求。保存事件引用最多利用了当前首请求实现细节；E3 已否定轮内可靠性。存储更多生命周期事件不增加缺失的信息。

自定义 `/compact` 命令可以拿到 command context，并在限定 idle/base-only 条件下读取 base hiddenTools。它仍不能替代原生手动、自动、启动前压缩及 model-transition 全部入口；该 getter 也不给 hook 改写后的完整声明。偷偷触发一个命令来捕获 context，不会改变 base/run 不一致的问题。reload 后旧 context 会被明确作废。[S3][S4]

### Use the actual payload or a provider wrapper

当前 `before_provider_request.payload` 是最有用的公开请求证据。只为当前请求处理，已知扩展顺序，已持有该请求对应的完整投影和 checkpoint 边界时，可以复用它，避免再猜工具可见性。

但 `payload.input` 不携带 source entry IDs、隐藏原因或此前被压缩掉的历史投影。不能将所有缺失声明静默删掉，再声称原有严格前缀校验仍然成立。若要重新设计为以实际 payload 为权威，必须另证 checkpoint 覆盖边界与保留历史的映射，而不是跳过不匹配。

注册一个包装 provider 可以收到宿主过滤后的 `TranscriptContext`，再委托官方 converter，因而能更准确地观察请求。但恢复后还没请求时，wrapper 同样没有数据。重新注册 provider 还改变模型/auth/其他包装器的组合方式，不是 F2 所需的最小修复。[S11]

payload 缓存还必须按 session、branch、model、声明版本失效。之前的 `tools` 不能无条件用于恢复后的手动压缩，更不能用于重新显示过的工具。E5 证明即使尚未离开同一 provider event，也存在状态版本差异。

### Supply a controlled SDK host

自有宿主可以持有 `AgentSession`、控制 loadout 策略或请求管线，并通过闭包/消息总线把权威结果交给插件。这不需要 Pi 上游合并改动，但要求用户更换启动宿主或约束所有 hook。

调用公开的 `agent.transformContext` 也不能直接当作无副作用查询 API。它会再派发 context handlers，可能改写数据或运行异步操作，并不承诺从任意历史得到与下一次真实请求相同的结果。普通扩展本来也没有 `session.agent` 引用。

以上方案可以作为明确限定范围的产品选项，不能据此把本次全部验收标为通过。私有字段访问、猴子补丁、删除历史和放松前缀比较均不作为正式方案。

## Minimal host capability

### Data contract

建议只增加只读声明快照及请求关联，不暴露可修改的内部 Set，也不重新执行 hook 来回答查询。下面是设计草案，不是 1.3.0 已有 API。

```ts
interface ToolDeclarationSnapshot {
  readonly revision: string;
  readonly hiddenDeclarations: readonly string[];
  readonly declaredTools: readonly Tool[];
}

interface ExtensionContext {
  getToolDeclarationSnapshot(): ToolDeclarationSnapshot;
}

interface BeforeProviderRequestEvent {
  toolDeclarationSnapshot?: ToolDeclarationSnapshot;
}
```

- `hiddenDeclarations` 必须是宿主实际用于过滤历史的完整集合，不能只取当前 active tools 的交集。1.3.0 聚合 hook 返回的名字时没有再按 active names 过滤，历史和迟到工具也可能被该集合命中。[S1]
- `declaredTools` 是当次 loadout 的工具声明，已经应用所有描述改写并去掉 hidden declarations，包含 provider 转换所需的 schema/constrained-sampling 数据。它不是某个 provider 的顶层 `payload.tools`，不能忽略 transcript 初始声明与增量的区别。[S8]
- `revision` 包含 runtime/session 世代，语义变化时更新。隐藏集合相同但描述、参数或 grammar 变化也应更新。不要每次无变化重算都制造新版本。
- getter 返回最新已提交 loadout 的不可变快照，供 `session_before_compact` 等没有请求的路径读取。它不等价于“未来所有注册已完成”，也不等待所有 MCP server。
- provider event 的字段是生成当前 payload 时实际使用的快照。它可以比 getter 返回的 live revision 旧，这是 E5 的正常情况。非 session 的嵌套 provider 请求没有对应 loadout 时应明确缺省，不能套用最近一次全局快照。

这两个读取点各有用途。只加 getter，仍有 E5 的竞态；只加 provider event 字段，仍缺 E1 的首次手动压缩。`session_before_compact` 无须再增加重复字段，插件可以在 handler 开始时同步读取 getter 并固定该操作的版本。

也可以把等价字段放入现有结构中，但不能悄悄把 command getter 的 base-options 语义改为 run/request options。那会破坏现有调用者。本方案选择单独命名，是为了把两种语义分清，不是认定只能新增方法。

### Publication and asynchronous lifecycle

1. 在 `_applyToolLoadout` 聚合完所有 hook 之后，原子发布 effective tools、hidden names 和 revision。registry refresh、setActiveTools、初次恢复、reload、每次 run/turn 的 loadout 准备都走这条路径。getter 本身没有副作用。[S1][S4]
2. 在 hidden projection 等待之前的 context transforms 完成之后，固定实际用于过滤的快照。后续转换与 `onPayload` 使用同一个请求局部关联，不从“最后一次请求”全局变量取。SDK/agent 的 request-options 传递需要保留这个关联。[S4][S7]
3. `session_before_compact` handler 同步捕获 branch、model、snapshot，之后构建的各 view 和 fallback tools 使用同一份数据。不能在 await 前用旧 hidden 集合、await 后再拿新工具列表。
4. 异步 auth、metadata、远程压缩完成后，比较 session/runtime、branch、model 和声明 revision。变化时取消或重做准备，不提交基于旧投影的新 checkpoint。网络已发出不能撤回，不应把返回结果强行应用到新状态。
5. 普通请求校验应针对该请求携带的快照，而不是因为 live getter 变新，就把新过滤规则应用到已生成 payload。是否重发要由宿主生命周期策略决定。
6. reload/session replacement 作废旧 getter/context 和 pending 操作；即使 session ID 没变，runtime 世代也必须变化。

只读快照解决的是宿主 hidden-declarations 投影。后续第三方 `context_with_system`、forced prompt 或 provider payload 改写仍需独立兼容与严格校验。若要求扩展能验证任意下游 payload 修改，还需要终态验证点或宿主合成后的 request snapshot，那是比 F2 更大的契约，不应借本次修复一并承诺。

### Compatibility and tests

新增能力应保持 additive，并明确最低宿主版本。旧 Pi 上不能把缺失 getter/字段解释为 `hiddenDeclarations: []`。可以继续支持事先证明无隐藏策略的受控场景；通用路径保持现有保护并报告能力不足，不能静默降级为猜测。具体拒绝策略需要后续产品确认，本次不实施。

上游与插件至少应补以下离线测试。

- 直接工具、codemode on/only、多 hook 隐藏集合 union、描述覆盖，以及 hook 抛错后的最终状态。
- 启动 handler 顺序两种排列、context handler 中的 await、轮内注册和 re-register、隐藏再显示、历史声明含 removal/redeclaration。
- 恢复后立即 compact、reload 后立即 compact、pending tools 迟到、声明变化但 active names 不变。
- 生成 payload 后注册新工具，验证 event snapshot 不变而 live revision 更新；嵌套请求不能拿错关联。
- 压缩 await 期间更换 loadout、branch、session、model，迟到结果不得提交。
- 旧 V2 checkpoint 不改写、不解密、不删除；隐藏过滤只作用于从原始历史派生的新视图。工具调用、结果、非工具 system updates 必须保留。
- 修改普通用户消息的负例仍产生 prefix mismatch。非隐藏的工具描述/schema 差异也不能被宽松比较吞掉。
- 同一操作复用 snapshot/view；消息和声明过滤按一次线性遍历完成，使用 N 与 2N 的访问计数检查，避免逐工具扫描历史。

## Plugin integration after host support

| File | Required change |
| --- | --- |
| `index.ts:416-470` | 请求入口读取 request-bound snapshot，与 requestInput/basePayload 一起传给 coordinator；缓存带 revision，不只用 session ID |
| `index.ts:472-553` | compact handler 在同步起点固定 live snapshot；每个异步返回边界核验其有效性 |
| `session-projection.ts:22-67` | 对 full-history 和 Pi-context 派生消息统一过滤隐藏的 `toolsAdded/toolsRemoved`，保留 sourceEntry/sourceIndex、system message 本身及非声明内容，不改 raw branch |
| `native-compaction.ts:697-776` | `createBranchInputSnapshot` 接收声明快照，所有 effective/full-history/pi-context 和 native range 使用同一投影；同一快照内复用缓存 |
| `session-coordinator.ts:652,726,744,859,1033,1082,1178` | 所有 snapshot 构造点、模型转换与失败恢复都传递同一操作的声明状态，避免只修普通请求路径 |
| `remote-compaction.ts:91-104` | 无已观察 payload 时，以 effective declared tools 生成工具声明，不再用原始 `getAllTools + getActiveTools`；保留 provider 对历史 loaded tools 的分配规则 |

请求已有对应 payload 时，优先复用其实际 tools 和 request formats。手动压缩不能复用旧 revision 的 tools；新接口的 `declaredTools` 还应保留 `prepareLoadout` 对描述的改写，不能仅从原 `ToolInfo` 删除几个名字。[S1][S12]

已有 checkpoint 的 `replacementHistory`、`preservedInput` 含不透明 provider 内容。没有依据去修改其内部声明；只能在同一当前投影下重建可见的历史部分，并保留现有兼容性和前缀保护。若旧 checkpoint 本身与新投影不兼容，仍应由已有 transition/失败处理拒绝，而不是宣称隐藏过滤能修复任意旧 checkpoint。

## Validation and limits

已运行三次 `pnpm run check`。第一次和最后一次退出码为 0，第二次有一项进程测试失败。最后一次结果如下。

```text
Test Files  180 passed | 4 skipped
Tests       2667 passed | 13 skipped
```

最后一次的类型检查、测试、构建、发布包检查，以及 source/dist 两种加载方式下的 legacy/official MCP host 检查都通过。最终日志为 `.tmp/hidden-declarations-api-research/check-rerun.log:297-311`。首次通过日志为同目录 `check.log`。legacy MCP 的替换提示是预期提示，四组 host 检查均为 `loadErrors: 0`。

第二次失败保留在 `check-final.log:304-324`。`test-wrapper.test.ts:106` 等待临时结果文件存在后立即读 JSON，遇到 `Unexpected end of JSON input`，失败用例是 two descendants / early-exit。单独复跑该文件的 10 项测试全部通过，日志为 `test-wrapper-rerun.log`；随后全量复跑也通过。源码显示“文件已存在但内容尚未写完”的竞态窗口，这解释与现象一致，但本次没有专门注入时序证明根因，也没有修改测试。检查未发现残留的 fixture worker、pnpm runner 或探针进程。

check 构建后再次运行探针，退出码 0，最终日志第 12 行为 `assertions: "passed"`、`blockedNetwork: 0`。该计数表示没有请求落到禁止联网的全局 fetch；每次 provider 请求都由显式的本地 response stub 接管。探针没有监听端口、启动服务或后台 worker，所有 session 均 abort、waitForIdle、dispose 后退出。

没有新增正式回归测试，没有修复插件，也没有改 todo、依赖、node_modules 或全局配置。全量检查针对开始时已存在多处改动的工作树，不代表干净提交。`dist/` 仅由要求执行的构建脚本生成，没有手工修改。

未验证真实 MCP 连接时序、TUI resume/compact 操作、线上 V2 协议、压缩质量、真实 OAuth、任意第三方扩展组合，以及本报告提出的新接口。第一项 thinking 的结论由本地源码和已有离线复现支持，本次没有实现或重新运行 thinking 专项探针。

## Source index

以下缩写仅用于定位本地行号。

- `CA` = `node_modules/@earendil-works/pi-coding-agent/dist`
- `AI` = `node_modules/@earendil-works/pi-ai/dist`
- `AG` = pnpm 安装的 `@earendil-works/pi-agent-core` 1.3.0 包下 `dist`

| Source | Local evidence | Fixed official source |
| --- | --- | --- |
| S1 | `CA/core/agent-session.js:1072-1097,1111-1207,1275-1369`，active/metadata、hook 聚合、prompt options、hidden/forced 投影 | [agent-session.ts at v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/agent-session.ts) |
| S2 | `CA/core/extensions/types.d.ts:212-288,369-504,601-719,1282-1284`，公开 context/tool/event 契约；`CA/core/session-manager.d.ts:178`，readonly manager 方法 | [extensions/types.ts at v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/extensions/types.ts)；[session-manager.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/session-manager.ts) |
| S3 | `CA/core/extensions/runner.js:640-755,1005-1170`，context/command 构造、handler 链、启动 options | [extensions/runner.ts at v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/extensions/runner.ts) |
| S4 | `CA/core/agent-session.js:200-217,535-565,1375-1382,1449-1499,2201-2245,2814-2815,2841-2950,2969-3001`；`CA/core/sdk.js:225-230,251-285`，恢复、启动、轮间刷新、手动压缩、工具刷新与 request dispatch | [agent-session.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/agent-session.ts)；[sdk.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/sdk.ts) |
| S5 | `CA/core/extensions/loader.js:231-240`；`CA/extensions/mcp/index.js:283-354,455-520,971-1073,1114-1120`，同步 refresh、后台连接、有限等待、关闭 | [extensions/loader.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/extensions/loader.ts)；[MCP extension](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/extensions/mcp/index.ts) |
| S6 | 官方 session-format、compaction 文档；本仓库 `session-projection.ts:22-67`；`CA/core/agent-session.js:2212-2245` | [session-format.md](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/session-format.md)；[compaction.md](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/compaction.md) |
| S7 | `AG/agent-loop.js:213-268`；`AI/api/openai-codex-responses.js:145-183`，工具 diff、transform、转换、onPayload、序列化 | [agent-loop.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/agent/src/agent-loop.ts)；[openai-codex-responses.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/ai/src/api/openai-codex-responses.ts) |
| S8 | `AI/utils/transcript.js:41-52,94-112,172-205`；`AI/api/openai-responses-shared.js:63-120`，工具状态和增量分配 | [transcript.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/ai/src/utils/transcript.ts)；[openai-responses-shared.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/ai/src/api/openai-responses-shared.ts) |
| S9 | `CA/extensions/codemode/tool.js:209-241`；`CA/extensions/codemode/index.js:18-31` | [codemode/tool.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/extensions/codemode/tool.ts)；[codemode/index.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/extensions/codemode/index.ts) |
| S10 | `AI/api/transform-messages.js:85-103`；本仓库 `extensions/codex-compact/src/native-compaction.ts:573-600`；旧探针 `.tmp/pi-compact-upgrade-probe.jsonl:1-2` | [transform-messages.ts](https://github.com/earendil-works/pi/blob/v1.3.0/packages/ai/src/api/transform-messages.ts) |
| S11 | 官方 custom-provider 文档的 normalized TranscriptContext、stream instrumentation 契约 | [custom-provider.md](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/custom-provider.md) |
| S12 | 本仓库 `extensions/codex-compact/src/native-compaction.ts:480-504,506-565,697-776`、`session-coordinator.ts:394-409`、`remote-compaction.ts:91-104`、`index.ts:371-394,416-553` | 本地待修代码；对应宿主行为见 S1、S7、S8 |

官方扩展总契约另见 [extensions.md at v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/extensions.md)，SDK 用法见 [sdk.md at v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/sdk.md)。
