# Approval and file side effects

验证 permissions 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `permissions-allow-once`：一次批准后执行工具。
- `permissions-deny`：拒绝后无文件副作用。
- `permissions-deny-note`：拒绝说明交给模型。
- `permissions-cancel-call`：取消中止调用。
- `permissions-read-safe`：只读工具不弹确认。

## How to get to it (user POV)

模型调用 write/edit/bash/MCP；Allow once；Deny；Deny with note；Cancel。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 验证默认权限模式下的真实文件副作用。普通默认启动为 Full access；本验证显式设置 PI_PERMISSIONS_MODE=default。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run permissions`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui permissions`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 发送 WRITE_PROOF denied，选择 Deny，等待 settled 后确认 workspace/proof.txt 不存在；再发送 WRITE_PROOF allowed，选择 Allow once，确认文件内容为 approved 加换行。补跑带说明拒绝与取消，检查 tool result 和文件不变；只读工具不弹审批。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/permissions/__tests__/permission-policy.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

模型结果在 provider 边界替换，真实 Pi write、tool_call 审批与磁盘未替换。只读、edit、bash、MCP 和附说明拒绝是额外分支，不能从 write 路径推断全部通过。

验收依据为 [permission-policy.test.ts](../../../../extensions/permissions/__tests__/permission-policy.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
