# Codex goal behavior at rust-v0.153.4

## Scope and source pin

本文只核验 `openai/codex` 的 `rust-v0.153.4`。该 annotated tag 经 tag object `042fb41b7c813ac7999105e886b2b7aa715b5081` 解引用到 commit [`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`](https://github.com/openai/codex/commit/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a)。下文链接全部固定到该 commit，没有用 `main` 代替版本源码。

实际读取范围如下：

- `codex-rs/ext/goal/src/{runtime,extension,accounting,tool,api,events,spec,steering,lib}.rs`
- `codex-rs/ext/goal/templates/goals/{continuation,budget_limit,objective_updated}.md`
- `codex-rs/ext/goal/tests/{accounting,goal_extension_backend,steering}.rs`，重点核验测试名称及预算、错误、恢复、子代理相关用例
- `codex-rs/state/src/{model/thread_goal,runtime/goals}.rs` 和 goal migrations
- `codex-rs/tui/src/{goal_files,goal_display}.rs`、`chatwidget/{goal_menu,goal_status,slash_dispatch,interaction}.rs`、`app/{thread_goal_actions,event_dispatch}.rs` 及 goal validation tests
- `codex-rs/app-server/src/request_processors/{thread_fork_goal,thread_goal_processor,thread_processor}.rs` 和 app-server protocol 的 fork/goal 类型
- 仓库根 `LICENSE`

没有继续展开 Core 的完整 idle 调度链。因此，下文能确认 goal runtime 在 idle hook 中何时提交，但不能给出 Core 从 turn 完成到发出 idle hook 的所有队列时序或公平性保证。这是本报告的主要缺口。

## State model

每个持久化 thread 最多一条 goal。SQLite 行保存 `thread_id`、内部 `goal_id`、objective、status、token budget、累计 token、累计秒数和时间戳；`thread_id` 是主键并随 thread 级联删除。[schema](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/state/goals_migrations/0001_thread_goals.sql#L1-L18) [foreign-key migration](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/state/migrations/0033_thread_goal_stopped_statuses.sql#L3-L19)

状态共六种：`active`、`paused`、`blocked`、`usage_limited`、`budget_limited`、`complete`。状态模型只把 `budget_limited` 和 `complete` 视为 terminal；不过 continuation 运行时只接受 `active`，所以其余四种停止状态也不会自动续跑。[model](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/state/src/model/thread_goal.rs#L12-L41) [runtime](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L428-L442)

`create_goal` 只会在没有 goal 或现有 goal 为 `complete` 时写入。未完成 goal 不会被模型工具替换。新 goal 获得新 UUID，usage 和时间归零。[insert SQL](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/state/src/runtime/goals.rs#L213-L268) [tool error](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/tool.rs#L191-L231)

## Prompt policy and runtime enforcement

必须把提示词约束和运行时强制分开。Codex 两者都用了，但强度不同。

| Behavior | Prompt policy | Runtime enforcement |
| --- | --- | --- |
| 只在用户或更高层明确要求时创建 goal | `create_goal` 描述要求不得从普通任务推断。[spec](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/spec.rs#L25-L48) | 不校验"明确要求"是否真实存在。运行时只校验 objective、budget 和现有状态。 |
| 完成前逐项核验、不得缩小目标 | continuation template 有完整 completion audit 和 fidelity 规则。[template](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/templates/goals/continuation.md#L30-L46) | 不检查验收项或证据。模型调用 `update_goal(status="complete")` 后即接受。 |
| blocker 连续三轮后才标记 blocked | tool spec 和 continuation template 都要求同一 blocker 连续至少三轮。[spec](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/spec.rs#L60-L83) [template](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/templates/goals/continuation.md#L48-L56) | `update_goal(blocked)` 本身不核验三轮。另有一条更窄的强制规则，只统计默认 namespace 的 `exec` 已执行失败，且本轮没有任何成功工具；连续三轮后 runtime 自动置 `blocked`。[accounting](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/accounting.rs#L102-L152) [turn stop](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L274-L328) |
| budget 到达后停止新实质工作并尽快收尾 | budget template 明确这样要求，并禁止仅因 budget 用尽而标 complete。[template](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/templates/goals/budget_limit.md#L1-L16) | DB 在 checkpoint 将状态改成 `budget_limited`，后续 idle continuation 被状态门禁抑制。当前 turn 不会硬取消，仍可继续产出并超预算。 |
| objective 是不可信用户数据 | 三个 template 都把 objective 放进 XML 风格边界，renderer 转义 `&<>`。[steering](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/steering.rs#L67-L94) [updated template](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/templates/goals/objective_updated.md#L1-L16) | 这是上下文构造，不是对 objective 内容做语义过滤。 |

模型可见工具固定为 `get_goal`、`create_goal`、`update_goal`。`update_goal` 的 schema 和 handler 都只允许 `complete` 或 `blocked`，模型不能直接 pause、resume、设 budget-limited 或 usage-limited。[spec](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/spec.rs#L9-L12) [handler](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/tool.rs#L234-L304)

## Automatic continuation

### Trigger

有两个明确入口：

1. extension 收到 `on_thread_idle` 后调用 `continue_if_idle()`。[extension](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L175-L187)
2. 外部 API 把 goal 设成 `active` 后，如果当前没有 turn，也会调用 `continue_if_idle()`；若 turn 正在运行，则把 goal 绑定到当前 turn，并在 objective 变化时注入 steering。[runtime](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L181-L243)

续跑不是复用上一条用户文本。runtime 生成一个 `InternalContextSource("goal")` 的 continuation item，随后以 `start_turn_if_idle` 开新 turn，并设置 `turn_trigger: "goal"`。[steering item](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/steering.rs#L53-L65) [submission](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L443-L475)

### Suppression

runtime 会在以下情况不续跑：

- feature disabled，或当前 thread 不提供 goal tools
- thread 是 ephemeral，因其没有 persistent thread state
- review subagent，明确隐藏 tools
- fork continuation deferral 尚未清除
- ThreadManager 或 live thread 不可用
- goal 不存在或 status 不是 `active`
- Core 的 `start_turn_if_idle` 拒绝，或提交报错

对应源码在 [thread capability](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L99-L156) 和 [continuation gates](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L399-L475)。Plan turn 也不计 goal token，并清除该 turn 的 active-goal 绑定。[extension](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L241-L270)

### Delay

Goal 层没有 sleep、backoff 或固定间隔。idle hook 和 external-active 路径都直接尝试 `start_turn_if_idle`。因此可移植语义应是"idle 后尽快提交一次"，而不是"每隔 N 秒轮询"。Core 如何排队并最终发出 idle hook未在本次收窄范围内核验，不能据此承诺零毫秒延迟或严格时序。

若提交被 Core 拒绝或失败，这次调用只记录 debug，不在 goal runtime 内安排 retry。[runtime](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L453-L475) 后续是否再次触发取决于新的 idle/lifecycle 事件，这是未展开 Core 调度链留下的缺口。

## Budget accounting

### Exact token formula

每次计费增量是：

```text
input_tokens_delta.saturating_sub(cached_input_tokens_delta)
    .saturating_add(output_tokens_delta.max(0))
```

源码实际先分别对累计计数做 `saturating_sub`，再按上式计算。这里是有符号 `i64` 的溢出饱和，不等于逐项截断为零；异常计数下仍可能出现负增量，调用方另有正增量筛选。因此移植时不能把公式擅自改成每一项都 `max(0)`。正常单调计数下就是非缓存 input 增量加 output 增量。`reasoning_output_tokens`、`total_tokens`、`cache_write_input_tokens` 和 `codex_rollout_budget_units` 不单独加入这个公式。[formula](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/accounting.rs#L422-L446) 测试以起始 `(input=100,cached=10,output=30)` 到 `(120,14,42)` 验证增量为 `(20-4)+12=28`。[test](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/tests/accounting.rs#L15-L40)

计费基线是 turn start 时的累计 usage。goal 在 turn 中途创建或替换时，基线重置到当时值，避免把创建前 token 算入新 goal。[accounting](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/accounting.rs#L226-L249) Plan mode完全不计。[test](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/tests/accounting.rs#L42-L56)

时间按 goal active 的单调时钟整秒累计。小于一秒的片段暂不写入；已写秒数通过推进 baseline 避免重复。idle resume 后也可累计 wall-clock 秒数。[wall clock](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/accounting.rs#L501-L539) [resume test](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/tests/goal_extension_backend.rs#L1319-L1368)

### Checkpoints and exhaustion

计费不会随每个 token event 立即写 DB。token hook 只更新内存累计值。DB checkpoint 至少包括符合条件的 tool finish、turn stop、turn abort、turn error、外部 goal mutation 和 fork 前 flush。[token hook](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L388-L415) [tool checkpoint](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L417-L489) [abort](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L332-L358)

Tool attempt 只有 `Completed` 或"handler 已执行"的 `Failed` 会触发 checkpoint。`Blocked`、未执行 handler 的失败、`Aborted` 不触发。`update_goal` 被排除，因为其 handler 自己先做 final accounting。[filter](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L451-L465) [outcome function](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L576-L587)

SQLite 在 `tokens_used + delta >= token_budget` 时原子地改为 `budget_limited`。不会截断到 budget，因此可以 overshoot。[SQL](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/state/src/runtime/goals.rs#L499-L610) 测试明确显示 budget 25 在第一次 checkpoint 到 25 后，当前 turn 继续，turn stop 最终记 35。[test](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/tests/goal_extension_backend.rs#L593-L665)

第一次在 tool checkpoint 发现 budget-limited 时，runtime 只向活跃 turn 注入一次 budget steering。它不硬中断 turn。稍后的 tool checkpoint 和 turn stop仍记入 in-flight usage。[extension](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L477-L489) [accounting status behavior](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/accounting.rs#L340-L363)

Budget 必须为正数，并受 `max_goal_token_budget` 上限约束。若调用者省略 budget，配置了 maximum 时，创建路径会把 maximum 当默认 budget。[validation](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/tool.rs#L413-L430) [API default](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/api.rs#L144-L173)

`remainingTokens` 是 `max(token_budget - tokens_used, 0)`。完成 budgeted goal 时，tool response 额外给模型一条报告最终 token/time 的指示，但实际向用户报告仍是提示词行为，不是 runtime 输出格式强制。[response](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/tool.rs#L433-L459) [completion report](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/tool.rs#L515-L523)

## Subagent usage

非 root agent 在启动时查找 parent 或 session root 的 `GoalAccountingState`。每次 token usage event 把该 event 的 `last_token_usage` 按同一公式加入 root 的原子 descendant counter。[root resolution](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L115-L152) [roll-up](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L407-L413)

这会跨子孙层级累计，即使中间 parent runtime 已 unload，grandchild 仍可落到 root accounting。测试覆盖 child 加 grandchild 合计耗尽 root budget，以及 parent unload 后 grandchild 的 23 tokens 仍被 root 收取。[tree test](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/tests/goal_extension_backend.rs#L413-L472) [unload test](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/tests/goal_extension_backend.rs#L475-L512)

Review subagent 看不到 goal tools，但其 usage 仍可上卷到 root。隐藏工具和计费是两件事。[tool visibility](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L101-L107) [review grandchild in test](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/tests/goal_extension_backend.rs#L420-L459)

Pi 移植不能只统计主代理 turn。需要一个 root-owned、跨 descendant lifetime 的累计器，并在换 goal 时重置 descendant baseline，而不是清空全局累计值。

## Interrupts, resume, errors, and limits

### User interruption

TUI 在快捷键真正触发 turn interrupt 时，若当前是 active goal turn，会另发 `thread/goal/set(status=paused)`。Ctrl+C、普通 interrupt key、运行任务退出菜单的 Cancel/Exit 都走这条语义。[interaction](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/interaction.rs#L503-L565) [pause helper](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/interaction.rs#L628-L647) [exit flow](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/app/event_dispatch.rs#L653-L704)

因此"用户中断后自动恢复"不是该版本行为。goal 保留为 `paused`，用户用 `/goal resume` 才改回 `active` 并触发 idle continuation。重新打开 session 时，TUI 对 `paused`、`blocked`、`usage_limited` 弹出恢复确认；选择 Resume 才继续。[resume prompt](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/app/thread_goal_actions.rs#L54-L85) [menu action](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/goal_menu.rs#L39-L71)

底层 `on_turn_abort` 自身只做 final accounting、清理 pending start options 和 finish turn，并不改 DB 状态。[abort hook](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L332-L358) 也就是说 pause 是 TUI 产品层补上的。非 TUI client 若只 interrupt 而不先 pause，goal 仍可能保持 active。Pi 移植要把"用户取消 goal turn 同时 pause goal"做成明确原子意图，不能假设 abort hook 会代劳。

### Error and usage limit

不可重试错误或重试耗尽后，runtime 先结算进度，再把 active goal 强制改为 `blocked`，防止 error/compaction loop 自动耗 token。`UsageLimitExceeded` 则改为 `usage_limited`。[error mapping](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L361-L384) [state update](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L265-L371)

Usage limit 可以覆盖刚进入 `budget_limited` 但仍在 flight 的 goal，并把剩余进度先计入，再落成 `usage_limited`。之后同 turn 的额外 usage 不再计入。[test](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/tests/goal_extension_backend.rs#L727-L805) [budget-limited limit test](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/tests/goal_extension_backend.rs#L900-L975)

Plan turn 和 stale turn 的 usage-limit 信号不会停止当前 goal，因为它们没有匹配的 active goal binding。[plan test](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/tests/goal_extension_backend.rs#L979-L1012) [runtime ID check](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L275-L289)

## Persistence and fork semantics

Goal 主状态存在 SQLite，同时 app-server 在 set 时把 `ThreadGoalUpdated` 写入 rollout。对 goal-first thread，它先补写 thread settings，再写 goal event。DB 是读写服务的当前状态，rollout 用于持久记录和 reconciliation。[app-server set](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server/src/request_processors/thread_goal_processor.rs#L123-L221)

Resume 时，runtime 只把持久化的 `active` 恢复为 idle active accounting。其他状态清空内存 active marker。app-server 另发 goal snapshot 给客户端。[runtime restore](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L375-L397) [snapshot](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server/src/request_processors/thread_goal_processor.rs#L398-L429)

Fork 只有在 experimental `deferGoalContinuation=true`、新 thread 非 ephemeral、rollout 存在且 goals enabled 时继承 goal。参数语义明写为"继承但不启动初始自动 continuation，下一条显式 turn 接管，之后恢复正常自动 continuation"。[protocol](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L590-L600) [fork conditions](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server/src/request_processors/thread_processor.rs#L5039-L5068)

Fork 前先 flush source in-flight usage。随后复制完整 snapshot，只改 `thread_id`，所以 `goal_id`、objective、status、budget、usage、created/updated timestamps 都保留。[flush API](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/api.rs#L113-L129) [copy](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server/src/request_processors/thread_fork_goal.rs#L5-L27) [snapshot SQL](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/state/src/runtime/goals.rs#L68-L123)

Deferral 本身也持久化到 `thread_goal_continuation_deferrals`，并通过 FK 随 goal 删除。任意下一 turn start 会清掉它，然后正常 lifecycle 可续跑。[deferral schema](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/state/goals_migrations/0002_thread_goal_continuation_deferrals.sql#L1-L3) [clear on start](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L223-L239)

这不是普通 fork 的无条件继承。Pi 若要复刻，应把"fork with deferred goal"作为显式模式，并保留快照计数和一个持久化 one-shot continuation barrier。

## TUI commands and goal files

命令语法是：

```text
/goal
/goal <objective>
/goal clear
/goal edit
/goal pause
/goal resume
```

固定 usage string 见 [goal_display](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/goal_display.rs#L1-L6)，解析与控制分支见 [slash dispatch](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/slash_dispatch.rs#L837-L942)。控制词按整个 trimmed 参数做 ASCII lowercase 精确匹配，因此 `/goal pause now` 是 objective，不是 pause。TUI 没有 `/goal ... --budget` 语法。

裸 `/goal` 显示 status、objective、time、tokens 和可用动作。[menu](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/goal_menu.rs#L85-L130) `/goal edit` 保留原 token budget。编辑 `budget_limited` 或 `complete` goal 会把状态改回 active；编辑 paused/blocked/usage-limited 则保留停止状态。[edit status](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/goal_menu.rs#L133-L142)

Protocol objective 上限是 4,000 Unicode chars。[validation](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/protocol/src/protocol.rs#L4002-L4013) TUI 对超长 objective、large paste 和图片不直接塞入字段，而写入 app-server 主机的 `$CODEX_HOME/attachments/<uuid>/`：

- paste 为 `pasted-text-N.txt`
- 本地图片为 `image-N.<sanitized-extension>`
- 最终 objective 超限时为 `goal-objective.md`
- DB objective 改为精确字符串 `Read the Codex goal objective file at <absolute-path> before continuing.`

实现见 [materialization](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/goal_files.rs#L17-L137)。编辑时只接受位于当前 `$CODEX_HOME/attachments/<valid-uuid>/goal-objective.md` 的这种精确引用，避免任意路径读取。[path validation](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/goal_files.rs#L140-L182)

失败时 TUI 清理本次 materialized output dir。替换未完成 goal 会先确认，再 clear 旧 goal，最后 set 新 goal；这不是单条数据库事务，中间失败可留下"旧 goal 已清、文件已清理"的结果。[set flow](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/app/thread_goal_actions.rs#L132-L230)

Ephemeral thread 不支持 goal。app-server 返回 invalid request，TUI 提示改用 saved session 或 resume。[server guard](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server/src/request_processors/thread_goal_processor.rs#L282-L347) [TUI message](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/app/thread_goal_actions.rs#L18-L21)

## Events and API ordering

Goal runtime 发 `ThreadGoalUpdatedEvent { thread_id, turn_id, goal }`。tool/turn 内更新带 turn ID，外部 API 更新的 turn ID 为 null。[emitter](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/events.rs#L19-L33)

App-server 的 `thread/goal/set|get|clear` 要求 feature enabled 和 materialized persisted thread。Set 的 API 参数允许 objective、status、double-option tokenBudget 独立更新。[protocol](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L815-L867) Set 顺序是 DB mutation、rollout append 尝试、response、ordered notification、最后 runtime effects。Rollout append 失败只 warn，不回滚 DB。[processor](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/app-server/src/request_processors/thread_goal_processor.rs#L151-L221)

并发保护分两层：goal-state semaphore 避免 external mutation 与 idle launch 交错；progress-accounting semaphore 避免并行 tool completion 重复收费；DB update 带 expected `goal_id` 防止旧版本 checkpoint 写到替换后的 goal。[API lock](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/api.rs#L176-L192) [accounting lock](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/accounting.rs#L154-L163) [expected ID SQL](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/state/src/runtime/goals.rs#L577-L585)

## Required semantics for a Pi port

后续 Pi 移植至少要保留这些语义，否则只是外观相似：

1. 每个持久 thread 单 goal，状态机和 usage 跨 turn 持久化。Ephemeral session 不开放 goal。
2. `active` 才能自动续跑。idle 触发一次 start-if-idle，不做 goal 层轮询；pause、blocked、usage-limited、budget-limited、complete 都抑制续跑。
3. 用户 interrupt 必须先或同时 pause。仅收到 turn abort 不足以推导 pause。
4. 计费公式严格使用 non-cached input 加 output，按 turn baseline 算 delta。Plan turn排除。并发 checkpoint 串行化，旧 `goal_id` 的写入必须拒绝。
5. 子孙代理 usage 归入 root goal，Review child 即使没有 goal tools 也照计。换 goal 时重置 baseline。
6. Budget crossing 在 checkpoint 发生，允许 overshoot。当前 turn收到一次收尾 steering，但不硬杀；turn 完成前继续记 in-flight usage。之后不再自动续跑。
7. error 和 usage limit分开。普通 terminal error落 `blocked`，服务限额落 `usage_limited`。三次 `exec` execution failure 的自动 blocked 是运行时窄规则，模型对一般 blocker 的三轮 audit 仍只是 prompt policy。
8. Fork 先 flush，再复制完整 snapshot，并持久化 one-shot deferral。只在显式 deferred-goal fork 模式继承，第一条显式 turn 清 barrier。
9. Objective 需要长度限制和附件 materialization。若采用文件引用，必须把路径约束在专用 attachment root 并验证引用格式。
10. Runtime event、DB state 和 transcript/rollout 的写入顺序要定义清楚。Codex 在 rollout append 失败时不回滚 DB，Pi 需有意选择是否复刻这一取舍。

## Gaps

- 未展开 Core 的完整 idle event 产生链、队列公平性和 start-if-idle 拒绝原因集合。因此没有声称严格零延迟，也没有声称拒绝后一定重试。
- 未执行该上游 Rust test suite。本报告依据固定版本源码与已有一手测试断言，不是本机动态运行结果。
- 未逐项审计 analytics/metrics 字段，因为它们不改变 goal 的用户可见状态机、预算或续跑语义。
- 未核验远端 Codex 服务是否还有仓库外策略。结论只覆盖该 tag 中可见的开源客户端、extension、state、TUI 和 app-server 行为。

## License

该 commit 根许可证是 Apache License 2.0，copyright notice 为 `Copyright 2025 OpenAI`。[LICENSE](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/LICENSE) `codex-goal-extension` 的 Cargo manifest 继承 workspace license。[Cargo.toml](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/Cargo.toml#L1-L9)

移植可在 Apache-2.0 条款下复用或修改源码，但分发时要附许可证、标明修改，并保留适用的版权、专利、商标和 attribution notices。Apache-2.0 不授予 OpenAI 商标使用权。此处是源码许可证事实摘要，不是法律意见。
