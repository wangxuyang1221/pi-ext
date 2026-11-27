# Read, Bash, Edit and Write display

验证 codex-ui 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `ui-tool-rendering`：工具使用各自的预览与展开规则，命令清单和补全提供 `/inspect`。
- `ui-read-group`：连续 Read 分组显示，折叠时以文件标题代替文件内容，展开显示带行号的内容。分组和折叠细则见 [grouped-read.test.ts](../../../../extensions/codex-ui/__tests__/grouped-read.test.ts)。
- `ui-read-image-warning`：模型不支持图片时，Read 在折叠与展开状态都显示 `[<model> does not support images; it saw a placeholder instead]`。
- `ui-bash-preview`：Bash 折叠时显示命令、输出开头和结尾各两行。Pi 1.6.1 截断输出时保留真实尾行；超长单行后只有空行时，捕获内容仍保留该长行末段。
- `ui-expand`：默认 Ctrl+O 展开已捕获内容；Read 展开最多 40 行，Bash 展开后显示已捕获的中间行。两个状态都在正文下方仅显示一次 `Truncated capture ·`，后接完整输出路径或 `Could not save the full output: <reason>`。宿主原始 `[Showing ...]` 尾注不出现在正文中。展开 codemode 时，预算内的 Bash 子调用也应保留真实尾行和单条提示。
- `ui-write-added`：新建 Write 显示 Added。
- `ui-write-edited`：覆盖 Write 显示 Edited。
- `ui-diff`：diff 展示行号与限制。Edit/Write 的语法高亮使用 Pi 的 `text` 主题色绘制无语法分类的字元。主题代理的 `text` 色变化时需要重新生成缓存。
- `ui-error`：Bash 标题反映命令退出状态。若截断日志保存失败，退出码为 0 时标题保持成功；非零退出时标题保留退出码（如 `· exit 7`），两种情况都在正文下方显示保存失败原因。正文使用主题 `toolOutput` 颜色；Edit/Write 失败标题为 `Edit failed`/`Write failed`，正文为首行错误。
- `ui-interrupted`：可靠中断用警告色中断状态：Bash 标题后缀为 `· interrupted` 或 `· timed out`；Edit/Write 显示警告色标记和 `Operation aborted`。

## How to get to it (user POV)

模型 read/bash/edit/write；Ctrl+O；`/settings` 中切换 [Output padding](layout.md#sub-features)。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 普通 TUI 与 fullscreen 是不同入口。renderer 固定帧不能替代真实工具执行的文件副作用核验。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-codex-ui/scripts/verify.mjs run tool-status`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-codex-ui/scripts/verify.mjs tui codex-ui`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 运行工具状态 PTY 的 regular/fullscreen/restart 场景，覆盖 Read 分组、状态和颜色显示。再按 [正式旅程](../scripts/README.md#run) 运行 `cli.py regular/fullscreen`，检查命令清单保留 `/inspect`、输入 `/inspec` 按 Tab 能补全、输入 `/lowp` 按 Tab 不补全已删除命令；reload/new/fork/resume 后重复检查。工具旅程覆盖实际新建/覆盖/Edit、4002 行导致 Diff unavailable、控制字符磁盘原字节、长/多行/截断 Bash、Ctrl+O 和独立 Bash 的真实 Esc。取消必须在宿主报告本次 Bash 的 BEGIN-CANCEL 输出后发生，且延后标记文件不存在。
4. `ui-interrupted` 的 Write/Edit 分支按 [文件修改取消边界](../scripts/README.md#file-mutation-cancellation) 记录。宿主执行短时异步文件操作，没有阶段进度；Writing/Editing 标题不能用于判断写入前取消时机。已开始的文件操作可在 signal 取消后完成，已写内容不回滚。执行层测试和真实 Esc 命中该阶段是不同证据；本 skill 没有可靠的人工步骤保证后者。
5. 按 [Pi compatibility 旅程](../scripts/README.md#pi-compatibility) 在普通和全屏 TUI 执行真实图片 Read、展开、TypeScript Edit/Write 和 Bash 截断。核对当前命令或 codemode 子调用的结束事件、对应工具卡片，以及临时目录恢复后保存的完整字节。以下已有定向测试补充步骤 3 的工具执行边界。

```bash
pnpm test extensions/codex-ui/__tests__/write-execution.test.ts extensions/codex-ui/__tests__/write-host-validation.test.ts extensions/codex-ui/__tests__/grouped-read.test.ts extensions/codex-ui/__tests__/grouped-bash.test.ts extensions/codex-ui/__tests__/diff-display-safety.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

`ui-output-padding` 的工具证据来自正式 CLI 旅程中的真实 Read、Bash、Edit、Write 和 codemode。检查展开后的标题列、正文相对缩进及宽度变化，并核对切换前后是同一批工具结果。步骤见 [CLI coverage](../scripts/README.md#cli-coverage)。

## Gotchas

固定工具播放用于显示，不证明 write 实际落盘。超过 diff 限制应显示 Diff unavailable；不能伪造行数。

Read 折叠时不显示文件内容；Bash 折叠时保留输出开头和结尾的少量行，中间以 `… +N lines` 省略，短输出完整显示，具体行数规则见 [bash-group-layout.test.ts](../../../../extensions/codex-ui/__tests__/bash-group-layout.test.ts)；纯新增 diff 使用绿色 `│` 竖线而不是整行底色；diff 折叠最多 12 行。CLI 会保存长命令、diff 与展开画面，部分行号、折叠边界及命令省略仍需审查这些画面；脚本退出码不能代替逐项显示判定。Bash 取消等待本次 `tool_execution_update.partialResult` 中的输出标记，命令参数或标题中的同名文字不算开始输出。

工具卡片的静态状态标记与 Working 动画属于不同区域。held 工具期间分别核对卡片文案/颜色稳定和 Working 持续推进；整张屏幕不变不是工具状态的通过条件。

验收依据为 [write-execution.test.ts](../../../../extensions/codex-ui/__tests__/write-execution.test.ts)、[write-host-validation.test.ts](../../../../extensions/codex-ui/__tests__/write-host-validation.test.ts)、[grouped-read.test.ts](../../../../extensions/codex-ui/__tests__/grouped-read.test.ts)、[grouped-bash.test.ts](../../../../extensions/codex-ui/__tests__/grouped-bash.test.ts)、[diff-display-safety.test.ts](../../../../extensions/codex-ui/__tests__/diff-display-safety.test.ts) 和 [仓库说明](../../../../README.md)。失败后先按 [driver 清理说明](../scripts/README.md#evidence-and-cleanup) 检查对应证据和进程，再启动下一次；证据不随 scratch 删除。
