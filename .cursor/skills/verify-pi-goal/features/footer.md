# Goal footer and elapsed-time display

验证 goal 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `goal-footer-codex`：Codex footer 两行目标摘要。
- `goal-footer-native`：原生 footer 单行状态。
- `goal-footer-fullscreen`：两种终端模式保持布局。
- `goal-detail-snapshot`：详情秒数为打开时快照。
- `goal-minute-refresh`：分钟边界刷新而非秒级动画。

## How to get to it (user POV)

启用/不启用 codex-ui；/goal 详情；resize。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 只在持久化 root TUI 验证自动推进；临时会话、headless、managed child 和无普通 function tools 的模型不具备同一执行保证。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run goal-footer`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui goal`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 运行四种 footer 驱动，核对 Codex 两行与原生单行、分钟边界、状态和预算变化；详情打开后秒数快照不自动刷新，重新打开才刷新。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/goal/__tests__/display-timing.test.ts extensions/goal/__tests__/presentation.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

固定消息和时钟夹具证明显示规则，不证明一个小时真实墙钟过程或远端计费。

验收依据为 [display-timing.test.ts](../../../../extensions/goal/__tests__/display-timing.test.ts)、[presentation.test.ts](../../../../extensions/goal/__tests__/presentation.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
