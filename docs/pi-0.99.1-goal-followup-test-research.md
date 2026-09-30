# Pi 0.99.1 Goal follow-up test research

## Verdict

本次确认 Goal 的原验收混用了 SDK 与 TUI 边界，不能直接将“两次请求”失败判为 TUI 插件 bug。原测试声明 `mode: "tui"`，却没有安装真实交互模式的 `abortHandler`。历史 C11 明确允许取消失效 Goal 请求时，把排队用户输入退回编辑器、由用户重新发送。本轮调用实际交互模式取消方法，观察到输入完整退回编辑器，与这一已接受的副作用一致。

SDK 路径仍有独立的行为差异，不能靠增加等待解释。用已等待完成入队的公开 `session.followUp()` 替换原 `pi.sendUserMessage()`，连续三次仍只有 1 个请求；输入留在 SDK 队列。历史 Slice 1 的 SDK 验收要求自动处理输入，0.84.3/0.85.1 的提交日志曾记录 2 个请求。因此当前组合不满足那项旧 SDK 验收，但这不等于违反 TUI 的 C11 约定。

结论应分两层：TUI 测试建模与预期需要按真实取消绑定和 C11 修正；SDK 原有自动执行验收目前不通过，应作为单独的兼容行为变化记录，不能通过移动入队时机或改变队列模式掩盖。首个变化版本尚未定位。在确认 SDK 是否仍需保持该保证之前，本报告不建议据此直接修改 Goal 生产调度。此前将整个问题直接称为“插件遗留 bug”的结论过强，需要撤回。详见 History and intent。

## Scope and sources

只调查 Goal。未调查 Fast、tmux，未修改生产 `src/`、生成 `dist/`、既有测试、期望或超时，未构建、提交、发布。临时实验只写入 `.scratch/pi-0.99.1-test-research/goal/`。

Context7 查询先定位 `/earendil-works/pi`，只有 `v0.87.1`、`v0.99.0`，没有精确 `0.99.1`。随后查询 `/earendil-works/pi/v0.99.0` 的 abort、队列、settle 文档。结果同时引用版本文档和 `main`，甚至出现“abort continues queued messages”的概括。因此本报告不把这些摘要作为 0.99.1 行为证据，使用本机安装包的精确代码与离线实跑。

完整读取安装包 `docs/sdk.md`、`docs/extensions.md`、`docs/session-format.md`，以及相关 `docs/message-types.md`、`docs/sessions.md`、`docs/how-pi-works.md`、`docs/custom-provider.md` 和 `examples/sdk/06-extensions.ts`。对本问题有直接约束的文档是 SDK 的 prompting/lifecycle 与 extensions 的 event/context contracts；模型和持久化细节用安装包实现核验。

以下引用使用这些缩写，行号来自当前安装包和仓库文件：

- `CA` = `node_modules/@earendil-works/pi-coding-agent`，版本 `0.99.1`。
- `CORE` = CA 的真实路径同级 `pi-agent-core`，版本 `0.99.1`。不能用字面 `node_modules/@earendil-works/pi-agent-core`，根目录没有这个入口。
- `AI` = CA 的真实路径同级 `pi-ai`，版本 `0.99.1`。
- `Fixture` = `extensions/goal/__tests__/provider-runtime.mjs`。
- `Scheduler` = `extensions/goal/src/scheduler.ts`。
- `Probe` = `.scratch/pi-0.99.1-test-research/goal/probe.mjs`。

本次运行 Node `v22.22.2`。Probe 与原夹具一样加载既有 `extensions/goal/dist/index.js`、`dist/storage.js`。生产源码用于解释行为；没有重新构建或单独证明整个 dist 与 src 完全一致。关键取消分支在 `extensions/goal/dist/scheduler.js:338-373` 也存在。

## Fixture audit

### Event and context authenticity

原失败用例没有伪造 `context` 或调用事件处理函数。它经真实 `createAgentSession`、`DefaultResourceLoader`、`bindExtensions`、`/goal` 命令运行，宿主产生 `agent_end` 和下一次 `context`。替代的是 provider streaming transport，非队列或 context 处理结果。见 `Fixture:104-156,268-285`。

