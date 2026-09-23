# Codex compaction projection fixes

## Understanding

2026-09-23 复审补充：`11c5cb1` 已修复本文基础路径和普通压缩上下文问题，但 T5 未覆盖“长历史被裁剪后立即再次压缩”的组合，原第 1 项仍有残余。本次剩余工作的唯一设计及 Todo 见 [request continuity fix](codex-compact-request-continuity-fix.md)。本文原执行记录保留为历史证据，不代表残余已修复。

在 Pi 0.87.0 上修复两个已复现的兼容性问题：编辑后的当前 user 被历史压缩裁剪，以及重叠普通压缩中的旧摘要使自动压缩判断被跳过。同步把本次涉及的投影、请求身份和历史排除收敛到明确的内部接口。本文是 expert 确定的实施设计及唯一 Todo 来源，基于 `0797d97c0b1885f9565a12a412d67afcee082430`，设计版本 1。

本轮实现长期方案中直接服务于上述修复的部分：带源身份的投影、三种明确的输入视图、每个同步阶段共享快照、Pi 投影兼容性测试。检查点持久化源 ID、失败标记内容匹配算法和无关 token accounting 重构不在本轮范围。

## User Visible Changes

- 最后一条尚未回答的 user 经 `context_edit` 替换后，即使替换内容超过 64k 历史保留预算，自动压缩仍完整保留本次请求；实际请求中的完整内容在压缩后的请求中只出现一次。
- 两次普通压缩的保留范围重叠时，切换到 Codex 后不再因旧摘要而跳过扩展的自动压缩判断；自动、手动压缩使用的当前上下文均不包含已被 Pi 排除的旧摘要。

## Evidence

2026-09-23 在基线源码和已安装 Pi 0.87.0 上，用真实 `SessionManager.inMemory()`、`streamSimple(...).onPayload` 序列化、`createSessionCoordinator()` 和 `buildReplacementHistory()` 完成四个临时对照测试，均验证了预期的故障或正常表现。远端 checkpoint 用固定 opaque 字符串替代，未发在线请求。临时测试已删除，以下是必须保留的结果和可重建输入。

| Case | Input | Observed result |
| --- | --- | --- |
| 未编辑当前请求 | `previous history`，再追加长 user | 当前 user 不进入压缩；`preservedInput` 长度 1；最终请求完整且含中间约束 |
| 编辑当前请求 | `previous history`，追加 `original task`，用 edit 替换成长正文，不追加 continue | 当前 user 进入压缩；`preservedInput` 长度 0；最终正文不完整且中间约束消失 |
| 普通压缩不重叠 | U1 → C1，保留 U1 → U2 → C2，保留 U2 → 切换 Codex → U3 | Pi 和插件均无 C1；自动判断 1 次、压缩 1 次 |
| 普通压缩重叠 | 同上，但 C2 保留 U1 | Pi 无 C1，插件回放及手动输入含 C1；自动判断 0 次、压缩 0 次，prepareRequest 返回 undefined |

长正文为 `"start ".repeat(30_000) + "MIDDLE_CONSTRAINT_MUST_SURVIVE" + " finish".repeat(30_000)`，共 390,030 字符。协调器探针把 `shouldAutoCompact` 固定为 true，隔离调度条件；正式验收还须覆盖下面 T3 的真实调度路径。

故障依据：`session-coordinator.ts` 的 `branchBeforeCurrentUser` 和 `preserveCurrentUser` 比较原始正文；`native-compaction.ts` 的 `piContextInputForBranch` 把整个 retained range 交给 `projectBranchMessages(..., true)`；后者贡献全部 compaction。Pi 0.87.0 `buildSessionProjection` 则只让最新 compaction 贡献消息。

