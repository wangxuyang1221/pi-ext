# Usage, soft budgets and direct children

验证 goal 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `goal-root-usage`：根响应使用宿主 usage。
- `goal-child-usage`：直接 child 用量归属目标。
- `goal-dedupe`：重复 checkpoint 不重复计费。
- `goal-cache`：排除 cacheRead。
- `goal-missing-usage`：缺失 usage 保留警告。
- `goal-soft-budget`：软预算允许收尾但不再续跑。
- `goal-freeze`：停止期间冻结统计并推进基线。
- `goal-time`：active 时间不计离线时长。

## How to get to it (user POV)

goal.json maxGoalTokenBudget；create_goal token_budget；根任务与直接 child。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 只在持久化 root TUI 验证自动推进；临时会话、headless、managed child 和无普通 function tools 的模型不具备同一执行保证。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run goal-accounting`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui goal`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 运行真实宿主 accounting 四个入口，检查 root/direct-child receipts、恢复去重、暂停 baseline 和终态。核对 input+output+cacheWrite，排除 cacheRead，缺失 usage 警告；预算允许超出后收尾但不新开自动轮次。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/goal/__tests__/accounting.test.ts extensions/goal/__tests__/child-budget.test.ts extensions/goal/__tests__/budget.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

只覆盖宿主暴露用量，不是远端账单。暂停不杀 child，孙代理不计费；真实外部 provider 支持需要额外验证。

验收依据为 [accounting.test.ts](../../../../extensions/goal/__tests__/accounting.test.ts)、[child-budget.test.ts](../../../../extensions/goal/__tests__/child-budget.test.ts)、[budget.test.ts](../../../../extensions/goal/__tests__/budget.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
