# Terminal contract review

## Scope

本复核服务于 [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12) 与当前 Planning #14，只核验 `extensions/goal/src/scheduler.ts` 的 terminal outcome 和纯文本自动续跑边界。依据包括仓库当前代码、已安装的 Pi `0.84.3` 产物，以及官方仓库固定 commit 的源码。没有运行真实模型，也没有读取凭据。

这里的结论是静态控制流证据，不是真实模型端到端验证。模型请求和凭据由 Pi 管理，goal extension 不管理凭据。

## Conclusions

| Question | Conclusion |
| --- | --- |
| 普通非空纯文本 `stop` 且无工具是否仍可无限自动续跑 | 可以。只要 goal 保持 `active`、没有用户待处理消息、存储和 capability 条件持续成立，当前代码没有对这种序列设置上限。 |
| `length` / `deferred` 在宿主 settled 后是否可能保留 `active` 且不续跑 | 可以。当前 `agent_end` 分支只处理 `aborted`、`error` 和 `stop`。最终 outcome 为 `length` 或 `deferred` 时会直接返回；`agent_settled` 又只收口 `error`，所以 goal 可继续为 `active`。 |
| extension 层能否用公开事件增加保护 | 能。公开的 `message_end`、`turn_end`、`agent_end` 和 `agent_settled` 足以观察最终消息并约束 goal 自己的续跑和状态。但 extension 不能据此承诺语义完成判断、所有 provider 的 outcome 一致性，或取消其他主体排入的消息。 |

## Plain-text stop loop

