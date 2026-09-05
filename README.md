# pi-ext

为 [Pi Coding Agent](https://github.com/earendil-works/pi) 提供六个扩展和一套主题：

- `codex-compact` 为支持的 ChatGPT auth 模型提供 Codex Remote Compaction V2。
- `openai-fast-mode` 为匹配的 OpenAI 和 OpenAI-Codex 模型注入 priority service tier。
- `codex-ui` 使用 Pi 品牌实现 Codex 风格的 TUI profile，并提供 `codex-pi` 主题。
- `mcp` 连接 Model Context Protocol 服务器，并将工具注册为 `mcp__<server>__<tool>`。
- `permissions` 提供 `Default permissions` 和 `Full access` 两种模式，以及逐次调用审批。
- `subagent` 通过 tmux 管理普通 TUI Pi child，并从 Pi 原生 session JSONL 读取活动与完成状态。

## Requirements

- Node.js 22.19 或更高版本
- `@earendil-works/pi-coding-agent` 0.84.3
- `subagent` 运行时需要 tmux 3.6 或兼容版本
- 支持 24-bit color 的终端可获得最接近设计稿的颜色效果

仓库在 Linux、macOS 和 Windows 上运行通用测试；`subagent` 的真实 child runtime 仅适用于可运行 tmux 的环境。运行入口是各扩展 `dist/` 目录中的 ESM 文件，Pi 启动时不需要转译 TypeScript 源码。

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

## Codex Compact extension

`codex-compact` 只接管 provider 为 `openai-codex` 且 API 为 `openai-codex-responses` 的模型。扩展通过 Codex Remote Compaction V2 获取加密 checkpoint，并将 V2 details 写入 Pi 的标准 compaction entry。其他 provider 和 API 继续使用 Pi 原生压缩；如果当前分支已有 V2 checkpoint，切换到非 Codex 模型时会回放原始分支，避免把加密 checkpoint marker 当作可用文本摘要。

Pi 发起的手动 `/compact`、threshold 和 overflow 压缩完全使用 Pi 原生进行中 UI，不叠加扩展 footer。Pi 提交最终 entry 后，扩展重新读取本次新写入记录并校验 hook 来源、V2 details、模型和压缩参数。校验结果会延迟到 Pi 完成 compaction 卡片重建后显示，避免通知被 transcript 重绘清除：

```text
Codex compaction applied
```

原生 compaction 卡片展开后还会显示持久化摘要：

```text
Codex encrypted compaction item.
```

若远程请求、响应结构或 checkpoint 校验失败，扩展会取消本次 Codex 压缩，不会静默降级为 Pi 本地文本摘要。若最终 entry 无法证明来自本次 V2 attempt，则显示 warning。扩展在 provider request 前自主发起压缩时，会在编辑器上方显示 `⠋ Compacting context... (esc to cancel)` 动画，并在下方保留一行间距。提示不会写入 footer；session、分支或模型切换时会立即清理。

可在全局 `~/.pi/agent/pi-codex-compact.json` 配置，也可在受信任项目的 `.pi/pi-codex-compact.json` 覆盖：

```json
{
  "autoCompactTokenLimit": 180000,
  "autoCompactScope": "total"
}
```

`autoCompactTokenLimit` 必须为正数，且最多为模型 context window 的 90%。`autoCompactScope` 可设为 `total` 或 `bodyAfterPrefix`；默认使用 `total`。当前 V2 路径不消费 `/compact focus text` 的 focus text。

不要同时加载本扩展和独立的 `npm:@yeungkc/pi-codex-compact@0.0.6`，否则同一组 hooks 会执行两次。迁移现有安装时，应先验证本 package，再从 Pi settings 停用独立 npm entry 并重启或 reload。

本目录基于 `@yeungkc/pi-codex-compact` 0.0.6 导入；精确 commit、同步范围和本地改动记录见 `extensions/codex-compact/UPSTREAM.md`，上游 MIT license 见同目录 `LICENSE`。

## OpenAI Fast Mode extension

`openai-fast-mode` 为配置中精确匹配的 OpenAI 和 OpenAI-Codex 模型注入 `service_tier: "priority"`。可使用以下命令切换：

```text
/fast
/fast on
/fast off
/fast toggle
```

启动参数 `--fast` 会启用并持久化 Fast Mode。全局状态继续保存在 `~/.pi/agent/extensions/pi-openai-fast-mode/config.json`；项目级状态保存在 `.pi/pi-openai-fast-mode/config.json`，迁入本仓库后无需迁移现有配置。

扩展通过 `setStatus("pi-openai-fast-mode", "fast")` 发布 footer 状态，并主动清理 0.3.0 使用的 below-editor widget。不要再单独加载 `npm:pi-openai-fast-mode`，否则 `/fast`、flag 和 provider hooks 会重复注册。

本目录基于 `pi-openai-fast-mode` 0.3.0 导入；精确 commit、同步范围和本地改动记录见 `extensions/openai-fast-mode/UPSTREAM.md`，上游 MIT license 见同目录 `LICENSE`。

## Codex UI profile

`codex-ui` 仅在 Pi 的 TUI 模式中接管以下组件：

- 使用 `pi v0.84.3` 官方 wordmark 的 header
- 实色背景 composer
- model、thinking、Fast Mode、cwd、git branch、context-left 和 permissions 单行 footer
- 带 accent marker 的 Thinking/Reasoning 最新段落单行显示
- 隐藏 streaming working row，并通过 terminal title 显示工作状态
- `read`、`edit`、`write` 的紧凑 renderer
- 以 Thinking marker 为主轴、使用固定 `├─ •` 分支前缀的 Bash timeline；摘要采用主副两行，按 `Ctrl+O` 展开详情

Thinking/Reasoning 区域无论处于流式状态还是历史状态，都只渲染最新段落，并按当前可用宽度截断为一个终端行。行首圆点使用主题的 `mdCode`，正文继续使用 `thinkingText`；在 `codex-pi` 中分别对应 cyan 与 muted。完整 Thinking 内容仍保存在 Pi 会话数据中，`codex-ui` 仅改变显示结果。

### Low-power rendering

`/lowpower on` 只负责简化 `write`、`edit`、`bash` 的渲染；`/lowpower off` 恢复完整工具输出，`/lowpower status` 仅查询当前状态。两种模式都会隐藏 Pi 内置的 streaming working row，并在 agent 工作期间通过 terminal title 显示 `Thinking.`、`Thinking..`、`Thinking...` 与 spinner。标题每 `500ms` 更新一次，不触发全局 TUI 渲染。

启用 Pi 的 `terminal.showTerminalProgress` 后，终端原生 edge progress 会与 title spinner 同时显示。该进度由终端处理，不进入 Pi TUI 渲染管线。Low-power 状态仅保存在当前 extension instance 中；`/new`、`/resume`、`/fork`、`/reload` 或进程重启会重新加载扩展，并恢复为默认关闭。

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

`read`、`edit`、`write`、`bash` 仍使用 Pi 0.84.3 的官方 tool definitions 执行。`edit` 优先根据真实 `EditToolDetails.patch` 还原 old/new 行号与 hunk，并绘制整行 added/removed 背景、独立 sign 和 syntax-highlighted content；sign 与源码之间保留一个空格。`write` 只显示路径、行数和字节数，不伪造 old/new diff。Bash 使用 `renderShell: "self"`；摘要采用固定 `├─ •` 前缀，分支轴与 Thinking marker 对齐。折叠态使用主副两行：首行显示状态和命令，次行显示 visual line 数、耗时、限制与展开提示，不再铺满状态背景。首行最大为 110 cells；终端不少于 72 cells 时至少保留 8 cells 右侧留白，命令被裁剪时以三个 ASCII 句点 `...` 结束。展开后的命令、输出和截断信息缩进到 `Bash` 标题列。展开时，耗时与 visual line 数显示在正文及截断说明之后，没有结果时耗时显示在命令之后；完成后保留底部最终值。状态、命令摘要、timeout、truncated 标记及折叠提示仍在顶部。使用当前配置中的 `app.tools.expand` 快捷键可以展开工具详情，默认是 `Ctrl+O`。

Footer 使用 ` ⋅ ` 分隔，并按 `model thinking ⋅ fast ⋅ cwd ⋅ git:branch ⋅ Context N% left ⋅ permissions` 排列。model 与 thinking 使用 Codex CLI 的 `#f6e2b7`，context 使用 `#f2b590`，Fast Mode 使用 `#c8a9ee`。终端变窄时会先缩短或移除 cwd 和 branch，再将 context 缩成 `N% left`；model、context 和 permissions 保留到最后。

Footer 只消费 `pi-openai-fast-mode` 和 `permissions` 两个稳定 status。MCP、压缩进度、low-power 和其他临时 status 不显示。内置的 `openai-fast-mode` 不再创建 below-editor widget。由于 Pi 0.84.3 没有公开 weekly quota 数据源，本 profile 不显示 weekly quota。

Ghostty 的窗口透明度、blur、字体和 titlebar 仍由 Ghostty 配置负责。Pi cell 只使用不透明 ANSI 颜色。

本地构建后可以直接 smoke test：

```bash
pi \
  -e ./extensions/codex-ui/dist/index.js \
  --theme ./themes/codex-pi.json \
  --use-theme codex-pi
```

## MCP extension

在项目中创建 `.pi/mcp.json`，或在全局创建 `~/.pi/agent/mcp.json`。配置支持 JSON comments、trailing commas，以及 `stdio`、`streamable-http`、`http` 兼容别名和 legacy `sse` transport。

```jsonc
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["dlx", "@modelcontextprotocol/server-filesystem", "."],
      "connectTimeout": 30000,
      "requestTimeout": 60000,
      "maxRequestTimeout": 120000,
      "retry": {
        "maxAttempts": 3,
        "baseDelayMs": 500,
        "factor": 2,
        "maxDelayMs": 5000,
        "background": true
      },
      "toolReplay": "never"
    },
    "remote": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  },
  "diagnostics": {
    "file": {
      "enabled": false,
      "path": ".pi/logs/mcp.jsonl",
      "maxBytes": 1048576
    }
  }
}
```

`connectTimeout` 是初始化、首次工具发现、前台重试和等待共用的总 deadline。`requestTimeout` 控制单次请求；当 `maxRequestTimeout` 更大时，progress notification 可以重置 request timer，但仍受该外层硬总上限约束。Timeout 或取消会关闭当前 transport，以终止仍在进行的 HTTP fetch，且不会重放原调用。旧 `timeout` 仍兼容，并在新字段缺省时分别作为 connect/request fallback。

连接默认最多尝试 3 次，采用 500 ms 起步、因子 2、单次上限 5 s 的 full jitter。HTTP `Retry-After` 优先，但最多等待 5 min。临时网络错误、408、429、部分 5xx 与 520–527 可重试；认证、配置和确定性协议错误不会重试。前台 deadline 耗尽后可在后台有界恢复；可用 `/mcp reconnect <server>` 取消该 server 的后台等待并立即发起单 server 重连。

工具调用自动重放默认关闭。`toolReplay: "read-only"` 只允许初始 catalog 与重连后的最新 catalog 都明确带有 `annotations.readOnlyHint === true`、且 route 所有者未变化的工具最多重放一次；该 annotation 来自服务器，不能替代对服务器和工具副作用的审查。

传给模型的 MCP text 与序列化非 text 内容合计限制为 50 KiB、2000 行，最多序列化 24 个非 text block；`details` 中的 structured output 也限制为 50 KiB。超限 raw 输出不会自动落盘。工具提示会要求 agent 缩小结果或使用 server pagination；需要完整数据时应按服务端 cursor/page/limit 分段获取。

内存 diagnostics 使用每服务器有界 ring buffer，并对控制字符、常见凭据和过长字段进行清理。文件日志默认关闭；启用后写入有界 JSONL，并保留一个 `.1` 轮转备份。Stdio stderr 使用 pipe 捕获到 diagnostics，不直接写入 Pi 终端。脱敏是降低风险的措施，不是保存或分享日志的安全保证。

可用命令：

```text
/mcp status
/mcp reload
/mcp reconnect <server>
/mcp logs [server]
/mcp-init
```

`/mcp-init` 创建项目配置；修改配置或删除已注册工具后使用 `/mcp reload`。MCP 配置可以启动进程、携带 headers 并暴露有副作用的工具，应把 `.pi/mcp.json` 视为可执行配置，只信任已审查的项目，并且不要提交凭据。

Exa hosted MCP 推荐直接使用 `https://mcp.exa.ai/mcp` 的 Streamable HTTP transport。Free plan 面向 casual use，匿名请求受当前 rate limit 政策约束；production 可通过 `x-api-key` header 配置 API key。不要在文档或配置中假定固定额度，也不要把 `mcp-remote` 作为原生远程连接故障的首选修复。

完整配置、Exa tool selection、诊断边界和排错流程见 [`extensions/mcp/README.md`](extensions/mcp/README.md)。

## Subagent extension

`subagent` 不依赖额外 skill，也不修改 Pi core。每个 child 都是在独立 tmux window 中运行的普通交互式 TUI Pi；初始任务和后续 prompt 通过 tmux buffer 投递，不进入 shell command line。

扩展只在 root Pi 注册六个工具：

```text
subagent_spawn
subagent_prompt
subagent_list
subagent_read
subagent_wait
subagent_close
```

managed child 仍加载 lifecycle hooks 并写入 runtime state，但不注册 subagent 编排工具。合法管理拓扑只有 root 到 direct child；`target: "all"` 也只处理当前 root 的 direct children。每个 child 固定对应一个 tmux window 和一个 pane；投递前会验证登记的 session、window、pane、进程和 pane 模式仍一致。

初始 task 和后续 prompt 都采用 at-least-once 投递。每条消息会在首行加入 `[subagent:<12-char-id>]`，该标识会进入 child 模型上下文；只有 Pi 原生 session 出现对应 user turn，或 TUI 显示对应 `Steering:`/`Follow-up:` pending 项时才算成功。`subagent_prompt` 成功结果会附带 `deliveryId` 和 `confirmation`。提交后 1 秒仍无证据时返回 `delivery_unconfirmed`，但 child 可能已经接受消息；扩展不会自动重试，调用方重试可能产生重复任务。

当前投递协议只支持 Pi 默认的 `Ctrl+C` 清空、`Enter` 提交和 `Alt+Enter` follow-up 键位。自定义 keybindings、替换 editor 的 extension，以及同一 window 内增加 pane 不在兼容范围内。

每个 root namespace 默认最多占用 3 个 slot。`pending`、`starting`、`running`、`settled` 和 `closing` 均占用 slot；已确认进程死亡的 `interrupted` 不占用。并发 spawn 使用持久化 reservation 防止超卖；同一 Pi 进程切换 session 产生的 direct-child aliases 按 `processInstanceId` 去重。可通过正整数环境变量 `PI_SUBAGENT_MAX_ACTIVE` 调整上限。

`subagent_list` 返回 `{ agents, capacity }`，其中容量结构为：

```json
{
  "active": 2,
  "pending": 1,
  "limit": 3,
  "available": 0
}
```

`subagent_read` 只读取 Pi 原生 session JSONL 中已经持久化的 finalized 数据，支持 `recent_activity`、`turns` 和 `activity_detail`。它不解析 tmux pane history，也不复制 transcript。`recent_activity` 默认返回最近 1 条非空 assistant 结论和 1 条 tool 状态；tool 摘要不包含 arguments 或完整 result，失败时只附带有界预览。摘要返回计数、省略数、`hasMore` 和 UTF-8 JSON 字节数，最终 payload 不超过 72 KiB；`turns` 中的 activity 使用同一摘要投影。

需要原始内容时，使用 `activity_detail` 按 activity id 读取单个 `assistant_text`、`tool_arguments` 或 `tool_result` section。每页最多 16 KiB，并使用绑定 agent、epoch、activity、section 和字节位置的独立 cursor 继续读取。普通 activity cursor 仍绑定 agent、epoch 和 view。

常规协作优先使用 `subagent_read` 摘要跟踪 child，让 main 继续推进；只有失败摘要不足、需要精确证据或用户明确要求时才读取 detail。`hasMore` 不要求自动读取全部历史；如果需要补取被 count limit 省略的摘要，应复用原 `after` 并提高对应 limit，而不是使用本次返回的新 cursor。只有 main 的下一步依赖 child 结果时才使用阻塞式 `subagent_wait`；wait 复用相同的轻量摘要投影。单次 wait 默认 30 秒、最长 120 秒；timeout 后可以复用同一 `afterSettled` 再次等待。

`subagent_close` 是终结操作：先停止并确认 Pi 进程与 tmux window 已退出，再解除 direct-child 关系并删除 Extension 状态，从而释放 slot。关闭失败或确认超时时保留关系、状态和 slot，以便重试。成功关闭不会删除或修改 Pi 原生 session JSONL、session 目录或项目文件。

扩展要求当前 parent 使用持久化 Pi session；`--no-session` 模式下工具会明确拒绝。默认管理快照位于 Pi agent directory 的 `subagents/sessions/<sessionId>/state.json`，每个 session 独立原子写入。可使用以下环境变量：

```text
PI_SUBAGENT_MAX_ACTIVE
PI_SUBAGENT_PI_PATH
PI_SUBAGENT_TMUX_PATH
```

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
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
```

常用命令：

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run package:check
pnpm pack --dry-run
pnpm run prototype:tui
pnpm run prototype:subagent-ui
```

仓库有意提交 `dist/`。Pi 从 Git 安装 package 时只安装生产依赖，因此需要预构建文件。CI 会拒绝过期的生成文件。`prepack` 会重建六个扩展，发布包只包含编译产物、theme、README、license 和上游 attribution。

`pnpm run prototype:tui` 启动 Codex、Claude、Hybrid 三套一次性 HTML 原型。生产 extension 只实现 Codex 方向，另外两套原型保留供后续使用。

## Layout

```text
extensions/
  codex-compact/
    src/
    __tests__/
    dist/
    LICENSE
    UPSTREAM.md
  openai-fast-mode/
    src/
    __tests__/
    dist/
    LICENSE
    UPSTREAM.md
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
  subagent/
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
