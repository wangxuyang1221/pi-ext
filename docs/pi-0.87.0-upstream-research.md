# Pi 0.87.0 compatibility research

## Repository verdict

初次调研日期为 2026-09-22。隔离环境曾在真实安装的 0.87.0 包上复现 `context_edit` 与插件原始历史重放的冲突：后续请求会取消，或在切换模型时重新引入已省略的内容。以下故障复现和基线测试结果记录的是修复前状态；当前升级结果见文末的「Implementation follow-up」。

初次调研只新增本报告，当时未修改主工作区源码、依赖声明和 lockfile。验证副本位于 `.cache/p87`，其中的图片 fixture 和版本断言调整仅用于区分故障原因。

## Confirmed repository incompatibility

### Raw history bypasses context edits

`codex-compact` 从 `getBranch()` 获取原始 entries，再逐条调用 `sessionEntryToContextMessages()`。这个单条转换函数不会应用其他 entry 中的 `context_edit`。0.87.0 通过 `buildSessionProjection()` 统一应用编辑，所以这两条路径会产生不同的模型上下文。[本地 context handler](../extensions/codex-compact/src/index.ts#L355)、[本地 Responses 转换](../extensions/codex-compact/src/native-compaction.ts#L653)、[上游 projection 实现](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/session-manager.ts)。

实际复现了两种结果：

| Trigger | Observed behavior | Impact |
| --- | --- | --- |
| 会话已有有效 native checkpoint，checkpoint 后的一条 user message 被 `appendContextEdit(id, null)` 省略，或 content 被替换，然后继续请求 | Pi 的投影已应用编辑；插件仍用旧历史匹配请求前缀，抛出 `HistoryPrefixMismatchError`。真实 `before_provider_request` handler 调用 `ctx.abort()`，记录 `history_prefix_mismatch` | 后续请求中断。仅重试同一条请求不会修复历史视图分歧 |
| 同样的历史切换到非 Codex 模型，进入插件从原始历史恢复 context 的分支 | Pi 投影中已不存在的 `STALE_CONTENT` 又出现在 handler 返回的消息里；content replacement 也退回原内容 | 模型重新看到被省略或替换的消息 |

第一种结果对应 [请求前缀校验](../extensions/codex-compact/src/session-coordinator.ts#L693) 和 [失败后取消请求](../extensions/codex-compact/src/index.ts#L425)。第二种结果对应 [非 Codex 恢复分支](../extensions/codex-compact/src/index.ts#L361)。以上是本地探针执行结果，不是仅凭上游 changelog 推测。

另一个探针模拟了被 `context_edit` 省略的 `stopReason: "length"` assistant。上游投影不再包含它，插件的 `fullInputForBranch()` 仍把它转换成 Responses input。0.87.0 自带的 length/overflow recovery 就会生成这类 omission，因此影响不只限于用户安装额外的 context-edit 扩展。插件原有转换已过滤 `error` 和 `aborted` assistant，不能把所有普通 error retry 都算作已复现故障。[本地 stopReason 过滤](../extensions/codex-compact/src/native-compaction.ts#L552)、[上游恢复逻辑](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/agent-session.ts)。

上述 length 探针只验证了历史转换差异，没有运行真实服务端的完整 overflow/retry 流程；真实请求取消的复现使用了明确构造的 user omission/replacement 和 native checkpoint。

适配应统一 provider 请求、compaction 输入、请求前缀校验和 token 估算使用的模型可见历史，并保留源 entry ID 与 checkpoint 的对应关系。若 edit 修改了已进入加密 checkpoint 的内容，还需要明确 checkpoint 失效和重新压缩的处理方式。单纯跳过 `context_edit` entry，或直接取消前缀校验，都无法解决问题。

## Other extensions

| Extension | Assessment |
| --- | --- |
| `codex-ui` | 未发现新的 API 破坏。`read` 包装器继续把完整 `ctx` 传给上游 definition，因此可以取得新增的模型图片 resize 配置。[调用位置](../extensions/codex-ui/src/tools.ts#L239) |
| `skill-mentions` | 图片测试需要更新 fixture。旧样本 `AA==` 不是有效 PNG，新版在 `message_start` 前省略图片并附加提示，导致原任务文本和图片保留断言失败。仅在副本替换成有效的 1×1 PNG 后，flow/lifecycle 共 41 项通过，未发现这组测试覆盖范围内的插件功能退化。[图片归一化实现](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/agent-session.ts) |
| `goal` | 未发现已复现的独立故障。主要续跑通过 `agent_end` 排 follow-up，未调用被删除的 `shouldStopAfterTurn`。`agent_settled` 中依赖 `isIdle()` 判断的逻辑应在升级回归时保留多扩展组合场景，因为新版会推迟其他 settled handler 发起的新 run。[调度器](../extensions/goal/src/scheduler.ts#L160) |
| `subagent` | 未发现已复现的新故障。缩短隔离目录后，6 项真实 tmux 测试全部通过。会话历史读取用于展示，保留 raw history 本身符合新版语义 |
| `mcp`、`permissions` | 工具注册和执行事件契约未变，现有测试未出现新增失败。未知 Chat Completions endpoint 的 strict schema 默认值变化由 Pi provider 层处理 |
| `openai-fast-mode` | `before_provider_request` payload hook 保留，现有测试未出现新增失败。Chat Completions 的 strict 默认值变化不应套用到 Codex Responses |

本仓库发布的 8 个扩展在 0.87.0 下都通过真实 filesystem loader 测试，编译后的 8 个入口也全部可导入。`codex-search` 尚未列入 `package.json` 的发布扩展，其已有单元测试随全量测试执行，但本次没有验证真实网页搜索服务。

## Validation evidence

运行环境为 Node.js 22.22.2、pnpm 11.9.0。主工作区仍安装 0.86.0；隔离副本将三个直接 Pi 依赖及 peer 声明改为 0.87.0，生成副本 lockfile 后使用 `pnpm install --frozen-lockfile --ignore-scripts` 安装。

| Check | Result |
| --- | --- |
| 主工作区 `pnpm run check` | 类型检查通过；测试 2419 通过、1 失败、12 跳过。失败来自 `quality-report.test.ts` 检查发布清单中的文档是否存在，涉及调研前已删除的文档 |
| 主工作区单独 build / package check | build 通过；package check 报缺少 `docs/skill-mentions.md`。发布清单中的 `docs/codex-compact-quality-validation.md` 也已不存在 |
| 0.87.0 副本 `pnpm run check` | 类型检查通过；首次全量测试 2408 通过、12 失败、12 跳过，未到达 build 阶段 |
| 0.87.0 副本单独 build / import | build 通过；8 个编译入口导入成功 |
| 首次全量测试的 11 项新增失败 | 5 项来自无效图片 fixture；2 项来自 quality worker 与测试硬编码 `0.86.0`；4 项来自隔离路径过长导致 tmux Unix socket 无法创建 |
| 排除上述测试条件后的定向复测 | 副本中更新有效图片和版本断言，并把目录移到较短的 `.cache/p87` 后，4 个测试文件共 51 项全部通过 |
| 新语义探针 | omission、replacement、非 Codex fallback、length 历史转换和真实插件 abort 分支均复现预期的不兼容行为 |

没有把调整测试条件后的定向通过称为新版全量通过；`context_edit` 问题也不在原有测试覆盖中。质量评估工具里的版本锁定需要随实际升级一起更新。[版本断言](../scripts/codex-compact-quality-plugin.mjs#L87)。

本地可复查的临时证据：

- `.pi-0.87-baseline-check.log`
- `.cache/pi-0.87-research/upgrade-check.log`
- `.cache/pi-0.87-research/targeted-recheck.log`
- `.cache/pi-0.87-research/semantic-probe.json`
- `.cache/p87/compatibility-probe.mjs`，运行方式为 `cd .cache/p87` 后执行 `node compatibility-probe.mjs`

这些路径均被 Git 忽略。本次没有调用真实模型服务，也没有执行完整交互式 TUI 验收。测试进程已退出，未发现本次启动的残留进程。

## Scope and method

本仓库直接锁定 `@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai` 和 `@earendil-works/pi-tui` 0.86.0。本报告比较官方 `v0.86.0...v0.87.0`，因此也包含 0.86.1。依据按优先级使用官方 release、各包 changelog、tag 下的文档与源码，以及官方 compare。Context7 能定位到 `/earendil-works/pi`，但内容来自当前主分支且没有 0.86.0/0.87.0 版本切片，所以版本结论均回到官方 tag 核验。[v0.87.0 release](https://github.com/earendil-works/pi/releases/tag/v0.87.0) [official compare](https://github.com/earendil-works/pi/compare/v0.86.0...v0.87.0)

## Executive findings

0.87.0 的主要变化是 provider context 改由 SessionManager 统一生成。`SessionManager` 现在是 `AgentSession` 的权威上下文，`agent.state.messages` 只是刷新后的检查缓存。上游同时引入 append-only `context_edit`、可修改状态的 `turn_end` 和 `agent_before_settle` 边界，以及每次 provider 请求前的 `prepareRequest`。这几项共同保证恢复、重试和扩展写入都先落入 session，再投影为下一次请求的上下文。[coding-agent changelog](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/CHANGELOG.md#breaking-changes) [SDK session state](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/sdk.md#session-state)

对本仓库最危险的兼容点是原始历史与模型可见历史从此可能不同。`SessionManager.getBranch()` 仍返回 append-only 原始 entries，其中可能包含已经被 `context_edit` 省略的失败 assistant/tool-result 尝试。需要 provider context、token 估算或 compaction 输入的代码应使用 `buildSessionProjection()` 或 `buildSessionContext()`，并保留 entry 到投影消息的来源关系。[ContextEditEntry](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/session-format.md#contexteditentry) [session projection source](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/session-manager.ts)

## Breaking changes

| Area | 0.87.0 change | Required migration |
| --- | --- | --- |
| Agent loop | 删除 `AgentOptions.shouldStopAfterTurn` 与 `AgentLoopConfig.shouldStopAfterTurn`。新增 `finishTurn`，返回 `{ action: "end" }` 或 `{ action: "continue" }`。它在 `turn_end` 前运行，也会收到 error 和 aborted 响应，但这些响应仍直接结束。 | 把旧 predicate 移到 `finishTurn`。如果旧逻辑只应处理正常响应，先排除 `stopReason === "error"` 和 `"aborted"`，避免新增副作用。[agent-core changelog](https://github.com/earendil-works/pi/blob/v0.87.0/packages/agent/CHANGELOG.md#breaking-changes) |
| Session union | 导出的 `SessionEntry` 新增 `ContextEditEntry`，`type` 为 `context_edit`。 | exhaustive switch 必须处理该分支。读取 provider context 时不能把它当作普通可忽略 metadata。[session format](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/session-format.md#contexteditentry) |
| AgentSession context | 给 `session.agent.state.messages` 赋值不再替换后续请求历史；下一个请求边界可用 SessionManager 投影覆盖它。 | 恢复历史时构造 `SessionManager.inMemory(...)` 并传给 `createAgentSession`。已有 session 要追加外部 entry 时，通过 `session.sessionManager` 写入，再调用 `session.refreshContext()`。[SDK migration](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/sdk.md#session-state) |
| Extension events | `TurnEndEvent` 新增必填的 `messageEntryId`、`toolResultEntryIds`、`outcome`、`entries`、`continue` 和 `context`。`ExtensionEvent` union 新增 `agent_before_settle`。 | 构造事件的 host 与 exhaustive switch 都要更新。`ExtensionRunner.emit()` 不再接受 `turn_end`，host 应调用 `emitBoundary(baseEvent, buildContext)`。[extension event contract](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/extensions.md#turn_start--turn_end) |
| Settled dispatch | `agent_settled` handler 发起的新 run 会等所有 settled handlers 完成后再启动，不再在同一次通知派发中重入 `agent_start`。 | 不要依赖 handler 间观察到重入 run 的旧时序。需要在最终结束前追加 entry 或继续请求时改用 `agent_before_settle`。[settlement events](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/extensions.md#agent_start--agent_end--agent_before_settle--agent_settled) |

还有一项虽列在修复项中，但会改变扩展可见行为。`context` handler 现在只收到非 system 的会话消息。如果 handler 改动列表，Pi 会恢复当前 prompt 与工具声明到首个 system message。需要按请求改写完整 transcript 的扩展应改用新增的 `context_with_system`，并保证 index 0 仍是 system message。[`context`](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/extensions.md#context) [`context_with_system`](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/extensions.md#context_with_system)

## Events and tool execution

新增的 `turn_end` 是可操作边界。它在 assistant 与全部 tool-result 消息持久化之后、底层公开 `turn_end` 事件之前运行。handler 按扩展加载和注册顺序执行，每个 handler 都能看到前面 handler 提议的 entries 以及基于这些 entries 重建的 context。允许追加 `custom`、`custom_message`、`context_edit` 和 `compaction` draft，并可用 `continue: true` 保证一次后续 provider 请求。已有工具结果、steering 或 follow-up 引起的请求会满足该保证，不会额外多发一次请求。[turn boundary docs](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/extensions.md#turn_start--turn_end) [runner source](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/runner.ts)

`agent_before_settle` 是最终的可操作边界，位置在 provider retry、overflow recovery、compaction 和排队消息处理完成之后。它也能追加上述 draft 并请求继续。`agent_settled` 仍是最终通知，不适合再做结构性 session 修改。[extension lifecycle](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/extensions.md#extension-events)

`tool_execution_start`、`tool_execution_update`、`tool_execution_end` 的 payload 字段没有改变，仍分别暴露 tool call、partial result 与最终 `result/isError`。变化发生在它们之后的边界：`finishTurn` 和扩展 `turn_end` 都能看到已经完成的 `toolResults`，`TurnEndEvent` 还提供对应持久化 entry IDs。0.86.0 到 0.87.0 的官方 compare 没有修改这三个事件接口。[event types](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/extensions/types.ts#L881-L905) [official compare](https://github.com/earendil-works/pi/compare/v0.86.0...v0.87.0)

工具结果中的图片现在按当前模型的 `inputLimits.images.resize` 处理，扩展通过 `tool_result` hook 注入或替换的图片也会经过同一处理。`read` 工具和 prompt attachments 使用相同模型配置。[tool-result image handling](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/utils/tool-result-images.ts) [image input limits](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/models.md#image-input-limits)

## Session and compaction

`ContextEditEntry` 对较早的 user、assistant、tool-result 或 custom-message entry 做分支内的 append-only 修改。`replacement: null` 从后续模型上下文省略目标，非 null replacement 只替换 content。原始 entry 仍保留在 raw history、UI、export 和 session accounting 中；同一分支对同一目标的最后一次 edit 生效，导航到 edit 之前会重新看到原内容。[session format](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/session-format.md#contexteditentry)

0.87.0 把自动重试和最终 length/overflow 恢复改为持久化 context edits。失败或废弃的 assistant 尝试以及相关 tool results 仍留在 transcript，但会先追加 omission edits，再进行 recovery compaction 和新的 run。因此恢复后的 provider context 不应再次包含这些尝试；直接 flatMap 原始 branch entries 会把它们错误地送回模型。[compaction recovery ordering](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/compaction.md#overflow-and-length-recovery-ordering) [AgentSession recovery source](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/agent-session.ts)

compaction 现在基于 `buildSessionProjection()` 选择 cut point、估算 token 并生成摘要。省略的原始 entries 不参与 cut selection、summary、checkpoint 或 token estimate。最近一次 context edit 或 compaction 还会让旧 assistant usage 失效，Pi 会重新估算投影上下文，避免复用旧 usage。扩展如果自行实现 compaction，应沿用投影语义。[compaction docs](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/compaction.md#how-it-works) [compaction implementation](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/compaction/compaction.ts)

`appendCompaction(summary, null, tokensBefore)` 新增 retain-none 模式。它把 compaction entry 自己的 ID 写入 `firstKeptEntryId`，表示不保留它之前的任何 entry。处理 `firstKeptEntryId` 的代码不能再假设目标一定在 compaction 之前。[compaction entry format](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/session-format.md#compactionentry) [SessionManager source](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/session-manager.ts)

低层 agent-core 还新增 `prepareRequest`，它在每次 provider request 前运行，包括第一次请求。此时已选中的 pending messages 已追加并发出事件，hook 可以替换 context、model 和 thinking level，但不会再次轮询队列。coding-agent 用它在每次请求前重新安装 SessionManager 的权威投影。[agent-core changelog](https://github.com/earendil-works/pi/blob/v0.87.0/packages/agent/CHANGELOG.md#added) [agent loop source](https://github.com/earendil-works/pi/blob/v0.87.0/packages/agent/src/agent-loop.ts)

## Provider options

`pi-ai` 的 `Model` 新增 `inputLimits`。本次实际执行的是 `inputLimits.images.resize`，字段包括 `maxWidth`、`maxHeight`、`maxBytes` 和 `jpegQuality`。图片在进入 history 前只编码一次，之后切换模型不会重写历史图片，因此不会破坏已经形成的 cache prefix。`maxRequestBytes`、`maxPerMessage` 和 `maxPerRequest` 当前只是 catalog metadata，0.87.0 不会据此重写或拒绝 history。[pi-ai types](https://github.com/earendil-works/pi/blob/v0.87.0/packages/ai/src/types.ts) [model documentation](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/docs/models.md#image-input-limits)

OpenAI-compatible Chat Completions 默认不再声明支持 strict tool schema。未知 endpoint 除非明确声明 `compat.supportsStrictMode: true`，否则不再收到 strict schema；内置已确认支持的模型仍在生成 catalog 中显式开启。自定义 provider 若依赖旧默认值，需要补配置。这一变化修复了未知兼容端点和 Cerebras 的 HTTP 400，但可能降低未声明 provider 的 schema 约束强度。[pi-ai changelog](https://github.com/earendil-works/pi/blob/v0.87.0/packages/ai/CHANGELOG.md) [OpenAI Completions detection](https://github.com/earendil-works/pi/blob/v0.87.0/packages/ai/src/api/openai-completions.ts)

0.86.1 还新增 Meta provider，支持 `META_API_KEY` 和 `/login meta` 的 Muse subscription OAuth，并加入 Muse Spark 模型。z.ai 的 `Prompt too long` 会被识别为 context overflow，Cerebras 不再宣称支持 strict tools。[pi-ai 0.86.1 changelog](https://github.com/earendil-works/pi/blob/v0.87.0/packages/ai/CHANGELOG.md#0861---2026-09-20) [Meta provider source](https://github.com/earendil-works/pi/blob/v0.87.0/packages/ai/src/providers/meta.ts)

## TUI and extension loading

`pi-tui` 0.87.0 changelog 没有新增公开 API 项。源码只有 fullscreen viewport 的修复：自动 scrollbar 隐藏或出现时，"Jump to latest message" 标签保持以 transcript 宽度居中，同时绘制和点击范围不会覆盖 scrollbar。扩展无需做 TUI API 迁移。[tui changelog](https://github.com/earendil-works/pi/blob/v0.87.0/packages/tui/CHANGELOG.md#0870---2026-09-21) [TUI fix source](https://github.com/earendil-works/pi/blob/v0.87.0/packages/tui/src/tui-alt-screen.ts)

官方 compare 没有修改 extension discovery/compiler loader 的公开契约，也没有修改 `packages/coding-agent/src/core/extensions/loader.ts`。相关改动有三处。第一，0.86.1 的 bundled CLI 在加载 runtime 前启用 Node persistent compile cache，主要减少重复启动时间。第二，prompt template frontmatter 解析失败不再静默跳过，而是进入 resource warning diagnostics。第三，crash diagnostics 会把 stack trace 命中的已加载扩展路径列为提示。这些变化会提高错误可见性，但不要求扩展入口或 manifest 迁移。[coding-agent changelog](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/CHANGELOG.md) [prompt loader source](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/prompt-templates.ts) [crash diagnostics source](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/crash-log.ts) [official compare](https://github.com/earendil-works/pi/compare/v0.86.0...v0.87.0)

## Migration checks for this repository

升级前应优先检查以下位置：

1. 所有对 `SessionEntry`、`ExtensionEvent` 或 `TurnEndEvent` 的 exhaustive switch 和手工构造代码。
2. 所有直接读 `SessionManager.getBranch()` 后自行生成 provider messages、Responses items、token estimate 或 compaction input 的代码。它们必须应用 `context_edit`，最好直接消费 `buildSessionProjection()`。
3. 所有写 `session.agent.state.messages` 的恢复或分支代码。它们需要改为 SessionManager API，并在追加后调用 `refreshContext()`。
4. 所有 `context` handler 中读取、删除或重排 system messages 的代码。它们应改用 `context_with_system`。
5. 所有 `shouldStopAfterTurn` 使用点，以及依赖 `agent_settled` 内同步重入新 run 的逻辑。
6. 自定义 OpenAI-compatible provider 的 strict tool schema 配置，以及模型图片进入 attachment、`read`、tool result 三条路径时的 resize 预期。

这些检查直接对应 0.87.0 的权威上下文、事件 union 与 provider 默认值变化。[v0.87.0 release](https://github.com/earendil-works/pi/releases/tag/v0.87.0)

## Implementation follow-up

2026-09-23 已将三个直接 Pi peer/dev 依赖、lockfile 和 pnpm 发布年龄例外统一升级至 0.87.0。`codex-compact` 现在从完整原始分支生成应用最新 `context_edit` 的模型历史，并在编辑触及加密检查点之前的消息时使该检查点失效，再使用已编辑的历史重建请求。原始会话记录保持不变。切换非 Codex 模型时，同样使用编辑后的完整历史。

新增使用真实 `SessionManager` 的回归用例覆盖检查点后的替换与省略、检查点前的编辑失效、切换模型，以及 user、assistant 和 tool-result 的多次编辑。测试中的图片换成有效 PNG，质量报告与运行时版本断言更新至 0.87.0。删除文档仍保持删除，发布清单及对应的失效引用已经清理。

`pnpm install --frozen-lockfile --ignore-scripts`、`pnpm run check` 和 `pnpm pack --dry-run` 均通过。全量测试为 2425 通过、12 项按仓库配置跳过；类型检查、构建和发布包校验通过。未执行付费模型请求或跨平台 CI，真实远端压缩质量不由这组离线测试证明。
