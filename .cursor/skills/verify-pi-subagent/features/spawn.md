# Spawn, roles and capacity

验证 subagent 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `subagent-spawn`：启动真实 TUI child。
- `subagent-role`：读取 root 角色配置。
- `subagent-overrides`：显式启动参数覆盖角色。
- `subagent-capacity`：并发 reservation 不超容量。
- `subagent-readiness`：握手后才投递任务。
- `subagent-auth`：凭据交接文件及时删除。

## How to get to it (user POV)

subagent_spawn；agent/agents/*.jsonc；PI_SUBAGENT_MAX_ACTIVE。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 此 skill 测试扩展创建的产品 child。它不授权代理把开发任务委派给其他 agent。root 与直接 child 是唯一受支持拓扑。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run subagent`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui subagent`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 运行两轮真实宿主组，检查 child 交互 readiness、角色/显式参数优先级、失败或关闭后的名额回收、认证交接文件删除。非法角色/未知模型应失败且不遗留 slot；child 不公布编排工具。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/subagent/__tests__/roles.test.ts extensions/subagent/__tests__/manager-capacity.test.ts extensions/subagent/__tests__/auth-environment.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

并发 reservation 防超卖目前只由 manager-capacity 的受控 runtime 测试覆盖。验收 subagent-capacity 时，在真实宿主同一轮并发发出超过 maxActive 的 spawn，核对活跃 child 与 reservation 总数不超限、拒绝项无 pane/PID、关闭后名额恢复；串行第三次 spawn 被拒绝不能证明并发竞争。没有真实竞争证据时此 ID 保留 unverified。

helper 使用私有 socket。不得连接用户默认 tmux server；认证夹具用测试值，不拷贝真实 key。

验收依据为 [roles.test.ts](../../../../extensions/subagent/__tests__/roles.test.ts)、[manager-capacity.test.ts](../../../../extensions/subagent/__tests__/manager-capacity.test.ts)、[auth-environment.test.ts](../../../../extensions/subagent/__tests__/auth-environment.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
