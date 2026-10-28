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

1. 运行 [专用 PTY](../SKILL.md#drive)。核对手动 `/compact` 的原生卡片、`Codex compaction applied` 和持久化 checkpoint。新增对话后再次压缩，在固定服务等待中按 Esc，确认 abort 传到 transport，原 checkpoint 不变。连续两次压缩之间没有新消息时，Pi 会报 Already compacted，不能用该路径验证取消。
2. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run compact`。它在真实 SDK 上补验 manual/threshold/overflow、单次重试与失败后的请求和 checkpoint，保存 evidence 并核对清理。
3. `compact-pre-request` 的编辑器上方动画仍需单独触发请求前自动压缩，并记录 Esc 后动画消失及 checkpoint 未提交。专用 PTY 的手动压缩取消不能代替此分支。
4. 对照以下定向测试定位未覆盖边界；它们不代替对应的按键、画面和会话结果。

```bash
pnpm test extensions/codex-compact/__tests__/repair-runtime.test.ts extensions/codex-compact/__tests__/scheduler.test.ts extensions/codex-compact/__tests__/presentation.test.ts extensions/codex-compact/__tests__/remote-boundaries.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

共享 compact helper 是 SDK 证据，替换模型目录、配置和 HTTP/SSE；专用 PTY 保留生产配置读取、目录解析和 Codex adapter，只替换服务响应。两者均不证明线上认证、服务端接受性或摘要质量。共享 faux TUI 不能验收压缩；在线验收缺少认证和服务使用授权时记为 blocked。focus text 当前不消费。

验收依据为 [repair-runtime.test.ts](../../../../extensions/codex-compact/__tests__/repair-runtime.test.ts)、[scheduler.test.ts](../../../../extensions/codex-compact/__tests__/scheduler.test.ts)、[presentation.test.ts](../../../../extensions/codex-compact/__tests__/presentation.test.ts)、[remote-boundaries.test.ts](../../../../extensions/codex-compact/__tests__/remote-boundaries.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
