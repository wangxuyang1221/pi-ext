# Codex Compaction Plugin Repair Todo

## Understanding

在 Pi `1.3.0` 上完成 codex-compact 的七项修复，并补齐它们共同依赖的来源追踪、请求快照、异步提交保护和集成验收。只修改本仓库插件，不要求修改上游 Pi；生产修复已落地，执行记录见下文。I16 的 Linux 实机验证尚未完成；其余已勾选项表示本地实现及对应离线验证完成，不代表真实服务端验收。

依据为 [研究报告](codex-compact-plugin-repair-proof.md)及其 36 组离线探针。研究基线是 `8667f5fdd41419f7475e5dc5a2421cef19dfccb0`；隔离候选通过不等于生产代码已修复。此前的 [Pi 1.3 compatibility todo](codex-compact-pi-1.3-compatibility-todo.md)保留其已完成范围，本计划接续处理其余问题。

| ID | Repair | Main files |
| --- | --- | --- |
| F1 | 压缩后错误带回旧 system update | `src/session-projection.ts`, `src/native-compaction.ts` |
| F2 | pending tool calls 期间的 system 顺序及派生 ID 不一致 | `src/native-compaction.ts` |
| F3 | 同一用户输入的截断版和全量版重复保留 | `src/index.ts`, `src/session-coordinator.ts`, `src/native-compaction.ts` |
| F4 | hidden declarations / forced prompt 的合法投影被拒绝 | `src/session-coordinator.ts`, `src/index.ts`, `src/remote-compaction.ts` |
| F5 | grammar tool 的 item ID 保留规则不完整 | `src/native-compaction.ts` |
| F6 | 调度漏算当前输入，固定 retention 导致最终请求超窗 | `src/session-coordinator.ts`, `src/scheduler.ts`, `src/remote-compaction.ts` |
| F7 | 非成功 HTTP response 的 body 读取缺少总时限 | `src/native-compaction.ts` |

表中路径均相对于 `extensions/codex-compact/`。测试修改放在对应 `__tests__/`，不手动编辑 `dist/`。沿用 Pi 固定版本、Node.js 22.19+ 和 `packageManager` 指定的 pnpm；不在修复中顺带升级依赖。

## User Visible Changes

- 压缩、恢复会话和继续工具调用后，不再因旧 system update、工具结果顺序或 grammar ID 差异而错误拒绝合法请求；真正不匹配的历史仍拒绝回放。
- 长用户输入不再因截断而被重复补回。同文但不同次提交仍分别保留；明确属于本次待发送的输入只保留一份完整内容。
- 受支持的隐藏声明、强制提示词配置可以继续压缩和恢复。首次手动压缩若缺少证明当前投影所需的信息，会取消本次操作、保留旧 checkpoint，并给出具体原因；无此信息缺口的配置仍可立即手动压缩。
- 自动压缩会考虑最终请求中的当前输入、工具与提示词。在小窗口或长输入场景中，保留的旧历史明文可能少于原来的 64k tokens，以给当前请求留出空间；不会为满足本地估算而截断当前输入。
- 容量修复有明确次数上限。没有进一步压缩收益时会停止重复压缩；本地估算偏高不会单独成为禁止正常 provider 请求的理由。
- 非成功 HTTP 响应的 body 即使挂起或持续缓慢发送，也会在总时限内结束读取；取消及时生效，认证错误不会因 body 超时变成可重试错误。

## Todo

### 1. Locate

