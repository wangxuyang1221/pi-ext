# Web search prototype

## Question

两行搜索块在真实 codex-ui 周边、状态切换、展开和连续调用时，是否紧凑且协调？启动后观察自动播放，再用 `/play batch`、Ctrl+O 和窗口缩放作判断。界面文案使用英文，用户已确认。

## Landing map

- **Target**：Pi transcript 中 `codex_search` 的 `renderCall` / `renderResult`。正式落点为 `extensions/codex-search/src/renderers.ts`，本原型不修改该文件。
- **Context**：真实 Pi `InteractiveMode`，当前 codex-ui 的启动标题、编辑器、页脚、Read 渲染，以及当前 MCP renderer。周边代码从当前工作树原样编译进隔离目录，不重画终端。
- **Contract**：原生工具参数流、执行开始、`onUpdate`、完成事件、self-shell、共享 row state，以及 Ctrl+O 工具展开。搜索执行由具名 fixture 替代。

## Run

在仓库根目录执行：

```sh
pnpm run prototype:web-search

# Current production renderer with offline fixtures
pnpm run prototype:web-search --production

# Production checks, including reload, process restart, and in-process resume
pnpm run web-search:check

# Actual extension registration and in-process session switching
pnpm run web-search:resume:check

# Optional fullscreen host
pnpm run prototype:web-search --fullscreen

# Unit tests and regular/fullscreen PTY smoke
pnpm run prototype:web-search:check
```

入口启动后自动播放成功场景，约五秒完成。无需登录、真实搜索服务或模型凭据。

| Command | Behavior |
| --- | --- |
| `/play` | 重播成功场景，进度从 0/5 更新到完成 |
| `/play partial` | 4/5 成功、1 个失败，警告色摘要 |
| `/play timeout` | 超时，黄色状态和明确原因 |
| `/play error` | 服务失败，红色状态和原因 |
| `/play empty` | 成功但没有来源，不误标为失败 |
| `/play single` | 单查询，不显示多查询后缀 |
| `/play batch` | 连续两轮搜索，第二轮部分失败，用于比较块间距 |
| `/hold` | 停在执行中，不自动推进 |
| `/finish success` | 完成 held 搜索，也支持 partial、timeout、error、empty、interrupted |
| `/play stop` | 取消当前播放；结束后可以重播 |
| `/theme light` | 切换到真实浅色主题；`/theme codex-pi` 恢复 |
| `/guide` | 显示命令提示 |
| `/quit` | 退出，清理隔离 workspace |

Ctrl+O 使用 Pi 原生工具展开/折叠，会同时影响其他工具，不是单独的搜索面板。展开后的长列表通过宿主滚动查看。窗口可自由缩放。

## Resume regression

Pi 会话内 resume 的顺序是先重建历史 UI，再执行 `session_start`。只在 `session_start` 注册搜索工具会导致旧记录退回通用绿色工具框，即使结果 details 完整也无法自动恢复。

正式扩展现在加载时同步注册隐藏的历史展示定义，`session_start` 再按配置替换为可执行工具。展示定义不读取配置、不调用网络，直接执行会拒绝；禁用搜索仍可显示历史，不会因此启用搜索或 standalone 操作。

`extensions/codex-search/__tests__/resume-tui.py` 通过真实 CLI 加载完整搜索扩展，先打开空白 fixture，再调用宿主 `switchSession` 恢复搜索记录，检查紧凑标题、展开、主题及 reload。覆盖普通、全屏与禁用搜索；`--global-host` 可补验 PATH 中的 Pi。所有会话与配置均在仓库 `.tmp/` 内生成，不打开或修改用户原始会话。该测试与只注入 renderer 的旧播放测试互补，不能用后者代替注册顺序验证。

## Proposed behavior

默认两行示意：

```text
⌕ Searched web (Anthropic 争议言论与官方回应 +4 queries)
  └ 17 sources · 5 queries · 5s · ctrl+o expand
```

搜索块自己不添加前后 spacer，只保留 Pi 前置的一行。采用搜索前缀 `⌕` 和状态语义配色：成功 muted 灰色，等待和运行 warning 黄色，失败 error 红色，标题加粗、查询预览弱化、结果正文使用 `text`，不引入背景或固定 hex 色板。

运行进度原位更新，不逐条追加日志。批量查询默认只显示第一条和剩余数量；展开后显示全部查询、配置和来源标题与明文 URL。窄窗口优先保留错误及成功/失败计数，再按空间保留次要统计。极窄窗口仍会截断，不承诺完整两行可读。

部分失败显示黄色，区别于成功绿色和全部失败红色。超时与中断沿用 warning。结果行不再重复添加对勾或 spinner。

## Real and fixture boundaries

真实部分：

