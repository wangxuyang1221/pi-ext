# Close and root exit choices

验证 subagent 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `subagent-close`：单个关闭后确认进程退出。
- `subagent-close-all`：close-all 只关闭直接 child。
- `subagent-close-failure`：关闭失败保留关系与 slot。
- `subagent-quit-end`：结束会话先关闭 child。
- `subagent-quit-leave`：暂离保留 child 供恢复。
- `subagent-quit-cancel`：退出选择取消保留当前会话。

## How to get to it (user POV)

subagent_close；root /quit → End session/Leave temporarily/Escape。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 此 skill 测试扩展创建的产品 child。它不授权代理把开发任务委派给其他 agent。root 与直接 child 是唯一受支持拓扑。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run subagent`。保存返回的 evidence 路径并核对退出码。
2. 运行 `pnpm exec node .cursor/skills/verify-pi-subagent/scripts/run.mjs`。正式 driver 从真实 root CLI 调用生产工具并操作 child；参数、受控故障和证据层级见 [driver 说明](../scripts/README.md)。逐条审查对应断言。
3. 关闭已运行 child 后核对 PID 和 window 已退出、slot 释放、原生 session 文件仍在。根 TUI /quit 分别选择结束、暂离、取消，检查 child 是否按选择保留；暂离后恢复原 root 验证接管。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/subagent/__tests__/manager-close.test.ts extensions/subagent/__tests__/quit.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

正式 full driver 实际操作 End session、Leave temporarily 和 Escape，并在恢复后继续 prompt/wait。它还验证 main 正忙时取消、启动 pending 拒绝退出、菜单内关闭失败留在会话、两个 namespace 同时存在时 close-all 只影响当前 root。Ctrl+D、信号和崩溃不走关闭菜单。错误或未知状态必须留在会话。

验收依据为 [manager-close.test.ts](../../../../extensions/subagent/__tests__/manager-close.test.ts)、[quit.test.ts](../../../../extensions/subagent/__tests__/quit.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