`afterGoal` 在 Goal 注册之后注册 `agent_end` handler。宿主按注册顺序等待 handler，见 `CA/docs/extensions.md:97`。因此 Goal 先排自己的 continuation，夹具再禁用 `get_goal`，随后发送外部输入。下一轮请求遇到过期 continuation，这是有意构造的竞争，不是不存在的宿主事件顺序。

`pi.sendUserMessage()` 是公开 ExtensionAPI，默认 SDK 实现把其 Promise 错误送给 extension error handler，见 `CA/dist/core/agent-session.js:2644-2648`。原夹具不能等待这个 void API 完成。这确实值得检查，但本次换成 `await session.followUp(..., { source: "interactive" })`，在 `agent_end` handler 返回前完成真实入队，失败不变。因此原失败并非 fire-and-forget 尚未完成造成的假阴性。

### Queue and Goal state

原夹具不注入私有队列。自有 continuation 通过 `pi.sendMessage(..., { deliverAs: "followUp", triggerTurn: true })` 入队，外部输入通过 `pi.sendUserMessage()`，见 `Scheduler:80-88`、`Fixture:279-284`。诊断只读取队列，并包裹 `session.abort()` 记录调用。

禁用工具也通过公开 `pi.setActiveTools()`。夹具没有写 Goal record、generation、ticket 或 `toolRecoveryRequired`。生产 `observeTools()` 自行检测缺失工具并提交 recovery 状态，见 `extensions/goal/src/index.ts:88-103,260-263`。实验最终从真实 GoalStore 读取到 `status: "active"`、`toolRecoveryRequired: true`。

默认队列模式为 `one-at-a-time`，不是夹具私设的异常模式，见 `CA/dist/core/settings-manager.js:534-535` 和 `CORE/dist/agent.js:139-140`。`agent.continue()` 优先取 steering，没有 steering 才取 follow-up，见 `CORE/dist/agent.js:251-273`。因此同一队列中，自有 continuation 在前、外部 follow-up 在后时，外部输入不会与自有票据一起送达下一次 context。

### Idle and abort boundaries

`await prompt()` 加 `waitForIdle()` 不是“只等第一个 agent_end”。SDK 文档明确 `agent_end` 后仍可能有自动工作，`agent_settled` 才是不会继续自动运行的边界，见 `CA/docs/sdk.md:62-70,90-94`。Probe 记录了真实 `agent_settled`。

安装包 `isIdle` 的实际判断不检查队列是否为空，见 `CA/dist/core/agent-session.js:1025-1031`。故失败后的 `idle: true, queued: true` 并不矛盾。`waitForIdle()` 不会主动启动残留队列，见该文件 `1853-1858`。

默认 SDK 的 `ctx.abort()` 调用 `session.abort()`，设置 `_agentRunAbortRequested` 并 abort 当前 Agent，见该文件 `2689-2695,1841-1851`。`_runAgentPrompt()` 看到这个标志就不再处理后续队列并进入 settled，见 `1315-1345`。这正是本次观察到的停止点。继续多等待不能撤销这个标志或补启动下一轮，增加测试 timeout 没有依据。

## Offline experiments

Probe 从原夹具复制会话、真实 GoalStore、provider transport 和清理逻辑，只保留目标场景，增加队列/idle/settle 快照。既有测试没有改动。第一响应固定为文本，第二响应固定为 `User request preserved`。所有有效实验都保持请求数 2、消息包含 `PRESERVED_INPUT`、recovery 为 true 的断言，没有把预期改成 1。

每次独立进程串行运行，`env -i` 只传 PATH、仓库内 HOME 和离线/trace 开关。credentials/models store 均为内存实例，provider key 是 `offline-placeholder`，model network refresh 关闭；`fetch` 拦截并拒绝未预设的请求。所有场景的 `scenario-finally.networkAttempts` 都为 0，provider 也没有发实际网络请求。截止 timer 保持原 `10000 ms`，没有触发。