- Pi 0.84.3 的会话、工具生命周期、参数流、TUI 容器、展开与缩放。
- 当前工作树的 codex-ui/MCP 代码和未改写的 `themes/codex-pi.json`。
- 共享的 `extensions/codex-ui/src/tool-status.ts` 状态符号与配色 helper。
- Read 实际读取隔离 workspace 中的 `research-notes.txt`。

Fixture / approximation：

- 模型使用 Pi faux provider，只发送固定工具调用。
- 搜索与 MCP 不执行网络请求。来源使用 `example.com`，标题明确标记 fixture；不是实际研究结果。
- 搜索数据结构为原型专用 `status/total/completed/failed/sources`，不代表正式 `WebSearchDetails` 契约。
- 故障状态由 fixture outcome 明确指定，再通过 `tool_result` 进入真实宿主错误路径。它不能验证真实服务的错误分类。
- 默认每条查询推进一次，间隔 900ms。耗时由本地经过时间计算，不代表真实服务性能。
- 默认参考模式不加载正式搜索插件的认证、网络执行和动画模块。`--production` 改为使用正式 renderer、活动管理和真实 `WebSearchDetails` 形状，但仍不连接真实认证或网络；错误由具名 fixture 抛出，正式执行器的分类另由单元测试验证。

入口在仓库 `.tmp/web-search-*` 内隔离 HOME、agentDir、sessionDir、临时目录和 workspace；不加载用户扩展、skills、上下文或凭据。禁用 fetch、模型网络、shell 输入、任意模型输入和压缩。文件工具经过具名调用及参数校验，只有预定 Read 可读取隔离文件，其他文件修改工具不执行。正常退出和 SIGTERM/SIGHUP 会清理隔离目录。不要用 SIGKILL 退出，因为任何程序都无法在 SIGKILL 后执行清理。

## Verification

环境为 Node.js 22.22.2、pnpm 11.9.0、Pi 0.84.3。Context7 没有对应版本快照，具体 API 以本地安装版本的完整 SDK、extensions、TUI 文档和既有原型入口为准。

验证结果：

- `pnpm run prototype:web-search:check` 通过，含 7 个测试及 regular/fullscreen 两种真实 PTY 检查。
- 两行默认视图、状态变化、展开详情和 `+1 query` 单复数均先观察到测试失败，再实现通过。
- 单元测试覆盖播放进度顺序、取消停止更新、部分失败与空来源、1/12/24/40/80/120 列宽度上限。
- PTY 验证运行黄点、成功绿点、部分失败及超时黄点、失败红点；原生 Ctrl+O 能显示来源 URL。
- 相邻两个搜索标题相隔三行，即标题、结果、一行空白后进入下一标题。不是三行空白。
- PTY 验证 40/80/120 列缩放、浅色主题切换、取消后重播及退出清理。未启动监听服务，测试启动的原型进程已退出。
- `pnpm run check` 类型检查通过，1148 个测试通过；既有 MCP 原型测试因缺少 `prototypes/mcp-status-ui-prototype/src/codex-startup.js` 加载失败，因此未进入后续构建和发布包检查。没有修改该无关缺文件问题。

PTY 文本证据保存在 `.tmp/web-search-regular-smoke.json` 和 `.tmp/web-search-fullscreen-smoke.json`。全仓检查日志为 `.tmp/web-search-repo-check.log`。这些是本地验证产物，不随发布包分发。

## Production verification

用户已认可本方案，正式接入完成，详见 [Web search UI acceptance](../../docs/web-search-ui-acceptance.md)。`--production` 不再使用参考原型的私有状态结构或颜色代理，可搭配 `--fullscreen`。自动验收的 `--restart` 会在首次退出后恢复同一份隔离历史，再次退出才清理。

正式模式 80 个搜索测试及 regular/fullscreen PTY 通过，覆盖 reload 和新进程恢复超时记录。全仓检查现为 1159 个测试通过，仍被同一个既有 MCP 原型缺文件问题阻塞。上节 7 个测试保留为参考原型的验证记录。

## Handoff

已验证并正式接入的是宿主中的两行密度、单一间距来源、状态更新、展开与缩放行为。参考原型保留用于视觉对照。

可以保留的决定是两行层级、语义颜色、首条查询预览、错误优先和由宿主控制间距。`src/renderers.mjs` 可作正式实现的布局参考；正式实现应重新接入现有搜索结果结构、真实进度、失败诊断和 renderer 缓存，而不是照搬 fixture 数据结构。

`prepare.mjs`、离线运行入口、faux provider、播放脚本和错误注入只用于原型，不应迁入生产。正式实现位于 `extensions/codex-search/src/`，并未搬入这些 fixture；dist 不手工修改。根 `package.json` 提供原型与正式验收命令，`.gitignore` 保留本原型目录的例外。
