# Explicit goal inheritance

验证 goal 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `goal-tree`：/tree 不回退累计统计。
- `goal-native-fork`：原生 fork 不继承目标。
- `goal-native-clone`：原生 clone 不继承目标。
- `goal-fork`：goal-fork 将目标快照保存到独立记录。
- `goal-clone`：当前位置 clone 复制独立快照。
- `goal-deferral`：继承门禁跨 reload 保留。

## How to get to it (user POV)

/tree；/fork；/clone；/goal-fork。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 只在持久化 root TUI 验证自动推进；临时会话、headless、managed child 和无普通 function tools 的模型不具备同一执行保证。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run goal`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui goal`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 运行 [驱动表](../DRIVERS.md) 的 `matrix inheritance` 与 `lifecycle`。前者驱动 active 带预算目标的 clone、冷开门禁、明确输入解除、tree 和历史 fork；后者核对原生 clone 不继承。比较源文件原始字节与新记录身份。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/goal/__tests__/commands.test.ts extensions/goal/__tests__/storage.test.ts extensions/goal/__tests__/controls.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

此完整 TUI 旅程未由 tool-ui smoke 覆盖。未落盘会话 clone 是已知前置条件失败，不能伪造回复来宣称支持。

验收依据为 [commands.test.ts](../../../../extensions/goal/__tests__/commands.test.ts)、[storage.test.ts](../../../../extensions/goal/__tests__/storage.test.ts)、[controls.test.ts](../../../../extensions/goal/__tests__/controls.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
