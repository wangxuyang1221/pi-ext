# Goal parity review against current Codex

## Scope and source pins

核验日期为 2026-09-10，UTC。比较对象是本仓库 `263556030a42eaeaf6dbee2b3b9a7871d734ff7e` 的源码，以及联网重新取得的 OpenAI 官方源码，不把既有研究报告当成当前事实。

| Baseline | Pin | Verification |
| --- | --- | --- |
| 本地移植声明 | `rust-v0.153.4`，`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a` | `extensions/goal/UPSTREAM.md:5-17` |
| 调查时最新正式 release | `rust-v0.154.0`，`6b9826e3aa83b1a5947db50f4332cb9c65f1b340` | [官方 release][release]，发布时间 2026-09-09 22:35:38 UTC。API 的 annotated tag `36eab01061df3cde5f95ec20a526777b430091ba` 解引用至此 commit |
| 调查时 `main` | `b348fc26674189f758d5941cdab3f78f258b2aa7` | [官方 commit][main]，committer 时间 2026-09-10 06:06:21 UTC。它不是正式 release 的别名 |

本次下载上述三个固定 SHA 的源码，实际比较 `codex-rs/ext/goal`，并展开当前 `state`、Core idle lifecycle、app-server fork 和 TUI interruption 路径。`0.153.4` 与 `0.154.0` 的整个 goal extension 目录无差异；与当前 `main` 相比，变化集中在用户请求暂停和空自动续跑保护。两个版本到当前 `main` 的 `state/src/runtime/goals.rs` 也没有差异。可复核 [旧目录][old-goal]、[正式版目录][release-goal]、[当前目录][current-goal]。

研究运行模型通过 `PI_MODEL=gpt-6-astra`、`PI_REASONING_LEVEL=medium` 核验。没有继续委派。临时源码和检查日志只写在仓库内 `.tmp/goal-parity/`，交付前删除，不作为报告依赖发布。

## Summary

本地已经不是历史报告所描述的“每次模型请求都把完整 goal prompt 重新放在尾部”。当前 `context` hook 保留历史位置，测试直接断言 tool response、用户 steering、重试和 compaction 后不重插。这个差异已修复，不应继续列为待办。见 `extensions/goal/src/scheduler.ts:170-212`、`extensions/goal/__tests__/scheduler.test.ts:23-72`。

尚未对齐的重点有五项。其中预算状态、用量口径和 live edit 都不是追赶 `main` 的新功能，而是旧基线也已有的语义。

1. 官方底层状态 SQL 保证已有 `budget_limited` 不被 paused/blocked 覆盖，不区分自动中断、用户 pause 或模型 update 入口。本地存储缺少同样的保护。自动 abort 变成 paused 是已复现示例，差异也涵盖用户 pause 和模型 blocked。
2. 非零 `cacheWrite` 会被本地 `input + output` 漏掉。仓库实际安装的 Pi 0.84.3 Responses adapter 从原始 input 同时扣除 cache read 和 cache write，官方 goal 只扣 cache read。本次算例为官方 90、本地 60。不能把这个合成算例当成主 OpenAI Codex 会话的常见问题；更应检查可使用其他 provider 的子任务，真实 endpoint 返回频率尚未核实。
3. `main` 已允许模型在用户明确请求后调用 `update_goal(status="paused")`，本地 schema 和 handler 仍拒绝。
4. `main` 已对三个连续空自动 continuation turn 强制 blocked，本地重复工具检测不覆盖这种完全没有工具活动的空转。
5. 运行中编辑目标时，官方注入当前回合 steering，本地一律排 followUp，可能继续执行整个旧目标工具链才收到新目标提醒。[官方 live edit][external-set]；`extensions/goal/src/scheduler.ts:57-64,222`。

前四项依据分别见 [预算状态 SQL][state-update]、[官方 token 公式][token-formula]、[当前工具契约][spec]、[空回合计数][empty-accounting]；本地证据和排序见下文。

## Aligned behavior

### Tool contract and objective policy

