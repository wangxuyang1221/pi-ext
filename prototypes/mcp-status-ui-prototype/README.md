# MCP status UI prototype

## Question

在真实 Pi 会话中，极简状态行、紧凑监控表、连接进度三种展示，哪一种最便于判断 MCP 是否可用，同时不打扰聊天？通过切换相同状态、查看详情和重放启动过程进行比较。另提供 Codex CLI 0.153.4 的 `/mcp` 和 `/mcp verbose` 作为独立方案四对照。

界面文案使用英文，已由用户确认。本目录是隔离原型，不修改正式 MCP 扩展。

## Run

在仓库根目录运行。使用现有 Node.js 22.19+、pnpm 11.9.0 和锁文件依赖，不要求全局安装 Pi，不需要登录或 MCP 服务。

```bash
pnpm run prototype:mcp-ui
```

如果依赖尚未安装：

```bash
pnpm install --frozen-lockfile --ignore-scripts
```

默认显示方案一的全部成功状态。在真实 Pi 输入框中输入以下命令：

| Command | Action |
| --- | --- |
| `/mcp-ui` | 打开方案选择菜单 |
| `/mcp-ui 1` | 极简状态行 |
| `/mcp-ui 2` | 紧凑监控表 |
| `/mcp-ui 3` | 连接进度 |
| `/mcp-ui 4` 或 `/mcp-ui codex` | 切换到 Codex CLI 对照，立即向聊天记录输出紧凑 `/mcp` 摘要 |
| `/mcp-ui compare` | 把四个方案的当前状态快照放进真实聊天记录，便于上下比较 |
| `/mcp-scene` | 打开状态选择菜单 |
| `/mcp-scene connecting` | 三个服务已连接，mysql 连接中 |
| `/mcp-scene ready` | 四个服务全部成功，13 个工具可用 |
| `/mcp-scene retrying` | mysql 重试，其余 10 个工具可用 |
| `/mcp-scene failed` | mysql 离线，突出错误原因 |
| `/mcp-details` | 方案 1–3 切换实时详情；方案四输出 verbose 详情 |
| `/mcp` | 方案 1–3 输出详细状态快照；方案四输出 Codex 紧凑摘要 |
| `/mcp verbose` | 方案四展开 Auth、Tools、Resources 和 Resource templates |
| `/mcp-play` | 方案 1–3 的原重放不变；方案四播放 Codex 多服务启动动画，4.8 秒后完成 |
| `/mcp-play single` | 方案四播放单服务 `Booting MCP server: mysql` |
| `/mcp-play failed` | 方案四播放 mysql 启动失败的过程 |
| `Esc` | 方案四启动动画期间中断，停止动画并显示取消提示 |
| `/mcp-quit` | 退出并清理本次运行目录 |

方案三的 `/mcp` 和 `/mcp-details` 现在使用独立的服务清单：不显示 `4/4` 或重复的 `Connected`，工具数右对齐，异常服务置顶并紧接错误原因。启动展示及重放时序不变。查看新版详情可依次输入 `/mcp-ui 3`、`/mcp`；实时切换状态查看详情可用 `/mcp-details`。

建议先运行 `/mcp-ui compare` 比较成功态，再切到 `failed` 重复比较。最后分别选择三个方案执行 `/mcp-play`，观察占用行数与错误信息是否容易找到。快照不会随状态变化，实时预览会更新。

## Codex reference

参考版本为本机 `codex-cli 0.153.4`，已核对官方 `rust-v0.153.4` 的固定提交 `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`，并非根据旧截图猜测。准确布局、源码行和 snapshot 证据见 [CODEX-REFERENCE.md](./CODEX-REFERENCE.md)。

在已打开的原型会话中：

```text
/reload
/mcp-ui codex
/mcp
/mcp verbose
```

Codex 默认摘要有标题、按大小写敏感顺序排序的服务列表和 verbose 提示。服务行使用加粗名称、带色连接状态和弱化工具数，不显示 `4/4`。verbose 才显示认证、工具名和资源列表。当前版本的实际路径不显示旧版 `Command`、`URL` 等本地配置字段，也不在失败服务下面附加错误原因。

方案四的 compact/verbose 详情写入真实 Pi 聊天记录，不将长详情放进常驻 widget；切换状态会追加新的紧凑快照。已保留方案三的启动和新版详情。

### Startup replay

```text
/mcp-ui codex
/mcp-play
```

启动行临时显示在真实输入框上方：圆点亮度变化、文字高亮扫过、已结束服务数/总数、排序后的待启动服务名，以及耗时和 `esc to interrupt`。最多列出三个待启动服务，更多时用 `…`。每 1.2 秒完成一个 fixture，4.8 秒后启动行消失，不追加成功列表。输入 `/mcp` 可查询完成后的状态。

单服务使用 `/mcp-play single`；即使多服务启动只剩最后一个，也仍显示 `Starting MCP servers (3/4): mysql`，不会变成单服务标题。`/mcp-play failed` 在结束时显示 `MCP startup incomplete (failed: mysql)`。Esc 会停止更新，并让之后的 `/mcp` 显示 `cancelled`。切换方案、切换场景、重新播放、reload 或退出都会清理计时器与临时 Escape 监听。

复刻边界：

