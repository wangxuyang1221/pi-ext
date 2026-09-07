# Codex CLI diff highlighting

## Scope and revision

核验日期为 2026-09-07。通过 Exa 定位 [OpenAI 官方仓库](https://github.com/openai/codex)，再读取固定 commit 的源码。本文的“当前”指查询时官方 `main` 返回的 [`694b6319d3ad2399f6e435760a22d9b9357f0697`](https://github.com/openai/codex/commit/694b6319d3ad2399f6e435760a22d9b9357f0697)，提交时间为 `2026-09-07T04:59:12Z`，不等于用户本机版本，也不宣称是最新正式版。

主要对象是 Rust TUI 的文件编辑 diff，即 `create_diff_summary → render_changes_block → render_change`。另有两个入口不能混同。

- `Renderable for FileChange` 明确传入 `lang = None`，这条入口没有代码语法高亮。[入口源码][entry]
- `/diff` 的 Git 数据生成路径执行 `git diff --color`，未跟踪文件使用 `--no-index`，不是本文的 `FileChange` 语法高亮流程。未继续核验该命令的最终显示组件。[Git diff 源码][git-diff]

## Main flow

1. 按文件路径排序，汇总增删行数，生成文件标题。重命名时用目标路径识别语言，然后给代码区预留四列缩进。[文件块渲染][blocks]
2. 新建和删除文件把完整 `content` 交给高亮器。更新文件先用 `diffy::Patch::from_str` 解析 unified diff，再逐 hunk 高亮。[变更渲染][changes]
3. 高亮器生成每个源代码行的 Ratatui spans。渲染器添加行号、`+` / `-` / 空格，组合 diff 背景与语法前景，最后按显示列宽硬换行。[样式组合][compose]

锁定依赖为 `syntect 5.3.0`、`two-face 0.5.1`；`two-face` 提供语法和主题，TUI 启用 `syntect-default-onig`。unified diff 解析使用 `diffy 0.4.2`。这不是 Tree-sitter 高亮流程。[TUI 依赖声明][tui-deps]、[syntect 锁定版本][syntect-lock]、[two-face 锁定版本][two-face-lock]、[diffy 锁定版本][diffy-lock]、[语法集合初始化][syntax-init]

## Language selection

文件 diff 的第一步只取 `Path::extension()`。没有扩展名就没有语言参数，不读取 shebang，不按完整文件名识别 `Dockerfile`，也没有代码内容自动检测。重命名时取目标扩展名。[路径识别][blocks]

扩展名随后进入 `find_syntax`。它修补少量别名，再依次尝试 token、精确语法名、忽略大小写的语法名和原始扩展名。显式别名包括 `cu/cuh → cpp`、`cppm/cxxm/ixx → cpp`、`golang → go`、`python3 → python`、`shell → bash`、`csharp/c-sharp → c#`。不应把这段别名列表误认为完整语言列表，其余由 two-face 的语法集合解析。[语法查找][lookup]

未知扩展名或无扩展名会退回普通 diff 配色，保留行号、增删符号和 diff 背景，不会让整个 diff 消失。高亮解析失败也返回 `None`，走同样路径。[高亮核心][highlight-core]、[普通 diff 路径][compose]

## Parsing state

| Change | Highlighting unit | State |
| --- | --- | --- |
| Add | 整个文件的 `content` | 同一次调用内逐行复用一个 `HighlightLines`，跨行保留状态 |
| Delete | 整个文件的 `content` | 与 Add 相同 |
| Update | 每个 hunk 的行文本拼成一个字符串 | 同 hunk 跨行保留状态，不跨 hunk 保留 |

证据是高亮核心在循环外创建 `HighlightLines::new`，循环内用同一个实例调用 `highlight_line`；`Update` 在 hunk 循环里分别调用该核心。官方还提供 `update_diff_preserves_multiline_highlight_state_within_hunk` 测试，比较跨行字符串的实际 token 样式。[高亮核心][highlight-core]、[hunk 调用][changes]、[跨行测试][state-test]

这个实现有两个边界。

- hunk 文本按 diff 顺序拼接 context、delete、insert 行，删除和新增内容共用同一个解析状态，不是分别重建旧文件、新文件后高亮。因此不能声称它等价于完整文件语法解析。
- 每个 hunk 从初始状态开始。如果 hunk 开头位于此前已打开的注释或多行字符串内部，缺失的文件前文不会自动恢复。源码注释说 context 边界会重新同步，但代码没有验证这种同步一定成立。

以上是从实际调用方式推导的限制。另有行数一致性检查，高亮结果行数不等于 hunk 行数时，整个 hunk 回退普通 diff 配色。[hunk 拼接与校验][changes]

## Colors and dimming

语法颜色与 diff 颜色分开处理。syntect token 转换保留前景和 bold，忽略 token 背景、italic、underline；因此 diff 行背景不会被语法主题的普通代码背景覆盖。默认语法主题根据终端背景选浅色 `catppuccin-latte` 或深色 `catppuccin-mocha`，也支持主题覆盖。[token 转换][conversion]、[默认主题][themes]

| Region | Add | Delete | Context |
| --- | --- | --- | --- |
| 符号 | named Green 的 `+` | named Red 的 `-` | 空格，默认样式 |
| 有语法高亮的正文 | token 前景，不强制全绿 | token 前景，额外加 `DIM` | token 前景，不额外 dim |
| 无语法高亮的正文 | 深色主题为绿；浅色丰富色模式用默认前景；ANSI-16 为绿 | 深色主题为红；浅色丰富色模式用默认前景；ANSI-16 为红，不额外 dim | 默认前景 |
| 行背景 | 新增底色 | 删除底色 | 不设置 |

深色主题的行号栏 dim。浅色主题的 add/delete 行号使用深色前景与较浓底色，ANSI-16 不加底色；context 行号仍 dim。删除正文的 dim 仅在有语法 spans 的分支追加，不能概括成所有删除行均 dim。[正文与符号组合][compose]、[配色辅助函数][styles]

无主题 diff scope 覆盖时的固定背景如下，数值以常量为准。

| Palette | Add line | Delete line | Light add/delete gutter |
| --- | --- | --- | --- |
| 深色 truecolor | `#213A2B` | `#4A221D` | 不适用 |
| 浅色 truecolor | `#DAFBE1` | `#FFEBE9` | `#ACEEBB` / `#FFCECB` |
| 深色 ANSI-256 | index `22` | index `52` | 不适用 |
| 浅色 ANSI-256 | index `194` | index `224` | index `157` / `217` |

该文件顶部注释仍写旧深色值 `#212922` / `#3C170F`，与实际常量不同，不能照抄注释。[调色板常量][palette]

活动主题定义的 `markup.inserted` / `markup.deleted` 背景优先于固定行底色，没有时再查 `diff.inserted` / `diff.deleted`。ANSI-256 把主题 RGB 量化到固定索引 `16..255` 中感知距离最近的颜色；ANSI-16 忽略这些背景。浅色行号底色仍由自己的固定调色板决定。[scope 提取][scope-bg]、[背景解析][backgrounds]、[行号样式][styles]

此渲染流程没有字符级或词级差异计算，也没有单独突出一行内具体变动字符。不同 token 颜色属于语法高亮，不能当成 intraline diff。依据是 `render_change` 只分派 Insert/Delete/Context，正文直接使用源文本或语法 spans；组合阶段仅追加整行类别的样式。[变更渲染][changes]、[样式组合][compose]

## Fallbacks and layout

- 终端色深来自 `supports_color::on_cached(Stdout)`。diff 自己把 Unknown 降为 ANSI-16，而不是完全无色；ANSI-16 移除 diff 背景，保留红绿符号和普通正文前景。`WT_SESSION` 存在且没有 `FORCE_COLOR` 时提升为 truecolor；其他被识别为 Windows Terminal 的 ANSI-16 会话也有提升规则。终端背景查询失败则选深色 diff 配色。[色深探测][terminal]、[diff 终端规则][color-level]
- 不能据此说“所有语法 token 自动降为 16 色”。`convert_syntect_color` 对普通主题直接产生 RGB，未按终端色深量化；ANSI 系列主题通过 alpha 标记产生 named/indexed 颜色或默认前景。这里只确认 diff 底色的降级规则，不保证所有终端的最终显示，也未核验 `NO_COLOR` 的端到端行为。[token 转换][conversion]
- 单次高亮超过 `512 * 1024` bytes、`10_000` 行，或任一行超过 `4 * 1024` bytes，就关闭该次语法高亮。Update 还先检查所有 hunk 的合计 bytes/行数，合计超限会关闭整个 patch 的语法高亮。阈值不是显示截断上限，普通 diff 仍会生成。[限制与核心][highlight-core]、[Update 合计检查][changes]
- 本渲染器没有“只显示前 12 行”的规则。Add/Delete 遍历全部内容行；Update 遍历输入 patch 的全部 hunk 行，不自行补全整个文件或额外裁剪 context。hunk 之间显示 dim 的 `⋮`。[变更渲染][changes]
- 主文件块预留四列缩进，内部再预留最大行号位数、一列空格和一列符号。内容可用宽度为 `max(1, width - gutter_width - 2)`，其中 `width` 已扣除四列外层缩进。长行按 Unicode 显示宽度硬换行，保留 spans 样式；续行不重复行号和符号。tab 替换为四个空格。极窄宽度仍保证至少消费一个字符，不保证前缀本身一定装得下。[外层宽度][blocks]、[组合与换行][compose]、[换行实现][wrap]、[tab 常量][palette]

## Local codex-ui comparison

本节补入本仓库可直接核验的对应实现。基线为本地 HEAD `0f42559521ebbce37e7057b309f27b00fec4ec15`，但 `tools.ts` 在核验时已有未提交修改，因此描述的是当时工作树，不应视为该 commit 的固定内容。

| Topic | Official Codex CLI | Local codex-ui |
| --- | --- | --- |
| 高亮库 | syntect 5.3.0 + two-face 0.5.1 | 宿主直接使用 highlight.js 10.7.3，不是旧文档所写的 cli-highlight |
| 语言入口 | 原始扩展名，再交 two-face 查找 | 宿主 `getLanguageFromPath(path)` 使用静态后缀映射 |
| 高亮单位 | Add/Delete 整文件，Update 整 hunk | 编辑 diff 每行独立调用 `highlightCode(line.text, language)[0]` |
| 跨行状态 | 同一文件调用或同 hunk 内保留 | 本扩展未传递解析状态，也未把相邻行拼成块；缓存保存逐行结果，不是 parser state |
| 代码前景 | 语法 token 色；无高亮时受 diff 类别、浅深主题影响 | 语法结果套 `toolDiffContext` 默认前景，增删符号单独用 ANSI named 红绿 |
| 背景 | 终端浅深、色深与语法主题 diff scope 决定 | 使用宿主主题 `toolSuccessBg` / `toolErrorBg` |
| 删除 dim | 仅语法 spans 正文追加 dim | removed 正文一律包 dim，行号也 dim |
| 行数与长行 | 本渲染器不做固定行数裁剪，长行硬换行 | 默认取前 12 条 display diff 行，展开取全部；宽度超出时截断，不硬换行 |

本地 diff 输入由 [`parseDisplayDiff` / `parseUnifiedPatch`](../../extensions/codex-ui/src/tools.ts#L497-L560) 解析。显示、折叠与逐行缓存的依据为 [`renderDisplayDiff`](../../extensions/codex-ui/src/tools.ts#L563-L608)、[`renderEditResult`](../../extensions/codex-ui/src/tools.ts#L848-L883) 和 [`layout.ts` 的宽度/背景函数](../../extensions/codex-ui/src/layout.ts#L29-L54)。context 不加 diff 背景；没有字符级差异强调。`cache.prefix` 重用每行高亮结果，不保留跨行解析状态。

宿主的补充核验覆盖本地 Pi `0.84.3` 和运行环境 `0.85.1`，两者 `dist/utils/syntax-highlight.js` 字节相同，均直接使用 `highlight.js 10.7.3`。依赖依据为 [`package.json`](../../package.json)、[`pnpm-lock.yaml`](../../pnpm-lock.yaml)，执行路径依据为安装后的 [`syntax-highlight.js`](../../node_modules/@earendil-works/pi-coding-agent/dist/utils/syntax-highlight.js) 与 [`theme.js`](../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js#L963)。`node_modules` 链接只在安装依赖后的本地检出中可用。

语言识别是路径后缀静态映射，`.ts/.tsx → typescript`，`.js/.mjs/.cjs/.jsx → javascript`，还覆盖 Python、Java、Go、Rust、JSON、YAML、SQL 等常见扩展名。`.vue`、`.svelte` 不在该映射中。未知语言不会自动猜测。只读脚本已核对常见后缀的实际返回结果，并确认多行注释里的 `const` 在逐行高亮与整块高亮下出现不同着色。这是状态缺失的可观察差异，不只是调用方式不同。

默认 [`themes/codex-pi.json`](../../themes/codex-pi.json) 的新增背景是 `#213a2b`，删除背景是 `#4a221d`，代码默认前景是 `#cdd6f4`。这两种背景与当前官方深色 truecolor 固定背景相同。各语言共用 `syntaxKeyword`、`syntaxString` 等主题 tokens，语言决定 token 分类，不为每种语言另换一套配色。普通正文回退到 `toolDiffContext`，不是统一染成增删红绿。

低功耗模式另走 [`tools.ts` 的 raw patch 预览分支](../../extensions/codex-ui/src/tools.ts#L813-L845)，只显示有限原始 patch，不做语法高亮，不能套用上表的正常编辑 diff 行为。

直接结论是两者视觉上都把语法前景叠在增删背景上，默认深色 diff 底色也一致，但语言映射、高亮引擎和状态单位不同。当前官方 Update 已是 hunk 级高亮；本地仍是逐行调用。比较多行注释或多行字符串时，应先看这个差异。官方 hunk 混合旧、新行且不恢复 hunk 前文，仍有上文列出的解析限制。

## Verification limits

本次只读源码及已有测试，没有运行 Codex、终端截图或性能基准，也没有构建上游仓库。Context7 返回的 syntect 文档未固定到 5.3.0，因此最终行为判断以 Codex 固定 commit 的调用代码和测试为准，而非借用第三方最新文档作版本证据。Exa 正文提取会压缩源码空格，缩进和 tab 数值已另读 raw 源码确认。

未核验用户安装版与上述 commit 的对应关系、所有主题在具体终端上的可读性、终端对 dim 的实际表现、所有界面的外层 viewport 限制。本文仅写研究笔记，未修改生产源码。

[entry]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/diff_render.rs#L298-L357
[blocks]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/diff_render.rs#L369-L482
[changes]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/diff_render.rs#L484-L744
[compose]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/diff_render.rs#L848-L948
[wrap]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/diff_render.rs#L950-L1041
[color-level]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/diff_render.rs#L1043-L1129
[styles]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/diff_render.rs#L1153-L1317
[palette]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/diff_render.rs#L10-L78
[backgrounds]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/diff_render.rs#L201-L296
[state-test]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/diff_render.rs#L2522-L2558
[syntax-init]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/render/highlight.rs#L26-L71
[themes]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/render/highlight.rs#L194-L234
[lookup]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/render/highlight.rs#L535-L579
[conversion]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/render/highlight.rs#L456-L533
[highlight-core]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/render/highlight.rs#L581-L641
[scope-bg]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/render/highlight.rs#L273-L315
[terminal]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/terminal_palette.rs#L6-L31
[tui-deps]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/Cargo.toml#L121-L122
[syntect-lock]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/Cargo.lock#L14969-L14972
[two-face-lock]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/Cargo.lock#L16071-L16074
[diffy-lock]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/Cargo.lock#L6174-L6177
[git-diff]: https://github.com/openai/codex/blob/694b6319d3ad2399f6e435760a22d9b9357f0697/codex-rs/tui/src/get_git_diff.rs#L64-L122