- 两边都有 `get_goal`、`create_goal`、`update_goal`。创建时 objective trim 后要求非空、最多 4,000 Unicode 字符，budget 为正整数，未完成 goal 不能由 create 工具覆盖。本地额外限制 JavaScript safe integer，不能声称与 Rust `i64` 的数值域完全相同。[官方 handler][tool]；`extensions/goal/src/tools.ts:38-51`、`extensions/goal/src/index.ts:396-408`、`extensions/goal/__tests__/tools.test.ts:9-29`。
- `goal`、`remainingTokens`、`completionBudgetReport` 的主要响应结构一致，剩余额度不小于零，完成时提示模型报告最终用量。本地新增 `usageVisibility`，用于明确不完整计数。[官方 response][tool-response]；`extensions/goal/src/tools.ts:24-35`。
- objective 按用户数据处理并转义 XML 字符。completion audit 和一般 blocked audit 都是模型指令，不是运行时逐项验收器；模型调用 complete 不需要提交可机验的证据清单。[官方 renderer][steering]、[官方 handler][tool]；`extensions/goal/src/tools.ts:14-22,50-56`。不应把任一实现描述为“保证任务全部完成”。

### State, accounting and stopping

- 每个持久 session/thread 一条当前 goal，使用同样的六个状态。只有 active 自动续跑，其他状态停止自动目标工作。替换目标生成新 goal identity、重置统计，编辑和 pause/resume 保留统计。[官方状态模型][state-model]、[官方 runtime][runtime]；`extensions/goal/src/storage.ts:8-34,206-216,271-295`、`extensions/goal/src/scheduler.ts:43-50`。
- 两边按观测到的 usage 结算，允许超出预算，不把实际消耗裁到预算值。预算耗尽后给运行中的回合一次收尾提醒，而不是强杀当前模型回合。一般 terminal error 不覆盖已到达的 budget-limited，明确的账号用量限制可以覆盖成 usage-limited。[官方 tool checkpoint][tool-checkpoint]、[官方 stop 优先级][runtime-stop]；`extensions/goal/src/accounting.ts:31-103`、`extensions/goal/src/scheduler.ts:140-151,214-220`、`extensions/goal/__tests__/commands.test.ts:151-179`。但用户 pause 和模型 blocked 的优先级仍有漏洞，见差异 D1。
- 本地按 request 开始前绑定的 goal identity/generation 归因，并去重 receipt，旧目标的迟到主代理 response 不记到新目标。官方在 turn 内换 goal 时重置累计 token baseline，并用 expected goal ID 限制 checkpoint 写入。[官方 baseline][accounting-baseline]、[官方 progress commit][runtime-account]；`extensions/goal/src/accounting.ts:24-69`、`extensions/goal/src/storage.ts:160-180`、`extensions/goal/__tests__/commands.test.ts:181-191`。两边避免串账的目的相同，但计费单位不完全相同。
- 时间以进程内单调时钟累计整秒，保留亚秒余量，不按离线时长补计。[官方时钟][clock]；`extensions/goal/src/storage.ts:150-181`、`extensions/goal/__tests__/budget.test.ts:35-90`。

### Scheduling, interruptions and history

- 自动 continuation 不在每个 tool result 后启动。官方由 idle hook 调用 `start_turn_if_idle`，本地由正常完整运行结束后排入 `followUp`。本地 `context` 不再刷新或搬动完整 reminder。[官方 idle][idle]、[官方 continuation][runtime]；`extensions/goal/src/scheduler.ts:57-64,123-139,170-212`。本地仍有 explicit-turn 注入和排队语义差异，不能说调度器逐事件等价。
- 用户真正 abort 当前工作后本地落 paused，不自动恢复。官方 TUI interrupt 同时请求 pause，底层 goal abort hook只结算和清理，不单独 pause。[官方 TUI helper][interrupt]、[官方 abort hook][abort]；`extensions/goal/src/scheduler.ts:130-146`、`extensions/goal/__tests__/scheduler.test.ts:107-128`。本地更直接地在运行事件层实现取消语义，而不是复制 TUI 内部调用链。
- fork 继承是显式动作。官方 `deferGoalContinuation` 模式先 flush source，再复制完整 snapshot；本地 `/goal-fork` 复制当前 goal identity、状态和统计，持久化一次性 deferral，不让普通 fork 自动继承目标。[官方 fork 条件][fork-conditions]、[snapshot copy][fork-copy]；`extensions/goal/src/index.ts:143-216`、`extensions/goal/src/storage.ts:190-204`。本地会删掉 child report 订阅，避免 fork 后继续收原会话子代理账单，见 `extensions/goal/__tests__/child-budget.test.ts:6-38`。

## Partial or missing parity

### D1: Budget-limited status can be overwritten

确定差异，而且旧基线已存在。保护规则来自官方底层状态 SQL，不仅是 `runtime.can_stop` 的自动停止判断。