- [x] **L1 — 确定输入来源与覆盖契约。** 梳理 `createBranchInputSnapshot`、Pi projection、converter、`RequestReceipt`、`prepareCompaction` 和 checkpoint parser 的数据流，确定消息实例如何表示、合成结果如何关联原调用、checkpoint 覆盖如何记录。区分人的本次输入、已执行历史、custom/bash/summary 转成的 wire user；形成字段与状态转换说明，供 F1–F3、F6 共用，不引入“任务语义已完成”的推断。
- [x] **L2 — 确定可证明的投影范围及生产算法。** 列明 hidden/forced、工具移除与重声明、描述变更、context hooks、provider handlers 顺序的支持条件；确认插件能获得的快照和版本信息。确定非指数的候选约束与有效回放等价性算法，以及首次手动压缩的受控路径、凭据失效与拒绝条件。若某类配置无法证明，记录具体缺失信息及适配契约，不能默认纳入支持范围。
- [x] **L3 — 确定完整请求会计与修复状态机。** 核对 `autoCompactScope: total/bodyAfterPrefix`、默认 95% effective window、usage/metadata 校正、64k retention 和各入口的现有语义，明确最终组装估算与触发阈值的职责。定义一次 logical request、压缩收益、内部预算收敛和远程尝试的计数边界，防止 checkpoint 更新或 provider retry 重置计数。
- [x] **L4 — 确定快照成本与异步适用条件。** 核验 branch、context edits、payload、工具描述/schema/grammar 的可变性与现有 generation guards；决定哪些数据需要一次复制、哪些可安全共享。确定提交前必须核验的 revision、缓存作用域和非指数算法的时间/空间上界；无法观察的私有 hook 状态不能凭 branch leaf 未变视为有效。
- [x] **L5 — 确定错误 body 的资源与分类契约。** 核对 fetch header timeout、成功 SSE idle timeout、HTTP status、retry-after、`MAX_REMOTE_RETRIES`、fallback 分类和取消传播，确定错误 body 总 deadline 的配置归属与默认值。评估现有 body 缓冲成本；若必须增加大小上限，明确截断后的诊断与分类规则，并给出阈值依据。

### 2. Implement

以下按依赖顺序推进。I1–I3 提供投影基础；I4–I7 完成请求证据与提交保护；I8–I10 统一输入保留；I11–I13 完成预算修复。I14–I16 可独立实施，但仍须通过最终组合验收。每项完成都包含下文对应的功能、失败路径和性能验证。

#### Projection and conversion

- [x] **I1 — 使用真实 Pi active projection 修复 F1。** 有效自有 Codex checkpoint 的 pi-context 路径改用已有 `projection.piContext()` / `buildSessionProjection()` 结果，只移除该路径由自有 checkpoint 替代的 compaction summary，保留 merged leading system baseline、context edits 和来源字段。删除仅服务于错误重建路径的 native-range 缓存；普通 Pi summary、无效/未知 checkpoint 路径不得套用删除规则。
- [x] **I2 — 按 Pi 规则规范化工具调用组，修复 F2。** pending 期间暂存 system messages，先输出真实结果，在下一 user/assistant 或结束处补齐缺失结果，再输出暂存 system。组关闭不能仅看 pending map 是否清空；规范化后的序列统一决定 messageIndex、assistant fallback ID 和 tool-load ID。来源随复制、移动和合成传播，跨 checkpoint 截取按来源和调用组边界完成，不使用重排前数组位置。
- [x] **I3 — 按 replay 类型校验 item ID，修复 F5。** 对齐 Pi 的 provider/API normalization，再分别核验 function 的 `fc_` 与 grammar custom 的 `ctc_`；同 provider/API 跨模型省略 item ID，保留合法 `call_id` 配对。保留同模型合法 ID，不通过全清空或替换前缀掩盖错误；保留既有跨模型 thinking 兼容行为。

#### Request evidence and replay

- [x] **I4 — 建立一次请求共用的不可变证据快照。** 在入口首次 `await` 前固定 branch/context edits、checkpoint 边界、model/compat、实际 payload 的 input/instructions/tools、声明格式和 session/request generation。来源、投影、预算与远程请求使用同一快照，按 L4 决定复制方式，避免各阶段重复深拷贝完整历史或异步后混入 live tools。
- [x] **I5 — 实现受支持投影的严格匹配与回放等价性判定，修复 F4。** 用 L2 确定的算法覆盖实际配置可能产生的候选，比较完整 input/instructions/tools，包含 additional-tools、tool-search、grammar 和 converter compat。仅在存在匹配且所有匹配候选导出同一有效回放时接受；有效回放包含旧 opaque checkpoint、保留输入、checkpoint 后可见 suffix 及本次输入。允许无关隐藏集合差异，不要求逐项来源唯一；禁止穷举全部工具子集、放宽 prefix 或以当前 payload 重压覆盖未知旧历史。
- [x] **I6 — 接通全部请求与手动压缩入口。** automatic、model transition、overflow recovery、manual、resume/reload 后首次操作和最终 replay 共用 I4–I5 的证据规则。实现 L2 中可验证的手动路径及凭据失效；无法确定投影时仅取消本次压缩并给出具体原因。修正 `remote-compaction.ts`，区分“未观察 payload”和“已观察到 tools 缺失/为空”，后者不得回退为全量工具；不以 `getAllTools - payload.tools` 推断 hidden set。
- [x] **I7 — 在结果提交前核验适用性并清理作用域。** 保留现有 session/model/signal/leaf guards，增加操作实际依赖的 context、request、prompt/declaration revision 检查；过期结果不得写入 checkpoint 后再判无效。resume、reload、fork、session/model 切换正确清理证据、缓存与尝试计数；不同请求隔离，同一 logical request 才能合并并发压缩。对没有可靠 revision 的私有策略使用明确适配契约，不伪造宿主 getter 或版本保证。

