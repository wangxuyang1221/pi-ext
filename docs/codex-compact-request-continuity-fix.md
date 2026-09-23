# Codex request continuity across compactions

## Understanding

修复 `11c5cb121303b6a82cd899011d0ed2bc38f5d23d` 的剩余 P2：同一次 `prepareRequest()` 中，模型转换压缩裁掉部分历史 user 后，紧随的自动压缩失去当前请求身份，第二个检查点未完整保留当前任务。

本文是本次剩余工作的唯一设计和 Todo 来源，版本 1。方案由 expert 决定，尚未实现。前一份 [projection fixes](codex-compact-projection-fixes.md) 保留原修复的背景和验证记录；其中 T5 的完成记录没有覆盖本次组合条件，不能作为关闭原第 1 项问题的依据。

## User Visible Changes

- 编辑后的当前任务超过 64k 历史保留预算，且模型转换压缩裁掉历史后立即再次压缩时，第二个检查点及后续有效上下文仍完整保留该任务。本次最终请求中的全文仍只出现一次。

## Evidence

2026-09-23 在上述提交运行过真实协调器测试。临时测试已删除，重建方式见 T1。远端返回的加密内容用 opaque 字符串替代，本地投影、provider 序列化、协调器、历史裁剪和检查点写入均使用实际实现，没有在线请求。

当前任务为 `"start ".repeat(30_000) + "MIDDLE_CONSTRAINT_MUST_SURVIVE" + " finish".repeat(30_000)`，共 390,030 字符。历史为 5 条 user，每条 `H${i}:` 加 `"h".repeat(99_997)`，各 100,000 字符。最后追加 `draft`，然后用 `context_edit` 替换成当前任务，不再追加 user。

| Case | Request users | First checkpoint users | First preservedInput length | Second preservedInput length | Final payload complete | Subsequent effective input complete |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| 无历史 | 1 | 1 | 1 | 1 | 是 | 是 |
| 5 条短历史，各 100 字符 | 6 | 6 | 1 | 1 | 是 | 是 |
| 5 条长历史，各 100,000 字符 | 6 | 4 | 1 | 0 | 是 | 否 |

第三组的第二个检查点缺少完整任务，后续有效输入也缺少中间约束。首个检查点已完整保存任务，本次最终 payload 依靠原始 tail 补上全文，掩盖了持久化结果中的缺口。

源码依据在 `extensions/codex-compact/src/session-coordinator.ts`：

- `resolveCurrentRequest()` 不再把新检查点之前的源 user 返回为 `branch`。
- `checkpointPreservedCurrentUser()` 在原请求 user 数大于检查点 user 数时提前退出。这是旧检查点消歧的保护条件，不能直接删除。
- `runTransition()` 成功保存当前请求后只返回 `void`，自动压缩阶段重新推断身份，没有得到刚刚保存的对应关系。
- `preserveCurrentUser()` 对 `undefined` 不补正文；对已确认的 `checkpoint` 身份，已有完整正文才免于追加。后一个行为可以复用。

本轮核实运行过原 coordinator 测试及三组临时测试，原有 54 项通过，新三组中 2 项通过、长历史组失败。删除临时测试后重新执行 `pnpm run check`，2464 项通过、12 项跳过，类型检查、构建、发布包校验通过。这是修复前基线结果，不是本方案的验收结果。不能据此判断远端加密摘要是否保留了约束语义。

## Design

### D1. Scope

实现只改 `extensions/codex-compact/src/session-coordinator.ts` 及对应 `__tests__/session-coordinator.test.ts`，并在本文记录验收。复用现有投影、历史裁剪、模型转换策略和测试设施。

保持公开协调器接口、`appendCheckpoint(): void` 依赖接口及检查点持久化格式不变。保留 64k 预算、普通压缩投影修复、Fast Mode、失败请求过滤、subagent 行为。无需修改 `native-compaction.ts`、`session-projection.ts`、`index.ts`、依赖或用户配置；出现必须修改这些范围的证据时，先回传 expert。

### D2. Request-local continuity

在协调器内部增加一个只属于本次公开 `prepareRequest()` 调用的状态对象。它不是 session 缓存，也不进入检查点 JSON。内部实现函数可以接收它；公开函数签名不增加参数。

