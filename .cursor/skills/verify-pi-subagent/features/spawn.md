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
2. 运行 `pnpm exec node .cursor/skills/verify-pi-subagent/scripts/run.mjs`。正式 driver 从真实 root CLI 调用生产工具并操作 child；参数、受控故障和证据层级见 [driver 说明](../scripts/README.md)。逐条审查对应断言。
3. 运行两轮真实宿主组，检查 child 交互 readiness、角色/显式参数优先级、失败或关闭后的名额回收、认证交接文件删除。非法角色/未知模型应失败且不遗留 slot；child 不公布编排工具。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/subagent/__tests__/roles.test.ts extensions/subagent/__tests__/manager-capacity.test.ts extensions/subagent/__tests__/auth-environment.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

full driver 的 `audit_parallel` 在同一个真实 root context 并发调用五次生产 spawn。`concurrent-capacity-results` 核对三成功两拒绝，`concurrent-capacity-sampled` 核对 pending 存在且 reservation 与注册 child 的唯一进程总数始终不超三，随后核对 pane 数和名额回收。层级为真实 root/child 加并发工具派发夹具，不能改称普通模型自动并行。角色增删改与快照、thinking/model/fast 显式覆盖和非法配置零资源也在该 driver 中。

helper 使用私有 socket。不得连接用户默认 tmux server；认证夹具用测试值，不拷贝真实 key。

验收依据为 [roles.test.ts](../../../../extensions/subagent/__tests__/roles.test.ts)、[manager-capacity.test.ts](../../../../extensions/subagent/__tests__/manager-capacity.test.ts)、[auth-environment.test.ts](../../../../extensions/subagent/__tests__/auth-environment.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