| Case | Operation | Requests | Queue after settle | Result |
| --- | --- | --- | --- | --- |
| `original`, `original-2`, `original-3` | Goal 后的 `agent_end` 禁用工具并调用原公开 `pi.sendUserMessage` | 各 1 | `PRESERVED_INPUT` 仍排队 | 三次 exit 1，2 vs 1 |
| `public`, `public-2`, `public-3` | 同一位置，改为等待公开 `session.followUp`，source 为 interactive | 各 1 | 同上 | 三次 exit 1，2 vs 1 |
| `late` | 第二次真实 context 的前置 handler 禁用工具并等待公开 `session.followUp` | 1 | 同上 | exit 1，2 vs 1 |
| `early` | 把公开 follow-up 与工具禁用放在 Goal 前的 `agent_end` handler | 2 | 空 | exit 0 |
| `steer` | Goal 后的 `agent_end` 等待公开 `session.steer` | 2 | 空 | exit 0 |
| `foreign` | Goal 后用公开 `pi.sendMessage` 排外部 custom follow-up | 1 | Agent 队列仍有工作，用户文本快照为空 | exit 1，2 vs 1 |
| `all` | 与 `public` 相同，仅把公开 followUpMode 设为 `all` | 2 | 空 | exit 0 |
| `tui` | 与 `public` 相同，安装实际交互模式使用的 abort 路径 | 1 | 清空，编辑器收到 `PRESERVED_INPUT` | exit 1，2 vs 1 |

每个场景均只发出一次 `agent_settled`。失败场景在 settle 前有一次内部 `session-abort`；`early`、`all` 没有，`steer` 在用户请求完成后取消自有过期 continuation，因此也有一次。

日志和完整事件在 `.scratch/pi-0.99.1-test-research/goal/<case>/run.log`、`<case>/<mode>.json`。聚合结果见同目录 `summary.json`。临时目录被忽略，报告保留关键结果，不能把这些本机日志当成发布包资源。

### Request and settlement evidence

`public/public.json` 的代表性交错：

1. 请求 1 完成，Goal 的 `agent_end` 排自有 continuation。
2. 后置 handler 禁用工具，等待公开 follow-up 入队。
3. 新的 `agent_start` 投递自有 custom continuation，`context-before-goal` 仍为请求 1，Agent 仍有队列，follow-up 快照为 `PRESERVED_INPUT`。
4. `session-abort` 在请求计数 1 时发生，紧接 `context-after-goal`。
5. `agent_settled` 后 `idle: true, streaming: false, queued: true`，请求计数仍是 1。

这与旧证据 `.scratch/pi-0.99.1-fixes/goal-trace-2/stale-queued-continuation-followUp.json` 一致。但此次公开 SDK 入队已经等待完成，排除了原 void API 的等待疑点。

`late` 不在 `agent_end` 中发送用户输入，而是在下一轮已选中自有 continuation 后、Goal 检查前通过公开 SDK 入队，仍失败。它说明危险条件是“外部输入尚未 delivered”，不依赖必须与另一个 extension 的 `agent_end` callback 恰好交错。该实验仍是受控 SDK 交错，不声称已经捕获真人键盘操作。

`foreign` 的 `getFollowUpMessages()` 为空不能解释为外部 custom message 消失。这个 API 只记录用户文本，自定义消息直接排 Agent queue，见 `CA/dist/core/agent-session.js:1727-1730,1681-1688,1835-1837`。Probe 的 `agent.hasQueuedMessages()` 在 settled 时为 true。

### Real interactive abort difference

真实 TUI 通过 `abortHandler` 调用 `restoreQueuedMessagesToEditor({ abort: true })`，见 `CA/dist/modes/interactive/interactive-mode.js:1434-1439`。该方法先 `clearAllQueues()`，把返回文本写回编辑器，再调用 `session.abort()`，见同文件 `3752-3765,3784-3802`。

`tui` Probe 加载实际 `InteractiveMode`，调用这些已安装方法。仅编辑器存储和 pending display 用最小对象替代，没有启动终端 UI、PTY 或服务。真实会话与真实 queue/abort 方法没有替代。结果记录 `editor-restored.editorText: "PRESERVED_INPUT"`，之后 settled，只有 1 个 provider 请求，Agent queue 已空。代码见 `Probe:151-155`。

