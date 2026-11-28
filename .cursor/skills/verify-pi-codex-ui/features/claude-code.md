# Claude Code profile

在原版 Pi 1.6.1 加载仓库 package，通过 `--use-theme claude-code` 或原生 `/settings` 激活主题。按[驱动说明](../scripts/README.md#claude-code-profile)串行验证普通和全屏 TUI。

| Feature ID | Required observations |
| --- | --- |
| `claude-welcome` | 宽屏显示陶土色圆角欢迎卡、像素方块 Clawd、模型与思考等级、工作目录、Git 分支和 Pi 快捷键。77 列显示单栏，78 列显示双栏。 |
| `claude-composer` | 草稿区及上下细线保留默认终端背景，草稿以 `❯ ` 开头。插入 `!` 时两条细线、提示符和底栏 `! for bash mode` 即时切成粉红色，删除后恢复。 |
| `claude-working`、`claude-footer` | 真实 Shift+Tab 循环思考等级，底栏保持左侧思考等级及右侧模型、Git 分支和 `Context left: X%`。流式响应期间核对输入框上方的陶土色 spinner、变色动词、计时变化、`esc to interrupt` 与 token 数，以及底栏的实时速率。宿主任务结束后复查状态清除。 |
| `claude-messages` | 提交消息的 `❯ ` 和助手正文的 `● ` 位于首行。思考块标题为 `∴ Thinking…`，正文为淡灰斜体，Ctrl+T 在正文与 `∴ Thinking… (ctrl+t to expand)` 之间切换。 |
| `claude-tools` | 执行真实工具并对照工具结束事件、文件字节和终端帧。核对独立与分组 Read、Bash 失败及截断、Write 行数、Update 增删行数与红绿 diff，以及 grep/find/ls 的 Search/Glob/List 标题和连接符。Ctrl+O 展开并再次折叠，同一工具结果的内容显隐随之变化。 |
| `claude-switch` | 命令行覆盖仅影响本次启动。另起进程验证 codex-pi 草稿配色基线，再通过原生设置保存 claude-code。结合 `session_start` 的原因、设置文件、header 和 composer，核对 `/reload`、`/fork`、`/new`、`/resume` 后的主题。切回 codex-pi 后复查草稿配色。 |

## Evidence boundaries

以 `journey.json` 中每条断言及对应终端帧为准。模型响应来自离线夹具，工具执行和持久化由真实宿主完成。PTY 记录单元格的默认背景与实际 ANSI 颜色，窗口透明度、字体及像素效果需要物理终端。清理与证据位置见[驱动说明](../scripts/README.md#claude-code-profile)。