官方 `update_thread_goal` 在当前状态为 budget-limited、请求状态为 paused 或 blocked 时保留原状态，两个带 status 的 SQL 分支都如此。用户 pause、TUI interrupt 发出的 pause，以及模型 `update_goal(blocked)` 都通过该状态更新，因此同样受保护。官方还提供 `pausing_budget_limited_goal_preserves_terminal_status` 和 `blocking_budget_limited_goal_preserves_terminal_status` 测试。[状态 SQL][state-update]、[模型 handler][tool]、[TUI helper][interrupt]、[相关测试][state-budget-tests]。

本地 `GoalLease.control` 直接把 pause/blocked action 映射为相应状态，只有结果为 active 时才重新判断预算。用户 `/goal pause`、模型 blocked 和自动 abort 的 pause 都经过这个方法。普通 terminal error 路径另有 budget-limited 保护，不能补上这些入口。见 `extensions/goal/src/storage.ts:274-295`、`extensions/goal/src/index.ts:320-328,412-421`、`extensions/goal/src/scheduler.ts:123-151`。

主代理以无模型 scheduler 探针复现 budget-limited 后 abort 变成 paused。本研究也用真实 `GoalStore` 对 budget 10、已记 10 tokens 的记录分别调用 `control("pause")`、`control("blocked")`，结果为 paused、blocked。探针验证存储和 scheduler 行为，用户/模型入口另由上述调用链核验，不声称做过真实 provider 端到端测试。现有 `controls.test.ts:40-50` 只检查 exhausted resume/edit。

这不会凭空增加预算，因为 resume 会再次检查额度。但它把停止原因从预算耗尽改成暂停或阻塞。应在共同存储 mutation 层实现与官方相同的优先级，并覆盖自动 abort、用户 pause、模型 blocked。授权模型暂停与保存哪个实际状态是两个问题，不能因请求来自用户或模型而绕过预算状态保护。

### D2: Cache-write tokens are omitted

确定的公式差异，触发频率未知。

官方 `goal_token_delta_for_usage` 计算 `input_tokens - cached_input_tokens + max(output_tokens, 0)`，没有再减 cache write。[源码][token-formula]。

本地 `goalTokens` 只取 `usage.input + usage.output`。但实际仓库依赖 Pi 0.84.3 的 Responses adapter 已把 `cache_write_tokens` 从 input 分离出去，得到 `input = max(0, rawInput - cacheRead - cacheWrite)`，Codex Responses adapter 复用该实现。见 `package.json:113-115`、`node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js:433-454`、`node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js:14,476`、`extensions/goal/src/accounting.ts:13-19`。子代理 reporter 同样漏掉该项，见 `extensions/subagent/src/usage.ts:59-64`。

本次纯数据探针使用 raw input 100、cache read 20、cache write 30、output 10。Pi 正规化后 input 50，官方 goal 计 90，本地计 60。正常非负数据下，补回 `cacheWrite` 才与官方的非缓存 input 口径对应。现有主代理预算 fixture 使用 `cacheWrite: 0`，见 `extensions/goal/__tests__/commands.test.ts:156`。子任务可切换 provider，因此即使主 OpenAI Codex 路径返回零 cache write，也不能证明所有 managed child 均可忽略它。

不能据此断言已发生真实欠计费，也不能把目标 token budget 说成货币成本。需要补非零 cache-write fixture，并确认当前 endpoint 的实际 usage 返回。跨其他 provider 的公式不能直接照搬。

### D3: Model-requested pause is missing

这是当前 `main` 的新增差异，正式版 `0.154.0` 尚没有。

提交 [fa7af388][pause-change] 修改 schema、handler 和三个模板。`update_goal` 新增 paused，要求用户明确请求，模糊时询问，后续 resume 撤销该请求，返回实际状态后停止目标工作，预算优先。官方没有运行时自然语言授权验证器，这一授权条件仍由提示约束。[当前 spec][spec]、[handler][tool]。

本地仍只允许 complete/blocked，且测试明确拒绝 paused，见 `extensions/goal/src/tools.ts:11,50-55`、`extensions/goal/__tests__/tools.test.ts:23,42`、`extensions/goal/src/upstream.ts:7-12`。只修改枚举不够，必须同步三个模板、状态描述、响应与预算优先级测试。对用户自然语言“先暂停一下”有直接价值，成本较低。

### D4: Empty automatic continuation fuse is missing

