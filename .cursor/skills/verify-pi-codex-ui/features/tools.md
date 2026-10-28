# Read, Bash, Edit and Write display

验证 codex-ui 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `ui-read-group`：连续 Read 分组预览。
- `ui-bash-preview`：Bash 显示短命令和输出。
- `ui-expand`：Ctrl+O 展开已捕获内容。
- `ui-write-added`：新建 Write 显示 Added。
- `ui-write-edited`：覆盖 Write 显示 Edited。
- `ui-diff`：diff 展示行号与限制。
- `ui-error`：失败标题与正文正确。
- `ui-interrupted`：可靠中断用中断状态。

## How to get to it (user POV)

模型 read/bash/edit/write；Ctrl+O。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 普通 TUI 与 fullscreen 是不同入口。renderer 固定帧不能替代真实工具执行的文件副作用核验。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run tool-status`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-ui`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 运行工具状态 PTY 的 regular/fullscreen/lowpower/restart 场景；核对进行中静态 Writing/Editing，结束后 Added/Edited、diff、错误和中断颜色。真实执行覆盖测试另读回磁盘，确认显示控制字符处理不修改文件。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/codex-ui/__tests__/write-execution.test.ts extensions/codex-ui/__tests__/write-host-validation.test.ts extensions/codex-ui/__tests__/grouped-read.test.ts extensions/codex-ui/__tests__/grouped-bash.test.ts extensions/codex-ui/__tests__/diff-display-safety.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

固定工具播放用于显示，不证明 write 实际落盘。超过 diff 限制应显示 Diff unavailable；不能伪造行数。

验收依据为 [write-execution.test.ts](../../../../extensions/codex-ui/__tests__/write-execution.test.ts)、[write-host-validation.test.ts](../../../../extensions/codex-ui/__tests__/write-host-validation.test.ts)、[grouped-read.test.ts](../../../../extensions/codex-ui/__tests__/grouped-read.test.ts)、[grouped-bash.test.ts](../../../../extensions/codex-ui/__tests__/grouped-bash.test.ts)、[diff-display-safety.test.ts](../../../../extensions/codex-ui/__tests__/diff-display-safety.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
