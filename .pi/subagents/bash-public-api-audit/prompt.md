# Task

调查 Pi 0.84.3 中截图所示 Bash tool call block 的稳定公开定制能力。重点是 extension 作者可以通过哪些 public API 定制它，以及不能定制什么。

你是 leaf subagent。不得创建、调用或委派任何 subagent，亲自完成这条研究线。

行动前完整读取：

- `/Users/wangxuyang/.agents/skills/wangxuyang/investigate/SKILL.md`
- `/Users/wangxuyang/Code/t3code/pi-ext/docs/agents/repository-language-policy.md`
- `/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.3/09befb10f2a2fa758010e8552a2160f1c25d5e3ec1c7aa49969903f49d96754e/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`

`docs/extensions.md` 必须完整读取，并继续读取其中与 tool registration、custom tool rendering、built-in tools 和 TUI components 相关的 Markdown 交叉引用。优先使用本机 Pi 0.84.3 官方文档、types、examples 和源码。任务涉及具体第三方 API，按项目规则尝试通过 Context7 解析 `@earendil-works/pi-coding-agent` 并查询与 0.84.3 匹配的 tool rendering 文档；若 Context7 没有该 fork/version，明确记录后以本机版本化一手资料为准。

用户截图：

`/var/folders/pc/2s8cc_fn3fz6j0x9qwnqx2k00000gn/T/pi-clipboard-664b7552-eee9-4364-90c7-8e6fd98066f7.png`

当前仓库 commit 为 `8327925`。本次只调查，不修改正式源码、测试、配置、commit 或远端。可以在临时目录做可清理实验。

回答以下问题：

1. 先确认截图属于 agent 调用的 built-in `bash` tool，还是 `!` interactive bash command，二者定制入口是否不同。
2. public extension API 能否分别接管 command header、timeout metadata、stdout/stderr 内容、折叠提示、expanded 状态下的展示、结果摘要，以及 inner component 的宽度渲染。
3. 覆盖同名 `bash` tool renderer 时，是否同时替换执行定义；如何基于 `createBashToolDefinition()` 或其他官方工厂委托执行并完整保留 metadata、abort、timeout、cwd、partial streaming 等语义。
4. host 仍然控制哪些外层行为，例如 pending/success/error background、padding、工具生命周期、全局 expand toggle、快捷键和 result state。
5. theme JSON、settings、keybindings、custom UI、tool renderer 各自能改到哪一层。明确 stable public API 与内部源码 hack 的边界。
6. 给出按能力分级的 customization matrix。每项说明“直接支持 / 可通过替换 built-in tool 实现 / 只能改颜色或设置 / 无稳定入口”，并写明代价。

结果写入：

`/Users/wangxuyang/Code/t3code/pi-ext/.scratch/docs/research/pi-bash-block-public-customization.md`

遵守仓库语言政策：document title 和 section headings 用 English，正文用中文，code blocks 保持源码语言。主要主张必须附本机文件绝对路径加行号，或官方一手 URL。文档至少包含 `Scope`、`Evidence Pack`、`Synthesis`、`Customization Matrix`、`Design Implications`、`Open Questions`。

完成后只回复研究文档路径、关键结论和未决问题，不复制调查过程。