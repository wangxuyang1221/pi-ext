# Goal creation, editing and details

验证 goal 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `goal-create`：创建并保存新目标。
- `goal-replace`：替换未完成目标须确认。
- `goal-edit`：编辑保留统计。
- `goal-clear`：清除写 tombstone。
- `goal-details`：查看和滚动详情快照。
- `goal-pause`：暂停停止自动推进。
- `goal-resume`：显式恢复同一目标。

## How to get to it (user POV)

/goal objective；/goal；/goal edit；/goal clear；/goal pause；/goal resume；详情 p/r。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 只在持久化 root TUI 验证自动推进；临时会话、headless、managed child 和无普通 function tools 的模型不具备同一执行保证。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run goal`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui goal`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 运行真实 tool-ui 场景，观察创建、读取和更新的卡片。隔离 TUI 输入 /goal Verify lifecycle 后 /goal pause，再用 /goal 查看，p/r、Esc/Enter 关闭；编辑目标检查统计保留，replace 要确认，clear 后重开不得从镜像复活。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/goal/__tests__/commands.test.ts extensions/goal/__tests__/details.test.ts extensions/goal/__tests__/controls.test.ts extensions/goal/__tests__/storage.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

自动 tool-ui 证明工具卡片，不替代全部 slash 入口。faux 模型不会完成目标，自动空白或重复保护应如实报告；需要可控任务时沿用 tool-ui-runtime 的 provider。

验收依据为 [commands.test.ts](../../../../extensions/goal/__tests__/commands.test.ts)、[details.test.ts](../../../../extensions/goal/__tests__/details.test.ts)、[controls.test.ts](../../../../extensions/goal/__tests__/controls.test.ts)、[storage.test.ts](../../../../extensions/goal/__tests__/storage.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