这是当前 `main` 的另一项新增差异。[0735c519][empty-change] 在 host 成功接纳 continuation 后记录 turn ID，只有自动回合、空 final 且整个回合无 activity 才累计，三次后 blocked。普通显式用户回合不计，工具结果、非空文字、reasoning summary、问题、compaction 等活动会重置或使该回合不满足空转条件，goal mutation 和 abort 也重置。[admission][runtime]、[计数][empty-accounting]、[官方测试][empty-tests]。

本地 `completedResponse` 只检查 stopReason 和没有 toolCall，不检查内容是否空，也不保留官方所需的自动 admission 标记。空 response 会继续进入 `start(ctx)`。重复工具 detector 则必须观察 tool_result，因此不覆盖这个路径。见 `extensions/goal/src/scheduler.ts:93-97,130-148`、`extensions/goal/src/loop.ts:55-78`。现有测试甚至以空 `content: []` 作为 continuation 驱动，见 `extensions/goal/__tests__/scheduler.test.ts:39-51`。

移植需要独立计数器和明确工作轮次边界，不宜把“无文件修改”当成空转。Pi 的 reasoning、工具、用户输入与官方 `TurnItem` 并非同构，需逐项定义 activity 映射。

### D5: Execution failure protection targets different failures

确定差异，现有历史说明把它们都简写为“三次执行失败”，容易掩盖实质区别。

官方只把默认 namespace `exec` 的 `ToolCallOutcome::Failed { handler_executed: true }` 视为执行不可用。`Completed { success: false }` 不计，测试明确命名为 `script_errors_and_failures_before_execution_do_not_block_goals`。成功工具重置计数，而一个既无执行失败也无成功工具的 status-only turn 不会清零，官方 backend 测试中插入这种回合后第四轮阻断。[计数][execution-accounting]、[排除脚本失败测试][execution-tests]、[status-only 测试][execution-backend]。

本地专门匹配 bash 文本 `Command exited with code` 或 `Command timed out after`，并在每个结束回合用 `failedBash && !successfulTool ? failedRuns + 1 : 0` 重算。它因此把普通命令非零退出纳入自动 blocked，同时把 status-only turn 清零。见 `extensions/goal/src/scheduler.ts:79-87,111-116`、`extensions/goal/__tests__/scheduler.test.ts:162-189`。

不建议把所有 `isError` 都替换成官方的 host failure。Pi 没有同样的默认 `exec` outcome 分类。若追求对齐，先给本地 shell 执行失败、进程退出、策略拒绝和取消建立明确分类；否则应把此行为注明为本地更宽的保护。

### D6: Live edit and explicit-turn reminders differ

官方外部更新 active objective 时，用 `inject_if_running` 注入 objective-updated steering；空闲时再尝试 continuation。普通 `on_turn_start` 只绑定 accounting，不额外插完整 continuation template。[external mutation][external-set]、[turn start][turn-start]。

本地 `/goal edit` 调用 `scheduler.resume(ctx, true)`，后者走 followUp。若仍有工具链，更新后的 objective 提醒会等工具链结束，而不是像官方那样送进当前运行回合。此外本地 `before_agent_start` 给每个 explicit work turn 增加一份完整 reminder。它与已经修掉的“每次采样尾插”不同。见 `extensions/goal/src/index.ts:316-329`、`extensions/goal/src/scheduler.ts:57-64,86-90,222`。

运行时依据需按 Pi 版本看待。Context7 `/earendil-works/pi` 未提供 0.84.3/0.85.1 固定版本文档，故补读本机 0.85.1 完整 `docs/extensions.md`。其中 `pi.sendMessage` 明确 followUp 等工具结束，steer 在当前工具批次后交付。这里确认的是队列语义，不声称实测所有 TUI 中途编辑时序。live edit 纠偏值得改；取消 explicit-turn reminder 是否改善模型行为则需要 A/B，不应仅为文本相同而删掉。

### D7: Tool visibility and execution support do not share one gate

官方 goal capability 由 feature、persistent thread availability 和 review source 共同决定；goal feature 当前为 stable、默认开启。普通非 review 子线程可以有 goal tools，review 隐藏工具但仍能上卷用量。[capability][capability]、[feature][feature]、[child roll-up][child-rollup]。

