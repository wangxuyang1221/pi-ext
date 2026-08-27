# Task

从 Pi 0.84.3 的官方源码反向审计 TUI 定制边界，重点找出哪些核心区域没有公开 extension 替换或样式 API，以及若要继续定制需要 fork、patch 或上游改动的地方。

行动前完整读取：

- `/Users/wangxuyang/.agents/skills/wangxuyang/investigate/SKILL.md`
- `/Users/wangxuyang/Code/t3code/pi-ext/docs/agents/repository-language-policy.md`
- `/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.3/09befb10f2a2fa758010e8552a2160f1c25d5e3ec1c7aa49969903f49d96754e/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
- `/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.3/09befb10f2a2fa758010e8552a2160f1c25d5e3ec1c7aa49969903f49d96754e/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`

你是 leaf subagent。不得创建、调用或委派任何 subagent。亲自完成该研究线索。

只使用一手资料。以本机已安装 package 的 TypeScript 源码和导出类型为主，必要时对照 pi.dev 官方文档或官方仓库。相关 `.md` 必须完整读取并继续读取交叉引用。不要修改项目正式源码。

请建立核心界面区域清单并逐项验证公开能力：启动 logo/header、transcript 与 assistant/user/thinking 渲染、tool call 容器、editor、footer/status、selector/dialog、spinner/loaders、fullscreen 模式、搜索和滚动条。对每项判断：

1. theme token 可改样式。
2. extension hook 可新增或替换。
3. 只能间接影响。
4. 没有公开 API，需要 fork/patch。

特别检查 public exports、`ExtensionContext.ui` 或同等类型定义、interactive mode 装配代码，避免把内部可改误写成公开 API。记录源码路径和行号。

把结果写入 `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/docs/research/pi-tui-customization-boundaries.md`。遵守仓库语言政策，标题和 section headings 用 English，正文用中文。文档结构至少包含 `Scope`、`Evidence Pack`、`Core Region Matrix`、`Public API Boundary`、`Fork or Patch Cases`、`Open Questions`。

完成后只回复文档路径、关键结论和未决问题，不复制完整调查过程。