#### Input retention and checkpoint compatibility

- [x] **I8 — 将压缩输入、保留历史和当前输入分开，修复 F3。** 建立共用 compaction plan，分别表示 `compactionInput`、`retentionInput`、`preservedInput`、受保护 suffix 及其来源/覆盖。只把确认为本次待发送且尚无执行进展的输入从历史压缩与 retention 排除，最终补回一次；已经执行工具的历史进入正常压缩规则，不无限保护整段任务。移除按最后 wire user 和全文相等决定补回的逻辑，不用 stopReason、manual 或 willRetry 推断任务完成。
- [x] **I9 — 持久化并解析必要的来源/覆盖元数据。** 按 L1 扩展新 checkpoint 的可选字段，同步 writer、parser 校验、续压、分支恢复和序列化 round trip，避免 parser 静默丢字段。两个同文但不同 entry 的输入保持独立；synthetic tool result 关联调用来源，不伪造独立 entry。元数据不存储重复的完整消息正文。
- [x] **I10 — 实现旧 checkpoint 的保守兼容与原子替换。** 缺少来源元数据时，只采用可唯一证明或可证明有效回放一致的映射；不按相似文本删除、不改写 opaque 内容、不原地清空旧保留历史。无法证明时保留旧 checkpoint 并中止本次操作；只有新结果通过回放与适用性校验、完成 I12–I13 的预算处置后才提交替换，失败和取消均不损坏旧状态。预算处置允许“本地仍估算超窗但交给 provider 判断”的结果，不要求本地估算必须低于窗口。

#### Complete request budget

- [x] **I11 — 用最终组装请求做容量判断，修复 F6 的遗漏。** 共用估算入口覆盖 opaque prefix、retained history、受保护 suffix、当前输入及附件、instructions/tools；保持 L3 确定的 scope 与 usage 语义。移除 no-tail 对“存在可压缩历史且最终请求超窗”场景的错误短路；远程 compaction input 仍只包含允许压缩的历史，不能为触发调度而把新输入塞入历史。
- [x] **I12 — 按剩余窗口缩减旧明文，并复查组装结果。** 64k 保留为历史明文预算上限，实际预算受 effective window 减去不可缩减部分后的余额约束，不重复扣除 95% margin。收到新 opaque 结果后，以统一 estimator 重新组装并估算，计入截断标记、结构和附件成本；采用有限、单调缩减的本地调整，显式处理无进展。不能使用探针单例中的 22-token 差值作为固定修正值，也不能假设旧 opaque 已覆盖所有将删掉的保留文本。
- [x] **I13 — 限制容量修复次数并保留正常发送机会。** 每个 logical request 最多一次本地估算触发的远程历史修复，以及一次实际 provider overflow 后的恢复；内部 HTTP retry 独立按原有上限计数，checkpoint 更新不得重置 logical attempt。新输入或模型变化按 L3 建立新 scope。无进一步可压历史或本地估算仍偏高时，不截断当前输入，允许正常 provider 尝试；实际 overflow 且无收益/已达上限时明确结束恢复，不循环重压。

#### Transport and test infrastructure

- [x] **I14 — 给非成功 response body 增加总 deadline，修复 F7。** 在 `callRemoteCompaction()` 内接入可取消 reader，总时限不因收到 chunk 重置。正常 EOF、超时、外部取消、读取异常均清理 timer、监听器、reader lock 和 attempt 资源；外部取消立即终止。按 L5 处理必要的缓冲上限，保持成功 SSE 的既有 idle 策略。
- [x] **I15 — 将 body outcome 接回 HTTP 重试与 fallback 分类。** 同时保留 status 和读取结果，401/403/quota 不因读取超时变为普通可重试错误；503 按既有次数和 retry-after 处理。不完整 body 不能放宽模型 fallback 条件，取消不能启动下一次 retry/fallback；最终错误保留可用诊断信息。
- [ ] **I16 — 修正跨平台 fixture，并补足真实 SDK 集成夹具。** 将 `full-reference.test.ts` 中会被 `mockReset` 清空的 decoder mock 改为逐用例安装并恢复，保留根配置的 `mockReset`。复用研究探针的隔离 provider/transport 思路，为正式测试提供真实 AgentSession、ExtensionRunner、session persistence 与可控响应；不让固定中间 payload 绕过本次要验证的调度和转换路径。

