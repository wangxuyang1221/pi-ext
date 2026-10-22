# Codex Compaction Plugin Repair Round 2 Design

## Status and Scope

本设计接续[第二轮 TODO](codex-compact-plugin-repair-round-2-todo.md)，基线为 `9aac58af3ae334d48ed6907fd2b78fe19e80e676`。设计依据是固定提交的生产代码、正式测试及外部复审描述。expert 已完成静态调用链核对，没有编写或运行新的实验脚本；四项缺陷的本地 Red/Green 由 worker 执行。设计决定不等同于已通过运行验证。

修改限于 `extensions/codex-compact/src/native-compaction.ts`、`session-coordinator.ts`、必要的 `index.ts` 接口接线及对应测试、README/UPSTREAM/TODO。现有 `request-projection.ts` 的匹配规则、session projection、scheduler 和 remote retention 算法不因本轮重构。若实现需要改变这些模块的行为，先向 expert 返回证据。

## Verified Code Paths

- `compactionInputPlan()` 只在 checkpoint 前 user 的 ID 存在于 `preservedInputSources` 时识别它为当前输入；缺少字段时返回空 `preservedInput`。`prepareCompactionPlan()` 将结果交给 `session_before_compact`，后者没有另一个旧来源保护检查。这是 R2-1 的遗漏位置。
- `createBranchInputSnapshot().view("effective")` 输出顺序是 `replacementHistory + preservedInput + checkpoint 后 tail`，来源只覆盖带显式 metadata 的 preserved user 和 tail；不能从有效 view 的来源缺失推断该项属于已完成历史。
- `deps.getBranch` 在 coordinator 创建时被包装为 `branchWithoutFailedRequests`。`prepareRequest()` 的入口投影核验发生在 `prepareRequestInternal()` 清理 payload 之前，R2-2 的次序不一致确实存在。公开 `recoverCurrentModel()` 有同类提前核验，也要使用同一证据准备函数。
- `classifyHttpCompactionError()` 将状态写进 message，却只附加 code/retry/fallback 属性。`automatic` catch 依赖 message 正则和 context 分类，没有 HTTP 401/403 的结构化判断。transport catch 重抛同一个 Error，对新增非枚举属性的传播无须更换异常体系。
- 容量下切既经过 `prepareRequestInternal()` 的 pending selection，也经过 `recoverCurrentModelInternal()` 的持久化 checkpoint 恢复。当前只有 automatic 分支写 `automaticAttempts`；`transitionCompactionCompleted` 还能让 opaque-only history 进入 automatic。
- 已有 `repair-runtime.test.ts` 使用真实 AgentSession、session 文件、ExtensionRunner 和 provider converter，模型目录及 fetch 为替身；可直接扩展。`session-coordinator.test.ts` 已有同文失败请求、receipt、downshift、hash transition、软失败与请求成本覆盖，不另建一套 runner。

## R2-1: Legacy Pending Input

### Decision

仍按当前 raw branch 判定执行进展：最后一个真实 user 后出现 toolResult 或非 error/aborted assistant，即为已有执行进展。此判断保持现状，不扩展到语义任务完成。

对于 valid checkpoint 之前尚无执行进展的真实 user，明确分为：

1. `preservedInputSources` 包含该 user ID，沿用新格式来源路径。
2. 字段缺失，进入下面的严格旧格式证明。
3. 字段存在但不覆盖该 user，或来源指向的完整内容不符合当前投影，取消本次压缩。不能把不完整 metadata 当成已完成历史，也不能覆盖与现有 metadata 冲突的来源。

没有 pending user、已有执行进展、user 在 checkpoint 之后或没有 valid checkpoint 时，沿用现有分支。新格式若声称覆盖但有效 view 找不到对应项，取消，不静默降为历史。

### Proof Algorithm

