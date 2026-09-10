# Codex goal reminder injection and loop control

## Scope and source pins

本文以本机实际安装版本为主。本机已核验 `codex --version` 输出 `codex-cli 0.153.4`，与本仓库 pinned commit 一致。当前正式版和当前 `main` 只用于确认后来是否补上相关循环保护：

| Version | Commit | Verified status |
| --- | --- | --- |
| 本仓库 pinned `rust-v0.153.4` | [`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`](https://github.com/openai/codex/commit/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a) | 本仓库既定比较基线 |
| 当前正式版 `rust-v0.154.0` | [`6b9826e3aa83b1a5947db50f4332cb9c65f1b340`](https://github.com/openai/codex/commit/6b9826e3aa83b1a5947db50f4332cb9c65f1b340) | GitHub 标记为 Latest 的正式 release，[release page](https://github.com/openai/codex/releases/tag/rust-v0.154.0) |
| 调查时 `main` | [`5a9eb145c4c05fcfc7158d7c25b80e1322eccae1`](https://github.com/openai/codex/commit/5a9eb145c4c05fcfc7158d7c25b80e1322eccae1) | 尚未等同于正式 release |

对 `codex-rs/ext/goal` 执行 pinned 到 `rust-v0.154.0` 的源码 diff，没有差异。因此，本文重点行为在 `0.153.4` 和 `0.154.0` 相同。Pinned 之后、调查时 `main` 之前，官方 goal extension 只有两项相关提交：允许模型按用户明确请求暂停 goal 的 [`fa7af3883df4d14861f825f9a6aadbe1ffebe63d`](https://github.com/openai/codex/commit/fa7af3883df4d14861f825f9a6aadbe1ffebe63d)，以及增加空自动续跑保护的 [`0735c519789d300097554425cc3d7cf3f2d718a1`](https://github.com/openai/codex/commit/0735c519789d300097554425cc3d7cf3f2d718a1)。后者才改变本文讨论的循环停止行为。

结论依据是固定 commit 的客户端源码和官方测试，不包括仓库外服务端策略。没有执行上游 Rust 测试，也没有对 Codex CLI 与 Pi 做同输入、同模型的动态 A/B。

## Findings

已证明的结论如下。

1. Codex 不会在每个 tool response 后新注入一份 goal continuation prompt。它在 thread 完整进入 idle 后创建一个 continuation item，用该 item 启动一个新的 turn。Core 在 turn 开始时把这一条 `ResponseItem` 写入 conversation history。同一 turn 后续 sampling 只调用 `clone_history().for_prompt(...)` 重建请求，retry 路径也是从同一 history 重建。Core 没有按 `InternalContextSource("goal")` 删除旧条目并在最新 tool result 后重插一条的采样级路径。因此 prompt 会作为既有 history 留在请求中，而不是每次采样都变成最新 user item。[idle launch, `runtime.rs` L399-L475](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L399-L475) [context item, `steering.rs` L53-L64](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/steering.rs#L53-L64) [record the initial item, `hook_runtime.rs` L700-L721](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L700-L721) [normal sampling projection, `turn.rs` L372-L389](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L372-L389) [retry projection, `turn.rs` L1405-L1423](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L1405-L1423) [generic history projection, `history.rs` L287-L310](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/context_manager/history.rs#L287-L310)

2. 自动 continuation 的准确调用链是：一个 turn 先执行 `on_turn_stop` 或 `on_turn_abort`，Core 清除 `active_turn`，检查没有待触发 turn 的 mailbox item，然后调用 extension 的 `on_thread_idle`。Goal extension 再调用 `continue_if_idle()`，核验 deferral、live thread、goal 存在且为 `active`，渲染 `InternalContextSource("goal")` 的 contextual user fragment，最后通过 `start_turn_if_idle` 以 `turn_trigger: "goal"` 开新 turn。[turn completion order, `tasks/mod.rs` L812-L866](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/tasks/mod.rs#L812-L866) [idle gates, `tasks/lifecycle.rs` L43-L67](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/tasks/lifecycle.rs#L43-L67) [goal idle hook, `extension.rs` L175-L187](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L175-L187) [goal gates and submission, `runtime.rs` L399-L475](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L399-L475) [contextual user fragment, `steering.rs` L53-L64](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/steering.rs#L53-L64)

3. Tool response 不触发上述 idle continuation。Core 的 turn loop在模型需要 follow-up 时继续同一 turn；只有不再需要 follow-up 时才结束该 turn。Goal 的 `on_tool_finish` 负责记录工具结果、结算用量，以及在预算刚耗尽时注入单独的 budget-limit steering，不调用 `continue_if_idle()`。[turn loop contract, `turn.rs` L149-L160](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/session/turn.rs#L149-L160) [follow-up decision, `turn.rs` L408-L552](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/session/turn.rs#L408-L552) [tool finish, `extension.rs` L421-L489](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L421-L489)

4. `Completion audit` 不是运行时审计器。它只是 continuation template 中的模型指令，每次新自动 continuation turn 随完整模板出现。`update_goal(status="complete")` handler 只校验状态枚举、结算 usage、更新数据库和返回结果，不逐项核验文件、测试、交付物或完成证据。[completion instructions, `continuation.md` L30-L46](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/templates/goals/continuation.md#L30-L46) [template render, `steering.rs` L67-L94](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/steering.rs#L67-L94) [`update_goal` handler, `tool.rs` L234-L303](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/tool.rs#L234-L303)

5. Pinned 和当前正式版没有“同一成功工具调用重复 N 次后熔断”的 goal 级保护。Goal accounting 对任意成功工具只设置 `successful_tool = true`，并清空连续 exec 失败计数。连续三轮停止规则仅针对默认 namespace 的 `exec` 已执行失败，且该轮没有成功工具。它不比较 tool name、arguments、result 或 call sequence，也不累计重复成功调用。[tool accounting, `accounting.rs` L102-L152](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/accounting.rs#L102-L152) [turn-stop enforcement, `extension.rs` L274-L328](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L274-L328)

6. 调查时 `main` 新增的 fuse 也不是重复成功工具 fuse。它只统计自动 admission 的 goal turn，并要求 final answer 为空且整轮没有 activity。连续三轮才把 goal 标成 `blocked`。任何 tool outcome 都把该 turn 标为有 activity并重置空转计数，所以 178 次成功只读工具调用不会命中这条保护。[activity and empty-turn counter, `accounting.rs` L109-L229](https://github.com/openai/codex/blob/5a9eb145c4c05fcfc7158d7c25b80e1322eccae1/codex-rs/ext/goal/src/accounting.rs#L109-L229) [turn-stop check, `extension.rs` L275-L337](https://github.com/openai/codex/blob/5a9eb145c4c05fcfc7158d7c25b80e1322eccae1/codex-rs/ext/goal/src/extension.rs#L275-L337) [admission marker, `runtime.rs` L418-L500](https://github.com/openai/codex/blob/5a9eb145c4c05fcfc7158d7c25b80e1322eccae1/codex-rs/ext/goal/src/runtime.rs#L418-L500) [official change commit](https://github.com/openai/codex/commit/0735c519789d300097554425cc3d7cf3f2d718a1)

7. 因此，官方源码不能证明“Codex 绝不会循环”。已证明的是几类窄停止条件：三轮无成功工具的已执行 `exec` 失败、terminal turn error、usage limit、budget 状态门禁，以及 `main` 才有的三轮空自动 continuation。只要模型持续返回成功只读工具调用，Core 会继续同一 turn 的 tool follow-up，既不会进入 idle continuation，也不会触发上述失败或空回合计数。[same-turn tool continuation, `turn.rs` L149-L160](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/session/turn.rs#L149-L160) [follow-up decision, `turn.rs` L408-L552](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/session/turn.rs#L408-L552) [error stop, `extension.rs` L361-L384](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L361-L384) [active-only continuation gate, `runtime.rs` L428-L442](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L428-L442)

## Core reinjection check

这项核验专门沿着 Core 继续追踪 `InternalContextSource("goal")`，没有只停在 extension 入口。

- Goal extension 把 prompt 包装成带 `source="goal"` 的 `InternalModelContextFragment`。Core 的通用 fragment 实现只是生成带来源标记的 contextual user content，并不注册一个“每次 sampling 重新渲染”的 provider。[goal wrapper, `steering.rs` L53-L64](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/steering.rs#L53-L64) [fragment implementation, `internal_model_context.rs` L64-L84](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/context/internal_model_context.rs#L64-L84)
- `start_turn_if_idle` 提交的 `TurnInput::ResponseItem` 在 turn-start input 记录阶段写入 history 一次。[submission, `runtime.rs` L443-L475](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L443-L475) [recording, `hook_runtime.rs` L700-L721](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/hook_runtime.rs#L700-L721)
- Tool follow-up 的下一次 sampling 从完整 conversation history 做通用 projection。源码没有在该 loop 中调用 `continuation_steering_item`，也没有按 `goal` source 执行 remove/reinsert。[sampling loop, `turn.rs` L315-L389](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L315-L389) [follow-up branch, `turn.rs` L408-L518](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L408-L518)
- Core 确有通用 contextual item 裁剪逻辑，但源码将其用于 rollback 边界处理，不是每个模型采样的刷新机制。[rollback trimming, `history.rs` L585-L628](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/context_manager/history.rs#L585-L628)

所以更准确的说法是：Codex 在每个新自动 goal turn 生成并记录一份 prompt。该份 prompt随后作为既有 history 参与同 turn 的后续模型采样。它不会像 Pi 当前 `context` hook 那样，逐次删除旧 goal context 并把完整 prompt 重新放到上下文末尾。

## Call chain

Pinned 和 `0.154.0` 的原生链路可压缩为：

```text
model emits only final assistant output
  -> run_turn sees needs_follow_up == false
  -> turn stop lifecycle
  -> active_turn cleared
  -> thread idle lifecycle, unless trigger-turn mailbox has work
  -> GoalExtension::on_thread_idle
  -> GoalRuntimeHandle::continue_if_idle
  -> continuation_steering_item
  -> contextual user fragment with source "goal"
  -> start_turn_if_idle(turn_trigger = "goal")
  -> run_hooks_and_record_inputs records that one item at turn start
  -> sampling loop
       tool call -> tool output -> history rebuilt -> next sampling in same turn
       final-only output -> turn stops -> idle chain repeats if goal remains active
```

关键边界是“完整 turn”而不是“单次模型 response”。一个 response 以 tool use 结束时，Codex 仍在同一 turn 内。Goal extension 不在这个边界重新渲染 continuation template。[Core loop contract, `turn.rs` L149-L160](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/session/turn.rs#L149-L160) [idle submission, `runtime.rs` L443-L475](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L443-L475)

## Comparison with the Pi extension

本仓库当前 `extensions/goal/src/scheduler.ts` 的行为不同：

| Topic | Codex native | Pi extension workspace |
| --- | --- | --- |
| continuation prompt 的生成时机 | thread idle 时生成一次，作为新 turn 的初始 contextual user item | 每次 Pi `context` hook 都移除旧的自有 goal context，并在末尾追加完整 `renderGoalPrompt`，见 `extensions/goal/src/scheduler.ts:117-154` |
| tool result 后的位置 | 原 prompt 留在 history 原位置，tool result 之后不新追加 goal prompt | 转换后的模型上下文会在 tool result 后追加新的 user-role goal audit。主线程内存模拟已观察到该顺序 |
| 用户 follow-up 后的位置 | idle gate 先让 trigger-turn mailbox 输入优先；不会靠 goal hook把完整 prompt强制移到用户消息之后 | 主线程内存模拟观察到 `Please finish now` 后仍追加 user-role goal audit |
| 自动 continuation | 完整 turn 停止并进入 idle 后，由 Core lifecycle 启动新 turn | `agent_end` 只接受最后 assistant 的 `stopReason === "stop"`，随后 `start(ctx)`，见 `scheduler.ts:71-85` |
| 三轮 exec/bash 失败 | 完整 goal turn 粒度，成功工具清零失败 streak | `finishRun` 使用 `failedBash && !successfulTool`，但只有正常 `stop` 或 `completedResponse` 才结算，见 `scheduler.ts:53-60, 63-84, 117-120` |
| 重复成功工具 | 无重复成功调用 fuse | 同样无 fuse。成功结果只把 `successfulTool` 设为 true，见 `scheduler.ts:65-69` |
| `main` 空回合保护 | 三个空自动 continuation turn 后 blocked | 当前 Pi scheduler 没有对应的空自动 continuation turn 计数 |

这里能证明的是调度和上下文排列不同。不能仅凭排列差异证明它导致了真实 session 的 178 次调用。当前证据没有同模型、同 objective、同初始 history，仅切换 Codex 原生与 Pi scheduler 的 A/B。主线程的 `convertToLlm` 内存模拟证明 Pi 会把审计文本放在 tool result 或用户 follow-up 后面，但它没有证明模型一定因此继续调用工具。

## Interpretation of the observed session

已知真实 session 在完成报告后又发生 178 次成功只读工具调用，所有 assistant response 都是 `stopReason: "toolUse"`，没有正常 `stop`，也没有发生自动 continuation 重启。这个现象与当前 Pi scheduler 控制流一致：

- `agent_end` 不会在每个 `toolUse` response 后执行 `finishRun` 或 `start`，因为它明确要求最后 response 为 `stop`。`scheduler.ts:71-85`
- `message_end` 也只把不含 tool call 的正常 `stop` 标为 `completedResponse`。`scheduler.ts:62-64`
- 每次后续模型请求仍经过 `context` hook，旧 goal message 被移除，完整 audit 又放到末尾。`scheduler.ts:117-154`
- 成功只读工具只设置 `successfulTool = true`，既不会停止运行，也会阻止失败 streak 增长。`scheduler.ts:53-69`

用户催促后模型调用 `update_goal` 并成功，说明状态机和工具本身仍可结束 goal。它不能单独证明此前循环的原因是 reminder 位置，也不能证明换成 Codex 原生注入方式后同一模型必然会自行结束。

对 Codex 原生行为，结论同样有限。若同样的 178 次调用都发生在一个 turn 内并持续返回 tool follow-up，原生 idle continuation 不会介入。原生 prompt 不会每次重新移到最新 tool result 后，但 pinned、`0.154.0` 和调查时 `main` 都没有重复成功工具调用 fuse。原生实现因此降低了“每次请求都用一条最新 user message再次强调继续”的压力，却没有从运行时排除成功工具循环。

## Proven and inferred

### Proven

- Pinned 与当前正式版的 goal extension 在本次范围内无源码差异。
- continuation prompt 按 idle/new-turn 边界生成，不按 tool response 边界生成。
- completion audit 是模型指令，不是 `update_goal` 前的运行时 validator。
- pinned 和 `0.154.0` 没有重复成功工具调用 fuse。
- 当前 `main` 只新增三轮空自动 continuation fuse，任何工具活动都会使其失效。
- 成功只读工具循环可持续停留在一个 turn 内，绕过 idle continuation 和 turn-stop 检查，直到模型给出 final-only response、调用 `update_goal`、发生错误、预算或外部中断。

### Inferred

- Pi 把完整 audit 反复追加在上下文末尾，可能比 Codex 原生保留在 history 原位置更容易让模型把“继续工作”解释成最新指令。这是合理机制假设，不是已完成 A/B 的因果结论。
- 用户明确追问 `update_goal` 后，模型又做了一次 bash 检查，随后才调用完成工具。这说明它最终恢复了收尾行为，但无法区分是提醒位置、模型随机性、上下文累积，还是用户文本本身造成。

## Version differences

`rust-v0.153.4` 与 `rust-v0.154.0` 的 goal extension 对本文问题相同。当前 `main` 有两项差异：

1. `update_goal` 可在用户明确请求时接受 `paused`。这不处理重复成功工具循环。[current handler, `tool.rs` L234-L304](https://github.com/openai/codex/blob/5a9eb145c4c05fcfc7158d7c25b80e1322eccae1/codex-rs/ext/goal/src/tool.rs#L234-L304) [change commit](https://github.com/openai/codex/commit/fa7af3883df4d14861f825f9a6aadbe1ffebe63d)
2. 三次连续空自动 continuation turn 会自动 blocked。工具调用算 activity，因此它不覆盖本次 178 次成功只读调用。[current accounting, `accounting.rs` L159-L229](https://github.com/openai/codex/blob/5a9eb145c4c05fcfc7158d7c25b80e1322eccae1/codex-rs/ext/goal/src/accounting.rs#L159-L229) [change commit](https://github.com/openai/codex/commit/0735c519789d300097554425cc3d7cf3f2d718a1)

## Validation status

主线程已运行本仓库 `pnpm run check`，结果为 919 tests passed、2 skipped，并完成类型检查、测试、构建和发布包校验。该结果证明当前仓库检查通过，不是 Codex 原生循环行为的动态 A/B。

本次启动了一个研究 subagent，没有启动产品服务或真实模型 A/B。主线程读取并验收报告后关闭该 subagent，核验其已记录进程及 Git 子进程均已退出，对应 PID 没有 TCP 监听。

## Bottom line

Codex 原生 goal prompt 的关键设计不是“每个 tool response 后提醒一次”，而是“每个 idle 后的新 continuation turn 只投递一次”。Completion audit 也只在这份 prompt 中要求模型执行，runtime 不验证它。

Pi 当前实现把完整 goal audit 刷新到每次模型请求末尾，这是已证明的调度差异。它可能影响模型决策，但还没有 A/B 证据证明它就是 178 次调用的原因。

最后，无法证明 Codex 绝不会循环。Pinned、当前正式版和当前 `main` 都没有重复成功工具调用 fuse。`main` 新增的三轮空回合保护不覆盖持续成功的只读工具调用。