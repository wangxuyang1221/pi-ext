# Codex CLI tool summary rendering

## Scope

对比当前原型讨论中的 MCP 成功摘要与 Write 展示。研究对象是官方 `openai/codex` 仓库本次查询时的 `main`，固定到提交 `32351a7b1ae3d6106fb2b7adccfbd6051e375ce6`，不代表用户本机安装版本或最新稳定发布版。只检查源码，未启动 Codex CLI。

## MCP

官方 `McpToolCallCell::render_lines` 的常规展示如下。[source](https://github.com/openai/codex/blob/32351a7b1ae3d6106fb2b7adccfbd6051e375ce6/codex-rs/tui/src/history_cell/mcp.rs)

- 成功圆点 `•` 为绿色加粗；失败圆点为红色加粗；进行中为活动指示器。
- 标题是加粗 `Calling` / `Called`，不是整行绿色。服务名和工具名为青色，参数为 dim 的紧凑 JSON。
- 没有 `Completed · Text · 1.7 KB` 这类成功元数据行，也没有逐行 expand 提示。
- 正常结果直接展示 dim 的内容预览，首行前缀为 dim 的 `  └ `，后续缩进四列。内容为空时不增加结果行。
- 调用标题放不下时，`Called` 留在首行，完整调用移到分支行并自适应换行，不是固定单行省略。
- 传输错误正文包含 `Error: ...`，正文仍 dim，红色主要放在圆点。不能概括为错误正文全部红色。

`McpContentBlock::render` 按结果块调用截断函数。[source](https://github.com/openai/codex/blob/32351a7b1ae3d6106fb2b7adccfbd6051e375ce6/codex-rs/tui/src/history_cell/mcp_result.rs)

`TOOL_CALL_MAX_LINES` 为 5，但这是计算字符预算的参数，不是最终严格五个屏幕行上限。预算为 `5 × 可用宽度 - 5` 个 grapheme，超出用 `...`；JSON 先转换为带分隔空格的单行紧凑格式，再换行展示。多结果块分别处理。[constant](https://github.com/openai/codex/blob/32351a7b1ae3d6106fb2b7adccfbd6051e375ce6/codex-rs/tui/src/exec_cell/render.rs#L33) · [formatting](https://github.com/openai/codex/blob/32351a7b1ae3d6106fb2b7adccfbd6051e375ce6/codex-rs/tui/src/text_formatting.rs)

## Expansion

Codex 使用 `Ctrl+T` transcript overlay，与当前 Pi 原型的 `Ctrl+O` 原地展开不是同一种交互。`McpToolCallCell` 虽然区分 Display / Transcript，但普通 MCP 文本结果在两个模式下仍调用同一截断渲染函数。代码对 Node REPL 类型提供专门的完整文本分支，不能据此说所有 MCP 在 transcript 中都不截断。[MCP renderer](https://github.com/openai/codex/blob/32351a7b1ae3d6106fb2b7adccfbd6051e375ce6/codex-rs/tui/src/history_cell/mcp.rs) · [history contract](https://github.com/openai/codex/blob/32351a7b1ae3d6106fb2b7adccfbd6051e375ce6/codex-rs/tui/src/history_cell/mod.rs)

## File writes

不能把 Pi 的 `write` 和 Codex 的文件变更单元当成相同工具。本次核对的对应展示路径是 patch 文件新增、删除和编辑。

`PatchHistoryCell` 调用 `create_diff_summary`，单文件标题为 `Added` / `Deleted` / `Edited` 加路径和 `(+N -M)`；多文件标题是 `Edited N files (+N -M)`。圆点 dim，动词加粗，只有新增和删除统计分别为绿、红。下方直接展示带行号的 diff 或新增内容，没有额外 `Written` 状态行，也不展示写入字节数。[patch cell](https://github.com/openai/codex/blob/32351a7b1ae3d6106fb2b7adccfbd6051e375ce6/codex-rs/tui/src/history_cell/patches.rs) · [diff summary](https://github.com/openai/codex/blob/32351a7b1ae3d6106fb2b7adccfbd6051e375ce6/codex-rs/tui/src/diff_render.rs#L400-L470)

## Implications for this prototype

以下是设计建议，不是 Codex 源码事实。

- 值得借鉴的是减少重复状态词，让颜色集中在小标记或具有业务意义的增删统计上。
- MCP 不必照搬 Codex 的默认内容预览。保留用户已认可的默认折叠与 Pi `Ctrl+O` 交互更一致。
- Write 不需要为了统一 MCP 结构而保留独立 `Written` 行，可以保留标题、路径和紧凑行数。
- 三个现有变体都不是 Codex 的逐像素复刻。Codex 的 MCP 更接近“标题 + 灰色结果预览”；文件变更更接近“标题内统计 + diff”。

本次没有修改原型或生产渲染代码。
