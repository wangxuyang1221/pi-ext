# Goal model tools and availability

验证 goal 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `goal-get`：读取当前目标或空状态。
- `goal-create-tool`：工具创建目标。
- `goal-update-tool`：工具更新受支持状态。
- `goal-budget-default`：默认预算和上限生效。
- `goal-tool-missing`：缺必要工具停止续跑并提示。

## How to get to it (user POV)

create_goal；get_goal；update_goal；启停必要工具。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 只在持久化 root TUI 验证自动推进；临时会话、headless、managed child 和无普通 function tools 的模型不具备同一执行保证。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run goal`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui goal`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. tool-ui 驱动经模型响应执行三个生产工具，核对卡片状态、错误、重开历史与实际权威 goal。补跑禁用必要工具后停止自动续跑、恢复工具仍需 /goal resume，以及无目标 get、重复 create、非法预算/状态的失败。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/goal/__tests__/tools.test.ts extensions/goal/__tests__/capability.test.ts extensions/goal/__tests__/scheduler-runtime.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

不直接调用工具 execute 作为用户路径证明。无 UI/无持久 session 的拒绝应保留，不能用内存 goal store 冒充持久 TUI。

验收依据为 [tools.test.ts](../../../../extensions/goal/__tests__/tools.test.ts)、[capability.test.ts](../../../../extensions/goal/__tests__/capability.test.ts)、[scheduler-runtime.test.ts](../../../../extensions/goal/__tests__/scheduler-runtime.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
