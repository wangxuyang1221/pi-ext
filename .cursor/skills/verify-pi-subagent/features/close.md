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
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui subagent`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 关闭已运行 child 后核对 PID 和 window 已退出、slot 释放、原生 session 文件仍在。根 TUI /quit 分别选择结束、暂离、取消，检查 child 是否按选择保留；暂离后恢复原 root 验证接管。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/subagent/__tests__/manager-close.test.ts extensions/subagent/__tests__/quit.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

宿主组不等于 /quit 所有菜单路径实测。Ctrl+D、信号和崩溃不走关闭菜单，不应断言自动 close-all。错误或未知状态必须留在会话。

验收依据为 [manager-close.test.ts](../../../../extensions/subagent/__tests__/manager-close.test.ts)、[quit.test.ts](../../../../extensions/subagent/__tests__/quit.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
