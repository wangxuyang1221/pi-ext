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
- 远程压缩只适用于 openai-codex/openai-codex-responses。离线 CLI 使用 faux 模型，只能验收配置命令；远程协议由真实 SDK 加 HTTP 边界夹具验证，线上质量需要另行实跑。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run compact`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-compact`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 使用 repair-runtime 的真实 Pi session 请求路径，核对远程请求次数、checkpoint 提交与失败后的原会话。真实 Codex TUI 中触发 /compact，观察原生卡片和 Codex compaction applied；请求前动画按 Esc 后消失且不提交新 checkpoint。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/codex-compact/__tests__/repair-runtime.test.ts extensions/codex-compact/__tests__/scheduler.test.ts extensions/codex-compact/__tests__/presentation.test.ts extensions/codex-compact/__tests__/remote-boundaries.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

compact helper 是 SDK 协议证据，不是 /compact 键盘或服务端质量证据。现场 TUI 的 faux provider 不支持远程压缩，缺少已授权的 Codex 认证时把联网分支记为 blocked。focus text 当前不消费。

验收依据为 [repair-runtime.test.ts](../../../../extensions/codex-compact/__tests__/repair-runtime.test.ts)、[scheduler.test.ts](../../../../extensions/codex-compact/__tests__/scheduler.test.ts)、[presentation.test.ts](../../../../extensions/codex-compact/__tests__/presentation.test.ts)、[remote-boundaries.test.ts](../../../../extensions/codex-compact/__tests__/remote-boundaries.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
