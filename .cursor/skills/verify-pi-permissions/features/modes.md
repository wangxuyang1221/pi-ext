# Permission mode selection

## Sub-features

| ID | Observable result |
| --- | --- |
| `permissions-env` | default 启动要求审批；full 与未设置变量启动写入成功、没有审批。 |
| `permissions-menu` | `/permissions` 选择 full 后出现确认；选择 default 后，下次未授权写入重新审批；Escape 保留模式。 |
| `permissions-default` | full 下执行 `/permissions default`，footer 更新，下次写入要求审批。 |
| `permissions-full` | 命令与菜单升级均先确认，接受后 footer 显示 full access，未授权目标可写入。 |
| `permissions-cancel` | Escape 和 Cancel 取消升级后，下次未授权写入仍需审批，拒绝不写入。 |

## Drive

完成 [Launch 与 Doctor](../SKILL.md)，运行：

```bash
pnpm exec node .cursor/skills/verify-pi-permissions/scripts/run.mjs matrix
```

驱动保留 default、full、未设置变量的独立 Pi 进程，以及命令和菜单的按键、画面、后续工具结果和文件字节。检查 `matrix/journey.json` 的 actions/results，结合 `tools.ansi`、`tools.screens.json` 和 `env-*.ansi`。

单纯观察 footer 或确认框消失不足以通过。必须保留其后未授权目标的实际调用；full 写入应成功，default 拒绝应保持文件不变。

## Supplemental checks

`pnpm test extensions/permissions/__tests__/host-compatibility.test.ts` 提供 SDK 边界检查，不能替代本组 CLI/PTY 行为。