本地自动调度要求 `ctx.mode === "tui"` 且 provider 精确等于 `openai-codex`。但 `registerGoalTools` 不使用这两个条件；默认 entry 只对 `PI_SUBAGENT_PARENT` 提前退出。工具执行可尝试绑定持久 session，而非 TUI 的 `session_start` 不绑定现有 goal。这会造成“工具可见”与“自动执行受支持”不一致，不能把 TUI/provider gate 误写成统一的 API 拒绝。见 `extensions/goal/src/index.ts:90-107,391-428`、`extensions/goal/src/scheduler.ts:43-50,164-168`、`extensions/goal/src/tools.ts:41-56`。

建议先明确不支持的 mode/provider 是只读、完全隐藏工具，还是允许手动状态操作，然后用一个 capability 决策分别控制 schema 和运行。开放其他 provider 或 headless 自动续跑属于新产品范围，不是修一行条件就完成的 parity。

### D8: Resume and persistence are intentional adaptations

本地 session_start 只读取权威 JSON、恢复 child accounting 和状态行，没有调用 scheduler.start，也没有针对 paused/blocked/usage-limited 自动弹恢复选择。因此重载或恢复 active goal 不会仅因 session_start 启动新请求。用户 `/goal resume` 或明确工作输入后才进入调度。见 `extensions/goal/src/index.ts:90-107,128-140,320-329`、`extensions/goal/src/scheduler.ts:164`。

官方 resume 恢复 active accounting，后续 thread idle hook 可以尝试继续；TUI 对 paused/blocked/usage-limited 有专门的 Resume 确认框。[restore][runtime-restore]、[idle][idle]、[resume UI][resume-ui]。不应把“恢复 accounting”单独解释为无条件即刻模型请求，Core 仍有 idle admission 门禁。

本地权威 JSON + session mirror 与官方 SQLite + rollout 不互通；本地写失败会 suspend，镜像失败只警告并重试，恢复不会盲信 transcript mirror。原会话文件丢失时可经确认接管 goal，但不能恢复对话和外部副作用。见 `extensions/goal/src/storage.ts:63-148`、`extensions/goal/src/index.ts:45-68,218-268`。这是应保留的恢复边界，不是待换成 SQLite 的缺陷。可借鉴官方的恢复确认 UI，但不建议默认恢复就自动耗 token。

### D9: Subagent accounting has a narrower ownership model

官方给 descendant runtime 找 parent/root accounting，子孙每次 token event 按同一公式写 root 原子累计器。即使中间 parent unload，grandchild 仍可通过 session root 计费；review 子代理隐藏工具不影响归集。[root resolution][capability]、[roll-up][child-rollup]、[官方 child tests][child-tests]。

本地只订阅自有 subagent extension 在 beforePrompt 注册的 report source。报告在主代理关闭后可继续持久化，重新打开时按 source checkpoint 补差值。这个机制已覆盖 managed child，不能称为“没有子代理计费”。见 `extensions/goal/src/children.ts:26-103`、`extensions/subagent/src/index.ts:95-114`、`extensions/subagent/src/usage.ts:41-103`、`extensions/goal/__tests__/child-budget.test.ts:6-38`。

但所有 managed child 都不安装 goal extension，而且 child 也不注册 subagent tools，原生可用路径没有任意深度 descendant 树。任意外部代理或未接入事件的 nested model call 不自动纳入。见 `extensions/goal/src/index.ts:426-428`、`extensions/subagent/src/index.ts:111-115`。

归因边界也不同。官方换 goal 后重设全局 descendant baseline，之后仍运行的后代用量可以进入新 active goal；本地换 goal 后清除旧 report 订阅，迟到旧任务不记入新目标。前者偏运行时间窗口，后者偏任务投递归属。[官方 baseline][accounting-baseline]；`extensions/goal/src/storage.ts:206-216`、`extensions/goal/__tests__/commands.test.ts:124-149`。不要为了原生相同而让新目标承担旧任务账单，应先确认产品期望。

### D10: Stopped goals still receive late child usage locally

补充核验确认了正常自动计费路径的差异，不再只列为待查。

官方模型 update 先结算当前可见进度，更新状态后 `clear_current_turn_goal()` 清掉 turn 与 wall-clock 的 active goal binding。外部 paused/blocked/usage-limited/complete 更新也清掉 binding。此后 descendant 原子累计器仍可能增长，但普通 `progress_snapshot` 和 `idle_progress_snapshot` 因没有 active goal ID 而不能生成该目标的 checkpoint。重新激活时重置 descendant baseline，不会自动补收整个停止期的晚到用量。[官方 update][tool]、[外部状态更新][external-set]、[binding 与 snapshot][stopped-binding]、[重新绑定 baseline][accounting-baseline]。

