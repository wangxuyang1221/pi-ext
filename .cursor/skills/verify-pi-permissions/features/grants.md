# Session grants and process lifetime

验证 permissions 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `permissions-grant-exact`：同一进程同一命令复用 grant。
- `permissions-grant-path`：不同目标路径不能复用。
- `permissions-grant-mcp`：MCP grant 按 server/tool 隔离。
- `permissions-grant-limit`：grant 条数有上限。
- `permissions-restart`：重启清除 grant。

## How to get to it (user POV)

审批菜单 Allow this session；相同/不同命令和路径；重启 Pi。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 验证默认权限模式下的真实文件副作用。普通默认启动为 Full access；本验证显式设置 PI_PERMISSIONS_MODE=default。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run permissions`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui permissions`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 在隔离 TUI 对 WRITE_PROOF 选择 Allow this session，再次发送同一写入应免审批；退出并重启新的隔离 TUI 后必须重新审批。对不同 bash 文本、目标路径和 MCP server/tool 使用对应真实工具种子，核对能否复用。512 条容量另以同一进程批准 513 个不同目标，先重调第 513 个目标确认免审批，再重调最早目标确认已被淘汰、重新要求审批，并保留每次选择与工具副作用；未完成此完整步骤时，permissions-grant-limit 保持 unverified。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/permissions/__tests__/permission-policy.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

自动 smoke 不覆盖 grant。必须保留连续两次 action 与第二次工具结果，不能仅检查内部 grant 集合。定向测试只能补充其实际存在的断言；当前 permission-policy.test.ts 没有 512/513 容量验收，不得引用该文件声称已证明上限。

验收依据为 [permission-policy.test.ts](../../../../extensions/permissions/__tests__/permission-policy.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
