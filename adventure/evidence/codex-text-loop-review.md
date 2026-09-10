# Codex goal non-empty text loop review

## Scope

本文只回答 Planning #15 的一个问题：Codex CLI goal 激活后，如果模型连续输出非空纯文本、不调用工具、也不调用 `update_goal`，客户端是否会继续自动开 turn，以及现有停止条件能否截断这条路径。

核验对象如下：

| 对象 | 固定版本或 commit | 核验结果 |
| --- | --- | --- |
| 本机 Codex CLI | `codex-cli 0.153.4` | 本机执行 `codex --version` 得到该版本 |
| 本仓库 pinned | [`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`](https://github.com/openai/codex/commit/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a) | 对应 `rust-v0.153.4` |
| 当前 latest release | [`rust-v0.154.0`](https://github.com/openai/codex/releases/tag/rust-v0.154.0) | annotated tag 指向 [`6b9826e3aa83b1a5947db50f4332cb9c65f1b340`](https://github.com/openai/codex/commit/6b9826e3aa83b1a5947db50f4332cb9c65f1b340) |
| 本次在线重新解析的 `main` | [`968835997714baaff199cfed5f89a2c65d8ca77d`](https://github.com/openai/codex/commit/968835997714baaff199cfed5f89a2c65d8ca77d) | 通过 GitHub `commits/main` API 解析并固定，避免链接随分支移动 |

对 `runtime.rs`、`extension.rs`、`accounting.rs`、`tool.rs` 和 `continuation.md` 下载固定 commit 的原始内容后计算 SHA-256。Pinned 与 `0.154.0` 的五个文件逐一相同。因此两者在本文问题上的行为相同。

## Conclusion

有这种可能。

在 `0.153.4` 和 `0.154.0` 中，只要 goal 保持 `active`，一个 turn 即使只返回非空 final text、没有任何 tool call，也会在 turn 结束并进入 idle 后触发新的 goal continuation turn。源码没有为“连续非空纯文本且无工具”设置次数上限。若 goal 没有 token budget，客户端这条控制流没有内建的有限上界。

本次固定的 `main` 增加了“三次空自动 continuation 后 blocked”的保护，但非空文本被明确记为 activity，并把空回合计数清零。因此 `main` 的新保护也不覆盖连续非空纯文本。每轮输出一句“仍在处理”就足以绕开它。

这不是动态复现结论。它是固定源码能容许的执行路径。真实模型是否持续选择该路径，源码不能回答。

## Control flow

完整路径如下：

```text
active goal
  -> model returns a non-empty final assistant message, with no tool call
  -> turn stops
  -> goal turn-stop accounting runs
  -> core clears the active turn
  -> core emits thread-idle lifecycle
  -> GoalExtension::on_thread_idle
  -> GoalRuntimeHandle::continue_if_idle
  -> goal still exists and status is active
  -> start_turn_if_idle(turn_trigger = "goal")
  -> next automatic goal turn
```

Core 先执行 turn-stop lifecycle，再清除 active turn，随后在 mailbox 没有用户触发 turn 时发出 idle lifecycle。[`tasks/mod.rs` L824-L856, release](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/tasks/mod.rs#L824-L856) Idle 检查本身只分发 extension hooks，不会无条件创建新 turn。[`tasks/lifecycle.rs` L43-L67, main](https://github.com/openai/codex/blob/968835997714baaff199cfed5f89a2c65d8ca77d/codex-rs/core/src/tasks/lifecycle.rs#L43-L67)

Goal extension 在 idle hook 中调用 `continue_if_idle()`。[`extension.rs` L175-L187, release](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/ext/goal/src/extension.rs#L175-L187) 该函数只要求 goal 存在且状态为 `Active`，然后用 continuation item 调用 `start_turn_if_idle`。[`runtime.rs` L428-L462, release](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/ext/goal/src/runtime.rs#L428-L462) 它没有读取上一轮 final text 是否非空，也没有检查上一轮是否调用过工具。

Continuation template 还要求：证据不充分时继续工作并保持 goal active，只有完成或满足严格 blocked audit 时才调用 `update_goal`。[`continuation.md` L35-L56, release](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/ext/goal/templates/goals/continuation.md#L35-L56) 这能约束理想模型行为，但不是 runtime validator，也不是循环上限。

## Session distinctions

### Ordinary session without a goal

普通无 goal 会话没有这条自动续跑路径。Core 会发出 idle lifecycle，但 goal runtime 查不到 goal 后会清理 accounting state 并返回，不调用 `start_turn_if_idle`。[`runtime.rs` L428-L437, release](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/ext/goal/src/runtime.rs#L428-L437)

所以“普通 assistant final text 结束会话”和“active goal 下 assistant final text 结束当前 turn 后再开 continuation”必须分开讨论。

### Active goal with non-empty text only

在 pinned 和 release 中，turn-stop 逻辑检查 exec 失败并结算 goal usage，但没有纯文本 no-progress 计数。[`extension.rs` L274-L328, release](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/ext/goal/src/extension.rs#L274-L328) Goal 结算后若仍为 active，随后的 idle hook会再次启动 turn。

在 `main` 中，源码新增 item accounting。非空 assistant text 令 `has_activity = true`，并立即把 `consecutive_empty_turns` 清零。[`accounting.rs` L163-L203, main](https://github.com/openai/codex/blob/968835997714baaff199cfed5f89a2c65d8ca77d/codex-rs/ext/goal/src/accounting.rs#L163-L203) 空回合保护只接受自动 goal turn、空 final 且整轮没有 activity，连续三次才返回 goal id。[`accounting.rs` L206-L229, main](https://github.com/openai/codex/blob/968835997714baaff199cfed5f89a2c65d8ca77d/codex-rs/ext/goal/src/accounting.rs#L206-L229) `on_turn_stop` 随后才把这类 goal 标成 blocked。[`extension.rs` L292-L324, main](https://github.com/openai/codex/blob/968835997714baaff199cfed5f89a2c65d8ca77d/codex-rs/ext/goal/src/extension.rs#L292-L324)

官方测试覆盖了三次空 final，以及用户输入、工具、goal 变化、显式 reset 对计数的重置。[`tests/accounting.rs` L62-L114, main](https://github.com/openai/codex/blob/968835997714baaff199cfed5f89a2c65d8ca77d/codex-rs/ext/goal/tests/accounting.rs#L62-L114) 测试使用的 final text 只有空白。它没有主张非空文本应被阻断，生产代码反而明确把非空文本算作 activity。

### Model calls `update_goal`

在 `0.153.4` 和 `0.154.0` 中，模型可把 goal 更新为 `complete` 或 `blocked`。成功更新后，handler 清除当前 turn 的 active goal，后续 idle gate 不再续跑。[`tool.rs` L234-L304, release](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/ext/goal/src/tool.rs#L234-L304)

本次固定的 `main` 还接受模型提交的 `paused`。错误文本要求它只在用户明确请求时使用，但 handler 没有额外核验该请求是否存在。[`tool.rs` L234-L260, main](https://github.com/openai/codex/blob/968835997714baaff199cfed5f89a2c65d8ca77d/codex-rs/ext/goal/src/tool.rs#L234-L260) 这些停止方式都依赖模型主动调用工具。连续纯文本路径的定义正是模型没有这样做，所以它们不是 runtime fuse。

### Token budget

`create_goal` 的 `token_budget` 是可选值。只有调用方传入预算或 host 配置了 `max_goal_token_budget` 时，创建逻辑才会填入预算。[`tool.rs` L191-L211, release](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/ext/goal/src/tool.rs#L191-L211)

Turn stop 会结算 token usage，并以 `ClearActive` 处理达到预算的状态。[`extension.rs` L299-L305, release](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/ext/goal/src/extension.rs#L299-L305) 后续 `continue_if_idle()` 只接受 `Active`，不接受 `BudgetLimited`。[`runtime.rs` L439-L441, release](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/ext/goal/src/runtime.rs#L439-L441) 因而在 usage accounting 正常完成时，有限 token budget 是现有的总量边界。没有预算时，不能把它当作保护。

### Three failed exec turns

三轮保护只统计默认 namespace 的 `exec`，要求 handler 已执行并失败，而且该 turn 没有任何成功工具。连续计数达到 3 才返回待阻断 goal。[`accounting.rs` L102-L152, release](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/ext/goal/src/accounting.rs#L102-L152)

纯文本 turn 没有 failed exec，因此不会增加这项计数。它与本文路径无关。

## Version findings

| 行为 | `0.153.4` pinned | `0.154.0` latest | 固定的 `main` |
| --- | --- | --- | --- |
| Active goal 在 idle 后自动开 turn | 是 | 是 | 是 |
| 连续非空纯文本且无工具的次数上限 | 无 | 无 | 无 |
| 三次空自动 continuation 后 blocked | 无 | 无 | 有 |
| 空回合保护覆盖非空文本 | 不适用 | 不适用 | 否，非空文本算 activity 并重置计数 |
| 模型主动 `update_goal(complete/blocked)` | 可停止 | 可停止 | 可停止 |
| 模型主动 `update_goal(paused)` | 不允许 | 不允许 | handler 接受，提示要求仅用于用户明确请求 |
| Token budget 达限 | 停止 active continuation | 停止 active continuation | 停止 active continuation |
| 三轮 failed exec | blocked | blocked | blocked |

`main` 启动自动 turn 后会记录该 turn id，空回合判断只针对这种 host-admitted continuation。[`runtime.rs` L472-L484, main](https://github.com/openai/codex/blob/968835997714baaff199cfed5f89a2c65d8ca77d/codex-rs/ext/goal/src/runtime.rs#L472-L484) 这进一步说明新增逻辑很窄，不是通用 no-progress 检测。

## Prevention options

Codex 已有的有限 token budget 可以限制观测到的总消耗，但不判断纯文本是否有进展，且依赖 usage 正常归集。是否为本项目设置默认或强制预算尚未确认，归 Planning #16。用户也可暂停、清除或中断 goal，但这需要外部动作。

Planning #15 中的“连续纯文本有限暂停”属于本项目额外的安全取舍，不是对齐 Codex `0.153.4`、`0.154.0` 或本次固定 `main` 所必需的行为，也不是跨 provider 接入的技术前提。它可能暂停合法的写作或分析，不能把没有工具调用直接判定为没有语义进展。

后续决定：用户在了解上游行为后明确排除本次新增纯文本保护。完整决定与剩余异常处理讨论在 [Planning #15](https://github.com/wangxuyang1221/adventure/issues/15) 维护；本报告的上游事实不变。

## Evidence limits

本文使用官方仓库固定 commit 的客户端源码、官方 release/tag API、官方测试和本机版本输出。没有运行真实模型，没有构造同模型动态复现，也没有运行上游 Rust 测试。

因此本文证明的是：客户端控制流允许连续非空纯文本自动续跑，现有本地 guards 不会截断无预算的该路径。本文不声称任一具体模型一定会无限输出，也不假设客户端外还有或没有服务端限额、风控、调度超时或其他策略。

## Source index

- GitHub latest release API: <https://api.github.com/repos/openai/codex/releases/latest>
- GitHub `rust-v0.154.0` tag ref: <https://api.github.com/repos/openai/codex/git/ref/tags/rust-v0.154.0>
- GitHub `main` resolution used by this report: <https://api.github.com/repos/openai/codex/commits/main>
- Pinned commit: <https://github.com/openai/codex/commit/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a>
- Latest release commit: <https://github.com/openai/codex/commit/6b9826e3aa83b1a5947db50f4332cb9c65f1b340>
- Fixed `main` commit: <https://github.com/openai/codex/commit/968835997714baaff199cfed5f89a2c65d8ca77d>
