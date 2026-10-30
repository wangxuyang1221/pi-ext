# Manual and automatic compaction

验证 codex-compact 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `compact-manual`：手动 /compact 提交 checkpoint。
- `compact-threshold`：上下文达到阈值时压缩。
- `compact-overflow`：宿主 overflow 后压缩重试。
- `compact-pre-request`：请求前显示压缩动画。
- `compact-cancel`：Esc 取消不提交。
- `compact-failure`：失败保留原 checkpoint。

## How to get to it (user POV)

/compact；Pi 自动 threshold/overflow；请求前扩展压缩。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- provider/API 必须同时为 `openai-codex` / `openai-codex-responses`。离线验证的服务替换边界见 [专用 PTY](../SKILL.md#drive)。
- 带工具的手动或宿主压缩，在没有仍有效的已观察请求投影时，需要声明 `manualProjection`。普通无隐藏工具配置使用 `{"manualProjection":{"hiddenTools":[]}}`；隐藏工具及 forced prompt 必须声明实际规则。专用 PTY 使用隔离配置并显式声明，无需修改用户配置。

1. 运行 [场景配方](../journeys.md) 的 `combination`，核对手动卡片、持久化 checkpoint、Esc 取消、metadata 保存/reset 及取消后重试。连续两次手动压缩之间保留新消息，避免 Already compacted 跳过实际请求。
2. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run compact`。它在真实 SDK 上补验 manual/threshold/overflow、单次重试与失败后的请求和 checkpoint，保存 evidence 并核对清理。
3. 运行配方的 `threshold`、`overflow`、`repeated-overflow`，分别核对真实 TUI 的宿主原因、原生成功卡片、pending 完整性与单次重试上限。运行 `automatic`，观察编辑器上方 spinner 的两个不同帧、Esc 后消失、旧 checkpoint 未变和恢复重试；随后注入 401，核对失败分类、旧 checkpoint 不变与后续继续对话。手动取消与请求前取消分别留证。
4. 对照以下定向测试定位未覆盖边界；它们不代替对应的按键、画面和会话结果。

```bash
pnpm test extensions/codex-compact/__tests__/repair-runtime.test.ts extensions/codex-compact/__tests__/scheduler.test.ts extensions/codex-compact/__tests__/presentation.test.ts extensions/codex-compact/__tests__/remote-boundaries.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

`repair-runtime.test.ts` 使用真实 codemode `reachesTools` 回调，执行首请求、手动压缩、valid checkpoint 检查与续聊，验证函数不进入声明数据的 structuredClone。共享 `run compact` 包含该 SDK 检查。专用 PTY 的 `combination` 未启用 codemode，不能用其结果代替 codemode 组合的 TUI 证据；续聊 payload 中的 checkpoint 和实际 codemode 工具执行也需单独断言。

## Gotchas

共享 compact helper 是 SDK 证据，替换模型目录、配置和 HTTP/SSE；专用 PTY 保留生产配置读取、目录解析和 Codex adapter，只替换服务响应。两者均不证明线上认证、服务端接受性或摘要质量。共享 faux TUI 不能验收压缩；在线验收缺少认证和服务使用授权时记为 blocked。focus text 当前不消费。

验收依据为 [repair-runtime.test.ts](../../../../extensions/codex-compact/__tests__/repair-runtime.test.ts)、[scheduler.test.ts](../../../../extensions/codex-compact/__tests__/scheduler.test.ts)、[presentation.test.ts](../../../../extensions/codex-compact/__tests__/presentation.test.ts)、[remote-boundaries.test.ts](../../../../extensions/codex-compact/__tests__/remote-boundaries.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
