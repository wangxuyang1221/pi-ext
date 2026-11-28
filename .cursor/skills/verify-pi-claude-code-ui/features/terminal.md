# Claude Code UI

在隔离配置中用原版 Pi 安装 `extensions/claude-code-ui`，从空配置启动普通和全屏 TUI。

## Sub-features

| Feature ID | Required observations |
| --- | --- |
| `claude-welcome` | 宽屏显示陶土色圆角欢迎卡、像素方块 Clawd、模型与思考等级、工作目录、Git 分支和 Pi 快捷键。77 列显示单栏，78 列显示双栏。 |
| `claude-composer` | 草稿区及上下细线保留默认终端背景，草稿以 `❯ ` 开头。插入 `!` 时两条细线、提示符和底栏 `! for bash mode` 即时切成粉红色，删除后恢复。 |
| `claude-working`、`claude-footer` | 真实 Shift+Tab 循环思考等级，底栏保持左侧思考等级及右侧模型、Git 分支和 `Context left: X%`。流式响应期间核对输入框上方的陶土色 spinner、变色动词、计时变化、`esc to interrupt` 与 token 数，以及底栏的实时速率。宿主任务结束后复查状态清除。 |
| `claude-messages` | 提交消息的 `❯ ` 和助手正文的 `● ` 位于首行。思考块标题为 `∴ Thinking…`，正文为淡灰斜体，Ctrl+T 在正文与 `∴ Thinking… (ctrl+t to expand)` 之间切换。 |
| `claude-tools` | 执行真实工具并对照工具结束事件、文件字节和终端帧。核对独立与分组 Read、Bash 失败及截断、Write 行数、Update 增删行数与红绿 diff，以及 grep/find/ls 的 Search/Glob/List 标题和连接符。Ctrl+O 展开并再次折叠，同一工具结果的内容显隐随之变化。 |
| `claude-lifecycle` | 安装记录只包含 Claude 包，主题发现只有该包主题。重启同一配置，并结合 `session_start` 的原因、设置文件、header 和 composer，核对 `/reload`、`/fork`、`/new`、`/resume` 后的界面。 |

## How to get to it (user POV)

安装 Claude Code UI 后启动新的 Pi 进程。欢迎卡和输入框在打开会话时显示。提交请求可观察 Working、回复与工具输出。使用原生命令重载扩展或更换会话。

## Driving it with PTY

遵循 [Drive](../SKILL.md#drive) 运行两种模式。按表中 feature ID 查看断言，结合 `journey.json` 的按键和帧、`events.json` 的对应事件与归档文件核对结果。

## Gotchas

模型响应来自离线夹具，工具执行和持久化由真实宿主完成。PTY 记录单元格的默认背景与实际 ANSI 颜色，窗口透明度、字体及像素效果需要物理终端。清理与证据位置见[Evidence and cleanup](../SKILL.md#evidence-and-cleanup)。