因此这是实际交互模式取消方法的离线验证，不是完整终端端到端验收。它足以证明原测试缺少 abort binding 会改变输入最后放在哪里，不能证明终端视觉表现或按键处理。

## History and intent

本节仅通过只读 `git log`、`git ls-tree`、`git show` 读取提交对象，没有检出旧工作区、重跑旧版本或改测试。历史日志是当时提交保存的记录，不是本轮执行证据。

### Original SDK acceptance

`git log -- extensions/goal/__tests__/provider-runtime.mjs` 定位到初始提交 `50ff3b0de1071acec8bd3a85acf9f9b6b431cdd7`，提交说明为 `feat(goal): 放开多 provider 准入并持久化工具恢复门控`。该提交已有与当前相同的 stale follow-up 场景核心：Goal 后注册 agent_end handler，禁用 get_goal，通过公开 pi.sendUserMessage 追加 followUp，并断言两次请求、最终请求包含 PRESERVED_INPUT、状态 active、toolRecoveryRequired true。见 `50ff3b0:extensions/goal/__tests__/provider-runtime.mjs:236-254`。所以严格期望不是 0.99.1 升级时新添的。

同提交的 `adventure/evidence/implementation-slices-proposal.md:33-40` 在 Slice 1 acceptance 明确要求“失效排队请求不误取消用户输入”；`adventure/evidence/slice-1-provider-admission.md:14,75` 进一步写明失效 ticket 在 context 边界拦截，用户 steer/follow-up 和其他扩展消息保留，且 follow-up 仍执行、合计两次请求。结合原用例的位置，这一 SDK 验收确实涵盖已排队但尚未 delivered 的输入，而非仅保护已经进入 context 的输入。

历史两版日志均保存了通过结果：

| Historical artifact at 50ff3b0 | Recorded evidence |
| --- | --- |
| `adventure/evidence/slice-1-sdk-0.84.3.log:13` | `PASS 0.84.3 stale-queued-continuation-followUp (2 requests)` |
| `adventure/evidence/slice-1-sdk-0.85.1.log:13` | `PASS 0.85.1 stale-queued-continuation-followUp (2 requests)` |
| 两份日志 `1487-1516` | 场景 calls 2，第二请求不含 get_goal，tokens 14、status active |
| 两份日志 `1542-1567` | 初始 agent_end 为请求 1；内部取消后又有 agent_start，随后请求计数变为 2；最后 agent_settled 为请求 2 |

这比一句历史报告“全部通过”更具体，但日志没有完整消息正文，不能独立从日志正文重新检查 PRESERVED_INPUT。当时原夹具的该断言先执行、随后才记录 PASS。报告 `slice-1-provider-admission.md:66-83` 也明确两版各 22 场景、60 请求通过，并说明非 PTY SDK 验收边界。

### Earlier C11 exception

同一个提交仍保留旧产品规格，内容不能略去。`50ff3b0:docs/research/pi-goal-spec.md:45-47` 的 C11 明确允许撤销未发出的失效 Goal 请求时调用 TUI ctx.abort，接受清除其他扩展排队消息、把用户追加消息退回编辑器并要求用户重新发送。它要求文字可找回、历史和 Goal 不损坏，并明确“不再断言此取消路径保留并自动执行所有其他扩展消息”。`docs/research/pi-goal-slices.md:30-34` 复述该窄例外。

较后的 provider 方案也没有明确废除 C11。`50ff3b0:docs/research/pi-goal-any-provider-assessment.md:139,162` 说保留现有 C11 取舍，并把 TUI C11 队列副作用列为回归项。旧 `docs/research/pi-goal-provider-gate.md` 的 Status 及 Next move 还明确记录用户接受原 abort 方案，不实施 provider 包装检查层。