在 `native-compaction.ts` 增加 private `legacyPendingInputPlan(snapshot, model, options, userEntryId): CompactionInputPlan`，由 `compactionInputPlan()` 调用。只证明以下可核验子集，其他情况统一取消；不实现相似文本匹配或旧截断算法反推。

1. 从同一个 snapshot 取得 `effective` 和 `full-history` view，使用相同 model、投影策略和既有 exclusion options。用 `full-history.userSources` 找到 pending user 的唯一 wire index。该项不存在或多于一次，取消。
2. 再取得 checkpoint 之前的 full-history view：将 checkpoint 后所有 entry ID 与原 options 的 exclusions 合并后调用 snapshot view。通过来源定位该 pending user，取它到这个 view 末尾的完整 wire 后缀。要求旧 `details.preservedInput` 与此后缀逐项深相等且非空；不搜索任意子序列，也不只比较最后 user 文本。旧格式未保存的 system/custom 尾部、当前 context edit 改变的内容不能假定已被覆盖。
3. 对全量 full-history 中每个有来源的 wire user 建立一次 identity 索引。identity 是完整 ResponseItem 的确定性 JSON 表示，对对象 key 排序，数组保序；不是文本摘要。每个 identity 只保留唯一 occurrence 的 index/source ID，遇到第二个 occurrence 即标记 ambiguous，不枚举候选。实现可用 private JSON identity helper，不能把哈希碰撞当作相等证明；通过索引选中的实际项仍需 `isDeepStrictEqual`。
4. preserved 后缀的每个 user 必须与该 identity 索引的唯一 occurrence、来源和顺序一致。非 user 项按步骤 2 的完整后缀相等获得覆盖，来源记录为 null。不同 entry 的同文输入在此不能按文本合并；无法唯一证明则取消。
5. `replacementHistory` 中的每个 user 必须精确对应一个唯一 raw occurrence，且来源位于 pending user 之前。其来源不能重复使用，也不能属于 preserved 后缀。未匹配的截断 user、重复全文、ambiguous identity 均取消。其他 replacement items 保持原样，不推断 opaque 内部信息。
6. 证明成功后，plan.input 为旧 `replacementHistory`，plan.preservedInput 为已证明的旧 preserved 后缀加 effective view 中 checkpoint 后的完整 tail。来源数组由步骤 4 的来源加 tail 的 `userSources` 构成，非 user 为 null。tail 偏移使用 `replacementHistory.length + preservedInput.length`，不得按全文重新搜索。旧 checkpoint 和 snapshot 缓存不修改，只有正式压缩成功后生成新 details。

复审中的 `[truncatedUser, opaque] + [fullUser]` 不能证明 truncatedUser 的来源，因此选择取消而不是删除截断项。`[opaque] + [fullUser]` 或保留区内只有可唯一证明的更早完整 user，允许迁移。这个边界满足 I10 的保守要求，不承诺修复任意旧数据。

### Error and Lifecycle

增加 exported `UnprovenPreservedInputError extends Error`，`name` 同类名，`code = "preserved_input_source_unproven"`。固定英文消息说明当前旧 checkpoint 的 pending input 无法安全归属，压缩取消且旧 checkpoint 保留；不输出用户正文。

helper 在 createCheckpoint/fetch 前抛错。沿用 `session_before_compact` 已有 catch → reportCompactionFailure → `{ cancel: true }`，不得 append checkpoint/bypass 或修改原 details。无需改变持久化版本、公开配置或 parser 规则。用新来源生成成功结果后，继续压缩与重开走既有新格式路径。

worker 运行发现 `reportCompactionFailure()` 不透传 Error.message，因此必须补齐诊断接线。在 `compactionFailureClassification()` 的普通 code/message 分支之前，按 `instanceof UnprovenPreservedInputError` 返回其 `preserved_input_source_unproven` code；不信任任意外部 error.code，不输出用户正文。在 `index.ts` 的 `failureNextStep()` 最前增加此 code 的固定英文文案：`the pending input cannot be preserved safely; the existing checkpoint was kept; review the pending input before retrying manually`。现有 notice 字段、UI/stderr 路由及 outcome 保持不变。为 classifier、正式 hook 的 UI 通知和真实 SDK stderr 各验证对应 code/文案，确认不会泄漏用户正文。此接线属于 R2-1，不更换通用报告框架。