本地 `children.checkpoint` 和 `GoalLease.accountChild` 不按 goal status 过滤，source 仍订阅就可以继续记账。真实存储探针先 pause 再提交 child 累计 20，记录保持 paused、tokensUsed 变成 20；再 complete 并提交 child 累计 50，记录保持 complete、tokensUsed 变成 50。见 `extensions/goal/src/children.ts:26-52`、`extensions/goal/src/storage.ts:244-261`。

这意味着本地 complete 后显示的“最终用量”仍可变动。应明确选择完成时冻结，还是等仍运行的子任务账单收敛。前者贴近官方，后者更接近按任务归属统计实际消耗。不能只在读取报告前加 status 判断，否则 resume 时可能又把停止期累计量一起补进来；需要定义 source baseline 和 finalization。此处没有审计直接调用底层 GoalService/数据库 API 的任意第三方操作，只覆盖正常生命周期。

### D11: Elapsed time is not identical to active execution time

本地存储只根据 active 状态或 budget-limited in-flight 开关累计墙钟时间，不看 provider gate、idle 或 fork deferral。见 `extensions/goal/src/storage.ts:160-181`。所以本地 elapsed 不能解释为“模型实际执行秒数”。

但官方也不是“只计运行 turn”。`mark_idle_goal_active` 在恢复或外部激活时设置时钟，`idle_progress_snapshot` 能计 idle 间隔；只有 continuation 尝试后没有 active goal turn 时，runtime 才走 reset-idle-baseline 路径。deferral early return 等路径不能一概套用这个结论。[官方 idle accounting][accounting-baseline]、[snapshot][stopped-binding]、[admission 后重置][runtime]。

两边的计时启停边界确实不同，但目前不足以给出所有 idle、deferred、provider-change 组合的统一时间差值。先明确 UI 表示“目标激活时长”还是“工作时长”，再补状态/单调时钟矩阵测试，优先级低于调度和预算停止问题。

## Differences to keep or defer

- 保留重复成功工具检测。当前官方没有比较参数和结果指纹的保护，空自动回合 fuse 也不覆盖有工具活动的循环。本地保留 32 条窗口，4 次连续重复预警，8 次进入暂停候选，并放行已验证 live handle 的 `subagent_wait` 超时。这是有意增强，不是上游移植。它证明的是观测内容重复，不证明任务没有语义进展。见 `extensions/goal/src/loop.ts:2-5,45-78`、`extensions/goal/src/scheduler.ts:98-129`，对照 [官方 activity][empty-accounting]。
- 保留 goal JSON 权威、写锁、generation fence、receipt 去重和只恢复本项目记录的设计。重写成官方 SQLite/app-server 格式成本高，又不会自动获得官方线程生命周期保证。见 `extensions/goal/src/storage.ts:79-147,155-181`、`extensions/goal/src/index.ts:218-268`。
- UI 不需逐像素复制。官方 `/goal` 为 summary/action UI，附件存在 Codex home 的受限 attachment root；本地 notify/editor、content metadata/checksum 和 codex-ui footer 已满足本机集成方式。值得借鉴的是恢复确认，不是 Ratatui 实现。[官方 menu][menu]、[官方 goal files][goal-files]；`extensions/goal/src/content.ts`、`extensions/goal/src/index.ts:294-329`、`extensions/codex-ui/src/footer.ts:102-132`。
- Goal 不是权限提升开关。当前官方 continuation 复用 thread runtime/config，goal extension 自身没有把 sandbox/approval 变成全权限；本地 scheduler 也不改 permission extension 或 provider 凭证。[continuation][runtime]；`extensions/goal/src/scheduler.ts:57-64`。本报告没有审计两套权限系统的全部规则，不能据此宣称它们安全能力等价。
- Plan mode 的精确排除无法直接照搬。官方有 `ModeKind::Plan`，本地 accounting 不存在对应 mode 判定，Pi `ctx.mode` 指运行界面模式，不是规划模式。若未来接入本地 plan extension，再定义目标工作和规划工作的归因。[官方 Plan 排除][turn-start]；`extensions/goal/src/accounting.ts:31-111`。
- 官方 continuation 在 `update_plan` 不可用时删掉相关提示段，本地保留条件句 `If update_plan is available`。这是文本差异，优先级低，不值得为此加入不存在的计划工具。[renderer][steering]；`extensions/goal/src/upstream.ts:10`。

## Ranked recommendations

