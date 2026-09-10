# Codex CLI output-limit behavior review

## Scope

本文只检查 Codex CLI goal 在单次 Responses 输出达到上限时的行为，不讨论纯文本循环或 continuation deferral，也不替本项目选择 Pi 在 `length` 后应 blocked 还是继续。

核对对象：

| 版本 | 固定源码 |
| --- | --- |
| 本机 `codex-cli 0.153.4` | [`rust-v0.153.4` peeled commit `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`](https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a) |
| 最新 release `0.154.0` | [`rust-v0.154.0` peeled commit `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`](https://github.com/openai/codex/tree/6b9826e3aa83b1a5947db50f4332cb9c65f1b340) |
| 调查时 `main` | [`eca63f0803aa334cd45908743b4696dec893b6ed`](https://github.com/openai/codex/tree/eca63f0803aa334cd45908743b4696dec893b6ed) |

以下结论以本机对应的 `0.153.4` 为主。`0.154.0` 和所给 `main` 在 `response.incomplete` 的关键解析上仍相同，见 [0.154.0 parser](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/codex-api/src/sse/responses.rs#L472-L485) 与 [`main` parser](https://github.com/openai/codex/blob/eca63f0803aa334cd45908743b4696dec893b6ed/codex-rs/codex-api/src/sse/responses.rs#L472-L485)。

## Findings

1. Codex 没有把输出上限转换成类似 Pi `stopReason: "length"` 的正常完成枚举。收到 `response.incomplete` 时，它只读取 `incomplete_details.reason`，包括 `max_output_tokens`，随后构造 `ApiError::Stream("Incomplete response returned, reason: ...")`。[固定源码](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-api/src/sse/responses.rs#L468-L477)
2. `ApiError::Stream` 会映射成可重试的 `CodexErrorDetails::Stream`。[API 到 core 的映射](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-api/src/api_bridge.rs#L18-L39) [retryable 分类](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/protocol/src/error.rs#L371-L411)
3. 因此 `reason=max_output_tokens` 当前走“流错误并重新采样”，不是成功结束，也不是专门的输出截断恢复。默认每种 transport 最多重试 5 次；provider 可用 `stream_max_retries` 配置，硬上限 100。[默认值和硬上限](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/model-provider-info/src/lib.rs#L26-L34) [配置取值](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/model-provider-info/src/lib.rs#L356-L370)
4. 若当前使用 WebSocket，5 次重试耗尽后会切到 HTTPS，并把 stream retry 计数清零。于是默认上界是 WebSocket 6 次请求，加 HTTPS 6 次请求，共 12 次 sampling attempt。若一开始就是 HTTPS，或无法启用 fallback，则是初次请求加 5 次重试，共 6 次。[重试、fallback 与计数重置](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/responses_retry.rs#L44-L124) [fallback 只在 WebSocket 尚未禁用时激活](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/client.rs#L549-L578)
5. 重试不会提高 `max_output_tokens`。Codex 的普通 Responses sampling request 结构根本没有这个字段，HTTP 和 WebSocket 请求转换也没有补入该字段。[HTTP request 字段](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-api/src/common.rs#L274-L300) [WebSocket request 字段](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-api/src/common.rs#L302-L355)
6. 输出上限错误不会触发专门的自动压缩。`response.incomplete` 先进入通用 stream retry；自动压缩检查位于 sampling 成功后的 context-window 路径。[sampling retry loop](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L1405-L1481) [成功后才检查 context token limit 并压缩](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L450-L521)
7. 所有重试和 transport fallback 都失败后，stream error 映射为 `CodexErrorInfo::Other`，触发 goal `on_turn_error`。正常关联到该 turn 且仍为 Active 的 goal 会变成 Blocked，不会保持 Active，也不会自动变成 Paused。[Stream 最终映射为 `Other`](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/protocol/src/error.rs#L424-L457) [`on_turn_error` 的分类](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L361-L384) [TurnError 更新为 Blocked](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L265-L305)
8. 已达到的 goal 预算限制状态有更高的终态保留优先级。`stop_active_goal_for_turn` 先结算进度；若结算已把 goal 变成 BudgetLimited，后续 TurnError 不会再覆盖成 Blocked。只有 UsageLimit 可以覆盖 BudgetLimited 为 UsageLimited。[先结算再决定是否覆盖状态](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L306-L365)

## Wire-event distinctions

| 后端或 transport 结果 | Codex 解析 | retry | 与 goal 相关的最终路径 |
| --- | --- | --- | --- |
| `response.completed` | 产生 `ResponseEvent::Completed`，保留 usage | 否 | sampling 成功；turn 正常 stop。goal 若结算后仍 Active，thread idle 时可继续 |
| `response.incomplete`，`reason=max_output_tokens` | 产生 `ApiError::Stream` | 是 | 重试耗尽后 `on_turn_error`，通常 Blocked；预算先命中则保留 BudgetLimited |
| 流关闭但缺少 `response.completed` | 产生 `ApiError::Stream("stream closed before response.completed")` | 是 | 与上项相同，但错误消息不同 |
| `response.failed` 且错误码表示 context window | 专门映射 `ContextWindowExceeded` | 否 | 直接 turn error，不属于输出截断 |

`response.completed` 会解析 usage 并结束 SSE；缺少 completed 的测试明确期望 stream error。[completed 解析](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-api/src/sse/responses.rs#L479-L503) [SSE 缺少 completed 的测试](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-api/src/sse/responses.rs#L928-L969)

SSE 与 WebSocket 共用事件解析函数，但终止动作略有差别。SSE 先保存 `response.incomplete` 对应错误，流关闭时再发出；WebSocket 立即返回该错误。两者对上层都表现为 stream error。[SSE 保存并在关闭时发错](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-api/src/sse/responses.rs#L570-L606) [SSE 共用解析](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-api/src/sse/responses.rs#L650-L674) [WebSocket 共用解析并立即返回错误](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-api/src/endpoint/responses_websocket.rs#L806-L838)

`ContextWindowExceeded` 是另一条明确分支。`response.failed` 只有通过 context-window 错误码判断后才生成该类型；core 将其标记为不可重试，并在 sampling 层直接返回。[`response.failed` 分类](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-api/src/sse/responses.rs#L409-L467) [core 的专门返回路径](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L1443-L1468)

## Turn and goal lifecycle

当 stream retries 最终耗尽时，`run_turn` 先调用 `emit_turn_error_lifecycle`，发送 error，然后退出 sampling loop。[turn error 分支](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L580-L607) goal extension 在此时把非 usage-limit 错误归为 TurnError，并按上一节的预算优先级更新状态。

外部可见的终止事件仍叫 `TurnComplete`，但其中带有 terminal error；idle cause 是 Failed。随后 core 仍调用 turn-stop lifecycle，再调用 thread-idle lifecycle。[failed idle cause、TurnComplete 及 idle 顺序](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/tasks/mod.rs#L797-L858) 这不等于模型返回了正常 `response.completed`。

正常情况下，Blocked 或 BudgetLimited goal 不会在 idle 时再启动自动 continuation，因为 continuation 只接受 Active 状态。[idle continuation 的 Active 检查](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L394-L443)

## Accounting caveat

`response.incomplete` 分支只取 reason，丢弃 response 上可能存在的 usage；只有 `response.completed` 分支会把 usage 放进 `ResponseEvent::Completed`。[两条分支对比](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-api/src/sse/responses.rs#L468-L503) core 也只在 `ResponseEvent::Completed` 时记录 token usage 并通知 extension。[completed usage 处理](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/core/src/session/turn.rs#L2591-L2638)

所以 goal token budget 不能可靠覆盖这些 incomplete attempts 的服务端输出 token。最终错误结算仍可能因其他已记录的 token 达到预算而将 goal 置为 BudgetLimited，但本次 incomplete event 自带的 usage 不参与该结算。这是源码能直接证明的记账缺口，不代表后端一定总在 incomplete event 中返回 usage。

## Pi contrast

为避免把两个运行时的终止语义混在一起，这里只记录与 Codex 结论直接相关的 Pi 对照，不据此提出本项目设计。

已安装 Pi `0.84.3` 对 OpenAI Responses 的处理不同。`response.completed` 和 `response.incomplete` 都进入 `finalizeResponse`；当 status 为 `incomplete` 且 `incomplete_details.reason` 为 `max_output_tokens` 时，Pi 映射为 `stopReason: "length"`，而不是 stream error。[共同 finalize 路径](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api/openai-responses-shared.ts#L551-L590) [事件分派](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api/openai-responses-shared.ts#L740-L741) [stop reason 映射](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api/openai-responses-shared.ts#L763-L781)

Pi 也没有把所有 `length` 都视为可恢复条件。`isRecoverableLength` 还要求 `desiredMaxOutput > 0` 且实际 `usage.output < desiredMaxOutput`。[固定源码](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/utils/overflow.ts#L164-L172) 因而不能从“Pi 能识别 `length`”推出“Pi 会对每次输出达到上限都压缩重试”，更不能把输出上限等同于 context-window exhaustion。

## Version comparison

在三个固定 revision 中，下列行为没有实质变化：

- `response.incomplete` 仍转换为 `ApiError::Stream`。
- 默认 `stream_max_retries` 仍是 5。
- 普通 Responses sampling request 仍不发送 `max_output_tokens`。
- goal 对终态 turn error 的基本处理仍是 Active 转 Blocked，BudgetLimited 不被 TurnError 覆盖。

`main` 的相关固定位置可交叉核对：[parser](https://github.com/openai/codex/blob/eca63f0803aa334cd45908743b4696dec893b6ed/codex-rs/codex-api/src/sse/responses.rs#L472-L481)、[retry/fallback](https://github.com/openai/codex/blob/eca63f0803aa334cd45908743b4696dec893b6ed/codex-rs/core/src/responses_retry.rs#L49-L135)、[goal error](https://github.com/openai/codex/blob/eca63f0803aa334cd45908743b4696dec893b6ed/codex-rs/ext/goal/src/extension.rs#L388-L410)、[goal status precedence](https://github.com/openai/codex/blob/eca63f0803aa334cd45908743b4696dec893b6ed/codex-rs/ext/goal/src/runtime.rs#L295-L384)。

## Limits of evidence

本次依据官方仓库固定 revision、已有 parser test、以及本机 `codex --version` 的只读检查。按要求没有发真实模型请求，没有使用凭据，没有安装 Rust 依赖，也没有执行大型构建。

因此，报告能确定“后端发来这些事件时，三个 revision 的 CLI 如何处理”，不能确定真实 Codex 后端在每个模型上何时触发输出上限、上限具体数值、是否总携带 usage，也不能用静态源码证明生产环境一定启用了 WebSocket。默认 12 次 attempt 只适用于 WebSocket 已启用且 HTTPS fallback 成功激活的条件分支。
