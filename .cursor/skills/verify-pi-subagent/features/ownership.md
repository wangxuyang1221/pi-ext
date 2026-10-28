# Resume, ownership and lifecycle

验证 subagent 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `subagent-resume`：恢复原 root 接管 child。
- `subagent-owner`：同 namespace 单控制者。
- `subagent-identity`：验证 pane 与进程实例。
- `subagent-session-switch`：切换 session 保留正确归属。
- `subagent-upgrade`：升级协议拒绝旧写入者。

## How to get to it (user POV)

恢复 parent session；/reload；切换 session；child 崩溃。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 此 skill 测试扩展创建的产品 child。它不授权代理把开发任务委派给其他 agent。root 与直接 child 是唯一受支持拓扑。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run subagent`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui subagent`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 运行生命周期和生产宿主场景，检查 state/runtime 分离、唯一 namespace owner、进程身份和 pane 归属；恢复同一 session 后可以继续控制原 child，身份不明时保留状态与 slot。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/subagent/__tests__/ownership.test.ts extensions/subagent/__tests__/lifecycle.test.ts extensions/subagent/__tests__/upgrade.test.ts extensions/subagent/__tests__/runtime-state.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

升级 v3 前须关闭旧 child 和停止旧写入者。不得用直接改 state.json 绕过所有权校验作为成功证明。

验收依据为 [ownership.test.ts](../../../../extensions/subagent/__tests__/ownership.test.ts)、[lifecycle.test.ts](../../../../extensions/subagent/__tests__/lifecycle.test.ts)、[upgrade.test.ts](../../../../extensions/subagent/__tests__/upgrade.test.ts)、[runtime-state.test.ts](../../../../extensions/subagent/__tests__/runtime-state.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
