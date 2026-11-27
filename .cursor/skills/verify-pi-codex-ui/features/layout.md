# Composer, footer and theme

验证 codex-ui 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `ui-header`：启动显示圆角 header：`pi vX · Codex profile`，`model:` 与 `directory:` 标签对齐，路径过长时省略中段。
- `ui-composer`：输入框保持实色背景和当前主题的文字色，草稿在终端默认前景不同的情况下仍可读。空草稿显示强调色 `›` 和占位文字；宽度不小于 48 列时底部留白行右侧显示 `/ for commands`，输入文字或打开菜单后隐藏。
- `ui-status`：footer 首行以 ` · ` 分隔展示模型与思考等级、目录与 git 分支、context，中性状态行另起一行；运行时右侧速率占位，结束后归还宽度。
- `ui-theme` 验证 Pi 按兼容 `https://pi.dev/schemas/theme.schema.json` 的定义加载 codex-pi，外观为 `dark`。原版 Pi 1.6.0 的普通回复段落沿用终端默认前景。输入草稿（`text`）、独立 Read 标题（`toolTitle`）和未标注语言的回复代码围栏正文（`mdCodeBlock`）使用 `foreground`（`#d4d4d8`）。`toolOutput` 使用 `muted`（`#9a9aa2`），`thinkingText` 与 `mdQuote` 使用 `thinking`（`#787882`），`mdQuoteBorder` 使用 `quoteBorder`（`#44444c`）。已保存的主题跨会话替换保持。
- `ui-output-padding`：用户与回复消息、自绘 Read、Bash、Edit、Write 和 codemode 共用 Pi 的 `Output padding`。默认 `1` 时标题与消息正文从第二列开始，切到 `0` 时从第一列开始。工具正文保留各自的内部缩进，极窄时撤销额外边距。
- `ui-fullscreen-scrollbar`：全屏滚动条的 `scrollbarTrack` 使用 `userBg`（`#2c2c31`），`scrollbarThumb` 使用较亮的 `dim`（`#6c6c74`）。
- `ui-resize`：窄屏 resize 不破坏内容。
- `ui-user-markdown`：用户 Markdown 保留原语义。
- `ui-reply-markdown`：回复沿用原生 Markdown 顶层块排版且不改变模型原文。
- `ui-copy-fallback`：编辑器执行 `/copy` 时跳过没有非空正文且 `stopReason` 不是 `stop` 的 assistant turn，复制上一条可复制正文。遇到正常结束且无正文的 turn 时显示 `No agent messages to copy yet.`。
- `ui-working`：输入框上方的生产 Working 动画和计时按任务生命周期显示，等待期间保持，settled 后隐藏。
- `ui-receive-rate`：footer 右侧显示最近约两秒的估算接收速率，无新数据为 `-- t/s`，任务结束隐藏。

## How to get to it (user POV)

启动 TUI；/settings 选择 codex-pi；/new；/resume；/fork；/reload。

提交 prompt 后出现 Working 和速率；input 对话框等待、工具、retry、自动压缩及取消均通过实际宿主进入。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 普通 TUI 与 fullscreen 是不同入口。renderer 固定帧不能替代真实工具执行的文件副作用核验。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-codex-ui/scripts/verify.mjs run codex-ui`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-codex-ui/scripts/verify.mjs tui codex-ui`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 按 [正式旅程](../scripts/README.md#run) 运行 `cli.py regular` 与 `cli.py fullscreen`。驱动通过原生设置菜单选择 light/codex-pi，逐列断言输入行背景及草稿前景，在 40/80/140 列和原生 fork/resume 后复验，并核对 footer 中的模型、目录与 context。检查 `Output padding`、`Markdown transcript`、`Thinking rails` 和折叠思考标签的单元格样式。默认 `1`、切换 `0`、切回 `1`、两个设置下缩至两列及恢复宽度的观察项见 [CLI coverage](../scripts/README.md#cli-coverage)。Markdown 通过 bracketed paste 进入真正模型请求与 session，同时保存 TUI 渲染画面。
4. `ui-working`、`ui-receive-rate` 按 [Working and lifecycle](working.md) 执行两个模式完整旅程。十帧/80ms 强调色 spinner、静态粗体 `Working` 文本、80ms 相位对齐共享调度和采样口径以 [生产说明](../../../../docs/codex-working-rate.md) 为准。核对 32/40/100/极窄宽度、中性状态第二行、旧 footer 字段、真实工具文件与取消无副作用。自动帧变化不证明物理像素或精确调度间隔，定时器测试属于补证。
5. 按 [Pi compatibility 旅程](../scripts/README.md#pi-compatibility) 核对全屏滚动条、主题加载与 `/copy` 回退。`ui-composer` 的像素与拖选、`ui-reply-markdown` 的系统 `/copy` 仍须执行 [人工边界](../scripts/README.md#manual-boundaries)。未执行时明确写出这些 ID 的自动通过部分及整体 unverified。
6. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3、4 的动作、画面和副作用。

```bash
pnpm test extensions/codex-ui/__tests__/components.test.ts extensions/codex-ui/__tests__/layout.test.ts extensions/codex-ui/__tests__/theme.test.ts extensions/codex-ui/__tests__/user-markdown.test.ts extensions/codex-ui/__tests__/reply-markdown.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

内存 ThemeObject 兜底不持久化。PTY 驱动保存 header 与空草稿提示的画面但不断言它们；圆角、标签对齐、路径省略和 `/ for commands` 的显示条件由 [components.test.ts](../../../../extensions/codex-ui/__tests__/components.test.ts) 断言，画面需人工对照。codemode fixture 的整体画面不等于每个用户 Markdown 分支和持久主题均验证。

验收依据为 [layout.test.ts](../../../../extensions/codex-ui/__tests__/layout.test.ts)、[theme.test.ts](../../../../extensions/codex-ui/__tests__/theme.test.ts)、[user-markdown.test.ts](../../../../extensions/codex-ui/__tests__/user-markdown.test.ts)、[reply-markdown.test.ts](../../../../extensions/codex-ui/__tests__/reply-markdown.test.ts) 和 [仓库说明](../../../../README.md)。失败后先按 [driver 清理说明](../scripts/README.md#evidence-and-cleanup) 检查对应证据和进程，再启动下一次；证据不随 scratch 删除。