因此历史材料同时存在两种边界：SDK Slice 1 要求该受控竞争仍自动执行输入，TUI C11 允许内部取消把输入撤回编辑器。仅凭仓库记录不能断言后来 Slice 1 已正式撤销 C11，也不能倒过来用 C11 抹掉 Slice 1 保存的两次请求验收。主任务应保留这个约定差异，产品修复前确认当前是否继续要求 TUI 自动执行。

本轮 `tui` 的输入完整返回编辑器、请求停在 1，与 C11 允许的副作用一致。它证明原测试不能代表完整 TUI 队列契约，不单独证明违反 C11。默认 SDK `public` 停在 1 且输入滞留队列，则不满足当时已通过、当前仍保留的两次请求验收。

### Introduction is not established

可以确认当前 0.99.1 SDK 组合与历史 0.84.3/0.85.1 记录不同；不能说插件“从来如此”。历史取消后还继续 drain 队列，而当前 `_agentRunAbortRequested` 阻止后续自动继续，是已核验的当前机制。

但本轮没有旧代码与宿主版本的交叉矩阵，不定位首个坏提交或首个坏 Pi 版本。只读 `git log` 还显示后续 `e1e592f` 将 delivered 保护从 userDelivered 扩展为 externalWorkDelivered，代码差异不保护尚未 delivered 的队列输入；仅凭这个差异不能判定它引入失败。0.87 同样失败也只能证明此前已有失败观察，不证明根因首次出现在 0.87，更不能替代历史成功记录。

### Main-agent confirmation

主代理使用同一临时 Probe 独立复跑，证据在 `.scratch/pi-0.99.1-test-research/goal/main-public/` 与 `main-tui/`。我已读取两份 run.log，均为 expected 2、actual 1：public 的 SNAPSHOT 是 idle true、queued true、followUp 为 PRESERVED_INPUT；tui 是 idle true、queued false、followUp 为空，tui trace 记录输入返回编辑器。这是主代理本轮实跑，不是历史记录，也不计入我此前三个重复样本。

历史核验命令：

```bash
git log --oneline -- extensions/goal/__tests__/provider-runtime.mjs
git show --stat 50ff3b0
git ls-tree -r --name-only 50ff3b0
git show 50ff3b0:adventure/evidence/implementation-slices-proposal.md
git show 50ff3b0:adventure/evidence/slice-1-provider-admission.md
git show 50ff3b0:adventure/evidence/slice-1-sdk-0.84.3.log
git show 50ff3b0:adventure/evidence/slice-1-sdk-0.85.1.log
git show 50ff3b0:extensions/goal/__tests__/provider-runtime.mjs
git show 50ff3b0:docs/research/pi-goal-spec.md
git show 50ff3b0:docs/research/pi-goal-slices.md
git show 50ff3b0:docs/research/pi-goal-any-provider-assessment.md
git show 50ff3b0:docs/research/pi-goal-provider-gate.md
git log --oneline -- extensions/goal/src/scheduler.ts
git show e1e592f -- extensions/goal/src/scheduler.ts
```

## Root cause and test correction

生产保护只对已 delivered 的外部输入有效，见 `Scheduler:128-132,286-299`。自有过期票据被选为请求尾部时，后面的 follow-up 仍在 queue，`externalWorkDelivered` 为 false，Goal 就调用 `ctx.abort()`。它并没有只取消一条自有消息的能力。SDK 默认停止整轮；交互模式还把外部输入撤回编辑器。

`early` 与 `all` 通过解释了为什么常规输入场景可能正常：前者在 Goal 自动调度前已有用户工作，后者将用户消息与自有票据同批送达，进入生产保护分支。这两种改法不能作为原失败测试的修正。把 handler 前移会删除“自有票据已入队后失效”的条件；把队列模式改成 all 会删除默认 one-at-a-time 的竞争。虽然它们也能满足“两次请求”，却不再测试原意图。

最小测试改进应保留原竞争与精确断言：

