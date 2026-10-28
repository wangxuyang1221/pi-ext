# Permission mode selection

验证 permissions 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `permissions-env`：环境变量选择启动模式。
- `permissions-menu`：菜单选择权限模式。
- `permissions-default`：命令切回 default。
- `permissions-full`：进入 full 必须确认。
- `permissions-cancel`：取消升级保留原模式。

## How to get to it (user POV)

PI_PERMISSIONS_MODE；/permissions；/permissions default；/permissions full。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 验证默认权限模式下的真实文件副作用。普通默认启动为 Full access；本验证显式设置 PI_PERMISSIONS_MODE=default。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run permissions`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui permissions`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 先在 default 模式执行拒绝和允许写入，再打开 /permissions full 并取消。交互模式补跑 /permissions 菜单选择、full 的 Continue 和 default 切回，检查 footer 与下一次工具调用是否再审批。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/permissions/__tests__/host-compatibility.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

自动脚本只验证 full 确认出现并取消，不代表接受升级和菜单路径通过。单独 dialogs-pty.py 只测试 Pi 对话框堆栈。

验收依据为 [host-compatibility.test.ts](../../../../extensions/permissions/__tests__/host-compatibility.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
