# Task

调查 Pi TUI 的主题定制能力，重点回答内置界面中哪些视觉属性可由 theme JSON 改动，哪些不能。

行动前完整读取：

- `/Users/wangxuyang/.agents/skills/wangxuyang/investigate/SKILL.md`
- `/Users/wangxuyang/Code/t3code/pi-ext/docs/agents/repository-language-policy.md`
- `/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.3/09befb10f2a2fa758010e8552a2160f1c25d5e3ec1c7aa49969903f49d96754e/node_modules/@earendil-works/pi-coding-agent/docs/themes.md`

你是 leaf subagent。不得创建、调用或委派任何 subagent。亲自完成该研究线索。

只使用一手资料，包括本机已安装 Pi 0.84.3 的完整文档和源码、pi.dev 官方文档、官方仓库源码。相关 `.md` 必须完整读取并继续读取其中与主题有关的交叉引用。需要时可做隔离、可清理的实验。不要修改项目正式源码。

查明并记录：

1. theme JSON 的全部 token 分组及每组具体影响的内置组件或状态。
2. 颜色值、热重载、主题来源与选择机制。
3. 主题不能控制的属性，例如布局、边框字符、间距、字体、动画、组件结构等，必须有源码或文档依据，不要凭猜测。
4. installed 0.84.3 与当前官网文档如有差异，明确区分。

把结果写入 `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/docs/research/pi-tui-theme-customization.md`。遵守仓库语言政策，标题和 section headings 用 English，正文用中文。每项主要主张附文件路径加行号或官方 URL。文档结构至少包含 `Scope`、`Evidence Pack`、`Synthesis`、`Customization Matrix`、`Limits`、`Open Questions`。

完成后只回复文档路径、关键结论和未决问题，不复制完整调查过程。