### 3. Deliver

- [x] **D1 — 更新使用与兼容文档。** 在 `README.md`、`extensions/codex-compact/UPSTREAM.md` 及相关配置说明中写清七项变化、hidden/forced 支持条件、手动压缩失败原因、动态 retention、尝试上限与旧 checkpoint 行为。产品日志/提示采用英文，说明用户可以采取的具体操作，不宣称兼容任意私有 hook。
- [x] **D2 — 保留研究基线并区分实施后的证据。** 为原探针注明适用基线及包含“复现旧缺陷”的断言，保留原 `evidence.json`，不覆盖成修复成功记录。生产验收引用正式测试和新的结果；研究报告补充实施状态与链接，不把隔离候选证据改写为真实服务端验证。

## How To Test

### Execution and evidence

先为每项修复写能在旧代码失败的行为测试，再实现、运行受影响测试并重构。正例与拒绝例同时保护；不以私有辅助函数调用次数替代对最终 payload、checkpoint 和错误行为的检查。

优先复用 `responses-parity`、`session-projection`、`native-compaction`、`index`、`session-coordinator`、`request-lifecycle`、`resume-runtime`、`remote-boundaries`、`scheduler`、`window-evaluation`、`usage-accounting`、`reasoning`、`full-reference`、`host-compatibility` 等现有测试。测试名、断言和 fixture 字段按仓库语言约定使用英文。

原 36 组探针含“断言旧缺陷存在”的检查。迁入正式测试时必须改为目标行为，并保留原始失败输入；不能把修复后原探针失败当作回归，也不能把它仍通过当作修复完成。

### Investigation acceptance

- L1：逐步追踪真实 raw user、custom user、重复文本 user、tool result 和 context edit，记录每次变换的来源及 checkpoint 覆盖。用 stop 后追加 custom continuation 的真实 SDK 用例证明实现未偷用“首个 stop 等于任务完成”。
- L2：以真实 Pi converter/ExtensionRunner 为参照，对 hidden、forced、两者组合及声明变化生成 payload；在小工具集合上用原 bounded oracle 对照生产算法，比较匹配与有效回放结论。oracle 仅供小规模测试，不能进入生产路径。对候选覆盖不足的配置列出反例和拒绝条件。
- L3：记录各 scope 下当前输入、tools、opaque、retention、usage 修正的账目；分别构造 local estimate 超窗、真实 overflow、provider 接受估算超窗请求，确认状态机有不同结果。确定内部收敛上限和无进展条件后写成可失败断言。
- L4：在 await 中分别改变 branch、context edits、模型、工具描述、隐藏策略和 session generation；确认哪些改变宿主可观测，哪些依赖适配契约。测量一次快照、投影与序列化的扫描/复制次数，依此选择共享与复制边界。
- L5：用挂起、持续 chunks、异常中断和完整错误 body 检查 timeout 与分类；若引入大小上限，增加超限及截断 JSON 用例，证明不会把不完整信息误判为允许 fallback。

### Functional matrix

