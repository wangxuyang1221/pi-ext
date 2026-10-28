# Execution settings and fail-closed configuration

验证 codex-ui 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `ui-shell-prefix`：继承 shellCommandPrefix。
- `ui-shell-path`：继承 shellPath。
- `ui-image-resize`：继承图片 autoResize。
- `ui-project-trust`：未信任项目配置不读取。
- `ui-settings-error`：配置损坏时 read/bash 拒绝执行。
- `ui-settings-reload`：修复后 reload 更新快照。
- `ui-headless`：print/RPC 也应用工具覆盖。

## How to get to it (user POV)

settings.json 的 shellCommandPrefix/shellPath/images.autoResize；read/bash；/reload。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 普通 TUI 与 fullscreen 是不同入口。renderer 固定帧不能替代真实工具执行的文件副作用核验。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run tool-status`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-ui`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 先执行定向配置/宿主测试；隔离配置改变前缀或 shell，发真实 bash 并核对实际输出；损坏配置后 read/bash 返回英文错误、底层命令未执行，修复后 /reload 恢复。未信任项目配置不读取。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/codex-ui/__tests__/execution-settings.test.ts extensions/codex-ui/__tests__/tools.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

tool-status 是显示 smoke。print/RPC 和 SDK getExecutionOptions/toolFactories 都需单独证据；不得由 TUI 外观通过推断执行配置正确。

验收依据为 [execution-settings.test.ts](../../../../extensions/codex-ui/__tests__/execution-settings.test.ts)、[tools.test.ts](../../../../extensions/codex-ui/__tests__/tools.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
