# Remaining execution boundaries

## Scope

本轮只核对 Pi deferred response 与 Codex goal execution unavailable。既定 length 策略不再讨论。Pi 固定源码为 `0.84.3` 的 [`4e58f324`](https://github.com/earendil-works/pi/tree/4e58f324fae8ebfa98a3d45181fb248072a2afac) 和 `0.85.1` 的 [`d981de12`](https://github.com/earendil-works/pi/tree/d981de1229ef899957bbe968bc8dcda02a21f477)，Codex 固定源码为 `0.153.4` 的 [`3d2ee51c`](https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a)。

## Pi deferred response

### Default interactive request

Pi coding-agent 的默认交互 Agent 没有启用 deferred response。`createLoopConfig()` 传递 model、reasoning、transport、retry 等请求项，没有设置 `deferred`。[0.85.1](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/agent.ts#L445-L483) Agent loop 原样展开该 config 后调用普通 `streamFunction`。[0.85.1](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/agent-loop.ts#L296-L310) coding-agent 的默认 stream function 再调用普通 `modelRuntime.streamSimple`，也只转发已有 options。[0.85.1](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/sdk.ts#L306-L330) `0.84.3` 的对应构造相同。[0.84.3](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/sdk.ts#L306-L330)

### Producers and redemption

对两个 revision 的 `packages/ai/src/api/*.ts` 做了定向源码搜索，没有找到内置生产 adapter 构造 `stopReason: "deferred"` 或实现 `fetchDeferred`。这只能证明已检查的内置 adapter 没有该分支，不能证明第三方或以后注册的 provider 永远不会返回 deferred。

仓库中的 faux provider 可以构造带 handle 的 `stopReason: "deferred"`，并实现 fetch 与 cancel，说明协议和测试设施确实支持它。[0.85.1 faux](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/providers/faux.ts#L291-L304) [fetch/cancel](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/providers/faux.ts#L564-L660)

coding-agent 的 `ModelRuntime` 暴露 `streamDeferred`、`fetchDeferred` 和 `cancelDeferred`，但这是显式调用接口。[0.85.1](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/model-runtime.ts#L647-L681) 普通 Agent loop 只特别终止 `error` 和 `aborted`，随后按 tool calls 和队列决定是否继续，没有 deferred redemption 或 `fetchDeferred` 调用。[0.85.1](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/agent-loop.ts#L211-L272) 因此默认 coding-agent 不会自动 fetch deferred response。

### Boundary assessment

默认交互请求没有开启 deferred，已查内置生产 adapter 也未找到 producer；这不排除自定义 provider 主动返回它。当前没有证据要求为内置 provider 增加 polling、等待窗口或 redemption retry。由于本次范围包含自定义 provider，意外收到 deferred 后的状态处理仍须在 Planning #15 明确；不能把完整异步取回能力默认为已获批准的新功能，也不能默默缩小已确认支持范围。

## Codex execution unavailable

### Repeated execution failure

Codex 不会在第一次执行失败时阻塞 goal。它只记录 default namespace 的 `exec` 且 `handler_executed: true` 的失败；任意成功 tool 会清零 streak。连续三个符合条件的失败 turn 后，`execution_failure_goal()` 才返回 goal id。[accounting](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/accounting.rs#L114-L152)

调用位置在 goal extension 的 `on_turn_stop`。达到阈值后，它调用 `stop_active_goal_for_turn(..., ExecutionUnavailable)`。[extension](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L274-L300) runtime 把该 reason 映射为 Blocked，并校验 expected goal id，避免旧失败阻塞替换后的 goal。[runtime](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L265-L365)

### Hidden or disabled tools

“执行三次失败”与“工具不可见”不是同一路径。goal extension 或该 thread 的 goal tools 不可见时，tool contributor 返回空列表；idle continuation 只清除内存 accounting，不更新持久化 goal status。因此已有 Active goal 会静默保持 Active，不会变成 Blocked。[tool visibility](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L495-L509) [idle no-op](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs#L399-L403)

Codex goal extension 没有自动重新启用用户禁用工具的代码。配置变化只更新 goal extension 自身的 enabled 状态；执行失败逻辑也只观察 tool outcome。[config update](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/extension.rs#L199-L216) 如果用户禁用 `exec` 导致它根本不被调用，就不会产生 `handler_executed: true` 的失败，也不会命中三-turn ExecutionUnavailable 阈值。

### Boundary assessment

这里有一个真实产品边界：已有 Active goal 遇到所需执行能力不可见时，是沿用 Codex 的静默 Active，还是立即或经检测后转 Blocked。它会影响持久化状态和用户恢复方式，需要用户取舍。

“是否自动重启用户禁用工具”不必制造成另一个同级选择。Codex 没有这样做，禁用也没有可安全推断的自动撤销时点。除非产品明确要求覆盖用户设置，基线应是尊重禁用，并只决定 goal status 如何反映不可执行。

## What remains unproven

- 没有真实 provider 请求，无法证明某个远端兼容 adapter 永不返回 deferred。
- 没有覆盖第三方 provider 注册或未来 adapter，只能确定默认交互参数与当前内置源码。
- 静默 Active 结论适用于 goal tools 不可见或 extension disabled；可调用 `exec` 连续失败三 turn 是另一条明确 Blocked 路径。