已接受的夹具细化：checkpoint 之后对之前 user 的 context edit 会被既有 lookup 判为 invalid，仍沿用原路径；legacy proof 的冲突测试使用 checkpoint 前的 edit，使 checkpoint valid 但 preserved 内容与当前投影不一致。真实 SDK 第二次 manual 前追加 aborted assistant，满足宿主新增 entry 条件，且不构成成功执行进展；不绕过真实 SDK 门槛。

## R2-2: Frozen Failed-Request Cleanup

### Structure and Order

在 coordinator 增加 private 证据准备函数，供 `prepareRequest()` 与公开 `recoverCurrentModel()` 共用：

```ts
type PreparedRequestEvidence = {
  rawBranch: SessionEntry[];
  branch: SessionEntry[];
  failedUserIds: ReadonlySet<string>;
  requestInput: ResponseItem[] | undefined;
  basePayload: JsonObject | undefined;
  requestInputWasSanitized: boolean;
};
```

参数为 `ctx`、原 requestInput、basePayload；函数闭包可用 `rawGetBranch`。同步执行：

1. 深拷贝一次 raw branch、request input 与 base payload。
2. 对冻结 raw branch 调用一次 `activeFailedRequests()`；同一结果交给 `branchWithoutFailedRequests()` 和 `requestInputWithoutFailedRequests()`。
3. 用清理函数返回值的引用变化记录 `requestInputWasSanitized`。若 basePayload 自身带 input，替换为同一份清理后的 input，避免内部两份请求证据互相矛盾；其他字段保持原值。
4. 冻结 tools、model、prompt 后，用清理后的 branch/input 及实际 instructions/tools 调用 `resolveRequestProjection()`，然后才开始 metadata await。

保留上述清理函数原有匹配规则，尤其最新复用 entry、同文新 user、legacy content marker 的规则。本轮调整执行次序与证据一致性，不扩大失败请求删除范围。

### Continuity and Return Value

`RequestContinuity` 增加 `requestInputWasSanitized: boolean`。`prepareRequestInternal()` 删除入口二次 input 清理，不在递归中重新消费 marker；现有局部 `requestInputWasSanitized` 改读 continuity。receipt、requestSuffix 和 automatic attempt key 均使用清理后的 input。内部返回 undefined 且入口确实清理过 input 时，公开 `prepareRequest()` 返回清理后的 input；无清理则保持原 undefined 语义。

`observedRequests` 保存清理后的 basePayload 和同一次核验得到的 policy。不把原始失败 payload 存回观察缓存。`recoverCurrentModel()` 虽无 payload 返回值，也必须使用相同证据进行提前核验和后续恢复。

### Frozen Branch Filtering

worker 核对出原 `deps.getBranch` 包装会反复计算 active markers，因此请求路径不再调用该包装。PreparedRequestEvidence 增加 `failedUserIds`，由入口唯一一次 `activeFailedRequests(rawBranch)` 的结果提取所有 `hasBranchUser` 的 entryId。`RequestContinuity` 增加同名 `ReadonlySet<string>` 字段；prepareRequest 与公开 recoverCurrentModel 创建 continuity 时必须传入。

在 coordinator 闭包增加 `requestBranch(ctx, continuity?)`：无 continuity 时调用原 `deps.getBranch(ctx)`，保留 manual 等旧入口；有 continuity 时先 `continuity.assertEvidence?.()`，再从 `rawGetBranch(ctx)` 过滤固定 failedUserIds，返回顺序不变的数组。不得再次调用 activeFailedRequests，不从 live marker 重算集合，不原地修改 branch。

