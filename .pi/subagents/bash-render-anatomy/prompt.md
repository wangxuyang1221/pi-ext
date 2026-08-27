# Task

解剖 Pi 0.84.3 中截图所示 Bash tool call block 的实际渲染链，逐项确认每个可见部分由哪段源码、哪个 component、哪个 theme token 或硬编码规则生成。

你是 leaf subagent。不得创建、调用或委派任何 subagent，亲自完成这条研究线。

行动前完整读取：

- `/Users/wangxuyang/.agents/skills/wangxuyang/investigate/SKILL.md`
- `/Users/wangxuyang/Code/t3code/pi-ext/docs/agents/repository-language-policy.md`
- `/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.3/09befb10f2a2fa758010e8552a2160f1c25d5e3ec1c7aa49969903f49d96754e/node_modules/@earendil-works/pi-coding-agent/docs/themes.md`

`docs/themes.md` 必须完整读取，并继续读取其中与 Bash/tool rendering 有关的 Markdown 交叉引用。使用本机 Pi 0.84.3 的官方源码、发布 types 和 examples作为一手资料。任务涉及具体第三方 API，按项目规则尝试通过 Context7 解析 `@earendil-works/pi-coding-agent`；若缺少该 fork/version，记录限制并以本机版本化源码为准。

用户截图：

`/var/folders/pc/2s8cc_fn3fz6j0x9qwnqx2k00000gn/T/pi-clipboard-664b7552-eee9-4364-90c7-8e6fd98066f7.png`

当前仓库 commit 为 `8327925`。本次只调查，不修改正式源码、测试、配置、commit 或远端。可以在临时目录做可清理的渲染实验。

追踪并记录：

1. 从 tool call/result 数据进入 TUI，到最终 `Component.render(width)` 的完整控制流。区分 built-in `bash` tool、通用 `ToolExecutionComponent`、专用 renderer，以及 `!` interactive bash 的 `BashExecutionComponent`。
2. 截图中的可见元素逐项归属：绿色整块背景、上下/左右 padding、`$` glyph、command 文本、bold/dim 样式、`(timeout 30s)`、空行、`... (11 earlier lines, ctrl+o to expand)`、stdout 行、ANSI 保留或清理、截断与换行、可能的 duration/exit/error 表示。
3. 折叠算法的行数/字节阈值、保留 head 还是 tail、expanded 切换来源、partial streaming 时的行为。不要只引用文案，追到拥有该规则的源码。
4. 哪些视觉属性来自 `toolPendingBg`、`toolSuccessBg`、`toolErrorBg`、`toolTitle`、`toolOutput`、`muted` 等 theme token，哪些是 hardcoded layout、glyph、copy 或状态机。
5. 内建 renderer 返回的 component 与 host outer Box 的边界。指出一个 custom renderer 即使完全替换 inner content 后，host 仍会包住什么。
6. 对每个可见元素给出“theme 可改 / public renderer 可改 / 需要替换整个 tool / 仅内部 hack 可改”的证据化分类。

结果写入：

`/Users/wangxuyang/Code/t3code/pi-ext/.scratch/docs/research/pi-bash-block-rendering-anatomy.md`

遵守仓库语言政策：document title 和 section headings 用 English，正文用中文，code blocks 保持源码语言。主要主张必须附本机文件绝对路径加行号，或官方一手 URL。文档至少包含 `Scope`、`Evidence Pack`、`Rendering Anatomy`、`Synthesis`、`Customization Matrix`、`Design Implications`、`Open Questions`。

完成后只回复研究文档路径、关键结论和未决问题，不复制调查过程。