权威源码：[Pi 0.87.0 session-manager.ts](https://github.com/earendil-works/pi/blob/v0.87.0/packages/coding-agent/src/core/session-manager.ts#L505)、[Pi 0.86.0 session-manager.ts](https://github.com/earendil-works/pi/blob/v0.86.0/packages/coding-agent/src/core/session-manager.ts#L454)。本地对应实现位于 `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js`。Context7 已查询，但未提供该版本具体分支，以上固定 tag 和已安装包为依据。

基线 `pnpm run check` 通过，2437 项测试通过、12 项跳过，类型检查、构建、发布包检查通过。这证明现有测试集正常，不证明两个新边界已覆盖。该结果不能倒算为修复验收。

## Design

### D1. Scope and responsibilities

| File | Change |
| --- | --- |
| `extensions/codex-compact/src/session-projection.ts` | 增加保留 sourceEntry/sourceIndex 的投影快照；明确 full-history 与 pi-context；保留无第二参数的 `projectBranchMessages(entries)` 作为完整历史恢复兼容入口 |
| `extensions/codex-compact/src/native-compaction.ts` | 转换结果增加内部 user item → source entry ID 对应表；构建并缓存 full-history、pi-context、effective 三种视图；排除消息贡献而不删除原始 entry |
| `extensions/codex-compact/src/session-coordinator.ts` | 统一当前请求解析；移除原始正文识别和重复识别；所有自动、转换、恢复及最终回放调用点按源 ID 选择消息；保留现有异步控制流程 |
| `extensions/codex-compact/src/index.ts` | 完整历史恢复入口仅按新签名接入。允许为测试暴露现有依赖注入接缝，不新增用户配置或行为 |
| 对应 `__tests__/session-projection.test.ts`、`native-compaction.test.ts`、`session-coordinator.test.ts`、`responses-parity.test.ts`、`index.test.ts` | 按 T1–T6 增加或调整测试，尽量复用现有 fixture |
| 本文 | 勾选完成的 Todo，在 How To Test 下记录实际验证结果、命令和边界 |

不修改依赖、checkpoint version、64k 保留预算、远端请求协议、Fast Mode 或 subagent。`dist/` 仅由构建生成。保留现有 public helper 返回 `ResponseItem[]` 的签名，新增带来源接口供协调器内部使用。

### D2. Projection snapshot

在 `session-projection.ts` 提供如下内部契约，命名可以做局部调整，职责与字段含义保持一致：

```ts
type ProjectedBranchEntry = {
  sourceEntry: SessionEntry;
  sourceIndex: number;
  messages: ProjectedSessionEntry["messages"];
};
type BranchProjectionSnapshot = {
  branch: readonly SessionEntry[];
  sourceIndexById: ReadonlyMap<string, number>;
  fullHistory(): readonly ProjectedBranchEntry[];
  piContext(): readonly ProjectedBranchEntry[];
};
function createBranchProjectionSnapshot(branch: SessionEntry[]): BranchProjectionSnapshot;
```

输入已是调用方选定的线性分支，可能经过失败请求过滤；不是包含其他分支的整个 session。创建时浅拷贝数组，消息内容按只读使用。通过新 `context_edit` 更新的 append-only 语义允许同步阶段内复用内容对象。不要修改来源 entry、message、parentId 或 details。

`fullHistory()` 保持现有完整恢复语义：对输入全段按顺序收集最后一次 edit，忽略 compaction 消息贡献，其他 entry 用 `sessionEntryToContextMessages` 转换，应用 replacement/null；assistant/toolResult 的 string replacement 转为 text block。输出按原分支顺序，空贡献仍保留 sourceEntry。用 Map 收集 edits，不能逐条重新扫描分支。

`piContext()` 调用上游 `buildSessionProjection`。为兼容现有已过滤的线性分支和旧测试中断开的 parentId，先生成顶层浅拷贝的临时 entry 数组，把 parentId 指向本数组前一项，首项为 null，显式以末项 ID 为 leaf。只在这份私有影子数组中重建关系。上游输出 sourceEntry 按 ID 映射回原始对象和 sourceIndex。空分支直接返回空数组。输入是已选定路径，因此此适配不会选择其他 session 分支；禁止把全树传入此接口。

上游负责普通压缩选择、保留区间、旧 compaction 排除、system checkpoint 和该上下文中的 edit 范围。由 full-history 处理完整恢复，不将其 edits Map 强加给 pi-context。两种视图不必包含相同的历史。

当前请求和 `excludeLastAssistantError` 的排除发生在快照完成后：仅把指定源 ID 的消息贡献置空。保留 sourceEntry 和原有 sourceIndex，包括 firstKeptEntryId 指向该 ID 的情况。`findNativeCheckpoint` 和会话叶节点检查始终读取未做本次请求排除的分支。

### D3. Response conversion and named input views

在 `native-compaction.ts` 新增内部结果和工厂：

```ts
type ResponseInputView = {
  items: ResponseItem[];
  userSources: ReadonlyMap<number, string>;
};
type InputViewKind = "full-history" | "pi-context" | "effective";
type InputViewOptions = {
  excludeEntryId?: string;
  excludeLastAssistantError?: boolean;
  allowCheckpointModelMismatch?: boolean;
};
function createBranchInputSnapshot(params: {
  branch: SessionEntry[];
  tools: ToolInfo[];
}): {
  projection: BranchProjectionSnapshot;
  checkpoint(model: Model<any>): CheckpointLookup;
  view(model: Model<any>, kind: InputViewKind, options?: InputViewOptions): ResponseInputView;
};
```

`userSources` 的 key 是 items 的实际索引，value 是产生该 user item 的原始 entry ID。摘要或 custom 消息转出的 user 也记录真实源 ID，避免把它们当成真实用户。native prefix 中的旧持久化 ResponseItem 没有源身份，不填映射，也不根据正文猜 ID。

转换 projected entries 时，对每项调用 `convertToLlm(messages)`，将每个 user message 浅拷贝成该次源贡献独享的对象，把这个对象与 source ID 存入同步局部 WeakMap，再把它们按原顺序一起交给现有 Responses 转换器。浅拷贝只复制 message 外壳，content 保持引用；这样两个 entry 即便共享同一个原始 message 对象，也不会互相覆盖来源映射。Pi 0.87.0 的 `convertToLlm` 是逐项映射，`normalizeContext` 和 `resolveTranscript` 对 user 对象保留引用，已核对 `dist/core/messages.js` 和 `pi-ai/dist/utils/transcript.js`。在 `messagesToResponseItems` 真正 push user item 的位置记录当前 items 索引；空 user 未产生 item 时不记录。无需给 assistant、合成 tool output 或所有响应项目建立来源，也不往 wire item 增加 id 或私有字段。

保持 existing messageIndex、tool ID、orphan tool output、system/tool updates 的转换顺序。native tail 仍先转换必要的完整历史来维持 messageIndex/tool pairing，再按原有 skipMessages 语义取后缀；同步移动 userSources 索引。不能逐条独立调用 Responses 转换器再拼接，那会重置 tool 配对和 assistant ID。

三种视图如下：

| Kind / checkpoint | Rule |
| --- | --- |
| full-history | 投影全部原始分支，应用 edits，所有 compaction 无消息贡献 |
| pi-context / none | 最新普通 compaction 的 firstKeptEntryId 有效时使用标准 Pi 投影；没有 compaction 时等于 full-history；既有损坏 firstKeptEntryId 路径继续回退 full-history |
| pi-context / invalid or bypassed | 保持当前完整历史恢复行为，使用 full-history |
| pi-context / valid native | 保持现有 `piContextInputForBranch` 的 retained-tail 兼容路径：以 native compaction 自身 firstKeptEntryId 或 custom checkpoint 之前最近普通 compaction 的 firstKeptEntryId 选区间，从该原始索引到当前分支末尾；该区间应用 edits，忽略所有 compaction 贡献；边界缺失继续 full-history。此路径不是普通压缩的 canonical Pi 视图，不改变其 existing matching 用途 |
| effective / valid native | 保留 model mismatch 校验；prefix 为克隆的 replacementHistory + preservedInput，接上原分支在 native entry 后的投影贡献，维持原 skipMessages 转换方式；prefix 没有 source ID，tail 来源索引增加 prefix 长度 |
| effective / other | 复用同一快照的 pi-context 结果 |

普通 compaction 的 retain-none，即 firstKeptEntryId 等于自身 ID，由 Pi 标准投影处理。对于 valid-native 区间局部投影，保持旧实现只读取选定区间 edits 的语义；这与 full-history 全段 edits 的目的不同。sourceIndex 始终来自快照原数组，而非选区间后的索引。

`fullInputForBranch`、`piContextInputForBranch`、`effectiveInputForBranch` 对外仍返回 `.items`，内部用上述工厂。删除 `entriesToResponseItems` 的 includeCompactionSummary 布尔模式，改为接收明确选好的 projected entries。`excludeLastAssistantError` 仍按旧实现选择最后一个原始 assistant entry，不在本次改写该 flag 的含义。

### D4. Resolve the current request once

用一个解析器替代 `branchBeforeCurrentUser()` 的正文比较，并将结果传入保留逻辑。解析在 request failed-input 清理之后进行，requestIndex 以清理后的数组为准。

```ts
type CurrentRequest =
  | { kind: "branch"; entryId: string; requestIndex: number; item: ResponseItem }
  | { kind: "checkpoint"; requestIndex: number; item: ResponseItem }
  | undefined;
```

解析步骤：

1. 没有 requestInput 或没有 user 时返回 undefined。
2. 候选源是原始分支最后一个真实 user message entry。保留现有保护：其后若有 message/custom_message 原始记录，则不认定它为未回答的当前请求；context_edit 和 custom state 不是阻碍。候选被投影省略或为空时不能绑定它，也不能后退到更早的同文 user。
3. 按现有 requestTail 候选顺序，取得未排除当前请求的 history-model effective、pi-context、full-history，再取得 current-model 三视图。两个 model `isDeepStrictEqual` 时复用。对每种视图同时接受原视图或现有 systemPromptInput 前缀形式。
4. 只有整个候选视图与实际 requestInput 前缀深度相等时，才使用该视图的 userSources 对应关系。必须映射到步骤 2 的源 ID，且其 requestIndex 等于实际 payload 最后一个 user 索引，才能绑定 branch。若 payload 在这个源出现之后又追加一个同文 user，最后一个 user 没有此来源，返回 request-only，即 undefined。多个可匹配视图若把当前 user 映射到不同源，则不绑定，进入现有 mismatch 处理；不要依靠内容相同选一个。
5. 有 valid native checkpoint 时，位于该 checkpoint 之前的源 user 不能作为 live branch 绑定。可以用现有 `checkpointPreservedCurrentUser` 认定 checkpoint 中已保存的当前请求，返回 checkpoint 类型；保留它对无后续 context entry、user 次数及完整 content 的检查。这是旧会话兼容分支，不伪造 source ID。
6. 无法建立对应关系时不从原始正文猜测。后续 `requestTail` 仍执行已有前缀校验，valid checkpoint 的错误、bypassed 的窗口校验、pending transition 的恢复路径和无 pending 时保留原请求的行为均保持。

对于 branch 绑定，以 `excludeEntryId` 选择历史视图；对于 checkpoint/undefined 不排除源消息。内容比较在这套规则中是 wire 匹配校验，身份来自 userSources。没有 source ID 的额外 payload user 保持在 tail 中。

### D5. Preserve and deduplicate the exact occurrence

压缩前解析好的 CurrentRequest 必须传入对应 createCheckpoint 后的保留步骤，不重新比较 raw user 正文。

- branch：总是向新 details.preservedInput 追加实际 request item 的 structuredClone。当前源已从本次 compaction input 排除，即便历史中有相同正文也必须保存这一次出现。
- checkpoint：该请求本来就在 native prefix 中，允许再次进入压缩。若新 replacementHistory 或 preservedInput 已完整含有这一请求，保持一份；否则追加完整 item。完整判定必须同时满足 `sameUserOccurrence(item, current.item)` 和 `isDeepStrictEqual(item.content, current.item.content)`。sameUserOccurrence 遇到相同 wire id 即返回 true，而裁剪会保留 id，所以它单独不能证明正文完整。
- undefined：不额外追加当前请求，由已匹配的 tail 保存 payload-only 项。pending mismatch recovery 的 `preserveRequestUser` 仍按现有流程执行。

保留 `appendPreservedInput` 的复制语义。新增设计不改变 `buildReplacementHistory` 的 64k 白名单和裁剪算法。

同一次 prepareRequest 记录初始 tail 在 cleaned requestInput 中的起始索引，即 `requestInput.length - tail.length`。若本次 branch 绑定被压缩写入，最终 valid checkpoint 位于该源之后，且其 replacementHistory/preservedInput 中确实存在与绑定 item 同一 occurrence 的完整 user，则从 tail 只删除该 requestIndex 对应的一项。完整性也必须同时比较 occurrence 和 content。用索引删除，不按文本删除所有相同项。若本次未成功保存，就保留原 tail。

这条本次请求的索引规则优先于 legacy checkpoint 推断，避免历史用户被 64k 裁剪后 requestUserCount 大于 checkpointUsers 而无法去重。对没有 branch 绑定的旧 checkpoint 回放，继续用现有 checkpointPreservedCurrentUser + sameUserOccurrence 去重，保持带 wire id 的重复正文测试。

### D6. Integration and lifecycle

`prepareRequest` 初始阶段在清理 failed requests 后创建一个 input snapshot，生成未排除视图用于解析 CurrentRequest，再使用同一快照的排除视图完成 historyInput/rawHistoryInput/piContextInput 和 requestTail。最初建立的 branch occurrence 可保留用于最终 tail 去重，不能用于读取 await 后的新历史内容。

`runTransition` 的每次 attempt、`recoverCurrentModel` 的每个实际读取阶段、自动压缩开始阶段以及最终回放阶段，都从当时的 deps.getBranch 建立新快照并重新解析当前身份。工具格式仍由 toolsWithRequestFormats 取得。每个 createCheckpoint 使用与该次保留判断相同的快照和 CurrentRequest。

必须逐一替换原 `branchBeforeCurrentUser` 的调用点：runTransition 输入和 fallback、recoverCurrentModel downshift 估算与 previousModel 缺失分支、prepareRequest 初始匹配、自动输入、bypassed 回放和最终 effective 回放。preserveCurrentUser 改为消费解析结果。删除不再使用的原始比较路径，不能保留一个备用 raw-content 实现。

`hasBranchTailAfterCheckpoint` 可以继续检查原始分支，但要接受可选 excludeEntryId，避免被排除的当前 user 单独触发“checkpoint 后有历史”的判断；原 isContextEntry 范围保持。checkpoint lookup 不使用过滤后的临时分支。

`prepareCompaction` 没有 requestInput，不识别或排除当前 user，按最新快照读取 effective 输入。普通压缩旧摘要因此自然被排除。

继续使用 generation、conversationLeafId、ensureCurrent/ensureRequestCurrent、AbortSignal 和 per-session promise map。同步缓存不能跨 await 读取变更后的历史；迟到结果、会话切换、模型切换和 abort 的写入限制、重试次数、异常分类保持。现有 failed-request 标记清理规则保留，输入到 projection adapter 的是其已选择的线性分支。

### D7. Cost and cache lifetime

设 n 为选定分支 entry 数，B 为实际转换正文总量。投影扫描和来源索引为 O(n)，正文转换及 wire 深比较为 O(B)，输出本身允许 O(n+B) 空间。采用浅层 source 引用和 Map/WeakMap，避免为了传 source ID 深拷贝整段长正文。

一个 input snapshot 内 full-history、canonical pi-context 和必要的 native retained-range projection 各最多构造一次，按需构造。checkpoint lookup 按 target modelKey 缓存，每个目标在该 snapshot 最多扫描一次；下一 snapshot 重新查找。每个 `(model semantics, kind, excludeEntryId, excludeLastAssistantError)` 序列化结果最多计算一次。`effective → pi-context`、没有 compaction 时的 `pi-context → full-history` 和其他相同语义回退直接复用结果。allowCheckpointModelMismatch 是校验开关，不得因缓存绕过禁止 mismatch 的调用。

模型不能只按 modelKey 分组，因为相同 ID 可以有不同 compat；沿用协调器 isDeepStrictEqual 的等价判断，其余按本次 snapshot 持有的模型对象区分。tools 在 snapshot 创建时固定。不创建 session/global 缓存，不累计不同请求正文。

这允许同一阶段为未排除和排除版本分别转换，但禁止逐个源 entry 重建整段 Pi projection，禁止 preserve 阶段再次完整解析同一快照。没有依据设置机器相关毫秒阈值，使用 T6 的确定性调用次数和增长约束验收。

## Todo

- [x] 按 D2 在 session-projection 建立带来源的两种投影，保留完整恢复入口，完成 T1 与 T6 的投影部分后勾选。
- [x] 按 D3、D7 收敛 native-compaction 的三种输入视图、来源映射和同步缓存，保持 wire 格式与 checkpoint 兼容分支，通过 T2、T5 及 T6 后勾选。
- [x] 按 D4–D6 修改协调器全部当前请求相关调用点，按源 ID 排除并完整保留实际请求，按出现位置去重，通过 T3、T4、T5 后勾选。
- [x] 清理被替代的内部布尔模式和 raw-content 当前请求判断，核对完整恢复调用方及文档引用；按最终验证记录结果，工作区只保留任务交付物。

## How To Test

各实现项先按对应目标写一个失败测试，确认失败来自目标行为，再实现到通过并跑相邻测试；随后处理下一场景。重构已有转换器前保留或补充行为保护测试。不得把断言改成复现 bug 的表现来取得 Green。

### T1. Projection semantics

在 `session-projection.test.ts` 用真实 `SessionManager.inMemory(process.cwd())` 创建 branch，逐次追加 user/assistant/tool/custom、重复 edit 和 null edit。pi-context 的 message 数组和每条 sourceEntry ID 与真实 sm.buildSessionProjection 完全相同；full-history 应保留压缩边界前的已编辑消息且无 compaction 摘要。补上 C1/C2 重叠及不重叠、retain-none、systemMessage checkpoint、旧 system entry 排除、当前源正好是 firstKeptEntryId 的情况。

测试输入数组和原始 entry 的 parentId/content 未变化。另测过滤一个中间 failed-user 后的线性输入，影子路径仍包含其后的 entry；不通过修改生产 session 的 parentId 修复测试。测试排除当前源贡献后仍保留其后的 context_edit 和 compaction 边界。

### T2. Ordinary compaction and source mapping

在 native-compaction 和 responses-parity 测试中，真实 session 创建 U1/C1/U2/C2/U3，其中 C2 保留 U1。用 Pi `convertToLlm(sm.buildSessionProjection().messages)` 进入真实 provider 序列化，捕获 onPayload 后立即抛出固定测试异常停止网络。可复用 `responses-parity.test.ts` 中 streamSimple/getBuiltinModel/测试 token 构造方式。断言插件 pi-context 与真实 payload.input 相等，仅 C2 贡献摘要，full-history 仍有 U1/U2/U3 且无 C1/C2 摘要。

userSources 必须定位到真实 user、custom 和摘要各自的源 ID，空消息不占错索引；两个 entry 引用同一个 user message 对象时，仍分别映射到各自 ID；native prefix 不伪造来源，tail 索引加上 prefix 长度。每一 wire item 与原 provider 格式一致，没有来源私有字段。现有 tool 配对、动态工具声明和 assistant messageIndex 测试继续通过。

### T3. Edited current user and real automatic compaction

先在 session-coordinator 加入 Evidence 中 390,030 字符的 edited-current 场景，与未编辑对照，输入从真实 provider 序列化取得。仅替代 createCheckpoint 的远端结果，实际调用 buildReplacementHistory。强制 shouldAutoCompact=true。断言 compaction input 不含当前任务；checkpoint.preservedInput 完整等于原请求当前 item；最终请求包含中间约束且当前任务完整出现一次。无需检测或推断 opaque checkpoint 内部语义。

再在 index 测试建立离线跨组件路径：真实 SessionManager、真实 provider onPayload → 注册的 before_provider_request → 真实 coordinator、scheduler、createNativeCheckpoint 与 SSE 解析 → checkpoint append 回同一个 SessionManager → 最终返回 payload。复用现有 stubSuccessfulCompaction，但 appendEntry spy 必须实际调用 sm.appendCustomEntry，不能只有 spy。模型保留有效内置 Codex 模型属性，测试中将 contextWindow 设为 1,000,000，ctx.getSystemPrompt 返回 1,000 个 ASCII 字符。隔离配置读取，让 loadConfig 返回 `{ autoCompactScope: "total", autoCompactTokenLimit: 100 }`，这属于有效的用户配置，替代边界仅是配置文件 IO。真实 provider 序列化时传入该 system prompt，使实际 instructions 前缀超过已配置自动阈值。这样两个 current-user 对照都能在排除当前任务后触发真实 scheduler，长请求本身不会成为唯一触发原因，且请求大小低于模型窗口。

在 fetch 接缝只返回合法 compaction SSE，记录实际提交 body.input；不得替换 scheduler 或固定最终 payload。断言仅一次远端压缩、压缩输入不含当前任务、最终任务完整且只有一次、ctx.abort 未调用。测试在 onPayload 返回或捕获修改后的 payload 后立即终止普通模型网络。所有输入均为合成文本，不读取真实凭证，不写全局配置。

### T4. Overlapping compactions and matching control flow

真实 SessionManager 生成 Evidence 中两组普通压缩，并执行 selectModel，从非 Codex 切入 Codex，无 valid native checkpoint、无 pending native model transition。协调器 fixture 用应返回 true 的 shouldAutoCompact 计数器，输入由真实 Pi projection/provider 产生。重叠与不重叠两组均断言判断执行 1 次、createCheckpoint 1 次；压缩输入无 C1，当前 U3 不进入压缩且最终保留一次。自动调用前执行 prepareCompaction，断言手动输入有最新摘要和当前上下文且无 C1。

再用 T3 的 before_provider_request 接缝和 stable-prefix 阈值运行重叠场景，验证生产 scheduler 的压缩 fetch 确实发生。该场景不通过 payload 的预先手工删除 C1 达到匹配。前缀校验仍须覆盖独立的真实 mismatch 对照：无 checkpoint/无 pending 保留原请求，valid native checkpoint 继续报错，pending transition 仍走原恢复路径。

### T5. Identity and lifecycle regression

必须覆盖下列可观察行为，优先扩展现有测试而非重复同一个 helper 断言：

- 历史 user 与当前 user 正文相同但源 ID 不同，只排除当前源；payload-only 追加同文 user 时不误删旧源或新 tail。
- 当前 user 多次替换以最后一次为准；null replacement 不复活旧正文；删除较早 user 不使剩余消息错位。晚于当前 user 的 message/custom_message 继续阻止“未回答当前 user”推断。
- 普通摘要、custom_message、branchSummary 转出的 user 不被误认成真实当前 user；保留真实图片及文字 block，实际 request item 原样保存。
- 有效 native checkpoint 之后编辑当前 user 仍可用旧 checkpoint，完整保存新任务。编辑触及 checkpoint 前消息继续使其失效，不重新发送旧密文。
- transition 压缩后立即 automatic 压缩，当前任务即便第二次被 64k 裁剪仍完整恢复且只出现一次。补充已保存的当前 user 带 wire id、再次压缩后相同 id 的正文被裁剪的情况，断言仍追加完整任务。已有的三组同文旧 checkpoint 测试、带 old-turn/new-turn wire ID 测试继续通过。
- 长历史用户被预算裁剪，requestUserCount 大于新 checkpoint 的 user 数时，仍按当前 occurrence 索引去重，不能复制当前任务两份。
- 暂停 createCheckpoint 后追加新 edit、切换模型、clear session 或 abort；迟到结果不写入错误的 checkpoint，不跨 await 复用旧快照。原有模型转换重试/回退、错误分类和自动失败继续请求测试保持。
- 手动压缩继续保留当前上下文全部消息，取消信号和不触发额外 model-transition compaction 的约定不变。

其中被编辑的失败请求 marker 内容匹配本身不在本次扩展修复范围；不得顺便修改 activeFailedRequests/recordFailedRequest 的产品语义。若某条必要测试表明它直接阻塞两个目标场景，按交接停止条件把证据返回 expert。

### T6. Performance acceptance

在 snapshot 的公共内部接口级别测试，同一快照多次读取同一语义视图应复用结果，effective 的普通路径与 pi-context 复用；source projection 及序列化调用计数不得随重复读取次数增长。用 spy 观察现有导入边界或测试可注入的投影函数，不为测试新增生产全局计数器。

分别构造 100 和 1,000 个 entry、其中约一半为 edit 的分支。以带计数 getter 的合成 targetId/content 字段或投影调用 spy 记录访问量：每种投影视图最多构造一次，应用 edits 的 targetId 读取总数不超过 `10*n+20`；总量增长不超过输入规模增长的线性倍数加固定开销，防止每个 entry 重新扫描所有 edits。该界限来自 Map 收集与线性投影的算法，不以首次实现结果定义阈值。

一次 snapshot 对每个唯一 model、kind、排除选项最多序列化一次；不同 compat 不错误命中缓存。创建新 snapshot 后读到新 edit，旧 snapshot 不可被新 entry push 改写。保留 T3 长正文测试防止完整任务因“优化”被裁剪。无需新增基准框架或付费请求。

### Final verification

环境核验 Node >=22.19，pnpm 使用 packageManager 指定版本；调查时为 Node 22.22.2、pnpm 11.9.0。依赖已安装，缺失或 lockfile 状态改变才运行 `pnpm install --frozen-lockfile --ignore-scripts`。

```sh
pnpm exec vitest run extensions/codex-compact/__tests__
pnpm run check
git diff --check
git status --short
```

测试临时文件和缓存优先落在仓库内的短路径，并按本次记录清理。若启动了服务或后台进程，停止它们并确认监听端口释放。结果按 T1–T6 记录实际命令、Red 原因、Green 结果、替代边界；已有全量 suite 的 skipped 项如实记录，不视为新测试通过。本文和 handoff 是任务产物，不清理它们。没有 commit/push/PR/部署授权。

### Verification results

2026-09-23 在 Node 22.22.2、pnpm 11.9.0、Pi 0.87.0 上完成。依赖已安装，lockfile 未改，未重装。没有运行在线模型请求。测试中的 provider `onPayload` 在网络前停止，压缩 fetch 仅返回固定合法 SSE；配置读取通过测试模块替代为 `{ autoCompactScope: "total", autoCompactTokenLimit: 100 }`，未写全局配置。

| Check | Actual result |
| --- | --- |
| T1 | 新 `session-projection.test.ts` 先因 `createBranchProjectionSnapshot` 不存在而 Red；实现后 8 项通过。真实 SessionManager 的重叠、不重叠、retain-none、system checkpoint、重复 edit、过滤中间 entry 与源索引均按 Pi 投影或完整恢复断言通过。输入 entry 和 parentId 未改。 |
| T2 | 新重叠压缩测试先因 `createBranchInputSnapshot` 不存在而 Red；实现后通过。真实 provider `streamSimple(...).onPayload` 与插件 pi-context wire input 深度相等；C1 缺席、C2 在场。真实 user、custom、摘要和 native tail 的 source ID、prefix 无来源、空内容 user、两个 raw entry 共用 message 对象均通过定向断言。既有 tool 配对和 messageIndex 测试通过。 |
| T3 | 390,030 字符 edited-current 协调器测试在修复前 Red：createCheckpoint 输入仍含 `MIDDLE_CONSTRAINT_MUST_SURVIVE`。修复后压缩输入不含当前任务，checkpoint.preservedInput 与原始 wire item 完全相同，最终完整任务只出现一次。index 的未编辑、已编辑两组真实路径均由 Pi provider payload 进入扩展入口，经生产 scheduler、SSE 解析、真实 replacement builder、checkpoint append 回同一 SessionManager；各压缩 fetch 1 次，ctx.abort 0 次。 |
| T4 | Evidence 中修复前重叠 C1/C2 对照为自动判断 0 次、压缩 0 次；未重叠对照为各 1 次。修复后真实 SessionManager + provider payload + selectModel 的重叠与不重叠两组，自动判断和 createCheckpoint 均各 1 次，手动/自动输入有 C2 而无 C1，U3 不进压缩，最终只出现一次。index 的重叠真实扩展入口也发生 1 次压缩 fetch。既有 valid checkpoint mismatch、pending transition 与无 pending 保留请求测试仍通过。 |
| T5 | 新测试覆盖同文历史与当前源、payload-only 同文 tail、多次 edit 与 null 删除、图片和文字原样保留、后续 custom_message 阻止当前请求推断、带 wire id 的二次压缩裁剪、transition 后立刻 automatic 压缩 390,030 字符任务，以及 await 中追加 edit 后不写迟到 checkpoint。既有模型切换、clear/abort、手动压缩、重试和失败分类测试通过。 |
| T6 | 100 与 1,000 entry、约半数 edit 的 getter 计数均低于 `10*n+20`，1,000 相对 100 的读取增长不超过 10 倍加 20。相同 snapshot 的 full-history/pi-context/effective 别名、排除选项、相同模型语义缓存与不同 compat 隔离通过；注入计数证实重复读取不重复调用 convertToLlm，同一 target modelKey 的 checkpoint lookup 仅调用一次。新 snapshot 读取新增 entry，旧 snapshot 不变。 |

最终命令：`pnpm exec vitest run extensions/codex-compact/__tests__ --reporter=dot` 为 38 files、933 passed；`pnpm run check` 的 typecheck、全量 2464 passed / 12 skipped、build、package:check 全部通过。`git diff --check` 通过。全量跳过的 12 项属于原有 subagent integration 测试，本轮未把它们记为通过。`dist/` 由 build 生成，未手工编辑或保留跟踪改动。

验证边界：压缩响应为固定 opaque SSE，未验证线上模型对密文的语义；未运行跨平台 CI。未启动需持续运行的服务或后台进程，没有待清理的任务进程或临时探针文件。未提交、推送、创建 PR 或部署。