以下路径中的全部请求阶段 branch 读取改用 requestBranch，并传递已有 continuity：`prepareRequestInternal`、`runTransition`、`recoverCurrentModelInternal`、`saveCheckpoint` 的前后比较、这些路径的 leaf/checkpoint 检查，以及 prepareRequest 结尾观察缓存的 branch fingerprint。`bypassFailedGate` 增加可选 continuity 参数，两个 transition catch 调用都传入；其适用性校验若抛 StaleCompactionError，只跳过写 bypass，不掩盖原错误。入口冻结函数仍用 rawGetBranch。`recordFailedRequest`、公开 prepareCompaction 和 prepareCompactionPlan 无 continuity，保持原读取方式。禁止通过全局修改 deps.getBranch 为单个请求的闭包来实现，避免并发请求互串。

### Stale Evidence

metadata await 后比较冻结 rawBranch 与 `rawGetBranch(ctx)`，不能只比较已删除失败 user 的 branch。`assertEvidence` 保留原 tools/prompt/model 检查，并检查冻结 rawBranch 是当前 raw branch 的内容一致前缀。这允许本次正常追加 checkpoint，但不能忽略旧 failed user 内容被修改、marker 被改写、分支切换或删除。

同时检查初始 rawBranch 末尾之后是否追加了 `customType === FAILED_REQUEST_KIND` 的 custom entry；若有则抛 StaleCompactionError，不能将新失败标记应用到旧冻结 payload。正常追加 checkpoint 不触发该规则。上述 guard 直接使用 rawGetBranch，不调用 requestBranch，以免递归。旧前缀任意修改或新失败标记都应在发送/提交前被发现。

`runTransition` 捕获第一次压缩错误后，先执行既有 ensureCurrent 及 fallback 资格判断。不允许 fallback 时仍抛 firstError；允许时，在第二次 createCheckpoint 之前执行 `continuity?.assertEvidence?.()`。证据变化时抛 StaleCompactionError 并停止第二次发送，且不写 checkpoint/bypass。测试覆盖可 fallback 的第一次错误期间修改 raw prefix 或追加 marker，并保留未变化时成功 fallback 的对照。

正常追加后的完整 branch 适用性仍由既有 `saveCheckpoint(before)`、leaf/generation/session/signal 检查负责；不要为了匹配整个初始 branch 而禁止自身 checkpoint 追加。操作期间新 message/marker 的追加由现有阶段快照检查处理。若测试表明某条追加路径绕过这些检查，暂停并反馈对应轨迹，不自行另设容错。

### Cost Boundary

新增证据处理为常数份复制和遍历。`activeFailedRequests` 和 `requestInputWithoutFailedRequests` 的既有内部匹配算法本轮不改写，也不宣称整个存量清理算法对 marker 数线性。本轮成本验收专门检查：冻结入口一次计算 marker 集合、一次清理 input，不随四个 projection 候选或内部重入重复清理；其余新增扫描对 raw branch 与 payload 大小线性。该限定替代 TODO 中尚未落实的泛化 marker 成本假设。

## R2-3: Typed HTTP Authentication Failure

继续使用 Error 上的非枚举属性，与已有 `compactionRetry/compactionCode` 同风格，不新建跨模块错误框架。

在 native-compaction 增加 private `markCompactionHttpFailure(error, status)`，附加 `compactionHttpStatus`，并对 401/403 附加 `compactionTerminalReason: "authentication" | "permission"`。属性 configurable、非枚举，status 使用真实 Response.status，不从 message 解析。

增加 exported `isTerminalCompactionFailure(error: unknown): boolean`：401/403 的结构化 reason/status 返回 true；其他错误按原 `isFailClosedCompactionError(message)` 返回。HTTP 非认证错误不能仅因为 retry 为 none 就返回 true。原 `isFailClosedCompactionError(string)` 保留，避免改变现有 SSE、HTTP retry/fallback 规则。

