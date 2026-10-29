# Durable recovery and lock ownership

验证 goal 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `goal-before-first-reply`：首次回复落盘前保存。
- `goal-recover-session`：恢复原持久会话。
- `goal-recover-orphan`：无原会话时接管目标记录。
- `goal-reopen-confirm`：重开停止状态须确认。
- `goal-lock`：活跃写入者不能被夺锁。
- `goal-storage-error`：存储失败停止推进并要求 resume。
- `goal-tombstone`：清除的目标不从镜像复活。

## How to get to it (user POV)

退出/重启；/goal-recover；paused/blocked/usage_limited 重开确认。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 只在持久化 root TUI 验证自动推进；临时会话、headless、managed child 和无普通 function tools 的模型不具备同一执行保证。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run goal-accounting`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui goal`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 运行 [驱动表](../DRIVERS.md) 的 `lifecycle`、`recovery`、三个 `matrix reopen-*`、`matrix lock` 与 `matrix storage`。恢复需同时核对确认框接受/拒绝、零请求、归属及持久文件。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/goal/__tests__/storage.test.ts extensions/goal/__tests__/lock.test.ts extensions/goal/__tests__/storage-failures.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

不能删除活跃 .lock 来使验证通过。恢复不存在的会话只接管目标记录，不恢复未落盘对话或撤销文件副作用。基础 helper 每次空目录，恢复旅程需复用同一次运行的目录。

验收依据为 [storage.test.ts](../../../../extensions/goal/__tests__/storage.test.ts)、[lock.test.ts](../../../../extensions/goal/__tests__/lock.test.ts)、[storage-failures.test.ts](../../../../extensions/goal/__tests__/storage-failures.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