- 使用公开 `session.followUp()` 并等待 `"queued"`，增加 settle 前后队列快照，避免依靠 void API 的隐式完成时间。此次探针表明，这个改进仍应为 red。
- 为默认 SDK 与交互 abort binding 分别补测。前者保留现有自动执行验收。后者若沿用 C11，应验证撤回编辑器的输入完整可找回、历史与 Goal 未损坏；若主任务决定废除该例外，再要求没有撤回、自动执行两次请求。不能未经确认直接把更强 TUI 约定写成历史共识。不要只断言 `stopReason !== "aborted"`。
- 维持默认 one-at-a-time，同时把 all 模式、steer 与提前入队保留为对照，不取代失败路径。

本次发现内部取消还可能生成 `stopReason: "error"`、`errorMessage: "This operation was aborted"`。`tui/tui.json` 已记录，`steer/run.log` 也显示额外 error assistant。原测试“没有 aborted assistant”不能完整识别取消痕迹。这是附加验收缺口，不是请求数失败的原因。对此应增加有针对性的终止结果验收，而非放宽请求数。

生产修改仍需主任务取得授权。`agent_before_settle` 是值得验证的调度候选，宿主先处理 agent_end 排队工作再进入该边界，见 `CA/dist/core/agent-session.js:1386-1390` 与 `CA/docs/extensions.md:66-67`。这还不是已证实的修复方案，不能直接假定搬 handler 就能解决所有 Goal accounting、budget、retry 与失效票据问题。

## Reproduction commands

先检查版本、入口和相关实现：

```bash
node --version
realpath node_modules/@earendil-works/pi-coding-agent
realpath node_modules/@earendil-works/pi-coding-agent/../pi-agent-core
rg -n 'getFollowUpMode|followUpMode' node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js
rg -n '_handlePostAgentRun|async abort|sendUserMessage|_runAgentPrompt|waitForIdle' node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js
rg -n 'abortHandler|restoreQueuedMessagesToEditor|clearAllQueues' node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js
```

Probe 已保存。每次使用新的 case 目录，在仓库根目录运行：

```bash
mode=public
case_dir="$PWD/.scratch/pi-0.99.1-test-research/goal/$mode"
mkdir -p "$case_dir/home"
env -i PATH="$PATH" HOME="$case_dir/home" PI_OFFLINE=1 \
  GOAL_PROVIDER_TRACE="$case_dir" \
  node .scratch/pi-0.99.1-test-research/goal/probe.mjs \
  node_modules/@earendil-works/pi-coding-agent "$mode" \
  > "$case_dir/run.log" 2>&1
printf '%s exit=%s\n' "$mode" "$?"
```

本次有效运行顺序为 `original public early steer foreign all`，然后 `late`，然后 `original-2 public-2 original-3 public-3`，最后 `tui`。重复场景传入的 mode 分别仍为 original/public，只使用不同 case_dir。没有并发运行。

首次生成 Probe 时 Goal import 多写了一个父目录，六次调用均在 scenario 初始化前报 `ERR_MODULE_NOT_FOUND`，不是行为复现。修正临时 Probe 的路径后重新运行；首次留下的六个空 `run-*` 目录已在重跑前删除。这个准备错误未计入三次复现结果。

## Cleanup and limits

有效场景的 `finally` 均清除 timer、abort 会话、emit shutdown、dispose，并在外层删除临时 run root。日志写入发生在清理前，但最后核对没有 `run-*` 目录。Probe 没有启动后台进程、child worker、listener、tmux 或 watcher，因此没有本任务监听端口需要释放。

清理检查和文本检查：

```bash
find .scratch/pi-0.99.1-test-research/goal -maxdepth 1 -name 'run-*'
ps -axo pid,comm,args | awk '$2 == "node" && index($0,"pi-0.99.1-test-research/goal/probe.mjs") { print }'
git diff --check
```

前两项均无输出，最后一项通过。保留隔离 HOME、Probe 和证据日志供审计，未在仓库外写文件，没有真实凭据或模型请求。按委派范围不运行 `pnpm run check` 或构建，避免与主任务冲突。

没有复跑旧 0.87 作为论据，也没有因为“旧版同样失败”推定生产 bug。结论来自 0.99.1 实际公开 API、默认队列、真实 Goal 状态提交与终止证据。完整真人 TUI 操作、源码重新加载和生产修复后的全套回归尚未验证。