排序依据是用户损害、发生条件、实现面和回归风险，不是“与官方越像越好”。成本为相对估算，不是工期承诺。

| Rank | Change | Value and evidence | Cost and acceptance |
| --- | --- | --- | --- |
| 1 | 在共同存储 mutation 层保护 budget-limited 对 pause/blocked 的优先级 | 自动 abort 与底层 pause/blocked 探针已复现，官方 SQL 对所有入口统一保护，见 D1 | 低。覆盖自动 abort、用户 pause、模型 blocked、同回合 budget crossing；保持 complete 与 usage-limited 的官方既定规则 |
| 2 | live edit 使用当前回合 steering，并避免排入多余旧目标续跑 | 用户纠正目标后能及时生效，不必等旧目标工具链完成，见 D6 | 中。覆盖 streaming、pending continuation、idle、stale ticket；不能重启每次采样尾插 |
| 3 | 引入用户明确请求的 `update_goal(paused)` | 直接支持自然语言暂停，当前 main 已有完整契约，见 D3 | 低至中。同步 schema、handler、描述、三个模板及许可证说明；单独验收模型工具的预算优先级 |
| 4 | 独立加入三轮空自动 continuation 阻断 | 填补现有重复工具检测完全不覆盖的空转路径，主代理探针已确认第三次后仍排第四次，见 D4 | 中。需要 admission 标记和 activity 定义；验证显式用户回合、reasoning、工具失败、修改目标、resume、abort 均正确重置 |
| 5 | 统一主/子代理 cache-write 归因，并补非零 fixture | 确定公式漏项；主路径发生率未知，优先核验其他 provider 子任务，见 D2 | 低至中。复用同一正规化函数，测试正常值、缺失、非法值、重复 receipt；避免重复计算 cache read/reasoning |
| 6 | 明确完成/暂停后的 child usage 冻结边界 | complete 后统计继续变化已由存储探针验证，与官方正常自动计费路径不同，见 D10 | 中。先决定冻结或账单收敛语义，再处理 source baseline、resume 与最终报告，不能简单丢弃报告 |
| 7 | 统一持久 session、mode、provider、child 的 capability 规则 | 避免暴露会进入半支持状态的工具，见 D7 | 中。先明确产品规则；测试支持矩阵，暂不承诺全 provider/headless 自动运行 |
| 8 | 区分 host execution unavailable 与命令退出失败 | 防止真实任务的正常失败尝试被当成基础设施故障，见 D5 | 中至高。Pi outcome 不同构，需要结构化分类；短期先纠正文档和测试命名 |
| 9 | 对停止状态提供非自动执行的恢复确认 | 改善 discoverability，保持本地“恢复不会默默烧预算”的边界，见 D8 | 低至中。仅在 UI 可用时提示，不默认 resume，覆盖取消和 reload |
| 10 | 扩展 descendant accounting 协议 | 当前一层 managed child 已支持；任意后代取决于 subagent 产品范围，见 D9 | 高。先支持后代 ownership/lifetime，再定义跨 goal 的计费归属，不能只加一个目录扫描器 |

不建议优先做 SQLite 格式兼容、完整 app-server goal RPC、Ratatui UI 移植、任意 provider 放开、语义完成审计器或删除本地重复调用保护。这些都超出低成本 parity 修复，且部分会降低当前保护能力。

## Validation and uncertainty