状态保存固定数量字段：session ID、开始时的 generation、目标 model key、请求输入数组引用，以及可选的 receipt。receipt 包含已经确认的 `requestIndex`、完整 `ResponseItem` 的独立副本、可选的源 entry ID、写入成功的检查点 entry ID，以及写入时的 `conversationLeafId`。源 ID 只来自 `CurrentRequest.kind === "branch"`，从旧检查点合法识别的当前请求不伪造源 ID。

状态开始时没有 receipt。只有本次调用自己发起的压缩在完成版本校验、保留全文并成功写入检查点后，才建立或更新 receipt。已有 receipt 被下一次成功写入替换，不累积历史。原始解析得到的 `CurrentRequest` 仍是首次确认身份的依据；不能仅凭末条 user 文本相等创建 receipt。

后续以有效 receipt 解析出的 checkpoint 身份再次保存时，保留原 receipt 的源 entry ID。只有从无 receipt 的旧检查点解析开始时，源 ID 才为空。身份或输入失效后不沿用之前的源 ID。

将现有 `prepareRequest` 主体移入私有 `prepareRequestInternal`，通过最后一个参数传递状态。原有递归等待分支调用内部函数并沿用状态。递归重新执行失败请求清洗后，如果输入数组发生替换，清空 receipt，并更新状态的输入引用。所有原有入口、等待后的 generation/model/abort 校验继续执行，不能因递归而接受一次中途模型切换。

将 `recoverCurrentModel` 的主体移入私有 `recoverCurrentModelInternal`，允许最后一个参数接收上述状态；公开包装保持原签名并不创建状态。`prepareRequestInternal` 调用内部版本。`runTransition` 增加最后一个可选内部状态参数。`transitionBySession` 与 `automaticCompactionBySession` 继续存 `Promise<void>`，不把 receipt 暴露给等待者。

### D3. Commit and resolve

在协调器内部统一本任务涉及的三处保存动作：`runTransition`、恢复阶段无法解析 previousModel 时的直接压缩、自动压缩。私有保存 helper 接收最终 details、该阶段已确认的 CurrentRequest、阶段开始的分支和可选状态；公开依赖仍只调用 `deps.appendCheckpoint(details)`。

保存顺序：

1. 沿用各路径已有的 `ensureCurrent` 与 leaf 校验。转换重试因 leaf 变化重新取快照时，不使用旧 receipt；以新事实执行原有解析。
2. 用 `preserveCurrentUser` 生成保留全文的 details，转换路径再执行 `rebindCheckpoint`。helper 接收的必须是实际要保存的最终 details。
3. 调用 `appendCheckpoint`。发生异常时清空本次 receipt，按原有错误处理继续传播或自动压缩回退，不把远端成功当成本地保存成功。
4. 无状态或无 CurrentRequest 时不登记 receipt。否则同步读取最新分支，调用一次 `findNativeCheckpoint`。确认分支仍在原 session、generation 和目标 model 下，conversation leaf 未变；原分支末项仍位于原索引，最新检查点是追加在原分支之后的新 entry；检查点为 valid，解析后的 details 与刚保存的 details 深相等，且其中含同一 user occurrence 的完整正文。满足后登记 receipt。
5. 第 4 步无法确认时清空 receipt，保留现有保存行为，不新增用户错误或补发压缩。此情形的测试应证明没有获得身份豁免，而不是依靠错误提示判断成功。

`parseNativeCompactionDetails()` 会克隆数组与 item，不能用 details 或 item 的对象引用判断保存结果。使用深相等验证，登记后只保留当前 item 副本和必要 ID，不保存第二份完整 history。上述“原分支”取本阶段快照中的数组，不能使用被测试依赖原地 push 后改变长度的同一个数组。

为当前请求解析增加私有包装，先验证 receipt，失败则清空并调用原 `resolveCurrentRequest`。验证同时要求：

- 当前 session、generation、目标 model 和输入引用与状态一致，signal 未取消；沿用调用方现有异常语义。
- 新快照中最新检查点为 valid，entry ID 等于 receipt 的检查点 ID，details 的 modelKey 等于目标 model key。
- conversation leaf 等于 receipt 的 leaf，检查点之后没有新 `message` 或 `custom_message`。有源 ID 时，它仍存在于当前过滤后的分支且在检查点之前。
- `requestIndex` 仍指向最后一条 user，该 item 与 receipt 保存的完整 item 深相等。检查点的 replacementHistory 或 preservedInput 仍含同一 occurrence 且 content 深相等的 user。

