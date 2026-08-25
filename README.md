# pi-ext

为 [Pi Coding Agent](https://github.com/earendil-works/pi) 提供三个扩展和一套主题：

- `codex-ui` 使用 Pi 品牌实现 Codex 风格的 TUI profile，并提供 `codex-pi` 主题。
- `mcp` 连接 Model Context Protocol 服务器，并将工具注册为 `mcp__<server>__<tool>`。
- `permissions` 提供 `Default permissions` 和 `Full access` 两种模式，以及逐次调用审批。

## Requirements

- Node.js 22.19 或更高版本
- `@earendil-works/pi-coding-agent` 0.84.3
- 支持 24-bit color 的终端可获得最接近设计稿的颜色效果

仓库在 Linux、macOS 和 Windows 上运行测试。运行入口是各扩展 `dist/` 目录中的 ESM 文件，Pi 启动时不需要转译 TypeScript 源码。

## Install

从 GitHub 安装整个 package：

```bash
pi install git:github.com/wangxuyang1221/pi-ext
```

安装后重启 Pi。使用 `pi config` 可以单独停用任一扩展或主题，而不必删除 package。

如需临时测试且不写入 settings：

```bash
pi -e git:github.com/wangxuyang1221/pi-ext
```

Pi package 以当前用户的完整系统权限运行。安装第三方 package 前应检查源码。

## Codex UI profile

`codex-ui` 仅在 Pi 的 TUI 模式中接管以下组件：

- 使用 `pi v0.84.3` 官方 wordmark 的 header
- 实色背景 composer
- model、thinking、cwd、context-left 和 extension statuses footer
- streaming working indicator 和 terminal title
- `read`、`edit`、`write` 的紧凑 renderer

### Theme persistence

Pi 0.84.3 会在 session replacement 和 reload 完成后重新应用 theme setting。`codex-ui` 的裸 `pi` 兼容兜底使用非持久的 `ThemeObject`，它只改变当前内存主题，不会替换保存的 setting。因此，当全局 theme 仍为 `dark` 时，首次启动可以显示 Codex 配色，但 `/new`、`/resume`、`/fork` 或 `/reload` 后会重新变为 `dark`。这不是终端配色漂移。

如果希望所有普通 `pi` 会话默认使用 Codex 配色，请在 `/settings` 中选择 `codex-pi`，或将 `~/.pi/agent/settings.json` 设置为：

```json
{
  "theme": "codex-pi"
}
```

主题名是 `codex-pi`，不是扩展名 `codex-ui`。采用全局设置后，直接运行 `pi` 即可，并且 session replacement 和 reload 后仍会保持 Codex 配色。

如果需要保留其他全局主题，只覆盖当前 Pi run，请使用：

```bash
pi --use-theme codex-pi
```

该参数不会修改保存的全局主题，但同样会在 `/new`、`/resume`、`/fork` 和 `/reload` 后保持 `codex-pi`。之后如果在 `/settings` 中主动选择其他主题，Pi 会立即应用并正常保存该选择。

如需短命令，可以自行在 Shell 配置中添加 function：

```zsh
pi-codex() {
  pi --use-theme codex-pi "$@"
}
```

仓库不会自动修改 Shell 配置，也不提供一个假定 `pi install` 会加入 `PATH` 的 package bin。

`read`、`edit`、`write` 仍使用 Pi 0.84.3 的官方 tool definitions 执行。`edit` 根据真实 `EditToolDetails.diff` 绘制整行 added/removed 背景；`write` 只显示路径、行数和字节数，不伪造 old/new diff。使用当前配置中的 `app.tools.expand` 快捷键可以展开工具详情，默认是 `Ctrl+O`。

Footer 读取 `FooterDataProvider.getExtensionStatuses()`，因此 MCP 和 permissions 状态仍会显示。`pi-openai-fast-mode` 的 `fast` 保留在它自己的 below-editor widget 中；由于 Pi 0.84.3 没有公开 weekly quota 数据源，本 profile 不显示 weekly quota。

Ghostty 的窗口透明度、blur、字体和 titlebar 仍由 Ghostty 配置负责。Pi cell 只使用不透明 ANSI 颜色。

本地构建后可以直接 smoke test：

```bash
pi \
  -e ./extensions/codex-ui/dist/index.js \
  --theme ./themes/codex-pi.json \
  --use-theme codex-pi
```

## MCP extension

在项目中创建 `.pi/mcp.json`，或在全局创建 `~/.pi/agent/mcp.json`：

```jsonc
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "timeout": 30000
    },
    "remote": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer replace-me"
      }
    }
  }
}
```

配置允许 JSON comments 和 trailing commas。支持 `stdio`、`http`、`streamable-http` 和 legacy `sse` transport。

可用命令：

```text
/mcp status
/mcp reload
/mcp-init
```

`/mcp-init` 创建 `.pi/mcp.json`。不要提交 MCP headers 或环境变量中的凭据。

## Permissions extension

扩展默认以 `Full access` 启动。设置 `PI_PERMISSIONS_MODE=default` 可改为默认权限模式。

```text
/permissions
/permissions default
/permissions full
```

在 `Default permissions` 模式中：

- `read`、`grep`、`find`、`ls` 和 subagent orchestration tools 不弹出确认。
- 修改型工具、shell commands 和 MCP tools 需要审批。
- `Allow this session` grant 只在当前进程有效，按操作隔离，最多保存 512 条，Pi 退出后清除。
- 非交互模式遇到需要审批的操作时 fail closed。

切回 `Full access` 需要交互确认。

## Development

```bash
npm ci --ignore-scripts
npm run check
```

常用命令：

```bash
npm run typecheck
npm test
npm run build
npm run package:check
npm pack --dry-run
npm run prototype:tui
```

仓库有意提交 `dist/`。Pi 从 Git 安装 package 时只安装生产依赖，因此需要预构建文件。CI 会拒绝过期的生成文件。`prepack` 会重建三个扩展，npm tarball 只包含编译产物、theme、README 和 license。

`npm run prototype:tui` 启动 Codex、Claude、Hybrid 三套一次性 HTML 原型。生产 extension 只实现 Codex 方向，另外两套原型保留供后续使用。

## Layout

```text
extensions/
  codex-ui/
    src/
    __tests__/
    dist/
  mcp/
    src/
    __tests__/
    dist/
  permissions/
    src/
    __tests__/
    dist/
themes/
  codex-pi.json
scripts/
prototypes/
```

## License

MIT