| Area | Inputs and production path | Expected result |
| --- | --- | --- |
| F1 | native checkpoint、普通 compaction 后接自有 checkpoint、重叠 compaction，经 Pi projection → branch snapshot → wire converter | 与 Pi 真实 input 逐项一致；旧 system 不复活，merged baseline 与来源保留 |
| F1 boundaries | 普通 Pi summary、无效/未知 checkpoint、context edits、full-history/pi-context/effective 各 view | 普通 summary 不丢失，未知格式不被当作自有格式剥离；实际覆盖与来源一致 |
| F2 | orphan、真实 result、并行部分 result、多个 system，分别用 additional-tools/tool-search；包含 call → system A → result → system B | 完整 input、顺序、synthetic result 数量及所有派生 ID 与真实 converter 一致 |
| F2 boundaries | pending group 跨 checkpoint、结果缺失、后续 user/assistant 与 EOF | 截取不拆坏调用组，不漏/重复结果；归一化前后的索引不会混用 |
| F5 | 同/异 provider/API、同/跨模型，function/grammar 互换，合法/错误/缺失 item ID | 与 Pi ID normalization 一致；同模型合法 ctc 保留，跨模型 ctc 清空的既有正例不回归；call/result 配对 |
| F3 | 280,000 字符单次用户输入、两个同文不同 entry、user 后 custom/bash/summary、已执行工具历史 | 同一 occurrence 不同时保留截断版和全文；不同 occurrence 不误删；wire user 不冒充人的新输入 |
| F3 lifecycle | 真实 AgentSession 手动 compact、达到 threshold 后下一 assistant、真实合成 overflow 错误触发 recovery | 三条入口自行产生 reason/willRetry，经真实 handler → plan → remote transport → checkpoint → 下一 payload，当前输入恰好一次；不能手填 flags 代替此项 |
| F3 continuation | toolUse、length、stop 后 boundary/custom continuation、steering/follow-up、abort 后手动压缩 | 不按 stopReason 判断目标完成；恢复省略正确 attempt，不任意删除最后 assistant |
| F3 persistence | 新/旧 checkpoint，保存重开、fork、resume、reload、连续两次压缩、畸形可选元数据 | 新元数据 round trip；旧格式不猜测去重；错误/取消/不确定映射不破坏原 checkpoint |
| F4 valid | hidden、forced、组合；工具新增/移除/重声明、描述/schema/grammar、隐藏切换、MCP 迟到、多个受支持 hook | 全 wire 匹配且有效回放相同则接受；多个等价策略不误拒。未适配的变换按明示边界拒绝 |
| F4 invalid | 改用户正文、删历史 user、调换 user/assistant、改未授权工具 schema/描述；同 wire 但跨 checkpoint 来源导致不同 replay | 严格拒绝；旧 opaque 不被 actual payload 的重压结果替换 |
| F4 manual | 首次无 provider 请求、恢复后首次手动、有效已观察快照、快照过期、无动态隐藏配置 | 受控且信息充分的配置立即成功；信息不足时仅取消本次并给原因；不一刀切禁用 manual |
| F4 declaration | 已观察 tools 缺失、已观察空数组、未观察 payload；additional-tools/tool-search/grammar | 前两者不重新声明隐藏工具；第三者仅走受控且可证明的构造路径 |
| Async state | 远程 await 中切模型/分支/session、改 context 或声明；取消；旧 callback 晚到；两请求并发 | 不适用结果不提交；同 branch 的声明变更也被正确处理；请求间证据不串用，资源和缓存按 scope 清理 |
| F6 trigger | 128k 原窗口、121,600 effective window、最终估算约 134,027 的 no-tail fixture；total/bodyAfterPrefix | 有历史压缩价值时进入容量修复；当前输入和工具等不再从最终容量判断中漏掉 |
| F6 retention | 小窗口、模型下切、长中文、图片/附件、截断标记、多工具、opaque 无缩减 | 统一 estimator 复查最终请求；旧明文预算单调有界，当前输入不截断，不靠固定 22-token 补丁 |
| F6 limits | 当前输入与不可缩前缀本身超窗；本地高估而 provider 接受；真实 overflow；新 checkpoint 后再次判断 | 正常 provider 机会保留；每 logical request 本地修复 ≤1、overflow 恢复 ≤1，无收益或耗尽时停止；HTTP retries 另按既有上限 |
| F7 | 401/403/quota/503 的挂起 body、持续 chunks、读取失败、正常 EOF、外部取消 | 总 deadline 生效，status 分类保持；认证/quota 不误重试，不完整 body 不放宽 fallback，503/retry-after 有界 |
| F7 cleanup | body deadline、header timeout、正常错误返回、成功 SSE、retry 中取消 | timer/监听器/reader lock 清理，取消后无新 attempt；成功 SSE 原 idle 行为不回归 |
| Fixture | Darwin decoder mock、多用例 mockReset，以及 Linux 无原生 Darwin decoder 路径 | 每个用例独立获得预期 mock；不修改生产 decoder 迁就测试，不将本机平台模拟冒充 Linux 实测 |

F4 的 forced 路径若以当前 payload.instructions 为权威，验收只证明该信任契约内的回放正确，不能声称独立验证了 prompt 来源。多 provider handlers 的验收必须覆盖支持的执行顺序；本 handler 看到的 payload 不是后续 handler 修改后的最终结果。

### Integration boundary

