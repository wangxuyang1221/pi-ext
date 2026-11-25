# pi-ext

简体中文 | [English](README.en.md)

为 [Pi Coding Agent](https://github.com/earendil-works/pi) 提供 `codex-ui` 终端界面和 `codex-pi` 主题。

## Requirements

- Linux 或 macOS。原生 Windows 不在支持范围内。
- Node.js `>=22.19.0`，pnpm `11.9.0`。
- Pi `1.5.2`。开发依赖与 peer dependencies 均固定为此版本，其他版本需另行验证。
- 建议使用支持 24-bit color 的终端。

## Install

先安装上述运行环境，再克隆、构建并安装本地 package。仓库不提交 `dist/`，请使用以下源码构建流程。

```bash
git clone https://github.com/wangxuyang1221/pi-ext.git
cd pi-ext
pnpm install --frozen-lockfile --ignore-scripts
pnpm run hooks:install
pnpm run hooks:check
pnpm run build
pi install "$PWD"
```

`pi install` 将本地目录记入用户设置，不复制文件。安装后请保留该目录，并重启 Pi。

选择本次会话的主题：

```bash
pi --use-theme codex-pi
```

要持久使用此主题，在 `/settings` 中选择 `codex-pi`。它会在 `/new`、`/resume`、`/fork` 和 `/reload` 后继续生效。

要临时加载 package 而不保存安装设置，在构建后的仓库根目录运行：

```bash
pi -e "$PWD"
```

更新源码后，重新安装锁定依赖并构建，然后重启 Pi。代码升级不要只依赖 `/reload`。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
```

## Everyday use

| Action | Command or input |
| --- | --- |
| 检查最近一次 codemode 调用 | `/inspect` |
| 展开工具输出 | 默认 `Ctrl+O`，遵循 Pi 的 `app.tools.expand` 绑定 |
| 复制最近一条已完成回复的正文 | 在 Codex 输入框提交 `/copy` |

### Codex UI

`codex-ui` 使用 Pi 品牌，提供实色背景输入框和紧凑的工具显示。状态栏显示模型、思考等级、工作目录、Git 分支及剩余上下文比例。

- 思考文本在原生消息位置以独立 `Thinking` 引用标题显示，正文沿用原生斜体思考样式与顶层块排版。`Ctrl+T` 与启用鼠标的 fullscreen 点击沿用 Pi 的隐藏切换。
- 连续 Read 按文件分组，折叠时每个文件只占一行，展开后显示带行号的内容。Bash 显示命令及输出的开头和结尾各两行，失败、超时或中断状态写在标题上，可原位展开已捕获内容。
- Edit 和 Write 显示变更 diff。工具标题用颜色区分执行中、成功、失败及可识别的取消或超时。
- 运行期间，输入框上方显示 Working 动画和计时，状态栏显示估算接收速率。统计口径见 [Working 与速率说明](docs/codex-working-rate.md)。
- codemode 显示嵌套调用树。`/inspect` 可切换 Calls、Script 和 Output，分别检查子调用与父脚本输出。重启后只能恢复宿主保存的信息，缺失详情会明确标注。

普通回复与用户消息均沿用原生 Markdown 顶层块排版（不添加外层列表缩进）。显示转换不修改会话原文或模型上下文。`/copy` 复制回复正文；终端选择复制保留显示出的原生排版与换行。

若希望减少消息两侧留白，在 `/settings` 中将 `Output padding` 设为 `0`。主题只控制终端单元格颜色，字体、窗口透明度和模糊效果由终端配置决定。

默认 Read 和 Bash 读取 Pi 全局设置及受信任项目的 `.pi/settings.json`，保留 `shellCommandPrefix`、`shellPath` 和 `images.autoResize`。配置损坏或不可读时，这两个工具拒绝执行并提示修复；修复后用 `/reload` 或重启刷新配置。SDK 自定义配置与执行器的接入参数见 [codex-ui 入口](extensions/codex-ui/src/index.ts)。

## Upgrading

从多扩展版本升级时，重新构建并重启 Pi。若曾为旧版 MCP 扩展在 Pi 设置的 `extensions` 中添加 `"-builtin:mcp"`，移除该项即可恢复 Pi 内置 MCP。需要旧扩展处理的会话可用升级前的版本继续。

## Development

`pnpm run check` 执行构建、类型检查、离线测试、宿主加载和发布清单检查。运行终端验收及配置提交钩子的说明见[测试文档](docs/testing.md)。

## License

本项目使用 [MIT 许可证](LICENSE)。