- 由 TypeScript 独立实现官方布局与字串，没有移植 Rust 或启动 Codex。
- 使用 Codex 暗色终端的 ANSI 色号、bold/dim，并保留标题图标。未复制 Codex 的亮色背景和色彩能力探测降级；实际颜色仍取决于终端 palette。
- 宿主仍为 Pi，滚动、外层间距、换行和 emoji 宽度不是 ratatui 的像素级复制。
- 工具名、`Unsupported` 认证与空资源均为显式 fixture，不是发现到的真实服务信息。未连接服务的 fixture inventory 为空。
- Pi 的 `retrying` 近似映射为 Codex `starting`，`offline` 映射为 `failed`；不显示 attempt 和 lastError，也未复刻完整的 Codex 状态枚举。
- `/mcp` 数据立即返回，未模拟 inventory RPC loading 或 RPC 失败。启动过程另由固定时间表重放，没有真实 MCP 握手。
- 启动标题、完成后移除行为和单/多服务分支依据同一 Codex 版本源码。动画用每 50ms 一帧的灰阶扫光近似 native 32ms 调度；没有移植其 palette 检测、RGB 混色或 reduced-motion 分支。计时从每次重放开始，而不是实际进程初始化时刻。
- Escape 原始输入监听通过仓库 Pi 0.84.3 的 `ExtensionUIContext.onTerminalInput` 类型和运行验证核实；它只在方案四启动期间安装，结束即解除。

## Landing map

- **Target**：正式 MCP 的 `formatStartupSummary`、`formatStatus`、`notifyStatusForMode`，位于 `extensions/mcp/src/index.ts`。正式启动消息和 `/mcp` 都通过 `ctx.ui.notify` 展示。
- **Context**：复用 `extensions/codex-ui/src/index.ts` 的真实头部、输入框、页脚，以及 `themes/codex-pi.json`。入口直接运行仓库安装的 Pi CLI 0.84.3。
- **Contract**：状态 fixture 复用 `McpServerState` 的 `connected`、`status`、`tools`、`attempt`、`lastError` 字段。原型通过真实 `setWidget` 更新实时区域，通过 `registerEntryRenderer` 和 `appendEntry` 把静态比较结果放进真实聊天记录。快照不进入模型上下文。

## Real and simulated boundaries

真实部分是 Pi 宿主、扩展加载、命令、菜单、主题、终端宽度处理、聊天记录渲染与 Codex UI。

替换部分：

- MCP manager 使用具名 fixture，没有创建 transport，没有读取 MCP 配置，也没有数据库查询。
- `mcp-ui-fixture/ui-preview` 是无网络模型占位，防止宿主弹出登录提示。调用入口直接拒绝模型请求。
- 实时展示使用输入框上方的 widget。它是正式启动通知生命周期的 approximation，不是对现有 `notify` 的原地修改。正式通知和原型条目的外层间距可能不同。
- 为方便比较，方案一的成功提示保持可见，未实现自动消失。方案三的成功态会收起服务明细，`/mcp-details` 可重新展开。
- 菜单、命令提示、fixture 标签只用于实验，不是建议加入正式产品的界面元素。

启动器只传递必要终端环境，不继承提供商密钥。`HOME`、Pi 配置、session 路径和缓存都指向本目录 `.tmp/run-*`。启用 `--offline`，禁用扩展自动发现、上下文文件、skills 和 prompt templates，只显式加载 Codex UI 与本原型。普通输入和 shell 执行被原型拦截。正常退出时删除本次运行目录；没有监听端口。

## Verification

```bash
pnpm run prototype:mcp-ui:check
pnpm run check
```

原型测试覆盖成功态去冗余、前三种布局、非健康状态与工具数统计、1/24/40/80/120 列宽、空配置、命令切换、重放取消、shutdown 清理及模型请求阻断。方案四另覆盖 Codex compact/verbose 字段、排序、状态样式、空 inventory、单复数工具数及命令路由。

额外的真实终端 smoke check 使用 Python 标准库，不需要额外 Python 依赖。需要 POSIX PTY 环境：

```bash
conda run --no-capture-output -n codex-py312 python prototypes/mcp-status-ui-prototype/__tests__/host_smoke.py
```

它实际启动 Pi，检查方案切换、失败态、详情、聊天记录快照、四方案比较、连接重放、Codex compact/verbose、Codex 启动行连续重绘和进度、单服务启动、Escape 中断与取消状态、启动失败提示、40 列缩放、普通输入拦截和正常退出。

尚未验证真实 MCP 连接时序、频繁状态事件、其他终端字体及主题、正式通知外框和自动消失时机。这些不能由 fixture 重放证明。

## Reuse

`src/renderers.ts` 的纯渲染函数可作为正式实现的起点，状态字段与生产类型一致。但接入时仍须使用正式 manager 的状态源，并核验服务名清洗、全部连接状态、通知挂载位置及生命周期。

`src/fixtures.ts`、离线 provider、命令控制器、启动器和重放计时器只用于决策，不应迁入正式扩展。最终选择尚待用户实际比较。

## API references

接口通过 Context7 核对，再以本仓库安装的 0.84.3 文档和类型确认版本行为：

- [Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi TUI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md)
- [Pi custom providers](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md)

本地对应文档在 `node_modules/@earendil-works/pi-coding-agent/docs/`。