正式离线集成从真实 AgentSession 的用户提交、工具执行、手动 compact 或 provider 错误开始，保留 Pi 的调度、projection、ExtensionRunner、converter、插件 coordinator、checkpoint 持久化与恢复。仅在网络边界替换 provider/compaction 响应及时间，截取最终出站 payload；fixture 的工具执行可以受控，但消息生成和传递不能固定为中间数组。

该验收能证明本地协议、状态、发送内容与资源生命周期，不能证明真实服务端接受 encrypted checkpoint，也不能证明模型总结质量。若缺少真实服务凭据或可用环境，明确记录此限制，不把离线 opaque fixture 记成真实服务端通过；已有真实服务质量验收按其环境要求执行。

### Performance and resource acceptance

令 N 为参与处理的消息/entry 数，T 为声明事件数，B 为相关正文和 schema 字节总量，K 为依支持规则需要检查的候选等价类数。L2/L4 必须给出 K 的上界及依据，不能让 K 等于全部 hidden subsets 的 `2^T`。目标是在每个有界候选类中线性处理 N、T、B，或说明必要的索引排序成本；禁止每个 entry 都重新转换完整历史。

- 在实现前采集相同环境的参考成本，使用 N=1,000/2,000/4,000 和工具数 10/100/1,000 的独立扩展负载，包含重复同文、频繁声明变化和大 schema。记录 Node/Pi 版本、候选数、扫描/转换/复制次数及峰值内存，不只记录总耗时。
- 将完整历史投影次数、序列化次数、候选类上界、每请求远程调用数和并发合并规则写成确定性断言。输入翻倍时，算法工作量应符合已确定的线性或排序上界；由 L2/L4 推导常数，不能以旧代码或首个实现的测量值直接作为合格门槛。
- 将输出 payload 本身需要的 O(B) 存储与中间工作内存分开。允许常数份必要快照，禁止按消息数复制全文；重复请求、resume/reload/fork 后，过期 receipt、快照和 listener 不累积。跨请求缓存必须有清理规则或有依据的容量边界。
- 用 fake timers 和 request counters 确认 body 总 deadline 不受 chunk 频率影响，retry/fallback/容量修复都不无界。用真实 reader 验证 cancel/release，而非只断言 timeout promise 返回。
- 墙钟耗时与峰值内存用可重复负载补充验证，预热后多次采样。绝对门槛依据不足时先完成 L2/L4 的候选实验再固定；确定性复杂度和资源清理断言仍必须通过。

### Final verification

执行实现任务时先确认实际 Node 与 pnpm 版本。需要安装依赖时使用 `pnpm install --frozen-lockfile --ignore-scripts`。每项运行其相关测试，所有实现完成后运行：

```sh
pnpm run check
```

预期类型检查、全量测试、构建、发布包和 source/dist host 加载检查全部通过；Pi 仍为 `1.3.0`，扩展加载无错误。涉及质量/宿主集成的变更再按现有脚本补跑相关验收，不用普通 unit tests 代替其路径。跨平台 fixture 至少完成 Darwin 与 Linux 路径验证；未获得真实 Linux 环境时说明模拟边界，实际平台结果保持待验。

在本节记录实际执行命令、平台、结果、跳过原因和剩余证据缺口；未通过或仍缺必要证据的实现项不得勾选。结束前停止本任务启动的服务/后台进程并确认监听端口释放。先前研究阶段的 2,699 个通过测试只作为基线，不作为这些修复的验收结果。

计划阶段基线：编写 TODO 时尚未实施 I1–I16。2026-10-22 在本机 Darwin、Node `v22.22.2` 环境运行 `pnpm run check`，退出码为 0：181 个测试文件通过、4 个跳过，2,699 个测试通过、13 个跳过；类型、构建、发布包检查通过，source/dist 各加载 8 个扩展，`loadErrors` 均为 0。现有 `/mcp` command replacement warning 仍有输出。日志位于 `.tmp/codex-compact-repair-todo-check.log`，文档相对链接与尾随空白检查通过。本轮结果仅证明编写计划时仓库检查通过，不是七项修复的验收，也不包含 Linux 或真实远程服务验证。


## Implementation record

2026-10-22 在本机 Darwin、Node `v22.22.2`、pnpm `11.9.0`、Pi `1.3.0` 实施。只修改 source、正式测试与文档，没有修改依赖版本；dist 由构建生成，没有手动编辑。

### Shared contracts

