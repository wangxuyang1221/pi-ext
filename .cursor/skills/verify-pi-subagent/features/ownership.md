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
2. 运行 `pnpm exec node .cursor/skills/verify-pi-subagent/scripts/run.mjs`。正式 driver 从真实 root CLI 调用生产工具并操作 child；参数、受控故障和证据层级见 [driver 说明](../scripts/README.md)。逐条审查对应断言。
3. 运行生命周期和生产宿主场景，检查 state/runtime 分离、唯一 namespace owner、进程身份和 pane 归属；恢复同一 session 后可以继续控制原 child，身份不明时保留状态与 slot。
   正式 full 旅程连续执行 Leave temporarily → 恢复同一 root → reload → prompt/wait，核对同一 child ID、PID 存活和原生历史中的新消息。已有 dist 时可直接执行步骤 2，无需安装或构建。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/subagent/__tests__/ownership.test.ts extensions/subagent/__tests__/lifecycle.test.ts extensions/subagent/__tests__/upgrade.test.ts extensions/subagent/__tests__/runtime-state.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

运行 `pnpm exec node .cursor/skills/verify-pi-subagent/scripts/run.mjs "subagent-legacy-$(date +%s)" legacy`。它加载 Git 中真实 v2 源码，先核对活 child 与活 writer 均拒绝升级且原文件未变，关闭旧进程后运行生产 upgradeOffline，再恢复原 root 并发送新任务。缺少指定历史时保持 blocked 并保存命令错误。full driver 另覆盖双 root 控制竞争、真实 pane marker 反例、child `/new` 后旧 alias 的拒绝和关闭、新 session 继续消息；不通过改 state.json 制造成功。

验收依据为 [ownership.test.ts](../../../../extensions/subagent/__tests__/ownership.test.ts)、[lifecycle.test.ts](../../../../extensions/subagent/__tests__/lifecycle.test.ts)、[upgrade.test.ts](../../../../extensions/subagent/__tests__/upgrade.test.ts)、[runtime-state.test.ts](../../../../extensions/subagent/__tests__/runtime-state.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
