# pi-theme

简体中文 | [English](README.en.md)

为 [Pi Coding Agent](https://github.com/earendil-works/pi) 提供两个可独立安装的终端界面插件。每个插件自带布局和配色。

## Requirements

- Linux 或 macOS。原生 Windows 不在支持范围内。
- Node.js `>=22.19.0`，pnpm `11.9.0`。
- Pi `1.6.1`。开发依赖与 peer dependencies 均固定为此版本，其他版本需另行验证。
- 建议使用支持 24-bit color 的终端。

## Install

先构建仓库，再选择一个界面插件安装。两个插件都接管编辑器、底栏和工具渲染，每个 Pi 会话只启用一个。

```bash
git clone https://github.com/wangxuyang1221/pi-theme.git
cd pi-theme
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
```

| Plugin | Theme | 在仓库根目录执行安装 |
| --- | --- | --- |
| Codex UI | `codex-pi` | `pi install "$PWD/extensions/codex-ui"` |
| Claude Code UI | `claude-code` | `pi install "$PWD/extensions/claude-code-ui"` |

重启 Pi 即可进入选定的界面。Pi 的安装记录指向本地目录，更新源码后运行对应的 `pnpm run build:codex-ui` 或 `pnpm run build:claude-code-ui`，再重启 Pi。

切换插件时，用 `pi list` 查出当前安装来源，执行 `pi remove <source>`，再安装另一个插件并重启 Pi。会话内的主题选择器只调整当前界面的配色。

## Everyday use

| Action | Command or input |
| --- | --- |
| 检查最近一次 codemode 调用 | `/inspect` |
| 展开工具输出 | 默认 `Ctrl+O`，遵循 Pi 的 `app.tools.expand` 绑定 |
| 复制最近一条已完成回复的正文 | 在输入框提交 `/copy` |

### Claude Code UI

`claude-code-ui` 提供 Claude Code 2.x 风格的终端界面，配色针对深色半透明终端调校。

- **欢迎卡片**：双栏陶土色圆角框与像素方块 Clawd 图标，展示当前模型、思考等级、快捷提示与工作目录/Git 分支；窗口窄于 78 列时自动收拢为单栏。
- **输入框与 `!` Bash 模式**：透明背景双细线输入框与 `❯ ` 提示符；输入 `!` 时边框、提示符和底栏即时切换为粉红 Bash 态提示。
- **工作状态与底栏**：输入框上方显示陶土色闪烁图标、流光动词与 `(esc to interrupt · 计时 · ↓ N tokens)`；底栏左侧展示与 Pi 真实 `Shift+Tab` 联动的 `⏵⏵ thinking: <level>`，右侧展示模型、Git 分支、剩余上下文比例及实时接收速率。
- **消息与工具流**：用户消息带 `❯ ` 前缀，助手正文首段带 `● `，思考块以 `∴ Thinking…` 淡灰斜体显示（`Ctrl+T` 折叠后显示 `∴ Thinking… (ctrl+t to expand)`）；工具按 `● Read(path)` / `● Read N files`、`● Bash(cmd)`、`● Update(path)`（附 `Added X lines, removed Y lines` 与红绿 Diff）、`● Write(path)`（附 `Wrote N lines to ...`）以及 `Search`/`Glob`/`List` 渲染，并使用 `  ⎿  ` 分支连接符。

### Codex UI

`codex-ui` 使用 Pi 品牌，提供实色背景输入框和紧凑的工具显示。状态栏显示模型、思考等级、工作目录、Git 分支及剩余上下文比例。

- 思考文本在原生消息位置以独立 `Thinking` 引用标题显示，正文按段落/块分别带柔和左竖线引用排版并降低对比度，同时保持流式顶层块与代码高亮缓存复用。`Ctrl+T` 与启用鼠标的 fullscreen 点击沿用 Pi 的隐藏切换。
- 连续 Read 按文件分组，折叠时每个文件只占一行，展开后显示带行号的内容。Bash 显示命令及输出的开头和结尾各两行，失败、超时或中断状态写在标题上，可原位展开已捕获内容；输出截断时会在正文下方提示完整输出路径或保存失败原因。
- Edit 和 Write 显示变更 diff。工具标题用颜色区分执行中、成功、失败及可识别的取消或超时。
- 运行期间，输入框上方显示 Working 动画和计时，状态栏显示估算接收速率。统计口径见 [Working 与速率说明](docs/codex-working-rate.md)。
- codemode 显示嵌套调用树。`/inspect` 可切换 Calls、Script 和 Output，分别检查子调用与父脚本输出。重启后只能恢复宿主保存的信息，缺失详情会明确标注。

普通回复与用户消息均沿用原生 Markdown 顶层块排版（不添加外层列表缩进）。显示转换不修改会话原文或模型上下文。`/copy` 复制回复正文；终端选择复制保留显示出的原生排版与换行。

所有消息与自绘工具（Read、Bash、Edit、Write、codemode）均遵循 Pi 的 `Output padding` 设置（默认 `1`），保持统一左右边距；若希望贴边显示，可在 `/settings` 中将 `Output padding` 设为 `0`。主题只控制终端单元格颜色，字体、窗口透明度和模糊效果由终端配置决定。

默认 Read 和 Bash 读取 Pi 全局设置及受信任项目的 `.pi/settings.json`，保留 `shellCommandPrefix`、`shellPath` 和 `images.autoResize`。配置损坏或不可读时，这两个工具拒绝执行并提示修复；修复后用 `/reload` 或重启刷新配置。SDK 自定义配置与执行器的接入参数见 [codex-ui 入口](extensions/codex-ui/src/index.ts)。

## Upgrading

旧版通过 `pi install "$PWD"` 安装了整个仓库。升级时，在原仓库根目录运行 `pi remove "$PWD"`，然后按上表构建并安装所需插件，重启 Pi。原来使用 Claude 布局的用户请选择 `claude-code-ui`。

从多扩展版本升级时，重新构建并重启 Pi。若曾为旧版 MCP 扩展在 Pi 设置的 `extensions` 中添加 `"-builtin:mcp"`，移除该项即可恢复 Pi 内置 MCP。需要旧扩展处理的会话可用升级前的版本继续。

## Development

`pnpm run check` 执行构建、类型检查、离线测试、宿主加载和发布清单检查。运行终端验收及配置提交钩子的说明见[测试文档](docs/testing.md)。

## License

本项目使用 [MIT 许可证](LICENSE)。