- `ResponseInputView.userSources` 用 raw entry ID 标记 wire user 的来源。真实 user、custom message 等可以生成相同 wire role，但来源仍不同。工具组规范化时保留原对象身份；合成 result 继承所属调用组的保留资格，跨 checkpoint 只保留所需调用组和边界后的消息。
- `CompactionInputPlan` 分开历史 input 与受保护的 `preservedInput`。只保护最后一个真实 user entry 及随后 custom suffix，且其后没有成功 assistant 或 tool result。这里判断的是执行进展，不是用户目标是否完成。`preservedInputSources` 与保留数组对齐，用 entry ID 或 null 表示来源；parser 校验长度和类型，旧 checkpoint 不生成虚构 ID。
- 对旧记录只采用严格 prefix 和唯一 occurrence 映射；无法证明的 model transition 输入不再走“取最后 wire user 重压”的 fallback。新 receipt 校验完整 suffix；checkpoint 更新后继续压缩会先从 retention 输入移出已经确认的本次 suffix。两个同文、不同 entry 仍是两次输入。
- 每个请求在首次 await 前复制 branch、model、tools 和 payload。提交前重新核验 branch 全内容、工具声明、prompt、模型、session/generation/signal；同 entry 原地修改也会取消，过期错误不会写 bypass marker。快照和映射仅在当前操作内复用，长期 Map 每 session 只保留最近一次观察和尝试 key，clear/model selection 清理。
- logical attempt key 包含模型配置、hash、prompt、tools、最新 wire user 及应用 context edits 后的 raw history 来源；去掉已省略的 error/aborted assistant，自有 checkpoint 写入不改变 key。不同 user entry 或实际请求输入变化建立新 scope。本地自动修复至多一次；真实 overflow 的一次恢复由固定 Pi 1.3.0 AgentSession 管理，HTTP retry 单独最多两次额外尝试。
- auto/downshift 判断包含当前输入和 suffix；total/bodyAfterPrefix 以及 usage 校正继续由既有 scheduler/accounting 决定。retention 先扣最终 opaque、受保护输入、instructions/tools，再以最终 estimator 检查，二分预算上限为 64,000，最多 16 步。不可缩部分本身超窗时保留完整输入，让 provider 判断；不会因单独的本地高估循环压缩。

### Projection support

工具只新增时，生产算法检查 normal、minimal hidden、maximal hidden、forced 四个候选。hidden 名称来自 raw/active declaration universe 和实际 wire 中可见声明，不能用 getAllTools 减去顶层 tools 代替。只在完整 input/instructions/tools 匹配且所有匹配候选有效回放相同时接受。小规模三工具 oracle 枚举 16 种策略与生产选择对照；指数枚举仅存在于测试。

工具移除或重声明后，支持精确普通投影，以及 prompt 文本足以区分的 forced 投影；无法证明的 hidden 组合拒绝。任意 context hook 和在本 handler 之后改写 payload 的 handler 不在支持契约内。forced 路径信任已观察 instructions；隐藏策略的私有闭包变化没有公开 revision，不能宣称自动观察到了这种变化。

provider 请求以外的压缩使用仍有效的观察快照，或显式 `manualProjection`。其 `hiddenTools` 是实际隐藏工具名，`forcedPrompt` 是可选的完整非空字符串。真实 SDK 测试证明 Pi 在回合结束后恢复基础 prompt，因此本实现不以布尔配置从 `getSystemPrompt()` 推断旧 forced prompt。声明或历史发生变化后，旧观察快照不再授权本次压缩；没有工具时仍允许直接操作。该限制也适用于 Pi 自行发起的 threshold/overflow hook，使用动态隐藏配置时应保持显式契约同步。

### Transport contract

错误 body 总 deadline 为 300 秒，与成功 SSE 的 300 秒 idle 策略分开计时。1 MiB 是诊断存储上限，错误 JSON 通常远小于此值；此上限不作为内容分类依据。达到上限、超时或读取失败均标记 incomplete；保留 HTTP status，不放宽模型 fallback。incomplete 429 不猜测 rate-limit 或 quota，停止重试；503 仍按 retry-after 和既有重试次数处理。reader 取消不等待可能挂起的底层 cancel hook，释放锁并移除 timer/listener。

### Test evidence