验证通过返回 `kind: "checkpoint"`，使用已确认的 requestIndex 和完整 item，跳过旧检查点 user 数推断。不能返回 `branch` 或按旧源 ID 排除检查点消息。验证失败仅意味着缺少本次调用的证明，仍由原始解析决定是否能识别。

包装用于转换、恢复阈值判断及恢复压缩、自动压缩、最终有效输入构造中的当前请求解析。起始无 receipt 时与原解析等价。已有 receipt 的 checkpoint user 仍按既有设计进入下一次压缩 input；随后 `preserveCurrentUser` 根据完整 content 判断是否必须在新 details 补回全文。即使 wire ID 没变，裁剪后的 content 也不算完整。

### D4. Tail, concurrency and failure behavior

最终 tail 去重优先使用仍有效的 receipt：用 `receipt.requestIndex - initialTailStart` 定位本次 tail 中的确切 occurrence，索引有效且完整 item 匹配时只移除该项。验证失败或索引不在 tail 中时不删除。没有有效 receipt 时保留现有基于 initial branch 来源及旧检查点的去重规则，不把全文搜索替换为全局去重。

其他调用发起的压缩不登记到当前调用。等待共享 promise 后仍创建新快照，receipt 只在检查点 ID 等全部条件继续成立时可用；遇到另一个检查点即失效。递归保留对象不等于继承其他请求的身份。进程重启或新的公开调用没有 receipt，继续使用旧检查点解析规则。

保留转换的最多三次 leaf 重试、旧模型失败后按现有条件重试当前模型、bypass 策略、自动压缩失败回退、abort、clear 和 model selection 的失效机制。receipt 不影响是否允许重试、是否触发压缩或错误类型。pending prefix mismatch 的 `context-recovery` 分支保存后直接返回，没有第二阶段，保持原逻辑，不为它增加特殊状态。

### D5. Cost

设分支长度为 N，检查点正文总大小为 B，当前任务大小为 U。每次成功保存增加一次分支读取和 checkpoint 查询，以及有限次深比较，成本为 O(N + B + U)。当前实现的 checkpoint parser 本身会克隆正文，因此避免逐条 user 调用 parser，保存后的查询只执行一次。每个同步阶段复用现有 snapshot 的 checkpoint 查询结果。

receipt 只保存一个当前 item 副本，额外常驻内存 O(U)，不存 N 条历史、不跨请求累积；当原 item 未变时更新 checkpoint ID 和 leaf 即可，不再克隆 U。持久化所需的 preservedInput 副本保持原行为。身份承接不触发 provider 序列化，不增加远端请求，也不新增遍历中嵌套全分支扫描。

这是基于所需证据与单次扫描算法的成本上限，不以旧实现耗时为通过标准。worker 通过代码审阅检查增长方式，并按 T4 对额外远端调用和重复 provider 转换建立可失败断言。

## Todo

- [x] 在 coordinator 引入 D2 的请求局部状态和私有入口，按 D3 统一三处检查点保存及后续身份解析，保持 D4 的并发、取消、恢复和错误行为。完成条件为 T1、T2、T3 及 D5/T4 的成本约束通过。
- [x] 在最终回放中按 D4 使用有效 receipt 精确消除当前 tail 的重复 occurrence，保留旧检查点的消歧规则。完成条件为 T1 的持久化与后续回放断言、T2 的重复正文保护及 T4 的全量验证通过。

## How To Test

### T1. Reproduce before implementation

先在 `session-coordinator.test.ts` 增加失败回归并运行，确认失败在第二检查点全文断言，随后再实现。复用同文件现有 ordinary-summary 测试的真实 Pi/provider fixture，不用 `effectiveInputForBranch()` 生成初始请求，以免输入与被测转换共同犯错。

