# Codex compaction plugin repair proof

## Scope and evidence

此报告保留研究基线的判断和 36 组原始探针结果。生产修复已另行实施，当前状态、正式测试、支持边界和未完成的 Linux/真实服务验证见 [repair todo 的 implementation record](codex-compact-plugin-repair-todo.md#implementation-record)。下面“当前插件”等表述均指研究基线，不能当作修复后状态。

本报告研究插件修复的可行范围，不修改生产代码。仓库基线为 `8667f5fdd41419f7475e5dc5a2421cef19dfccb0`，实际 Node.js 为 `v22.22.2`；`package.json` 固定 Pi `1.3.0`，本地 `@earendil-works/pi-coding-agent/package.json` 也报告 `1.3.0`。源码行号指本地已安装发布文件或该基线的仓库文件，不是 GitHub TypeScript 文件的行号。

已通过 Context7 定位 `/earendil-works/pi`，指定 `/earendil-works/pi/v1.3.0` 查询 compaction、provider request 和生命周期文档。Context7 返回了 v1.3.0 的 agent README 和 coding-agent compaction 文档，也混入 durable package 的资料。本报告只用 coding-agent 和 agent 的实际发布源码判断本插件行为，不将 durable 的调度语义套到 AgentSession。

证据分为以下四类。

| Classification | Meaning |
| --- | --- |
| 已证实缺陷 | 固定版本源码存在可达差异，且离线探针复现了后果 |
| 方案已证明 | 隔离候选实现通过列明的正例、负例与真实宿主转换比较，范围以探针覆盖为准 |
| 尚未证明 | 源码支持修复方向，但尚缺实验、候选集合完备性或服务端验证 |
| 功能政策选择 | 需要明确产品语义，不应包装成宿主事实或技术不可能性 |

离线探针入口为 [run.mjs](../prototypes/codex-compact-repair-proof/run.mjs)，可提交的结果快照为 [evidence.json](../prototypes/codex-compact-repair-proof/evidence.json)。本文已读取探针源码和成功退出的 36 组结果，意外网络请求为 0。旧报告 `docs/codex-compact-hidden-declarations-api-research.md` 仅用于定位源码，没有继承其结论或实验结果。

## Findings

| Topic | Source finding | Current proof status |
| --- | --- | --- |
| Pending tool calls and system messages | 官方转换会暂存 pending tool calls 期间的 system messages，插件当前立即输出 | 已证实缺陷；8 个隔离候选对照通过 |
| Grammar tool item IDs | 官方按 replay 类型校验 `fc_` 或 `ctc_`，同 provider/API 的跨模型消息清空 item ID；插件条件不完整 | 已证实缺陷；2 个修复例及 2 个回归例通过 |
| Session projection | pi-context 重建会错误带回已被 Pi 省略的 system update | 已证实缺陷；3 种 checkpoint 结构候选通过 |
| Duplicate retained user | handler 按全文比较补回最新 user，截断副本与全量原文同时保留 | manual/threshold/overflow flags 下均复现；来源策略尚未集成 |
| Non-success HTTP body | 请求 header timeout 不覆盖随后无界的 `response.text()` | 已证实缺陷；5 个独立 reader 候选通过，HTTP 分类集成尚未证明 |
| Current user and completion | 当前 user occurrence、下一次请求是否继续、用户任务是否完成，是三个不同问题 | 真实 SDK 续行反例通过；完整识别方案尚未证明 |
| Hidden and forced projections | 不要求唯一隐藏集合或逐项唯一来源；要求所有合法候选导出同一有效回放结果 | 3 种受控模式证明可行；通用生产算法尚未证明 |
| First manual compaction | 未发生 provider request 时，普通扩展可能缺少闭包 loadout 策略；这不证明所有手动压缩都必须禁用 | 真实 SDK 双世界反例通过 |
| Retention budget | 固定 64k 是当前迁移的 retention 规则；动态预算会改变保留行为 | 完整请求遗漏已复现；动态预算仅单例算术验证 |
| Commit after await | 已有生命周期检查不等于声明快照检查；提交前还须验证本操作依赖的状态 | 真实 SDK 已复现 branch 不变而 live loadout 改变，提交保护候选尚未证明 |

## Provider conversion

### Pending calls and system order

Pi `transformMessages()` 在规范化 ID、过滤跨模型 thinking 后，再维护 pending tool calls。遇到 system message 时先暂存；下一条 assistant、user 或消息结束时，先补齐缺失 tool results，再发出暂存 system messages。真实 tool result 不会被 system 打断。实现见 `node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js:138-211`。[Official source](https://github.com/earendil-works/pi/blob/v1.3.0/packages/ai/src/api/transform-messages.ts)

插件在 `extensions/codex-compact/src/native-compaction.ts:532-570` 只在 user、assistant 或结束处补 orphan outputs，但在 system 分支立即输出。输入顺序 `assistant(call) -> system(update) -> toolResult` 因此与 Pi 的 `assistant(call) -> toolResult -> system(update)` 不同。差异还影响 `messageIndex`，从而影响后续 fallback assistant ID 和 `pi_tool_load_*` 的 seed，不能只比较用户可见文本。

候选修复应对同一规范化消息序列执行与 Pi 一致的 pending/system pass，再生成 wire items。source entry 关联须随移动、复制和合成规则传播。合成 tool result 没有独立原始 entry，不能伪造它的来源。对 checkpoint tail 的截取也必须基于来源边界，不能把移动后的数组位置当成 raw branch index。

### Grammar IDs

Pi `openai-responses-shared.js:214-225` 根据本次 replay 类型选择前缀，function call 要求 `fc_`，custom call 要求 `ctc_`。同 provider/API 的不同模型消息省略 item ID，以免触发 reasoning 配对校验。`call_id` 仍须与结果配对。跨 provider/API 先按官方 normalization 处理，再按 replay 类型判断能否保留 ID。[Official source](https://github.com/earendil-works/pi/blob/v1.3.0/packages/ai/src/api/openai-responses-shared.ts)

插件 `native-compaction.ts:605-639` 已区分 custom/function，但第 616 行只检查部分 `fc_` 情形。同模型 custom call 的 `fc_` 或任意非 `ctc_` ID 会被保留。修复应分别核验 normalization、item ID 保留规则和结果配对，不能用清空所有 IDs 掩盖差异。

### Projection and provenance

Pi `session-manager.js:166-190` 将 message、custom message、branch summary 和 compaction 转成 runtime messages。`buildContextEntries():201-228` 使用最新 compaction 的 `firstKeptEntryId` 构造 active context；被保留范围内的旧 system entries 会省略。`buildSessionProjection():256-279` 再应用 active context 中的 context edits，且仅首个最新 compaction 贡献 summary。它返回 `sourceEntry`，所以仓库无需从文本反推正常分支的来源。[Official source](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/session-manager.ts)

本插件的 `session-projection.ts:22-67` 同时构造 full-history 与 pi-context；`native-compaction.ts:666-683` 在转换前把 user message 对应的 entry ID 保存到 WeakMap。这个方向合理，但后续规范化可能复制消息，必须显式保留关联。任何修正都应验证 full-history、pi-context、effective 三种 view，以及 context edit、compaction 边界和动态 system 更新，不能仅修普通无 checkpoint 请求。

P1 复现了更具体的错误。已有有效 checkpoint 时，`native-compaction.ts:734-753` 为 pi-context 从 `firstKeptEntryId` 开始重新走 full-history。它会带回 Pi active projection 原本省略的中途 system update。探针分别覆盖 native compaction、普通 compaction 后接 custom checkpoint、重叠 compaction。原结果均多出 developer item；使用真实 Pi projection 并只去掉 compactionSummary 的候选与真实 provider input 完全相同，且保留真实 merged system baseline。

这三种 fixture 还将带原始 sourceEntry IDs 的候选消息交给 `createBranchInputSnapshot().view(model, "full-history")`，确认最终 userSources 与原始 source IDs 顺序一致。这个结论只覆盖所列三种结构，不能代替全部 context edits 或跨边界 tool group 的验证。另一个普通摘要 control 确认，没有自有 V2 checkpoint 的普通 Pi summary 必须保留，不能无条件删除 compactionSummary。

### Error body timeout

`native-compaction.ts:1703-1713` 的 timeout 只等待 `fetch()` 返回 response。header 到达后该 timer 清除。非成功 response 随后在第 1721 行等待 `response.text()`，没有自己的 timeout；`catch(() => "")` 只处理 rejection，无法结束永不 settle 的 body。`finally` 中的 abort 也要等 body 读取返回才能执行。

候选修复应让非成功 body 的读取也具备明确 deadline 和取消机制，并保留外部 signal 的优先级。idle timeout 只能结束无进展的等待，持续到来的 chunks 可以不断重置它；若要限制整个错误 body 的读取时间，还需要总 deadline。本次探针证明的是后者。还应限制错误 body 大小，避免只修等待时间却留下无界缓冲。重试次数、retry-after、fallback eligibility 与成功 SSE 的现有规则应分别验证。

P7 的独立 reader 原型采用总 deadline。503/401 挂起、持续收到 chunks、外部取消、正常读完五种情形均按预期结束，timer 数归零且 reader lock 释放，deadline 和取消均中止本次 attempt。持续 chunks 也在总时限结束，证明它不是 idle timeout。原型保留 HTTP status 和 read outcome 两个字段，但没有替换生产 `callRemoteCompaction()` 的分类、retry 或 fallback 逻辑。因此只证明读取机制，不声称完整 transport 修复已经通过。401 在读取超时后仍应按认证失败处理，不能因统一 timeout 变成可重试网络错误。

## User occurrence and lifecycle

### Three different questions

当前 user occurrence 是某次 provider request 中，需要作为本次输入保留或从历史压缩输入中排除的具体消息实例。是否继续是 Pi 调度器决定要不要再发请求。任务完成是用户目标已经达成。后两者不能从某条消息的 `role` 或 `stopReason` 等同推出。

Pi `messages.js:75-115` 把 custom message、bash execution、branch summary、compaction summary 也转为 `role: "user"`。wire payload 不保留 `customType`、raw entry ID 或用户输入来源。插件的 `turn-boundary.ts` 识别 Codex 的上下文 wrapper，这不覆盖 Pi 的全部自定义消息语义。[Official source](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/messages.ts)

`session-coordinator.ts:269-309` 通过完整 prefix 比较和内部 userSources 关联识别最新 raw user，并要求它之后没有其他 context entry。这比只取最后一个 wire user 严格，但也会拒绝 user 后紧跟 custom/context continuation 的情况。修复须先定义这类消息由谁拥有，再处理它们的 retention，不能仅删除 eligibility 条件。

### Real scheduling semantics

| Observation | What Pi establishes | What it does not establish |
| --- | --- | --- |
| `turn_end.outcome === "completed"` | stopReason 不是 error/aborted；tool results 已完成并持久化 | 没有下一次请求；任务完成 |
| Assistant `toolUse` | agent loop 依据实际 tool calls 执行工具，通常继续 | 当前 user 已无须保留 |
| Assistant `length` | 带 tool calls 时，Pi 生成失败结果，不执行可能截断的参数；可触发恢复 | 已完成回答 |
| Assistant `stop` | 本次 response 正常结束 | 不会因 steering、follow-up、boundary continuation 再发请求 |
| Assistant `aborted` | 低层 loop 硬退出 | 用户目标结束；下一次 prompt 前无需压缩 |
| `agent_end` | 低层 loop 结束 | AgentSession 不会自动重试、overflow recovery 或接队列 |
| `agent_settled` | 当前 run 已无自动重试、压缩或已排队 continuation | 用户任务语义完成；未来不会恢复 |

依据为 agent-core `agent-loop.js:143-207`，AgentSession `agent-session.js:488-533,1500-1555`，以及 `extensions/types.d.ts:800-805,828-834`。`turn_end` boundary 和宿主 `finishTurn` 均可请求继续；steering 与 follow-up 分别在内外循环被读取。[Agent loop](https://github.com/earendil-works/pi/blob/v1.3.0/packages/agent/src/agent-loop.ts), [AgentSession](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/agent-session.ts)

普通 extension boundary 还有 `canContinue` 限制。stop 后若最终上下文仍是 assistant，且没有新增或排队消息，仅返回 `continue: true` 会被拒绝。`agent-session.js:616-633` 要求可继续的最终上下文或 pending context。因此 stop continuation 的探针必须实际提交 custom/context edit 或排队消息，不能把低层宿主 `finishTurn` 的无消息 continuation 能力误报为普通扩展能力。

### Compaction reasons

`manual` 先调用 `abort()`，再准备 branch 并发出 `session_before_compact`，固定 `willRetry: false`。因此 `willRetry: false` 并不表示历史中的最后一个用户任务已经完成，用户可以在中止后的未完成历史上手动压缩。见 `agent-session.js:2201-2233`。

`threshold` 也不只发生在任务结束。`_compactBeforeNextAssistantResponse():424-432` 在下一条 assistant response 前检查 threshold，并使用 `willRetry: false`。它可处于同一工具循环中。`_prepareRun():1449-1457` 还在新的启动 handler 之前检查上次 response，包含 aborted response 的预请求检查。

`overflow` 的 `willRetry` 由 `stopReason !== "stop"` 决定。Pi 可能对正常 stop 压缩而不重试，也可能对 error 或可恢复 length 压缩并重试。重试前 `_omitRecoveryAttempt()` 持久化省略该次 assistant 及相应工具结果。见 `agent-session.js:2362-2443`。插件不能在整个分支随意删除“最后一个 assistant”，而应对齐这次 recovery 已选定的 attempt 及其 context edits。

由此可以证明，存在比“最近一个 assistant 不报错”更可靠的运行完成观测；但宿主没有自动证明用户目标完成的事实。将 `agent_settled` 作为某种业务完成政策，或在恢复后把未知状态视为未完成，均应作为政策写明并持久化，而不是从旧 transcript 猜测。

修复不必以判定任务完成为前提。更窄的依据是这条 user occurrence 是否属于本次待发送输入，以及新 checkpoint 是否已经覆盖它。manual 或轮间 threshold 中，最近一条历史 user 可以继续属于未完成任务，却仍是可进入压缩历史的消息。只有明确绑定本次 provider request、尚未被 checkpoint 覆盖的输入，才有理由采用特殊排除和补回。若产品还要求进行中任务的原始用户文本始终全量可见，需要另外定义并承担 retention 成本。

P3 通过真实 extension handler 与真实 `prepareCompaction()` 复现了重复保留。同一条 280,000 字符 user 先进入正常 64k retention，截为 256,023 字符，随后 `index.ts:515-524` 因内容不相等又补入全量原文。manual/threshold fixture 的估算从 70,094 增为 134,037 tokens，overflow fixture 从 70,036 增为 134,037。三个 event 的 reason/willRetry 由探针构造，没有完整实测三条 SDK 自动调度链。

消除同一 occurrence 的截断版与全量版同时存在，是缺陷修复。两个不同来源但文本相同的 occurrences 则不是重复，不能按文本去重。P3-source-identity 用两个来源演示先按 source 排除 pending 输入，再做 retention、最后只补回一次全量输入；这是原则示例，尚未实现并验证实际 handler 修复。无条件保留未完成任务的全部原文是另一项产品政策，不能与消除重复混为一谈。

## Hidden declarations and forced prompts

### Observable transformations

hidden declarations projection 在全部前置 async context 变换后读取当前 hidden set，只过滤 system message 的 `toolsAdded/toolsRemoved`，不删除 message、非声明内容、call 或 output。forced prompt projection 随后把所有 system messages 折为一个 head，包含 forced text 与当前工具。见 `agent-session.js:1330-1365`。普通 `before_provider_request` 只有 `payload`，handler 按顺序 `await` 且可替换 payload。见 `extensions/types.d.ts:692-696` 与 `extensions/runner.js:1066-1093`。

这些是具体、可建模的宿主变换。它们不等于任意删除历史，因此不能因为缺少 hidden getter 就断言所有请求都无法由插件处理。反过来，实际 payload 也不自动给出压缩边界、隐藏原因或丢失的 source IDs。

### Sufficient condition for payload-based repair

需要唯一的是有效回放结果，而不是 hidden 集合或每个输出项的 source ID。

设受支持的宿主投影候选集合为 `C`。对每个候选 `c`，用完整 branch、已知模型转换规则和本次请求设置计算普通 wire 输入 `W(c)`，只保留与实际 payload 严格一致的候选。再用同一个候选和已知 checkpoint 边界计算应发送的有效回放 `Q(c)`，其中包括不透明 checkpoint 前缀、checkpoint 后 suffix、当前 user 的排除与补回决策。

满足以下条件时可以安全接受。

1. 候选集合非空，且覆盖本配置实际可能采用的宿主投影。
2. 比较涵盖完整 input 与相关 instructions/tools 格式，包括 `additional_tools`、tool-search、grammar，以及 converter compat；不能只比较顶层 tools 名称。
3. 所有匹配候选生成的 `Q(c)` 逐项相同。若当前 user 的来源不同但完全不影响 `Q(c)`，也无需拒绝。
4. 不改写或解密 checkpoint，不把不同历史内容视为相等；普通用户内容、工具 schema、未获授权的 system 改写仍触发严格失败。

例如，两个 hidden 集合只差一个在相关历史和当前工具中从未出现的名字，它们不是唯一集合，却可能产生同一有效回放。拒绝这种情形没有完整性收益。反之，若候选对 checkpoint 后 suffix 或当前 user 的处理不同，就不能仅挑一个能通过 prefix 的候选。

这是一组充分条件，不是对任意扩展的完备性证明。将“所有可能变换”缩为 hidden/forced 候选，必须有配置限制或明确适配契约支持。后加载的 payload handler 仍可能改变已校验结果，插件也需要已知执行顺序或终态验证点。

### Limits and indistinguishable worlds

Pi 允许 context handler 丢弃、改写或重排普通消息。若 raw branch 中有内容相同的两个 user occurrences，handler 只保留其中一个，两个执行可产生相同 wire user 内容，却对应不同 raw source。若这些来源位于 checkpoint 边界两侧，且其覆盖关系会改变有效回放，那么 payload 无法区分正确 suffix。这里真正失败的是 `Q(c)` 不一致；单纯 source 不唯一还不足以证明不安全。

同理，`convertToLlm()` 会把原始 custom 和真实 user 投影为相同形状。只看 wire role/content 不足以判断人的当前输入，但已知的完整、保序、未删改投影仍可通过位置与 source 关联精确匹配。这两个结论不冲突。

首次手动压缩是另一个信息问题。`compact()` 在 provider request 前不执行启动/context/provider 管线；任意 `prepareLoadout` 可以从普通扩展不可见的闭包决定隐藏。同一可见历史、active names、工具 metadata 和 system prompt 可以对应不同下一请求声明。双世界探针需要证明实际普通扩展观测相同，而后续真实 converter 输出不同。它只能证明这个配置族不存在纯观测的一般解，不能推出以下结论。

- 无 hidden/forced 且投影已受控的手动 compact 必须禁用。
- 已观察到有效请求、状态版本仍一致的手动 compact 必须禁用。
- 自有 SDK host 注入权威声明快照仍不够。
- 任何普通 before-provider payload 路径都无法修复。

这些路径是否支持，应按已证明的投影范围分别决定。缺能力时可以拒绝不确定的这一次操作；禁用全部 compact 是产品限制，不是此反例的逻辑结论。

## Retention budget

当前 `native-compaction.ts:20,1053-1104` 按白名单从新到旧保留最多 `64_000` 估算 tokens 的用户消息及部分 agent messages，再追加 compaction item。`remote-compaction.ts:145` 将这个结果保存为 replacement history。因此它不是 transport 限流参数，而是压缩后哪些原文继续可见的语义。

动态 retention budget 可以按照模型上下文、instructions/tools、compaction item、必须保留的当前输入和输出余量计算可用空间，并以 64k 为上限。它可以避免小窗口、模型下调或大型当前输入下的固定保留过大，但会更早截断旧用户原文，改变当前 migration 的 Codex retention 行为。不能把动态预算称为完全兼容的纯 bug fix。

预算还须按最终实际请求验证。encrypted compaction 的长度只有远程返回后才知道，当前用户的补回也发生在 replacement 构建之后；对预压缩输入估算一次不够。估算低于窗口只说明本地模型认为放得下，不能证明服务端 tokenizer 与上下文计费一定接受。超长单条当前输入无法靠缩减旧 retention 必然解决。

P6 的真实 coordinator fixture 中，窗口为 128,000，effective window 为 121,600。checkpoint 后唯一新增项是被识别为当前输入的 280,000 字符 user，no-tail gate 因排除该项而跳过自动压缩判断，`shouldAutoCompact` 与 remote compaction 均为 0 次，最终请求估算为 134,027。修复入口必须看完整待发送请求，而不能只看压缩历史是否有新增尾部。

同一探针还否定了简单预算公式的充分性。按前缀、opaque item 与当前输入相减，得到 retention budget 51,563；实际重新组装后仍为 121,622，比目标多 22。retention 的内部计费、截断标记与完整请求 envelope 的计费不完全相同。再减 22 并重建后为 121,600，历史原文由 255,900 缩至 206,188 字符。这个单例证明最终复查不可少，不是通用预算算法证明。生产候选仍需有限缩减、无进展终止和无法容纳当前输入时的明确行为。

固定 64k、动态上限、当前输入全量保留或允许截断，以及输出余量取值，均需要明确选择。可证明的验收应报告保留了哪些原文、最终估算值以及对不同窗口的行为，不只检查返回数组长度。

## Snapshot and asynchronous commit

插件已有 generation、session/model、signal 与 conversation leaf 检查，例如 `session-coordinator.ts:1043-1059` 在自动压缩远程返回后验证再保存。`index.ts:486-514` 的 Pi compaction 路径检查 lifecycle generation 与取消信号。不能因此声称没有并发保护。

仍需核验声明/投影版本。工具可在 await 期间注册、改写描述、隐藏或重新显示，而 branch leaf 不一定变化。操作开始应固定不可变的 tools、hidden/forced projection、模型与 branch/context-edit 状态，并给请求使用的快照单独关联。实时 getter 在 await 后返回的新状态不能套回已生成的旧 payload。

提交前至少比较 session/runtime generation、branch/context-edit 修订、model、声明与 prompt 投影修订、signal。远程结果、hash/metadata 查询和 auth 都是 await 边界。若版本变化，应取消或基于新快照重算，不能把旧结果提交到新状态。checkpoint append 之后再发现不一致，只能判定 receipt 无效，不能算作防止错误提交。

P4-await-snapshot 在真实 SDK 的 `before_provider_request` handler 内先复制 branch、tools 与 payload，经 await 后重新注册 hider 并改变隐藏策略。branch 完全不变，live tools metadata 改变，原 payload 保持不变且仍声明 victim；下一次请求才隐藏 victim。这证明 branch leaf 或 live getter 无法代表旧请求的声明快照。实验未进行远程 compaction，也未实现版本化提交 guard，不能据此宣称迟到 checkpoint 已被安全拒绝。

`prepareCompaction():1164-1181` 等待 active transition 后只检查 signal，没有自行核验 session/model/generation；调用者可能有外层保护，但新增声明状态必须沿完整调用链传递。`createBranchInputSnapshot()` 只对 branch 数组作浅复制，不等价于所有嵌套对象都已冻结。是否需要 deep clone 取决于宿主是否原地修改已入库对象，应通过目标竞态验证，避免笼统承诺。

## Offline proof results

探针使用实际安装的 Pi `1.3.0`、真实 `SessionManager`、`AgentSession`、`DefaultResourceLoader` 与 Codex provider serializer。credentials/models store 为内存实例，关闭资源自动发现、模型联网、retry 和 cache warming。普通 converter 探针在 `onPayload` 截获真实 payload 后主动终止，SDK 请求与 compaction 只接收合成 SSE。默认全局 fetch 抛错，意外网络计数为 0。没有读写真实用户会话、访问真实模型或验证 encrypted content。

| Evidence | What ran | Result and limit |
| --- | --- | --- |
| P1-native / ordinary-then-custom / overlap | 真实 compaction preparation 与 session projection，候选对照真实 serializer | 原 pi-context 多出 developer item；候选 input 完全一致，system baseline 和 userSources 保留。来源证明限这 3 种结构 |
| P1-ordinary-summary-control | 普通 Pi compaction，没有自有 V2 checkpoint | 普通 summary 保留；不允许无条件删除 compactionSummary |
| P2，8 cases | orphan、真实 result、并行部分 result、两条 system updates，分别走 additional-tools 与 tool-search | 原顺序不一致；使用官方 transformMessages 排序的候选 input 连同 IDs 完全一致，未重复 result |
| P5，4 cases | 从生产源码隔离生成一行条件修正候选，输入真实 grammar tool 格式 | foreign fc 与 same-model fc 修复；same-model ctc 保留、cross-model ctc 清空的原有正例继续通过 |
| P3-manual / threshold / overflow | 实际 extension handler，实际 prepareCompaction，合成 HTTP 响应，构造 reason flags | 同源长 user 的截断版和全量版重复保留。不是完整 SDK 三入口调度实测 |
| P3-source-identity | 数组级来源排除示例 | 相同文本但不同来源可分别保留，pending 全量只有一份。尚未集成生产 handler |
| P3-stop-then-continuation | 真实 SDK `agent_before_settle` append custom_message 并请求继续 | 发出 2 次请求、得到 2 次 stop/completed，仅最后 1 次 agent_settled。不能以首个 stop 判定 run 已结束 |
| P6-complete-budget | 真实 coordinator no-tail gate 与离线最终预算算术 | 最终请求超窗却未进入 auto decision；简单动态公式仍差 22 tokens，组装复查后单例拟合 |
| P7-stalled-error-body | 实际 callRemoteCompaction，503 headers 后 body 永不结束，虚拟推进 timer | 推进 1,000,000 ms 后仍未 settle，只有 1 次请求；外部 abort 后释放 |
| P7-candidate，5 cases | 独立总 deadline reader，覆盖挂起 401/503、持续 chunks、取消、正常读完 | outcome/status 正确，timer=0、reader lock 释放；未集成 HTTP retry/fallback classifier |
| P4-first-manual / indistinguishable-manual | 两个真实 SDK session，同 seed，闭包分别隐藏或显示 victim/late | compact 时全部收集的普通 API 观测 deepEqual，均无 payload；后续请求声明分别为 hider 与 hider/victim/late |
| P4-equivalent-replay-hidden / forced / both | 真实 SDK 生成目标请求；有限 hidden/forced 候选通过真实 serializer 全 wire 比对 | 每种模式均有 2 个合法策略、1 个有效 replay；用户改写、工具描述改写、删除历史 user、调换 user/assistant 顺序均无候选；现有 coordinator 仍报 prefix mismatch |
| P4-arbitrary-hook-ambiguity | 真实 ExtensionRunner context_with_system hooks 在同一 branch 分别选边界前后同文 user，再用真实 serializer 比较 | wire 相同而期望 replay 不同，确认任意 hook 不属于 hidden/forced 有限候选模型 |
| P4-await-snapshot | 真实 SDK 的异步 provider handler 内 re-register 工具并启用隐藏 | branch 不变、live 工具变、旧 payload 不变、下一请求隐藏 victim；未验证远程提交 guard |

P4 候选验证器是证明用的 bounded oracle，不是生产算法。工具 universe 最多 5 个，穷举 hidden subsets 与 forced boolean；fixture 只有单调新增工具，没有 arbitrary context edits、描述 hook 改写、removal/redeclaration 或跨 checkpoint 的 pending tool group。forced 候选把实际 instructions 作为当前请求的权威 prompt，再比较完整 input/instructions/tools。这不能独立证明 instructions 未被篡改，也不能证明任意历史 system 删除都会被拒绝，因为受支持的 forced projection 本来就折叠全部 system messages。若产品要求校验 prompt 来源，还需单独的可信 prompt 契约。

已知 raw checkpoint entry index 用于精确计算 prefix，prefix 本身也逐项验证。`Q(c)` 的 input 相同，instructions/tools 复用与候选一致的实际 payload。穷举是指数复杂度，不能把本实验直接迁入生产并声称可扩展。

这些实验证明独立插件在受控范围内存在保持严格比较的修复方向，也证明首次请求前的一般性观测限制。它们尚未给出支持任意扩展、任意声明策略与全部 checkpoint 结构的生产实现。

## Reproduction and repository validation

在仓库根目录依次执行，probe 会将临时文件写入本仓库 `.tmp/codex-compact-repair-proof/`。

```sh
pnpm run build
pnpm exec node prototypes/codex-compact-repair-proof/run.mjs
pnpm run check
```

`pnpm run check` 已完成，退出码为 0。日志 `.tmp/codex-compact-repair-proof-check.log` 包含 181 个测试文件通过、4 个跳过，2,699 个测试通过、13 个跳过；typecheck、build、package check 均通过。host check 实测 Pi coding-agent/ai/agent-core/tui 全部为 `1.3.0`，source 与 dist 各加载 8 个 extensions，`loadErrors` 均为 0。已有 `/mcp` command replacement warning 仍有输出，它不是此次检查失败。该检查验证仓库没有回归，不等于隔离候选已经集成生产修复。

## Implementation decision

生产修复应分别集成已经完成隔离验证的 ordered converter、grammar ID、source-preserving projection 和 bounded error-body reader，再验证组合后的行为。hidden/forced repair 仅在候选模型完备且有效回放结果一致时接受。current-user retention 应按消息消费阶段、来源和 checkpoint 覆盖处理，不能依赖“任务已完成”的猜测。动态 retention 属于有行为成本的独立决策。所有异步提交都应携带并核验同一投影快照。

## Source index

| ID | Local source | Fixed official source |
| --- | --- | --- |
| S1 | `node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js:63-212` | [transform-messages.ts v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/ai/src/api/transform-messages.ts) |
| S2 | `node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js:63-280` | [openai-responses-shared.ts v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/ai/src/api/openai-responses-shared.ts) |
| S3 | `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:166-279` | [session-manager.ts v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/session-manager.ts) |
| S4 | `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:424-550,1299-1365,1449-1555,2201-2233,2362-2479` | [agent-session.ts v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/agent-session.ts) |
| S5 | `node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js:75-123` | [messages.ts v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/messages.ts) |
| S6 | `node_modules/.pnpm/@earendil-works+pi-coding-agent@1.3.0_*/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:79-207` | [agent-loop.ts v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/agent/src/agent-loop.ts) |
| S7 | `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:692-696,780-805,828-834`; `runner.js:1066-1093` | [types.ts v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/extensions/types.ts), [runner.ts v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/src/core/extensions/runner.ts) |
| S8 | Context7 `/earendil-works/pi/v1.3.0`, compaction/lifecycle query | [coding-agent compaction](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/compaction.md), [agent README](https://github.com/earendil-works/pi/blob/v1.3.0/packages/agent/README.md) |

仓库源码引用均位于 `extensions/codex-compact/src/`，固定基线见首节。报告不包含真实远程 compaction、服务端 encrypted checkpoint 校验、真实 MCP 后台连接或生产部署的验证结果。
