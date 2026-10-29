# Read, Bash, Edit and Write display

验证 codex-ui 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `ui-tool-rendering`：工具统一完整显示，命令清单和补全不再提供 `/lowpower`。
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
3. 运行工具状态 PTY 的 regular/fullscreen/restart 场景，覆盖 Read 分组、状态和颜色显示。再按 [正式旅程](../scripts/README.md#run) 运行 `cli.py regular/fullscreen`，检查命令清单保留 `/inspect`、输入 `/inspec` 按 Tab 能补全、输入 `/lowp` 按 Tab 不补全已删除命令；reload/new/fork/resume 后重复检查。工具旅程覆盖实际新建/覆盖/Edit、4002 行导致 Diff unavailable、控制字符磁盘原字节、长/多行/截断 Bash、Ctrl+O 和独立 Bash 的真实 Esc。取消必须在 BEGIN-CANCEL 已显示后发生，且延后标记文件不存在。
4. `ui-interrupted` 的 Write/Edit 分支按 [文件修改取消边界](../scripts/README.md#file-mutation-cancellation) 记录。宿主执行短时异步文件操作，没有阶段进度；Writing/Editing 标题不能用于判断写入前取消时机。已开始的文件操作可在 signal 取消后完成，已写内容不回滚。执行层测试和真实 Esc 命中该阶段是不同证据；本 skill 没有可靠的人工步骤保证后者。
5. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/codex-ui/__tests__/write-execution.test.ts extensions/codex-ui/__tests__/write-host-validation.test.ts extensions/codex-ui/__tests__/grouped-read.test.ts extensions/codex-ui/__tests__/grouped-bash.test.ts extensions/codex-ui/__tests__/diff-display-safety.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

固定工具播放用于显示，不证明 write 实际落盘。超过 diff 限制应显示 Diff unavailable；不能伪造行数。

工具卡片的静态状态标记与 Working 动画属于不同区域。held 工具期间分别核对卡片文案/颜色稳定和 Working 持续推进；整张屏幕不变不是工具状态的通过条件。

验收依据为 [write-execution.test.ts](../../../../extensions/codex-ui/__tests__/write-execution.test.ts)、[write-host-validation.test.ts](../../../../extensions/codex-ui/__tests__/write-host-validation.test.ts)、[grouped-read.test.ts](../../../../extensions/codex-ui/__tests__/grouped-read.test.ts)、[grouped-bash.test.ts](../../../../extensions/codex-ui/__tests__/grouped-bash.test.ts)、[diff-display-safety.test.ts](../../../../extensions/codex-ui/__tests__/diff-display-safety.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