1. 用真实 `SessionManager.inMemory(process.cwd())` 构造 Evidence 的历史、draft 和 edit。用 builtin `gpt-5.5` 与 `gpt-5.6-sol`，核验当前依赖中的 compaction hash 不同，将测试模型 contextWindow 设为 1,000,000。若 builtin 元数据已变，不自行选择新契约，回传 expert。
2. 经 `sm.buildSessionProjection().messages`、`convertToLlm()`、真实 provider `streamSimple(...).onPayload` 得到输入。使用测试合成 token，在 onPayload 捕获后抛 `Stop before network`，沿用已有测试设施，断言已捕获 payload。禁止在线调用。
3. 实际 `createSessionCoordinator` 的 getBranch 和 appendCheckpoint 连接同一个 SessionManager。仅替换远端 createCheckpoint，返回实际 `buildReplacementHistory(input, opaqueItem)`；`opaqueItem.encrypted_content` 按调用序号区分。`shouldAutoCompact` 固定 true，隔离自动调度门槛。ctx 的 session ID、model registry 与该测试会话一致。
4. `selectModel` 后执行一次 `prepareRequest`。断言压缩恰好两次，顺序为 transition、automatic。首轮 input 不包含当前任务，首个检查点 preservedInput 含完整任务；长历史组首个检查点 user 数必须小于原请求，证明实际触发了裁剪。
5. 断言第二检查点 preservedInput 含与真实 payload 当前 user 深相等的全文。用实际 `effectiveInputForBranch` 从最终分支重新构造输入，不传原请求或 tail，断言完整任务出现一次且中间约束保留；再用新 coordinator 的 `prepareCompaction` 从同一分支读取，做相同断言。本文验收“全文出现一次”按完整 content 深相等计数，不要求删除合法的裁剪历史片段。
6. 另外断言本次最终 payload 全文一次。无历史、5 条各 100 字符短历史为对照，三组均通过。保留原无历史测试或参数化合并，不能用它代替长历史组合。

### T2. Identity and compatibility

逐个补齐下列生产入口行为测试，按 Red → Green 推进；已覆盖且预期相同的测试可直接复用并记录名称。

- 旧检查点含 `same`、请求又追加同文 user，但没有本次确认的来源或保存 receipt 时，保留新增 occurrence。保留 `keeps a duplicate user after omitted pre-checkpoint history`、`does not drop a new user that repeats a preserved user's content` 等已有断言；user 条数保护仍生效。
- 首次有效解析来自旧 checkpoint 身份，再经本次转换裁掉长历史并立即自动压缩，同样保留全文。这验证 receipt 的来源不被错误限制为 branch。fixture 的初始请求使用有效 checkpoint 的实际 effective input，当前完整 user 在 preservedInput，构造足够历史触发裁剪。
- 已有检查点 hash 不同但 previousModel 无法解析时，走 `recoverCurrentModelInternal` 的直接压缩路径；初始检查点之后追加新 user，验证恢复生成的检查点、最终 payload 和后续 effective input 完整保留该 user。这个恢复入口不会设置 `transitionCompactionCompleted`，新检查点之后也没有 branch tail，因此保持一次压缩，不强行要求第二次自动压缩。已解析 previousModel 路径由相邻恢复测试覆盖。
- wire ID 相同但 content 已裁剪时必须补全文；其他同文 user 不被删除。保留既有 `restores a checkpoint user when a second compaction truncates the same wire id`。
- 原第 2 项的真实 Pi 重叠普通压缩测试仍通过，C1 不进入当前上下文。原模型转换 fallback、bypass、失败请求清洗、自动压缩失败与重试次数测试继续通过。

### T3. State validity

用可控 promise 暂停远端 compaction，通过生产协调器方法和 SessionManager 操作构造变化，不导出私有 receipt 供测试直接赋值。

- 转换或自动压缩等待期间 `clear()`、切换 model 或 abort：仍按既有路径拒绝过期结果，不追加该结果，不把旧任务保存到新请求。
- 等待时新增 user 或 context_edit：按原路径重试或报 session changed；旧 receipt 不抑制失效检查、不把旧正文认作新正文。检查最终 append 记录。
- 首个检查点保存后，第二次远端压缩失败或 appendCheckpoint 抛错：沿用自动失败回退规则，首个有效检查点仍保有全文；不得登记未写入的第二检查点，也不得增加补发请求。
- 两个公开调用共享 transition 等待：沿用现有共享 promise 用例验证次数及等待顺序。完成后发起新的公开调用，使用旧检查点同文新 user 的歧义输入，验证额外 occurrence 保留，不能复用上一次调用的 receipt。等待者本身没有成功保存动作，不因等待而获得 receipt，结合 D2 的局部状态和 promise 类型做代码核查。
- 对保存依赖返回成功但没有追加、或追加的 details 不等于传入值的故障注入，不授予新 receipt；后续仍由旧解析处理，不误去重。它是承接依据的防御验证，不声明生产存储会出现此行为。