`classifyHttpCompactionError()` 创建 Error 时标记 status/reason，再套现有 retry/code/fallback 属性。`readErrorBody` 完整与否都经过此处，后续 message 追加不能清除属性。transport catch 和 transition fallback 重抛同一个 Error；如需包装，必须保留 cause 或字段并保持 classifier 可识别，但优先保持现有不包装路径。

automatic catch 用 `isTerminalCompactionFailure(automaticError)` 代替 message-only 调用，取消与 `isContextWindowCompactionError()` 检查保留。生产入口继续走现有 ctx.abort/report/failed-request marker 处理，无新 UI 流程。401/403 的一次请求、零 retry/fallback、零普通 provider 出站是完整验收；503 重试耗尽后的可软失败路径保持不变。此设计不把空正文 429 新分类为 quota，不改变已有 429 契约。

## R2-4: Shared Local Capacity Attempt

### State and Helpers

复用现有 `automaticAttempts: Map<sessionId, attemptKey>` 作为所有本地容量修复的额度记录，改名为 `localCapacityAttempts`；continuity 对应改名 `localCapacityAttempted/localCapacityAttemptKey`。这是内部符号变更，不改变持久化格式。

抽取 `localCapacityAttemptKey()`，内容沿用现有 accounting fingerprint 的 model、hash、prompt、tools、清理后的最新 wire user、带来源 ID 的 raw projected history，继续排除 error/aborted assistant 和 compaction 自身。在 prepareRequest 与公开 recoverCurrentModel 取得 hashes 后设置 key；无 requestInput 的直接恢复使用 undefined current，与现有无请求语义一致。相同完整输入的两入口得到相同 key。

增加 `claimLocalCapacityAttempt(continuity): boolean`，同步检查 continuity 的 attempted 标志及 Map 中该 session/key。已使用则 false；未使用则先标记 continuity 和 Map，再 true。只有真正决定启动容量修复时调用，不能在阈值未满足时消费额度。每 session 只保留最近 key；clear/selectModel 沿用现有清理生命周期，不增加无限增长集合。

### Entry Points

- pending selection 的 `reason === "downshift"`：阈值满足后、创建 transition promise 前 claim；失败时删除当前 pending selection 并跳过本次容量 transition，继续正常请求准备。`reason === "hash"` 不 claim，不受这份额度阻止。
- `recoverCurrentModelInternal()`：`!hashTransition` 且 downshift 达阈值后、启动 transition 前 claim；失败时返回，无远程调用。hashTransition 保持现有必需迁移。
- automatic：计算触发条件后、创建 promise 前 claim，替代原布尔与 Map 写入。guard 检查 live Map，不只看入口时读取的布尔，防止另一个同 key 操作已消费额度而当前 continuity 仍为 false。
- 成功、失败、checkpoint 追加、递归准备均不归还额度；新 user entry 或实际模型/输入变化产生新 key。不得在保存 checkpoint 时重置 Map。

`transitionCompactionCompleted` 仅记录完成的 hash 协议迁移，用于保留原有 hash transition 后自动容量检查的行为。纯容量 transition 不再通过此变量绕过 opaque-only 门槛，而且已消费本地额度。不同 hash 的现有 `presents separate transition and automatic compactions` 用例应继续通过。

transition 的既有 previous-model → current-model 有条件 fallback 保持在同一个逻辑 transition 内，HTTP retry 也独立计数。本轮“一次”指一次由容量估算触发的逻辑修复，成功且无 fallback 的复现必须只有一次 fetch。不得通过多次创建 transition 把额度当作函数级计数。

容量 transition 失败时沿用已有错误传播/bypass 规则，不把它改为新的软失败策略；本轮只保证它不会因额度遗漏重新发起同 scope 容量修复。真实 provider overflow 的恢复仍由 Pi 原有一次 compact-and-retry 负责，不由该 Map 扣减。

## Verification Decisions

完整场景见 TODO 的 Behavior Matrix。下列规则消除 worker 的验收取舍：