- 本次执行 `pnpm run check` 成功，79 个 test files 通过、2 个跳过，947 个 tests 通过、2 个跳过；类型检查、构建及发布包检查均通过。实际 Node `v22.22.2`、pnpm `11.9.0`。检查日志写入临时 `.tmp/goal-parity/check.log`，与本研究临时源码一同清理。没有修改生产源码，`dist/` 仅由正常构建生成。
- 主代理对本次构建的 `dist/scheduler.js` 做了无模型内存探针。连续三个自动 continuation 均返回 `content: []`、`stopReason: "stop"` 后，goal 仍为 active，已排入第四次 continuation；另一探针在 active request 绑定后模拟进入 budget-limited，再触发 `agent_end` aborted，结果为 paused。这两项是 scheduler harness 动态确认，不是真实 provider 端到端测试。
- 预算状态、cache-write 公式和停止后 child usage 另用了本地纯数据/真实存储探针验证。没有调用模型、没有访问业务数据库、没有启动监听服务。检查进程已退出。
- 没有运行上游 Rust test suite。官方行为依据固定 commit 源码和官方测试断言，不是同模型真实 Codex/Pi A/B。没有证明某项 prompt 排列必然导致或消除模型循环。
- 本机研究 runtime 是 Pi 0.85.1，仓库安装依赖是 0.84.3。Context7 查询没有提供版本 pin，所以具体正规化公式以仓库安装包源码为准。未把浮动文档当成该版本的精确保证。
- 预算统计仍可能因服务不返回 usage 而不完整。本地已经通过 `usageIncomplete` 和 `usageVisibility` 明示，不能把零对象当成准确零消耗。见 `extensions/goal/src/accounting.ts:53-67`、`extensions/goal/src/tools.ts:26`。
- `extensions/goal/src/accounting.ts` 目前只收 assistant、compaction 和 branch-summary usage，不读普通 tool result 的 nested LLM usage。Pi 0.85.1 文档支持该字段，但本次没有核验所有已安装工具是否实际产生它，故不把它列为已发生的漏计事故，也不假设可与 managed report 同时相加而不重复。
- 停止后 child usage 的正常自动计费边界已补充核验，见 D10。已证实存在差异，但选择冻结还是账单收敛仍是产品决定，不直接等同于 bug。
- “当前”只指本次锁定的 `main` SHA。OpenAI 仓库外服务策略、后续提交、真实非零 cache-write 发生率，以及所有第三方扩展组合时序不在已证实范围内。

## Source index

下列官方链接全部固定到本次 `main`，少数版本索引和变更 commit 除外。本地 `path:line` 均指 Scope 中固定的仓库 revision；`node_modules` 引用还需匹配已注明的安装版本。

[main]: https://github.com/openai/codex/commit/b348fc26674189f758d5941cdab3f78f258b2aa7
[release]: https://github.com/openai/codex/releases/tag/rust-v0.154.0
[old-goal]: https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal
[release-goal]: https://github.com/openai/codex/tree/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/ext/goal
[current-goal]: https://github.com/openai/codex/tree/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal
[pause-change]: https://github.com/openai/codex/commit/fa7af3883df4d14861f825f9a6aadbe1ffebe63d
[empty-change]: https://github.com/openai/codex/commit/0735c519789d300097554425cc3d7cf3f2d718a1
[spec]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/spec.rs#L9-L94
[tool]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/tool.rs#L173-L310
[tool-response]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/tool.rs#L433-L463
[steering]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/steering.rs#L53-L145
[state-model]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/state/src/model/thread_goal.rs#L12-L64
[state-update]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/state/src/runtime/goals.rs#L271-L351
[state-budget-tests]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/state/src/runtime/goals.rs#L1436-L1533
[token-formula]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/accounting.rs#L505-L532
[accounting-baseline]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/accounting.rs#L282-L347
[stopped-binding]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/accounting.rs#L348-L425
[clock]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/accounting.rs#L592-L626
[runtime]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/runtime.rs#L418-L521
[runtime-stop]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/runtime.rs#L269-L395
[runtime-account]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/runtime.rs#L536-L606
[runtime-restore]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/runtime.rs#L398-L415
[external-set]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/runtime.rs#L181-L250
[idle]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/core/src/tasks/lifecycle.rs#L43-L67
[turn-start]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/extension.rs#L221-L270
[tool-checkpoint]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/extension.rs#L449-L517
[abort]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/extension.rs#L358-L384
[interrupt]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/tui/src/chatwidget/interaction.rs#L676-L688
[resume-ui]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/tui/src/app/thread_goal_actions.rs#L54-L85
[empty-accounting]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/accounting.rs#L109-L229
[empty-tests]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/tests/accounting.rs#L63-L116
[execution-accounting]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/accounting.rs#L109-L158
[execution-tests]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/tests/accounting.rs#L157-L181
[execution-backend]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/tests/goal_extension_backend.rs#L839-L897
[capability]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/extension.rs#L99-L156
[feature]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/features/src/lib.rs#L1604-L1609
[child-rollup]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/src/extension.rs#L416-L443
[child-tests]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/ext/goal/tests/goal_extension_backend.rs#L413-L512
[fork-conditions]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server/src/request_processors/thread_processor.rs#L5233-L5265
[fork-copy]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/app-server/src/request_processors/thread_fork_goal.rs#L5-L27
[menu]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/tui/src/chatwidget/goal_menu.rs#L39-L142
[goal-files]: https://github.com/openai/codex/blob/b348fc26674189f758d5941cdab3f78f258b2aa7/codex-rs/tui/src/goal_files.rs#L17-L182