### T4. Performance and final verification

T1 对 0、5 条短历史、5 条长历史都断言恰好两个远端调用；使用真实 provider fixture 时每组只生成一次原始 payload。对 coordinator 执行区间的转换调用用现有 Vitest spy 计数，receipt 承接只读 checkpoint，不应为建立/验证 receipt 新增 provider 序列化；比较已有同步 snapshot 的调用路径，确认每个阶段相同 view 仍复用缓存。测试若无法区分 fixture 与 coordinator 转换次数，限定 spy 区间，不能用耗时猜测。

代码审阅记录 D5 的 O(N+B+U) 上限、无全历史状态和无跨请求累积是否成立。无需新增 benchmark 框架或无依据的毫秒阈值。

依次运行定向 coordinator 测试、codex-compact 测试和 `pnpm run check`。例如 `pnpm exec vitest run extensions/codex-compact/__tests__/session-coordinator.test.ts`，再运行 `pnpm exec vitest run extensions/codex-compact/__tests__`。需要临时目录时在仓库内建立专用目录，通过 TMPDIR 指定，结束后清理。检查工作区仅含本任务改动，记录真实命令、通过/跳过数量、Red 失败点和未验证范围。

### Results

2026-09-23 已完成实现和本地验收。改动文件为 `extensions/codex-compact/src/session-coordinator.ts`、对应 `__tests__/session-coordinator.test.ts` 及本文。保留交接前已有的 `docs/codex-compact-projection-fixes.md` 工作区改动；未修改 `dist/`、公共依赖接口或检查点格式。

- T1 Red：运行 `pnpm exec vitest run extensions/codex-compact/__tests__/session-coordinator.test.ts -t 'persists the edited request through two compactions'`，0 和 100 字符历史组通过，100,000 字符历史组在第二检查点 `preservedInput` 全文断言失败。Green 后三组均通过。测试用真实 SessionManager 投影、`convertToLlm()` 和 provider `onPayload` 产生原始请求，每组只捕获一次 payload，未发起在线请求；真实协调器各发起恰好两次远端压缩，顺序为 transition、automatic。长历史组首个检查点 user 数少于原请求。三个组均断言第二检查点、后续 `effectiveInputForBranch()`、新协调器的 `prepareCompaction()` 和本次最终 payload 保留一次完整任务及中间约束。
- T2：旧检查点身份经长历史裁剪后连续压缩、无法解析旧模型时的直接恢复压缩均通过新增测试。原有重复 user、同 wire ID 裁剪后补全文、真实 Pi 重叠普通压缩、fallback、bypass、失败请求过滤及自动失败回退测试继续通过。
- T3：暂停远端压缩后，对 `clear()`、切换 model、abort、`context_edit` 和新增 user 的转换与自动压缩测试通过；旧结果未追加。第二次远端或追加失败时，首个有效检查点仍保有全文且未补发请求。共享转换等待及后续公开调用的重复正文测试通过。保存依赖返回成功但未追加或写入不同 details 的故障注入没有得到本次身份凭据。
- T4：T1 三组每组只有一次 provider 原始 payload 捕获、两次远端压缩；限定在协调器执行区间的 `convertToLlm()` 调用数分别为 18、63、63，测试约束其不超过该次数。代码核查显示 receipt 验证只读取当前分支及检查点，不触发 provider 序列化；每次成功保存增加一次分支读取和检查点查询，有限次深比较，增长上限为 O(N+B+U)。请求状态只保存一个完整当前 item 副本，下一次成功保存复用未变的副本；不存完整历史，不跨公开调用累积。
- 验证命令：定向 coordinator 测试 74 项通过；`pnpm exec vitest run extensions/codex-compact/__tests__` 953 项通过；`pnpm run check` 2484 项通过、12 项跳过，类型检查、构建及发布包校验通过。

未验证远端加密内容的语义和在线模型行为；本次结论限于本地明文检查点及回放契约。