| Path | Evidence |
| --- | --- |
| F1/F2/F5 | `responses-parity.test.ts` 对照真实 provider converter，覆盖 native/ordinary/overlap checkpoint、system 暂存、跨边界并行工具组和 grammar ID 身份矩阵 |
| F3 and persistence | `session-coordinator`、`session-projection`、`index` 覆盖长输入、来源元数据、context edits、重复文本、custom suffix、连续压缩、保存后恢复和失效 receipt |
| F4 | `responses-parity`、`request-projection` 严格正负例与 bounded oracle；`repair-runtime` 实际 prepareLoadout/before_agent_start hooks 和显式策略下的 manual 后续回放 |
| F6 | `remote-boundaries` 最终窗口保留预算；`session-coordinator` 完整 downshift/current suffix 预算、no-tail、估算失败后正常发送机会和不重置尝试次数 |
| F7 | `native-compaction` 真实 ReadableStream + fake timers，覆盖挂起、持续 chunks、401/403/429/503、取消、超限、读取失败、清理及正常 SSE |
| SDK lifecycle | `repair-runtime.test.ts` 真实 AgentSession 自行触发 manual/threshold/overflow，重复 overflow 仅一次 compact-and-retry；session 文件重开后 checkpoint 相同。只替换目录发现和网络响应 |
| Existing continuation | `resume-runtime.test.ts` 保留真实 goal continuation、工具导致的 system update 和 abort 后恢复路径 |

本轮新增行为均先运行针对性用例，核实失败原因后实现；已满足行为的额外覆盖直接记录通过。真实 SDK forced manual 用例曾暴露基础 prompt 被误用，已改成显式 prompt 字符串。临时日志在 `.tmp/repair-*.log`，例如 `repair-crossing-red/green`、`repair-source-reload-red/green`、`repair-stale-bypass-red`、`repair-forced-manual-green`；日志不提交。原探针的 36 组 `evidence.json` 未覆盖。

### Cost and resource evidence

`request-projection.test.ts` 对 K≤4、最多 5 个 snapshot、最多 13 次完整 view 转换做确定性计数。forced synthetic head 为三个 view 各增加一个 entry conversion。1,000/2,000/4,000 条消息分别处理 13,023/26,023/52,023 条 message，工具扩展到 100/1,000 个时候选数量不增加。每个候选的消息、正文和工具声明扫描为线性，空间为常数份 O(N+T+B) 工作数据，没有逐 entry 重转换整个历史。

单独运行时，预热后的三个样本分别为 8–10 ms、13–14 ms、28–34 ms；1,000 条消息加 100/1,000 个含较大 schema 的工具为 6–9 ms。进程累计 peak RSS 为约 156–181 MiB，包含 Vitest、Pi、模型目录和此前样本，不能当作算法独占峰值。未采集实施前同负载的墙钟基线，因此不宣称运行速度提升。正确性标准是固定候选上界和线性工作量，墙钟数据仅供复跑比较。

### Remaining validation

I16 的逐用例 decoder mock 修复、真实 SDK 夹具及 Darwin 路径已完成。尚未在 Linux 实机运行完整检查，因此 I16 保留未勾选；平台 mock 不能替代该结果。没有调用真实 Codex 服务，离线 opaque 不能证明服务端接受、总结质量或真实 token 数。此项不是用离线测试可以补足的证明。

完整 `pnpm run check` 于 2026-10-22 17:08 启动，退出码 0。183 个测试文件通过、4 个跳过；2,765 个测试通过、13 个既有测试跳过。类型检查、web-search 类型检查、构建、发布包检查通过；source/dist 各加载 8 个扩展，`loadErrors` 均为 0。既有 `/mcp` command replacement warning 保持不变。完整日志为 `.tmp/codex-compact-repair-final-check.log`。`git diff --check` 通过。任务未启动常驻服务，所有测试夹具在 finally 中关闭 session 并清理工作区临时目录；截至本次实施验证结束尚未创建 commit 或 PR；后续分支提交以 Git 记录为准。

## Notes

- “全部修复”覆盖七项缺陷及其必要的共用基础，但不等于支持任意私有 context/loadout/payload hook。Pi 1.3.0 存在普通插件观测不可区分、正确回放却不同的配置；这类场景必须通过适配契约取得信息，或明确拒绝本次操作。
- 不加入自动延期手动压缩、新的上游 API、自动升级 Pi 或“未完成任务永远保留全部原文”等额外功能。后者会改变 retention 的成本与语义，不能作为去重修复的隐含要求。
- 不将本地 token estimator 解释为服务端精确计数；保留正常发送机会和有限 overflow 恢复，正是为了处理估算误差。
