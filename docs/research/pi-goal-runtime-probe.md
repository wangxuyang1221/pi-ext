# Pi goal runtime probe

## Purpose and boundary

验证标准 Pi 的公开扩展接口能否承载 goal 连续执行，以及排队、暂停和 `agent_settled` 的主要风险。本实验属于 [规划关 #2](https://github.com/wangxuyang1221/adventure/issues/2)，不是插件实现或整体验收。

C2 已由用户确认：只使用标准 Pi + 本仓库扩展，不修改或 fork Pi 核心。可以联动适配 codex-ui、subagent，行为差异仍须确认。

实验脚本：`prototypes/goal-runtime-probe/probe.mjs`。

运行的是真实安装包中的 `createAgentSession`、扩展 loader/runner、agent loop 与队列，不是模拟这些接口。模型响应使用 Pi 自带 `fauxProvider`，每条响应延迟 15ms；暂停由后一位扩展监听者修改实验状态模拟，未发送真实终端按键。没有调用付费模型，因此不能据此证明真实模型会按要求完成目标。

凭据、模型目录存储、settings、session 均使用内存实现；资源发现关闭。全局 fetch 被改为立即报错，两个版本运行结果均为 `networkAttempts=0`。未创建监听服务或后台进程，session 在 finally 中 abort/dispose，deadline timer 清理。未修改用户配置、宿主或真实会话。

## Executed versions

- 仓库 Pi `0.84.3`，官方提交 `4e58f324fae8ebfa98a3d45181fb248072a2afac`。
- 当前宿主 Pi `0.85.1`，官方提交 `d981de1229ef899957bbe968bc8dcda02a21f477`。

两个版本均实际执行十三个用例，所有断言通过，结果一致。新增重试及压缩用例使用受控错误响应；压缩场景把第一条 assistant usage 替换为 130001 tokens 以触发真实自动压缩流程，不代表实际 token 消耗。

## Results

| Case | Actual result | Consequence |
| --- | --- | --- |
| `agent-end-followup` | `agent_end` 内加入 follow-up custom message，完成 3 次模型请求。原始 `session.prompt()` 等到 3 次全部结束才返回；只发出一次最终 settled | 存在不修改宿主的连续执行路径 |
| `agent-end-followup` 的队列观察 | 加入 custom message 后，两次 `ctx.hasPendingMessages()` 均为 false | 该接口不能证明所有扩展队列都为空 |
| `agent-end-later-pause` | 先排入续跑，后一个 `agent_end` handler 将 active 改为 false，仍发生第二次模型请求 | 仅在排队前检查 active 不够；过期续跑会多请求一次 |
| `agent-end-pause-context-guard` | 同样排队后暂停，在 `context` 发现最后一条是失效的实验 custom message 时调用 `ctx.abort()`。模型请求数保持 1；底层有第二次 start/end，但没有第二次 provider 调用 | 可以在公开接口中阻止这个窄场景的额外模型请求；并未撤回队列，也没有消除内部 aborted 回合 |
| `settled-immediate-restart` | `agent_settled` 内立即启动续跑，原始 `session.prompt()` 在仅完成一次 end 时已返回，而且 `session.isIdle=false`。另行 `waitForIdle()` 才等到 3 次全部完成 | 不宜把裸 settled-restart 当成对所有 SDK/CLI 消费者透明的调度方式 |
| `settled-earlier-observer` | 同一次 settled 中，早于续跑 handler 的观察者看见 `idle=true`，晚于续跑 handler 的观察者看见 `idle=false` | 其他插件可能提前记录完成。加载顺序并不能提供全局稳定的完成语义 |

三个回合的 follow-up 运行只触发一次 `before_agent_start`。自动续跑使用 custom message 时，不能假定该钩子每回合都会重新注入目标或重建系统提示。

## Retry and compaction results

追加四个用例后观察到：

| Case | Actual result | Consequence |
| --- | --- | --- |
| `native-retry-before-goal-continuation` | 首次返回可重试的 500 错误，Pi 原生重试一次并成功，然后才排入 goal continuation。共 3 次模型调用，只有最终 settled | 不必由 goal 重新实现 Pi 的重试；不能在首个失败的 agent_end 就宣告阻塞或另外启动 goal |
| `native-retry-exhaustion-stops-goal` | 配置最多一次重试，两次均失败；最终 settled 时将实验 goal 停止，没有第三次模型调用 | 可以在宿主重试耗尽后停止 goal，避免无限重新尝试 |
| `compaction-failure-context-guard-only` | 一次任务响应触发压缩，摘要生成失败；已排队续跑在 context 中 abort，但 Pi 又自动尝试一次压缩。总计 3 次调用，一次任务与两次失败摘要 | 仅拒绝失效的续跑请求仍不足以阻止额外的压缩开销 |
| `compaction-failure-with-recovery-guard` | 同样的失败后，另外在 session_before_compact 拒绝这个已停止 goal 的自动恢复。总计 2 次调用，一次任务与一次失败摘要；第二次压缩在调用模型前取消 | 公开扩展钩子能够阻断此窄场景中的重复恢复，无须修改 Pi 核心 |

第一次新增压缩用例原以为 context guard 足够，断言预期 2 次请求，实际为 3 次而失败。没有把该结果当成成功实现；脚本保留了反例，并增加带自动恢复门禁的对照组。两个版本均复现相同差异。

这些实验只有内存 active 标志，不是完整故障恢复实现。正式方案需要把恢复门禁限定在失败 goal 的 generation 和当前自动恢复链；显式用户输入、手动 compact 或其他任务如何解除门禁仍需验证，不能永久禁止 Pi 压缩。

## User input interleaving results

新增四项受控实验：在第一次 `agent_end` 中将一条显式 user follow-up 排在 goal continuation 之前或之后，然后将实验 goal 停止。两种顺序分别验证仅 abort 和 abort 加上下文过滤。注入的是 Pi 真实 user 队列，不是真实终端键盘事件。

- 四项在两个版本均为 2 次模型调用，分别处理初始请求和用户 follow-up。失效 goal 本身没有额外模型请求；用户文本出现在后续上下文。
- 仅 abort 时，自有旧 goal 提醒仍留在历史中。尤其 goal 排在 user 之前时，后续用户请求的上下文仍含已失效的继续指令。没有额外自动请求，不代表没有旧指令污染。
- 增加 `context` 返回值过滤后，后续 context 监听者看到的消息不再含该自有失效提醒，用户消息保留。正式实现必须按 goal 身份与代次过滤，不能清除其他扩展或用户消息。
- user 排在前面时有 2 次底层 end，排在后面时有 3 次；两者都是 2 次模型请求。门禁产生的 abort 会增加底层事件，因此不能按裸 `agent_end` 数量判断三轮 bash 失败。

断言覆盖模型调用数、用户文本保留、门禁执行和过滤前后差异。上下文观察来自扩展链前后的监听者，不是付费模型服务的接收日志。尚未覆盖批量消息、steering、active goal 与用户输入并发，以及真实终端取消。

## Candidate direction

以下是实验支持的候选设计，还不是用户批准的完整 spec：

- 优先使用 `agent_end` 后的宿主 continuation 路径维持连续执行，避免直接在 settled 中另开不被原 prompt 等待的运行。
- 为续跑记录 goal ID、generation 和调度意图，在真正进入模型请求前再次核验；不能只依赖排队时的状态。
- 对终止错误、压缩失败、取消、目标替换和旧会话闭包设明确失效条件。
- 不能照搬本实验“最后一条 custom + inactive 就 abort”作为完整实现。多个来源的消息可能同批出现，必须先证明不会中止真实用户输入或其他插件的工作。
- 自有 subagent 的完成语义须与 goal 对齐，不能把任意低层 end 或中间 settled 当成目标结束。

在用户限定的纯扩展路线下，这些实验支持继续规划，没有证明必须 fork Pi。

## Deferred verification

尚未覆盖，不能从上表推断已通过：

- 真实 TUI 的 Esc、取消弹窗、编辑目标与排队用户输入的交错。
- 暂停后与续跑同批或不同批到达的真实 user、steer、follow-up 消息，是否保留且只执行一次。
- 更完整的重试及压缩链：退避期间用户取消、压缩成功、溢出后的重试、多来源队列以及故障后显式用户输入。现有实验只覆盖上述受控失败与恢复门禁。
- 与真实 subagent 运行的集成。实际 print/JSON/RPC 的独立 goal 功能已按 C4 排除，不因本实验使用 SDK JSON 绑定就宣称支持这些入口。
- reload、新会话、resume、fork、tree 导航后的持久化和旧回调失效。
- 用量统计、子孙代理归集、模型对 goal 提示与工具约束的遵循。

这些项目需要在完整调度候选方案形成后定点验证；本实验只排除过于简单的调度方案，不能独立让 #2 通关。

## Reproduction

默认使用仓库安装的 Pi：

```bash
PI_OFFLINE=1 PI_TELEMETRY=0 node prototypes/goal-runtime-probe/probe.mjs
```

可传入另一个已安装 `@earendil-works/pi-coding-agent` 的包目录，旁边须有其 `@earendil-works/pi-ai` 依赖：

```bash
PI_OFFLINE=1 PI_TELEMETRY=0 node prototypes/goal-runtime-probe/probe.mjs /absolute/path/to/node_modules/@earendil-works/pi-coding-agent
```

输出含实际版本、每个回合事件、prompt 返回时状态和队列观察；断言失败时退出非零。脚本把连续运行限制在最多三个低层回合，压缩对照组另有摘要请求；提供 3 秒的单用例 deadline，并关闭网络。

## Sources

- [Pi 0.84.3 SDK](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/sdk.md)
- [Pi 0.84.3 extensions](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/extensions.md)
- [Pi 0.84.3 AgentSession](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/agent-session.ts)
- [Pi 0.85.1 AgentSession](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/agent-session.ts)
- 两个版本本地已安装包的 `dist/providers/faux.d.ts`、`dist/core/model-runtime.d.ts`、`dist/core/resource-loader.d.ts` 和相关运行源码。
