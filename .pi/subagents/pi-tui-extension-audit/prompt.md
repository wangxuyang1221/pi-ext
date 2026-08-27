# Task

调查 Pi extension API 对 TUI 的可定制范围，列出 extension 能新增、替换或定制样式的界面区域与组件。

行动前完整读取：

- `/Users/wangxuyang/.agents/skills/wangxuyang/investigate/SKILL.md`
- `/Users/wangxuyang/Code/t3code/pi-ext/docs/agents/repository-language-policy.md`
- `/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.3/09befb10f2a2fa758010e8552a2160f1c25d5e3ec1c7aa49969903f49d96754e/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
- `/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.3/09befb10f2a2fa758010e8552a2160f1c25d5e3ec1c7aa49969903f49d96754e/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`

你是 leaf subagent。不得创建、调用或委派任何 subagent。亲自完成该研究线索。

只使用一手资料，包括本机已安装 Pi 0.84.3 的完整文档、examples 和源码，pi.dev 官方文档及官方仓库源码。相关 `.md` 必须完整读取并继续读取与 TUI API 有关的交叉引用。需要时可做隔离、可清理的实验。不要修改项目正式源码。

逐项核实并给出最小 API 示例或准确签名：

- custom UI 和 overlay，可定位、尺寸、焦点、生命周期及任意 ANSI 样式能力。
- widgets，status，working indicator，footer，editor component。
- tool 的 `renderCall`、`renderResult`，extension/custom messages，通知或对话框等。
- 可复用的内置 TUI 组件，例如 Text、Box、Markdown、SelectList、SettingsList、Input、Editor、Image，以及可用的样式回调。
- 每项是新增、局部替换还是全局替换，作用时长和恢复方式。

把结果写入 `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/docs/research/pi-tui-extension-customization.md`。遵守仓库语言政策，标题和 section headings 用 English，正文用中文。每项主要主张附文件路径加行号或官方 URL。文档结构至少包含 `Scope`、`Evidence Pack`、`API Matrix`、`Styling Model`、`Examples`、`Limits`、`Open Questions`。

完成后只回复文档路径、关键结论和未决问题，不复制完整调查过程。