- R2-1 在 `native-compaction.test.ts` 验证 proof 成功与拒绝，在 `repair-runtime.test.ts` 用真实 session 文件验证报告中的长输入旧格式取消、无截断副本的可证明迁移、重新打开及再次 manual。取消断言零 compaction fetch、旧 details 不变；成功断言完整 suffix 一次且新来源可 round trip。不能以“有全文或取消”这种合并断言让所有可证明正例都取消。
- R2-1 对同文多来源、context edit、custom suffix 的测试按 Proof Algorithm 预先给定预期：完整后缀和身份唯一则成功；被改写、重复 identity、截断保留或遗漏 suffix 则取消。新格式同文不同来源依旧成功，不受旧格式证明规则影响。
- R2-2 在 `responses-parity.test.ts` 或 coordinator 真实 converter 夹具构造有 instructions/tools 的请求，有/无 checkpoint 各一个 Red；在真实 SDK 入口至少覆盖一个失败 marker 后新请求继续的例子。验证最终 payload 与 raw session 来源，另测 recoverCurrentModel 同样路径。marker 更新、旧失败 user 原地变更和当前新输入不误删必须有断言。
- R2-3 在 transport 测试覆盖空与 incomplete 401/403 属性保留；coordinator 通过真实 createNativeCheckpoint + fake fetch 验证 reject；真实 SDK 至少覆盖空正文 401/403 两种状态，普通 provider fetch 次数为零。直接构造带 message 的 Error 不替代端到端用例。
- R2-4 用真实 scheduler/remote checkpoint/SSE，在两个容量入口分别复现同 hash 下切；记录 runCompaction reason 和 fetch 次数。再测同 key 重入、一次失败后不重新 claim、新 user ID、clear/model 变化以及不同 hash 对照。不要把所有 transition 测试都改成一次。
- 新增行为按逐个 Red → Green → Repeat → Refactor，已有行为保护测试可以直接记录通过。测试 fixture 的环境失败不算 Red。
- R2-1 identity 索引保留一个 occurrence 或 ambiguous 标记，每项只编码一次；选中项深比较总量受实际输入字节量约束。对 1,000/2,000/4,000 条消息用现有转换 spy 加 identity helper 的定向调用计数验证没有逐候选重转换历史。对象 key 排序成本以每个对象字段数 K 的 `K log K` 计，不宣称任意超宽对象编码严格线性。
- R2-2 的“marker 集合计算一次、input 清理一次”通过静态调用链复核：两个公开请求入口只调用一次 prepareRequestEvidence，内部请求路径全部使用固定 failedUserIds，不再调用重新计算 marker 的 deps.getBranch 包装。复核包括 checkpoint 保存和 prepareRequestInternal 重入。
- 动态验证保留现有 request-projection 候选上界及转换计数测试，并覆盖多 marker、checkpoint 保存和内部重入行为。私有闭包不能直接观测调用次数，字段 getter 又无法区分 structuredClone、stale guard 与 marker 扫描，因此不把 getter 次数作为扫描次数证据。不得声称已经运行时直接计数 marker 扫描；不新增生产计数器、公共 API 或仅为计数拆出的测试接口。
- 其他资源与完整命令沿用 TODO。最终 `pnpm run check` 必须通过，现有 skip 原因保持可说明。完成后更新 TODO 和第一轮状态，记录真实结果，准备同范围复审材料。

## Worker Stop Conditions

实际接口或数据与上述依据冲突、设计无法实施、出现未设计的行为分支、需要改变范围外公共接口或测试验收相互冲突时，暂停受影响工作。向 expert 返回 R2 编号、设计预期、实际轨迹、可运行的失败用例或源码位置及待决问题，可继续不受影响的项。不得自行降低断言、扩大旧数据推断规则或调整错误/额度语义。

本设计与 TODO 之间的具体算法、接口和成本边界以本设计为准；若执行发现契约冲突，必须让 expert 修订两份文档后继续。expert 负责确认需重做哪些实现与验证。
