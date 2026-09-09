# Codex CLI `/mcp` Reference

## Scope and Version

本文只研究用户本机版本 `codex-cli 0.153.4` 对应的官方标签 `rust-v0.153.4`。GitHub 的[官方 tag ref](https://api.github.com/repos/openai/codex/git/ref/tags/rust-v0.153.4)指向 annotated tag `042fb41b…`，其[官方 tag object](https://api.github.com/repos/openai/codex/git/tags/042fb41b7c813ac7999105e886b2b7aa715b5081)再指向固定提交 [`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`](https://github.com/openai/codex/commit/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a)。以下源码和快照链接均固定到该提交，不把 `main` 当作当前版本。

本次没有启动 Codex、登录、读取用户配置或连接真实 MCP。布局、字串和样式来自该固定提交的源码与 snapshot tests。

## Canonical Layout

### Compact `/mcp`

普通 `/mcp` 使用 `ToolsAndAuthOnly` 请求，但该版本的实际 compact renderer 只显示每个服务的连接状态和工具数量，不展开 Auth 或工具名；末尾提示使用 verbose。分发逻辑见 [`slash_dispatch.rs` L521-L523](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/slash_dispatch.rs#L521-L523)，渲染分支见 [`mcp.rs` L577-L590、L660-L663](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/mcp.rs#L577-L590)。

固定快照中的准确布局为：

```text
/mcp

🔌  MCP Tools

  • auth: authentication required (0 tools)
  • cancelled: cancelled (0 tools)
  • connected-empty: connected (0 tools)
  • deferred: not started (0 tools)
  • disabled: disabled (0 tools)
  • failed: failed (0 tools)
  • starting: starting (0 tools)
  • unknown: unknown (0 tools)

  Use /mcp verbose for tools and resources.
```

证据：[connection states snapshot L5-L18](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/snapshots/codex_tui__history_cell__mcp__tests__mcp_inventory_connection_states.snap#L5-L18)。

注意精确空白：`/mcp` 后一空行，标题后再一空行；服务列表和末尾提示之间一空行。服务行前两个空格，子项前四个空格。标题中的 `🔌` 后是两个空格。工具数按 `1 tool` / 其他数量 `tools` 变化。

### Verbose `/mcp verbose`

参数仅接受大小写不敏感的 `verbose`；其他非空参数输出 `Usage: /mcp [verbose]`。证据：[`slash_dispatch.rs` L739-L742](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/slash_dispatch.rs#L739-L742)。

准确结构为：

```text
/mcp

🔌  MCP Tools

  • plugin_docs: unknown (1 tool)
    • Auth: Unsupported
    • Tools: lookup
    • Resources: Docs (file:///docs)
    • Resource templates: Doc Template (file:///docs/{id})
```

证据：[verbose inventory snapshot L5-L13](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/snapshots/codex_tui__history_cell__tests__mcp_tools_output_from_statuses_renders_verbose_inventory.snap#L5-L13)。多个服务之间由一条空行分隔；renderer 在每个服务后追加空行，snapshot 会裁掉文末空行。[`mcp.rs` L599-L657](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/mcp.rs#L599-L657)

## Ordering and Metadata

- **服务顺序**：按服务 `name` 调用 Rust `String`/`str` 的默认 `cmp` 升序排序，而不是配置顺序或连接状态分组；这是大小写敏感的 UTF-8 字典序，ASCII 名称中 `A-Z` 排在 `a-z` 前，因此当前 fixture 的 `MultiFetch` 会排在 `context7` 前。[`mcp.rs` L540-L541](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/mcp.rs#L540-L541)
- **工具顺序**：每个服务内按工具名升序排序，再以 `, ` 拼成一条逻辑行；空列表显示 `(none)`。[`mcp.rs` L607-L613](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/mcp.rs#L607-L613)
- **verbose 字段顺序**：`Auth`、`Tools`、`Resources`、`Resource templates`。服务 header 已承担 connection status 和 tool count，不另设 `Status:` 字段。
- **Auth 值**：准确映射为 `Unknown`、`Unsupported`、`Not logged in`、`Bearer token`、`OAuth`。[`mcp.rs` L31-L40](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/mcp.rs#L31-L40)
- **Resources**：标签优先使用 `title`，缺失时使用 `name`，随后一个空格和括号 URI；多个条目以 `, ` 连接。renderer 不额外排序，沿用 app-server 返回顺序；空列表显示 `(none)`。[`mcp.rs` L615-L634](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/mcp.rs#L615-L634)
- **Resource templates**：与 Resources 相同，但括号内为 `uri_template`。[`mcp.rs` L636-L654](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/mcp.rs#L636-L654)
- **未显示的 metadata**：当前 app-server status 路径明确不以 client-local config 丰富内容，因此 `/mcp verbose` 不显示旧 renderer 曾有的 `Status`、`Reason`、`Command`、`Cwd`、`Env`、`URL`、`HTTP headers` 或 `Env HTTP headers`。设计说明见 [`mcp.rs` L521-L528](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/mcp.rs#L521-L528)。同文件 L347-L519 仍保留一个 `#[cfg(test)]` 的旧 config renderer，不能把其 transport 字段误当成 0.153.4 实际 `/mcp` 输出。
- **全局无工具提示**：verbose 模式下所有服务均无工具时，标题后先显示斜体 `  • No MCP tools available.` 和一空行，然后仍逐服务显示 `Tools: (none)`。[`mcp.rs` L543-L547](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/mcp.rs#L543-L547)

## Symbols and Colors

样式映射来自 renderer 和公共 semantic style；snapshot 是去 ANSI 的文本证据，不能单独证明颜色。

| Element | Symbol / text | Style |
| --- | --- | --- |
| command echo | `/mcp` | magenta |
| section title | `🔌  MCP Tools` | emoji 默认样式；`MCP Tools` bold |
| server marker | `•` | 与该 connection status 相同的样式 |
| server name | `<name>` | bold |
| tool count | `(<n> tool[s])` | dim |
| `connected` | exact lowercase text | green + bold |
| `failed` | exact lowercase text | red + bold |
| `starting` | exact lowercase text | accent + bold；暗色或未知背景通常 cyan，亮背景为较深 cyan `(0,95,135)` 的终端最佳近似色 |
| `authentication required` | exact lowercase text | attention + bold；已知暗背景 yellow，亮背景、未知背景或未知色彩能力使用默认前景 |
| `not started`, `disabled`, `cancelled`, `unknown` | exact lowercase text | dim |
| verbose URI / URI template | parenthesized value | dim |
| compact footer | `Use /mcp verbose for tools and resources.` | dim |

连接状态及行内 span 组合见 [`mcp.rs` L549-L588](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/mcp.rs#L549-L588)；semantic 色彩的终端背景适配见 [`style.rs` L13-L41、L79-L85](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/style.rs#L13-L41)。更精确地说：色彩能力为 `Unknown` 时，success、attention、failure 都退化为默认前景但仍 bold；仅在色彩能力已知时 success/failed 才固定为 green/red。`not started`、`disabled`、`cancelled`、`unknown` 只 dim、不 bold。服务 marker 和状态文字共享同一 status style，服务名另行 bold，冒号保持默认样式，count 只 dim。

`runtime_status` 缺失但 Auth 为 `NotLoggedIn` 时仍显示 `authentication required`；其他缺失状态显示 `unknown`。因此原型不应仅凭 `connected: false` 推出一种统一状态。

## Loading, Empty, and Error States

### Loading

提交 `/mcp` 后先放入临时 active history cell；完成或失败后删除。静态 snapshot 为：

```text
• Loading MCP inventory…
```

证据：[loading snapshot L5-L6](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/snapshots/codex_tui__history_cell__tests__mcp_inventory_loading_snapshot.snap#L5-L6)。开启动画时首字符是 activity indicator；关闭动画或 reduced motion 时为 `•`。正文 `Loading MCP inventory` 为 bold，Unicode 省略号 `…` 为 dim；raw transcript 使用三个 ASCII 点 `Loading MCP inventory...`。[`mcp.rs` L667-L714](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/mcp.rs#L667-L714)

### Empty

app-server 返回零个服务时显示：

```text
/mcp

🔌  MCP Tools

  • No MCP servers configured.
    See the MCP docs to configure them.
```

`No MCP servers configured.` 为 italic；第二行 dim，`MCP docs` underlined 并链接到官方文档。证据：[`mcp.rs` L326-L344](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/mcp.rs#L326-L344)。

### Inventory Failure

RPC 失败时先清除 loading cell，再调用统一 error cell，准确消息前缀为：

```text
■ Failed to load MCP inventory: <error>
```

整行 red。处理顺序和字串见 [`background_requests.rs` L714-L747](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/app/background_requests.rs#L714-L747)，error cell 样式见 [`notices.rs` L225-L231](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/notices.rs#L225-L231)。

单个服务状态为 `failed` 时，inventory 只显示红色 `failed`，不显示 startup error、重试次数或失败原因；这些数据不是该 UI 的逐服务 metadata。

## Wrapping and Indentation

MCP inventory 先构造完整逻辑行，`PlainHistoryCell` 自身忽略传入宽度，不对工具、resource 或 URI 做 MCP 专用拆行。[`base.rs` L6-L24](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/base.rs#L6-L24)

实际渲染使用固定依赖 ratatui `0.30.2`（[`Cargo.lock` L11749-L11758](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/Cargo.lock#L11749-L11758)）的 `HyperlinkParagraph`；其内部是 `Paragraph.wrap(Wrap { trim: false })`，即按词换行、保留原逻辑行开头的 whitespace；超长单词仍会拆分以适应 viewport。[`terminal_hyperlinks/paragraph.rs` L14-L46](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/terminal_hyperlinks/paragraph.rs#L14-L46) `trim: false` 不等于 hanging indent：首段保留 `  ` 或 `    `，续行从第 0 列开始，不重复服务子项的四空格前缀。Codex 没有为 inventory 提供 continuation prefix。

固定 snapshots 只比较 renderer 产生的逻辑行：connection-state tests 调用 `display_lines(100)`，[`mcp_tests.rs` L38-L44](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/mcp_tests.rs#L38-L44)；status-only 和 verbose tests 均调用 `display_lines(120)`，[`history_cell/tests.rs` L984-L1059](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/history_cell/tests.rs#L984-L1059)。由于 `PlainHistoryCell` 忽略 width，这些不是实际窄宽 wrap tests。独立 Pi 对照应在 120 列断言 canonical header/空行，再单独覆盖 24、40、80 列；当前 Pi `wrapTextWithAnsi()` 同样按词换行、保留首行原始缩进且不给续行添加 hanging indent，可以直接承接 Codex 的逻辑行。具体终端字体和 emoji 宽度仍未由官方 `/mcp` snapshot 核实。

## Startup UI Difference

启动 UI 与 `/mcp` inventory 是两个不同界面，不应混用：

- 启动期间在底部 status header 显示单服务 `Booting MCP server: <name>`，多服务显示 `Starting MCP servers (<completed>/<total>): <starting names>`；服务名排序，最多列出 3 个，更多时追加 `…`。证据：[`mcp_startup.rs` L14-L22](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/mcp_startup.rs#L14-L22)、[L143-L175](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/mcp_startup.rs#L143-L175)
- 固定 snapshot 的完整单服务 status line 为 `• Booting MCP server: alpha (0s • esc to interrupt)`，位于 composer 上方，而不是 `/mcp` 的 transcript inventory。[startup snapshot L5-L11](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/snapshots/codex_tui__chatwidget__tests__mcp_startup_header_booting.snap#L5-L11)
- startup 失败会另发 warning，例如 `MCP startup incomplete (failed: ...)`；取消则为 `MCP startup interrupted. The following servers were not initialized: ...`。[`mcp_startup.rs` L185-L204](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/chatwidget/mcp_startup.rs#L185-L204)
- `/mcp` 是用户触发的异步 inventory：短暂显示 `Loading MCP inventory…`，然后把 compact 或 verbose 结果写入 history。它不是启动进度动画，也不显示 elapsed time 或 `esc to interrupt`。

最初的对照只覆盖 `/mcp`。用户随后明确要求复刻启动过程，因此方案四新增独立启动重放，前三种方案保持不变。

## Prototype Mapping

当前 Pi 原型的 `Server` 只有 `connected`、`status`、`tools`、`attempt`、`lastError`。制作独立 Codex 对照 renderer 时，建议保留现有三种实验方案不动，新增 Codex 专用 view model 和 fixture，避免把缺失字段伪装成已核实数据。

| Existing Pi fixture | Codex display mapping | Limitation |
| --- | --- | --- |
| `connected === true` | `connected` | 可以直接映射；工具计数应按去重后的 tool name 计算 |
| `status === connecting` | `starting` | 接近但不是同一协议枚举 |
| `status === retrying` | 最多近似 `starting` | 官方 `/mcp` 没有 `retrying`、attempt 或重试原因 |
| `status === offline` | `failed` | 官方 detail 不显示 `lastError` |
| `tools[].name` | 排序后用于 count 或 verbose `Tools:` | Codex 使用服务返回的工具 map keys；fixture 名称可用于视觉对照 |
| `attempt`, `lastError` | 不显示 | 保留给其他三种方案，不进入 Codex 对照 |
| 无 Auth 字段 | Codex 专用 fixture 显式设为 `Unsupported` 等 | 不可由连接状态推导 |
| 无 Resources/templates | Codex 专用 fixture 显式设为空或示例值 | 空值应分别显示两个 `(none)` 行 |

还应补齐 Codex 的完整状态集合：`connected`、`starting`、`authentication required`、`failed`、`not started`、`disabled`、`cancelled`、`unknown`。服务排序必须在 Codex renderer 内执行；当前 fixture 顺序不能作为官方顺序依据。

## Implementation Landing

按当前实验目标，Codex 对照应作为独立第 4 种方案接入，而不是改写既有方案：

- `/mcp-ui 4` 和 `/mcp-ui codex` 选择 `codex` variant；已有 `/mcp-ui 1|2|3` 的 renderer、widget、详情切换和启动重放逻辑保持不变。
- 选择 Codex variant 时停止尚未完成的 fixture replay，并移除/不设置 `mcp-prototype-panel` widget；官方 `/mcp` 是 history inventory，不应把长列表长期挤在 composer 上方。
- 立即通过现有 `appendEntry("mcp-ui-prototype", ...)` 路径写入静态 Codex snapshot，让它进入真实 Pi transcript。Codex 的 compact 和 verbose 两种输出都应走 entry 路径；entry 仍按原型约定不进入模型上下文。
- Codex 专用 renderer 接受 detail mode：compact 复刻默认 `/mcp` 的状态/工具计数摘要；verbose 复刻 `/mcp verbose` 的 `Auth / Tools / Resources / Resource templates` 长详情。长详情只进入 transcript，不成为 status widget。
- `renderPanel()` 应在通用 minimal/progress 分支之前单独分派 `variant === "codex"`，例如调用纯函数 `renderCodexInventory(detail)`；不要让 Codex variant 落入当前 generic minimal renderer。
- Codex renderer 负责排序并输出逻辑行；现有 entry renderer 再使用 Pi 的 `wrapTextWithAnsi()` 和 `truncateToWidth()` 适配真实 transcript 宽度。不要人为改成表格或把 metadata 截成摘要。
- `/mcp-play` 在 Codex variant 下播放独立启动状态行，临时挂载在输入框上方；结束后移除。`/mcp-details` 仍只追加 verbose inventory，两种 UI 不混用。
- `/mcp-ui compare` 可以继续追加四个静态 entry，其中第 4 个是详细 Codex inventory；前三个结果及其顺序不变。

第 4 方案实现 compact 与 verbose 两个纯 transcript 模式；默认 `/mcp` 对应 compact、显式 `verbose` 或 detail action 对应长详情。两种详情模式不新增常驻 widget；启动状态行只在独立 replay 期间存在。

## Startup motion implementation

新增核验同一固定提交的 [status_indicator_widget.rs](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/status_indicator_widget.rs)、[motion.rs](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/motion.rs) 和 [shimmer.rs](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/tui/src/shimmer.rs)：

- 原生状态行组合 activity indicator、shimmer header、耗时与 interrupt hint；长行截断，不增加多行服务表。
- native 调度间隔为 32ms；shimmer 周期为 2 秒。truecolor 环境使用 RGB 混色；非 truecolor 的指示符每 600ms 在 `•` 和 dim `◦` 之间交替。它不是常见的旋转字符 spinner。
- MCP 标题中的 completed 计数是所有非 Starting 状态的数量，不仅是成功数量。只剩一个待启动服务时，若总数大于一，仍使用多服务标题。
- 原型采用固定 fixture 事件和 50ms UI 重绘，近似圆点亮度变化与灰阶扫光，没有复制原生终端 palette 探测与混色算法。`/mcp-play single` 与 `/mcp-play failed` 分别验证单服务标题和失败结束。
- Escape 中断只影响原型内存状态，后续 inventory 显示 `cancelled`。完成、取消、切换方案/场景、重新播放或 session shutdown 时均清理动画、状态计时器和键盘监听。
- 未复刻真实 app-server startup 事件丢失、缓冲下一轮、queued input 等生产生命周期；这不是连接可靠性实验。

## Test Match Points

实现测试应把 layout 与窄宽 reflow 分开验证：

1. 在 120 列先断言 logical layout。无论调用入口是 `/mcp` 还是 `/mcp verbose`，history cell 第一行都回显精确字串 `/mcp`，随后依次为一条空行、`🔌  MCP Tools`、一条空行。
2. compact 服务行彼此紧邻，中间没有空行；全部服务后恰有一条空行，再显示 dim footer。header、状态集合和排序可直接对齐官方 100 列 connection-state snapshot。
3. verbose 每个服务后追加一条空逻辑行，因此服务之间有一空行；没有 compact footer。最后一个服务也有 trailing empty logical line，文本 snapshot 的文末换行不适合判断这一点，应直接断言 renderer line array。
4. verbose 的顺序测试至少使用 `MultiFetch`、`context7`、`exa`、`mysql`，期望大小写敏感结果为 `MultiFetch`、`context7`、`exa`、`mysql`；工具名也放入逆序 fixture，验证 renderer 排序。
5. 另在 24、40、80 列验证每条输出不超过可见宽度、ANSI 样式跨行保持、原始首行 2/4 空格保留、续行没有自动四空格 hanging indent。120 列 snapshot 用于比对官方 canonical 文本，不代表官方已经测试过该宽度的实际 viewport wrapping。
6. 分别断言 semantic style：server marker 与 status label 相同；server name bold；count dim；neutral statuses dim-only；success/failure 在 Pi theme 映射到 success/error。由于 Codex 会按 palette 降级，Pi 测试不应硬编码其底层 ANSI 色号来声称像素级一致。

## License

`openai/codex` 该固定提交根目录的 [`LICENSE`](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/LICENSE#L1-L8) 明确为 **Apache License 2.0**。如果只是按事实复刻布局和字串，仍应在本笔记保留出处；若以后直接复制实质性源码，应遵守 Apache-2.0 的版权、许可证和 NOTICE 要求。

## Verification Limits

- 已核实：固定 tag/commit、标题、字串、空行和缩进、服务与工具排序、字段顺序、状态映射、semantic styles、loading/empty/RPC error、普通与 verbose 分发、启动 UI 的区别、仓库许可证。
- 未核实：真实用户配置下的动态输出、真实 MCP 返回的 Resources/templates 顺序、不同终端对 emoji 和 activity indicator 的实际宽度、窄终端续行截图、终端 palette 探测后的最终 RGB/ANSI 转换。
- snapshot 输出不保留 ANSI，因此颜色结论来自同一固定提交的 renderer/style 源码，而不是截图取色。
- 没有使用 `main` 的行为补全任何 0.153.4 结论；未来版本可能改变字段和布局。
