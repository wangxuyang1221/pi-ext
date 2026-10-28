# Continuation, steering and interruption

验证 goal 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `goal-auto`：active 目标自动续跑。
- `goal-steer`：运行中 steer 保留输入。
- `goal-followup`：follow-up 队列不丢消息。
- `goal-escape`：运行中 Esc 暂停。
- `goal-retry`：等待原生重试后判断终态。
- `goal-loop`：重复工具触发循环保护。
- `goal-empty`：连续空白自动轮次触发阻塞。
- `goal-settled-error`：最终不可恢复错误转 blocked。
- `goal-quota`：明确账号额度转 usage_limited。

## How to get to it (user POV)

创建或恢复 active 目标；运行中输入；Alt+Enter；Esc；/goal resume。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 只在持久化 root TUI 验证自动推进；临时会话、headless、managed child 和无普通 function tools 的模型不具备同一执行保证。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run goal`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui goal`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. tool-ui 先证明工具链；执行 execution/acceptance 驱动的明确场景前核验其场景参数。观察用户 steer/follow-up 保留、Esc 停止、最终错误 blocked、明确额度 usage_limited、重复工具与连续空白保护；恢复后继续同一目标。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/goal/__tests__/scheduler-runtime.test.ts extensions/goal/__tests__/quota-runtime.test.ts extensions/goal/__tests__/quota.test.ts extensions/goal/__tests__/loop-scheduler.test.ts extensions/goal/__tests__/loop.test.ts extensions/goal/__tests__/scheduler.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

tool-ui smoke 不足以覆盖这些边界。流式 Esc 使用 acceptance-tui-driver.py 的 `GOAL_TUI_SCENARIO=stream-interrupt`，首次 settled 必须 paused；重试等待使用 retry-c12，首次 settled 必须 blocked。2026-10-28 修复取消响应时间戳变化导致的漏暂停，并通过原断言。额度测试用合成 SSE 经真实 native adapter 和 SDK，不证明真实账号额度。其他旧 acceptance 场景仍先按 DRIVER-COMPATIBILITY.md 核验，不放宽断言。

验收依据为 [scheduler-runtime.test.ts](../../../../extensions/goal/__tests__/scheduler-runtime.test.ts)、[loop-scheduler.test.ts](../../../../extensions/goal/__tests__/loop-scheduler.test.ts)、[loop.test.ts](../../../../extensions/goal/__tests__/loop.test.ts)、[scheduler.test.ts](../../../../extensions/goal/__tests__/scheduler.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