Pi `0.84.3` 的 agent loop 在当前响应没有工具调用和 steering message 后检查 follow-up 队列。队列非空就继续；否则发出 `agent_end`。参见固定源码 [`agent-loop.ts` L169-L274](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/agent/src/agent-loop.ts#L169-L274)。`AgentSession` 在一次低层 agent run 的 `agent_end` handlers 执行后检查新入队消息，并在有消息时调用 `agent.continue()`；直到不再重试、compact 或续跑才发 `agent_settled`。参见 [`agent-session.ts` L1074-L1115](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/agent-session.ts#L1074-L1115)。

当前 scheduler 恰好在 `agent_end` 中完成本轮后调用 `start(ctx, true)`，见 `extensions/goal/src/scheduler.ts:145-162`。`start()` 通过 `deliverAs: "followUp"` 和 `triggerTurn: true` 排入 goal continuation，见 `extensions/goal/src/scheduler.ts:66-72`。因此序列可以是：

1. 模型返回非空纯文本、无工具、`stopReason === "stop"`。
2. scheduler 在 `agent_end` 排入自己的 follow-up。
3. Pi 的 post-run loop 发现队列非空并继续。
4. 下一轮再次返回同类纯文本，流程重复。

现有保护没有覆盖该序列：

- Empty guard 只累计“已接纳的自动 continuation，最终文本为空，且该轮没有 activity”。非空文本会把 `activity` 设为 `true`，并使 `emptyFinal` 为 `false`，见 `extensions/goal/src/scheduler.ts:85-96`、`:105-110`、`:224`。当前代码中的“三次”只是现状描述，不代表新的纯文本保护阈值已经确认。
- Loop guard 只观察 `tool_result` 中工具名、输入、输出和错误状态的 fingerprint，见 `extensions/goal/src/scheduler.ts:128-142` 与 `extensions/goal/src/loop.ts:45-77`。没有工具调用时，它没有 observation，也不会 warn 或 pause。
- Failed-run guard 只累计“出现匹配的失败 bash，且本轮没有成功工具”，见 `extensions/goal/src/scheduler.ts:85-99`、`:128-135`。纯文本轮不进入该条件。
- `start()` 会在自动续跑且 `ctx.hasPendingMessages()` 为真时让位，见 `extensions/goal/src/scheduler.ts:66-72`。这解决用户或其他消息的排队优先级，不限制连续纯文本轮数。

对应测试确认 empty guard 只对空自动 continuation 生效，并把 text activity 当作 reset 条件，见 `extensions/goal/__tests__/scheduler.test.ts:53-93`。当前测试没有证明普通非空纯文本序列会停止。

## Length and deferred after settlement

安装版 `@earendil-works/pi-ai@0.84.3` 的 `StopReason` 包含 `length` 和 `deferred`。Pi agent loop 只把 `error` 和 `aborted` 当作立即返回的错误终态。它对含工具调用的 `length` 会生成失败 tool results，避免执行可能截断的参数；没有工具调用时，`length` 和 `deferred` 都可沿普通“无更多工具、无队列”路径到达 `agent_end`。参见 [`agent-loop.ts` L196-L274](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/agent/src/agent-loop.ts#L196-L274)。

`length` 还有宿主恢复分支。开启 compaction 且 `isRecoverableLength(...)` 成立时，Pi 可 compact 后重试一次。恢复条件不成立或恢复机会耗尽时，仍可能 settled。参见 [`agent-session.ts` L2050-L2110](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/agent-session.ts#L2050-L2110)。`deferred` 没有对应的 post-run 特判。

scheduler 的状态缺口很直接：

- `lastError` 只在最终 `stopReason === "error"` 时赋值，见 `extensions/goal/src/scheduler.ts:145-154`。
- `aborted` 会暂停 goal，`stop` 会 `finishRun()` 并自动 `start()`，其他 reason 在 `extensions/goal/src/scheduler.ts:157-162` 直接返回。
- `agent_settled` 只有在 `lastError !== undefined` 时停止 goal，之后清除 `bound`，见 `extensions/goal/src/scheduler.ts:164-174`。

所以，在“宿主最终已经 settled”这个前提下，最终 `length` 或 `deferred` 确实可能留下 `active` goal，同时没有 pending continuation。这里不能反推所有 `length` 都会卡住，因为宿主可能先完成一次有效恢复；含工具调用的 outcome 也可能继续到后续 assistant response。

## Public extension events

Pi `0.84.3` 公开了 `message_end`、`turn_end`、`agent_end` 与 `agent_settled`。`turn_end` 带本轮 message 和 tool results，`agent_end` 带本次 run 的 messages，`agent_settled` 的合同是“不再有自动 retry、compaction 或 queued continuation”。参见 [`types.ts` L735-L778](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/extensions/types.ts#L735-L778) 与事件注册接口 [`types.ts` L1264-L1270](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/extensions/types.ts#L1264-L1270)。

可行的 extension 层职责是：

- 在 `message_end` 或 `turn_end` 记录自动轮的最终 `stopReason`、是否有非空文本、是否有工具调用，以及可审计的精确或规范化 fingerprint。
- 在 `agent_end` 决定是否排入 goal 自己的下一次 continuation，并记录非 `stop` outcome。对可能被宿主重试或压缩恢复的结果，等待最终 `agent_settled` 后再作停止决定，不提前阻断恢复。
- 在 `agent_settled` 做状态一致性兜底，处理“goal 仍 active，但本次 run 已确认没有宿主续跑”的情况。这里适合停止或标记待恢复，不宜把 settled 当作隐式无限重启信号。
- 延续现有 ticket、session owner、generation 和 pending-message 检查，避免旧 run 或用户消息被新保护误伤。

这些事件不能支持以下承诺：

- 不能只凭纯文本判断目标已完成、没有进展或内容在语义上重复。文本相同是可观测事实，语义等价是启发式判断。
- 不能阻止当前 provider response 已经发生。`message_end` 和 `agent_end` 都在响应完成后。
- 不能通过公开 API 删除或识别所有其他 extension、用户或宿主排入的具体消息。`hasPendingMessages()` 只提供布尔值。goal 能可靠控制的是自己是否再调用 `sendMessage()`。
- 不能保证所有 provider 把相同服务端状态映射成相同 `stopReason`。goal 看到的是 Pi 已规范化后的 `AssistantMessage`。跨 provider 合同仍需宿主类型、adapter 测试和真实集成验证共同支持。
- 不能靠运行期内存计数覆盖进程崩溃、extension reload 或状态写入失败。若 Planning 要求跨重启保证，计数和 terminal reason 必须进入 goal 的持久状态，并遵守现有 revision/generation 写入规则。

任何新增纯文本保护的判定窗口、计数阈值、状态选择和 resume 行为都仍是产品决策。本复核没有确认这些值。

## Version comparison

固定 commit `d981de1229ef899957bbe968bc8dcda02a21f477` 对应的 `0.85.1` 仍使用“无更多工具后检查 follow-up，再发 `agent_end`”的结构，见 [`agent-loop.ts` L170-L272](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/agent-loop.ts#L170-L272)。`AgentSession` 仍在 post-run 循环中消费 retry、compaction 或 queued messages，最后才 settled，见 [`agent-session.ts` L1105-L1147](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/agent-session.ts#L1105-L1147)。公开的四个事件也仍存在，见 [`types.ts` L735-L792](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/extensions/types.ts#L735-L792) 与 [`types.ts` L1284-L1292](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/extensions/types.ts#L1284-L1292)。

`0.85.1` 调整了 next-turn preparation 的时机，但没有消除本报告识别的两个 scheduler 缺口。该版本对本 Planning 不构成替代保护。

## Follow-up ownership

- Goal extension 应负责纯文本自动续跑 policy、`length` / `deferred` 的显式状态转换、持久化需求，以及 scheduler 单元测试和受控 fake-provider 集成测试。
- Pi host 应负责 `agent_settled` 合同、队列时序、recoverable `length` 行为和 provider outcome 规范化。若 Planning 需要取消任意来源队列或更强的 terminal API，应作为上游能力提出，不能在 goal 内假装已有。
- 后续验收矩阵应考虑普通纯文本 `stop`、空 `stop`、`length`、`deferred`、error recovery 和 pending user message。可先用受控 fake-provider 与真实 SDK 验证事件和状态契约；是否增加真实服务端到端验证尚未确认，不能把离线结果宣称为全部远端服务已验证。本报告没有执行该矩阵。
