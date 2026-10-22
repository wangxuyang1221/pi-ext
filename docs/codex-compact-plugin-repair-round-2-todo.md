# Codex Compaction Plugin Repair Round 2 Todo

## Understanding

修复第一轮复审指出的四项回归，补齐 F3 的旧 checkpoint 兼容、F4 的失败请求清理顺序，以及 F6/F7 的认证终止和容量修复次数。只在 Pi `1.3.0` 插件内修改，不扩大到其他缺陷或功能。

本轮基线为 `9aac58af3ae334d48ed6907fd2b78fe19e80e676`，分支为 `fix/codex-compact-pi-1.3-repairs`。依据为[原会话复审](https://chatgpt.com/c/6ad9af31-94b0-83e8-a35e-ed34b1d2feb7)、[第一轮 TODO](codex-compact-plugin-repair-todo.md)及本地源码核对。[第二轮实现设计](codex-compact-plugin-repair-round-2-design.md)已经确定算法、接口、错误与额度边界。L1/L2 的静态调查和设计、四项本地 Red/Green 及受影响回归已完成。完整检查和 expert 最终复核均已通过，提交状态见 Evidence Record。

| ID | Original scope | Reported defect | Primary implementation |
| --- | --- | --- | --- |
| R2-1 | F3 / I10 | 旧 checkpoint 无来源字段时，manual 续压失去 pending user 的完整显式回放 | `native-compaction.ts`, `session-coordinator.ts`, `index.ts` |
| R2-2 | F4 | 已清理 branch 与未清理 payload 提前比较，误拒失败请求之后的合法发送 | `session-coordinator.ts` |
| R2-3 | F6 / F7 | automatic coordinator 吞掉空正文 HTTP 401/403 | `native-compaction.ts`, `session-coordinator.ts` |
| R2-4 | F6 / I13 | 同 hash 容量下切未消费本地修复额度，随后再次压缩 opaque | `session-coordinator.ts` |

表中实现文件位于 `extensions/codex-compact/src/`。测试位于对应 `__tests__/`，优先复用现有真实 SDK 与 transport 夹具。F1、F2、F5 和 decoder fixture 保持既有行为，只检查本轮修改造成的直接回归。

## User Visible Changes

- 恢复旧 checkpoint 后手动压缩，尚无成功执行进展的用户输入不会静默退化成截断历史。能证明来源时完整保留一次；无法证明时取消压缩、保留旧 checkpoint，并给出明确原因。
- 上一次请求失败后，再提交合法新请求，可以正常清理失败输入并继续；有 checkpoint 时保留原有 opaque。
- 自动压缩收到真实 HTTP 401/403 时终止当前操作，即使错误正文为空或读取不完整，也不会提示跳过压缩后继续发送原请求。
- 同 hash 的窗口缩小与普通 automatic 压缩共享一次本地修复额度。修复后只剩 opaque 和受保护后缀时，不再发起第二次无收益压缩；本地仍估算偏大时保留正常 provider 尝试机会。

## Working Agreement

- 本轮仅实现 R2-1 至 R2-4 及其必要的测试、错误诊断和文档修正。固定 Pi `1.3.0`，不修改上游，不升级依赖，不替换整套 serializer，不手改 `dist/`。
- 不增加语义任务完成判断。成功 assistant/tool result 等执行进展的既有判定保持不变；同文不同来源仍分别处理。
- 不放宽完整投影校验，不增加对任意私有 hook 或更晚 payload 改写的支持；`manualProjection` 契约保持不变。
- 旧 encrypted content 原样处理，不假设 opaque 已完整覆盖将被删除的明文。未证明安全前，不修改旧 checkpoint，也不通过 bypass 掩盖本次失败。
- 内部 HTTP retry、实际 provider overflow 恢复和 hash 不兼容所需的协议迁移，与本地容量修复分别计数。禁止把所有不可重试错误都解释成认证错误。
- 使用 Node.js `22.19+`、仓库指定的 pnpm，执行前记录实际版本。安装依赖使用 `pnpm install --frozen-lockfile --ignore-scripts`。不创建 PR、不合并、不部署。

## Todo

### 1. Locate

- [x] **L1：确定旧 checkpoint 的来源证明规则。** 已按设计的 R2-1 确定严格完整后缀与唯一 occurrence 证明；保留区中无法精确映射的截断 user 直接取消，不反推截断来源。该结论来自固定提交的 plan/view/retention 调用链及旧格式结构，R2-1 的运行验收已完成，见 Evidence Record。
- [x] **L2：确定请求清理、错误传播和容量额度的共同边界。** 已按设计的 R2-2 至 R2-4 确定共同冻结入口、结构化 HTTP 终止、两个容量入口共享额度及 hash 迁移例外。新增扫描/复制受限，既有失败标记内部匹配算法不在本轮改写；完整成本边界见设计。

### 2. Implement

以下每项按[实现设计](codex-compact-plugin-repair-round-2-design.md)中同名 R2 章节编码。worker 不再自行选择来源证明规则、清理顺序、错误分类或额度语义；遇到反证按该文档的 Worker Stop Conditions 返回 expert。

- [x] **R2-1：让旧来源缺失进入显式兼容分支。** 对 checkpoint 之前尚无执行进展的真实 user，执行 L1 确定的来源证明。证明成功时，将当前输入及可证明的完整后缀从普通历史 retention 中分离，输出对应来源元数据，避免新结果同时留下同一次输入的截断副本和全文。证明失败时，在远程压缩及 checkpoint 替换之前取消，保持旧 checkpoint 和原始 session entries。保持新格式、已执行历史及同文不同来源的行为；映射不能枚举所有可能匹配组合。完成条件为 R2-1 行为矩阵与成本约束通过。
- [x] **R2-2：从同一冻结证据成对清理 branch 和 payload。** 在首次 `await` 前冻结 raw branch、失败标记、model/tools/prompt 和 payload；对 branch 与 input 应用同一组有效失败标记后，再核验完整投影。核验、receipt、预算和后续处理使用一致的清理结果，适用性检查仍能发现操作期间原始证据变化。显式保留清理前后差异，确保无 checkpoint 且未压缩时也返回已清理 input；不重复删除当前新输入。避免每个投影候选重新扫描失败标记。完成条件为 R2-2 的真实 payload 正负例与成本约束通过。
- [x] **R2-3：将认证和权限终止作为结构化错误传播。** 在 HTTP 分类处保留 status 和终止原因，使 wrapper/retry/fallback 不丢失该信息；automatic coordinator 按结构化分类传播 401/403。空 body、超时、超限和读取异常均不能改变已知认证状态；保留取消、context、policy 等既有终止规则，以及普通临时压缩失败后的正常发送机会。诊断不增加大正文副本，不改变 F7 的 deadline、字节上限和成功 SSE 路径。完成条件为 R2-3 transport → coordinator → 请求入口的终止与非终止对照通过。
- [x] **R2-4：统一同 hash 容量下切和 automatic 的本地额度。** 在发起纯容量 downshift 远程操作前，使用当前 logical request 的共享额度记录尝试；失败、checkpoint 写入、同请求重入都不产生第二份额度。防止 `transitionCompactionCompleted` 让 opaque-only 历史再次触发 automatic。确实需要的 hash 协议迁移保持独立，新用户发生项或有效模型变化按既有规则建立新 scope；session 清理释放记录。完成条件为 R2-4 调用次数、输入完整性和迁移对照通过。

### 3. Deliver

- [x] **D1：更新修复状态和使用说明。** 将第一轮 I10/I13 及 F4、F6/F7 的残留问题与本轮结果对应；只在相应用例和成本约束通过后勾选。按需修正 README/UPSTREAM 的旧格式取消原因、认证失败和额度说明，保留原始基线证据，区分本地结果与外部复审结果。
- [x] **D2：追加可复审的修复提交。** 本次提交是第二轮交付提交，base 为 `9aac58af3ae334d48ed6907fd2b78fe19e80e676`，追加到现有分支并推送 origin。head 由 Git 日志和最终交付回报确认。实际测试结果和未验证项见 Evidence Record，限定四项的复审简报见 Review Brief。

## How To Test

### Execution Order

先在本轮基线为每项加入行为断言，确认失败由报告的机制引起，再实现并运行受影响测试。按 R2-1 → R2-2 → R2-3 → R2-4 推进，共用文件小步修改。记录 Red/Green 的命令、结果和失败原因；环境或夹具失败不能当作缺陷复现。

复用旧用例前，检查输入是否经过真实待验证路径。尤其不能以只有 `{ input }` 的请求代替含 `instructions/tools` 的 provider payload，也不能仅通过 transport 不重试就宣称 coordinator 已终止。若已有预期与本轮契约冲突，说明原因并修正对应预期，不能放宽断言以维持旧通过数量。

### Behavior Matrix

| ID | Input and production path | Required observations |
| --- | --- | --- |
| R2-1 legacy pending | 使用旧 writer 可产生的 V2 details，无 `preservedInputSources`；约 280,000 字符真实 user，后接部分文本但 `stopReason: aborted` 的 assistant。真实 `SessionManager.appendCompaction()` 恢复，再执行 `AgentSession.compact()`，经过正式 hook、plan、retention、持久化和下一请求 | 来源唯一可证时，新有效回放恰好一份完整当前 user，无同来源截断副本，来源字段可重载；来源不可证时压缩取消，旧 checkpoint 未被替换，远程调用为零，有明确诊断。不能只断言原始 session 文件仍有全文 |
| R2-1 ambiguity and controls | 同文不同 entry、旧截断副本、多个候选来源、custom suffix、context edit；再覆盖带来源字段的新 checkpoint、已有成功 assistant/tool result 和连续两次 manual | 不猜来源、不误删独立输入；新来源路径及普通历史 retention 保持正确。取消后重开 session，旧 checkpoint 仍有效；证明成功后重开仍只保留正确的完整后缀 |
| R2-2 before checkpoint | 真实 session 的 system、旧失败 user、有效 FAILED_REQUEST marker 和新 user，经实际 Pi provider converter 生成完整 payload，再进入 coordinator 与正式请求 hook | 合法新请求通过，失败 user 被清理，最终返回的请求仅保留应有内容；没有 checkpoint、没有远程压缩也必须返回清理结果 |
| R2-2 existing checkpoint | 上述场景加有效 checkpoint；覆盖新旧 user 文本相同、多个 marker、当前新 user、hidden/forced 支持路径和异步期间证据变化 | 保留 opaque 和正确新输入，不重复清理；完整投影真正不匹配仍拒绝；过期操作不提交、不写 bypass。清理不得改变 instructions/tools 的支持契约 |
| R2-3 terminal HTTP | 真实 Pi converter 生成能通过 F4 的完整请求，有可压历史并触发 automatic。transport 返回空正文 401/403；补充挂起、超限、读取失败的 body | coordinator reject，正式 hook 中止当前请求，普通 provider 的出站替身调用为零；压缩请求仅一次，无 retry/fallback，无跳过压缩继续通知，无新 checkpoint。检查 timer/listener/reader 清理 |
| R2-3 controls | 503 按既有上限重试后失败；完整和不完整 429；正常成功 SSE；用户取消、context/policy 错误 | 保持各自现有分类。至少一个允许软失败的临时错误仍保留正常发送机会，证明没有把所有错误改成终止；不完整 body 不放宽 fallback |
| R2-4 same-hash downshift | 同 compaction hash，窗口从 100,000 降至 1,000；已完成历史后接 3,700 字符 pending user。真实 `selectModel()` → scheduler → `prepareRequest()` → `createNativeCheckpoint()` → SSE parser，每次返回相同 opaque | 第一次修复后只剩 opaque 和完整 user，即使仍估算超窗，也只有一次容量压缩；同 logical request 再次准备不新增调用，不截断 user、不因本地估算终止普通 provider 机会 |
| R2-4 controls | 首次容量修复失败、checkpoint 更新、同请求重入；新的同文 user entry、模型变化、session 清理；另测不同 hash 的强制迁移及真实 overflow | 同 scope 不重置额度；新 scope 可以修复；hash 不兼容迁移不被容量额度错误跳过；HTTP retry 仍独立有界，真实 Pi overflow 仍最多一次 compact-and-retry |

SDK 集成用例只替换模型目录发现、网络响应及最终 provider 出站，不固定 plan、过滤后的 input、投影策略或调度结果。保留真实 Pi `1.3.0` 的 session、converter、事件顺序与持久化。离线 opaque 只能证明本地组装和控制流，不能证明真实服务端接受性或总结质量。

### Cost and Resource Checks

- L1/L2 先分析新增路径：用 entry ID 索引及一次遍历收集来源/失败标记，常数次遍历构建输出，能够避免对每个候选重新扫描整段历史。此处约束本轮新增工作，不把存量实现的全部复杂度纳入重构范围。
- 对 1,000 / 2,000 / 4,000 条历史及同比增长的来源候选，复用现有 instrumentation 检查新增转换与 identity 处理次数。每项只编码一次，索引遇到重复 identity 即标为 ambiguous，不做排列枚举或逐候选重转换。JSON 对象 key 排序按字段数的 `K log K` 计，不能把超宽对象处理宣称为严格字节线性。旧失败请求匹配函数内部成本不在本轮重构；新增证据流程只计算一次 marker 集合和清理一次 input，不能随 projection 候选或内部重入重复执行。
- 保留现有 projection 的候选上界和转换计数测试，以及多 marker、checkpoint 保存和内部重入的行为测试。失败 marker 计算及 input 清理只执行一次由静态调用链复核，具体检查设计的 Verification Decisions 部分；现有私有闭包无法无侵入地区分扫描与 stale guard，不声称已用运行时计数直接证明，也不为计数新增公共接口。
- R2-3 的空正文 401/403 断言一次 HTTP 调用和零普通 provider 调用；R2-4 的同 hash 容量场景断言一次逻辑远程修复。HTTP 内部 retry 分开断言，不混用请求计数。
- 挂起响应使用 fake timers 检查有界退出、无残留 timer/listener/reader lock；session 结束清理观察和额度记录。保持现有 1 MiB body 上限，不额外保留完整错误正文。
- 本轮不设无依据的墙钟或 RSS 阈值，也不宣称性能提升；若需要前后性能结论，先在相同环境与负载采集修改前基线，再记录修改后结果。

### Commands and Acceptance

实现期间按变化选择对应文件运行；以下为本轮相关回归集合：

```sh
pnpm test extensions/codex-compact/__tests__/repair-runtime.test.ts extensions/codex-compact/__tests__/session-coordinator.test.ts extensions/codex-compact/__tests__/responses-parity.test.ts extensions/codex-compact/__tests__/request-projection.test.ts extensions/codex-compact/__tests__/native-compaction.test.ts extensions/codex-compact/__tests__/remote-boundaries.test.ts extensions/codex-compact/__tests__/index.test.ts
```

交付前执行完整仓库检查：

```sh
pnpm run check
git diff --check
```

预期类型检查、全量测试、构建、发布包及 source/dist 八扩展加载检查通过，`loadErrors` 为零；跳过项需说明是否既有，不能新增 skip 来掩盖本轮失败。记录实际版本、平台、命令和结果；任务启动的服务或后台进程须关闭并确认监听端口释放。

外部审查报告称 Linux `full-reference` 276 项通过，但未完成全仓发布/加载检查；这只作为外部正向证据，不等同于本地验证，也不据此将第一轮 I16 整体勾选。真实 Codex 服务仍未验证，该限制不追加为本轮新功能或额外阻断项。

## Evidence Record

2026-10-22 在 Darwin、Node `v22.22.2`、pnpm `11.9.0`、Pi `1.3.0` 实施。基线仍为 `9aac58af3ae334d48ed6907fd2b78fe19e80e676`。没有修改依赖或手动编辑 dist；dist 由构建生成。

| Item | Local evidence | Status |
| --- | --- | --- |
| R2-1 | 可唯一证明的 legacy suffix 先失败后通过。截断、重复 identity、缺失 custom suffix、checkpoint 前 context edit、冲突来源均取消。真实 SDK 使用 `retainRecentMessages([item], 64_000)` 生成旧 writer 的截断项，验证 280,000 字符输入的可证明迁移、截断旧副本取消、再次 manual 和重开；取消时零 fetch 且旧 details 保留。classifier、UI 与真实 SDK stderr 的指定诊断另行 Red→Green，无正文泄漏。日志 `.tmp/r2-1-legacy-red.log`、`.tmp/r2-1-legacy-green.log`、`.tmp/r2-1-diagnostic-red.log`、`.tmp/r2-1-diagnostic-green.log` | 通过 |
| R2-2 | 真实 Pi converter 带 instructions/tools 的完整 payload，有/无 checkpoint 均先复现投影误拒，修复后正常返回清理结果。normal/hidden/forced/both、两 marker 与同文新 user、recoverCurrentModel 及真正不匹配的拒绝通过。prepare/recover 在 metadata、远程成功、不可 fallback 错误与可 fallback 错误期间分别修改旧 failed user、marker 或追加 marker，均无 checkpoint/bypass；不可 fallback 时保留原错误，可 fallback 时在第二次发送前终止。真实 SDK 在 401/403 失败 marker 后发送新请求，旧失败输入被清理且新输入一次。日志 `.tmp/r2-2-red.log`、`.tmp/r2-2-green.log`、`.tmp/r2-2-projection-controls-green.log`、`.tmp/r2-2-sdk-green.log`、`.tmp/r2-2-fallback-red.log`、`.tmp/r2-2-fallback-green.log` | 通过 |
| R2-3 | transport 属性及 coordinator 终止分别 Red→Green。真实 SDK 401/403 各一次压缩 fetch、零普通 provider 出站、无 checkpoint，诊断为 `request_aborted`；挂起、超限和读取失败仍保留 status/reason 并释放 reader/timer。真实 503 transport 重试耗尽后三次 fetch、一次 soft-failure 回调并保留发送机会。日志 `.tmp/r2-3-transport-red.log`、`.tmp/r2-3-transport-green.log`、`.tmp/r2-3-coordinator-red.log`、`.tmp/r2-3-coordinator-green.log`、`.tmp/r2-3-native-runtime-green.log`、`.tmp/r2-3-controls-green.log` | 通过 |
| R2-4 | 同 hash 100,000→1,000 下切与 3,700 字符 pending user，经真实 scheduler/remote checkpoint/SSE，selection 先复现两次 fetch。修复后 selection/checkpoint/direct recovery 均一次，即使最终估算仍超过有效窗口。同 key 重入、容量失败、同文新 entry、clear/model 和不同 hash 对照通过。日志 `.tmp/r2-4-red.log`、`.tmp/r2-4-green.log`、`.tmp/r2-4-controls-green.log`、`.tmp/r2-4-failure-green.log`、`.tmp/r2-4-capacity-green.log` | 通过 |

R2-1 在 1,000/2,000/4,000 user 负载上，identity 编码恰为 2N 次，每个物理 item 一次；转换最多 3(N+1) 次，没有逐候选重转历史。JSON 对象 key 排序仍按每对象 K log K 计。R2-2 的 marker 单次计算由 expert 静态复核确认：两个公开请求入口各调用一次 prepareRequestEvidence，私有 marker/input 清理仅在该 helper 执行，内部阶段使用带 continuity 的 requestBranch，剩余包装读取属于 manual 入口。没有声称运行时直接计数了 marker 扫描，也没有新增生产计数器或测试专用公共接口。动态测试覆盖多个 marker 与同文发生项；既有 projection 成本断言保持候选 K≤4、最多五个 snapshot 和有界转换次数。

相关七文件回归 436 项全部通过，日志 `.tmp/r2-regression-green.log`。后续补充的 fallback 轨迹和明确超窗断言分别通过两文件 183 项回归及三入口定向检查，日志见上表。阶段曾保留 R2-2 的两个预期 Red，`.tmp/r2-partial-regression.log` 的 427 passed / 2 failed 不作为最终状态。

完整检查首次运行因既有 test-wrapper fixture 在状态文件写入期间读到空 JSON 失败，其余 2,802 passed / 13 skipped，日志 `.tmp/codex-compact-round-2-final-check.log`。未修改该范围外夹具；单文件十项复测通过，日志 `.tmp/r2-test-wrapper-recheck.log`。随后顺序重跑完整检查，结果记录在下段。

完整 `pnpm run check` 重跑退出码 0，日志 `.tmp/codex-compact-round-2-final-check-retry.log`。183 个测试文件通过、4 个既有文件跳过；2,803 个测试通过、13 个既有测试跳过，无新增 skip。类型检查、web-search 类型检查、构建、发布包检查通过；source/dist 各加载 8 个扩展，`loadErrors` 均为 0，既有 `/mcp` command replacement warning 保持不变。`git diff --check` 通过。未启动常驻服务；测试结束后核验无本轮 fixture、Vitest 或测试 wrapper 进程及监听端口残留，首轮 JSON 读取失败也未留下子进程。expert 已通过 source/test 和 marker 静态调用链复核；提交推送仍在 D2 跟踪。

checkpoint 之后修改其之前 user 的 context edit 会由既有 checkpoint lookup 判为 invalid，沿用原分支；R2-1 冲突测试使用 checkpoint 前的 edit，保证 valid checkpoint。真实 SDK 不允许没有新增 entry 的连续 manual，第二次 manual 前追加 aborted assistant，保持 pending user 尚无成功执行进展。

计划文档阶段日志 `.tmp/codex-compact-round-2-todo-check.log` 仅是实现前基线。离线 opaque 仅证明本地控制流、回放和持久化，不证明真实 Codex 服务接受性或总结质量。本轮没有 Linux 实机完整检查，第一轮 I16 保持待验。expert 最终复核已通过，按已有授权完成本次分支提交推送。

## Review Brief

复审 base 为 `9aac58af3ae334d48ed6907fd2b78fe19e80e676`，head 取第二轮交付提交。范围仅为以下四项和对原七项的直接回归；问题须提供文件位置、触发条件及可复现证据。

- R2-1：`native-compaction.ts` 的 legacy pending proof，以及 `index.ts` 的固定诊断。重点复核旧 writer 的真实截断项取消、唯一完整后缀迁移、新来源续压和持久化。
- R2-2：`session-coordinator.ts` 的冻结证据、固定 failedUserIds、requestBranch 与 fallback 前检查。重点复核完整 payload 清理、同文不同 entry、hidden/forced、marker 变化及 stale 时无 checkpoint/bypass。
- R2-3：`native-compaction.ts` 的结构化 HTTP status/终止原因和 coordinator automatic catch。重点复核空或不完整 401/403 零普通 provider 出站、一次压缩请求，以及 503/429 的原分类。
- R2-4：`session-coordinator.ts` 的共享容量额度。重点复核两个容量入口与 automatic 的一次逻辑修复、同 key 失败/重入、新 scope，以及不同 hash 迁移和实际 overflow 的独立边界。

本地完整检查 2,803 passed / 13 既有 skipped，source/dist 各 8 扩展加载无错误。真实 Codex 服务及 Linux 实机完整检查仍未覆盖。本简报用于后续复审交接，本轮未另行派发外部审查。
