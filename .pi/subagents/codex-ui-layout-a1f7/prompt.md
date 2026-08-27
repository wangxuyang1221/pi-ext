# Task

你是 leaf research subagent。不得创建、调用或委派任何 subagent，必须亲自完成这条研究线索。

调查当前仓库中的 `codex-ui` 内部布局与渲染实现，回答：输入框和状态栏是否由 `codex-ui` 自己拥有；能否只修改 `codex-ui`，让二者始终固定在终端底部，只有消息、工具调用等其他内容滚动。

# Scope

- 只研究当前仓库的 `codex-ui` 源码、测试、构建配置和可直接运行的局部实验。
- 重点追踪组件树、容器高度、滚动容器、输入框、状态栏、终端 resize 与渲染生命周期。
- 用代码位置和测试或最小实验支持结论。若做实验，放在临时目录并清理；不要修改 `src/`、`__tests__/`、`dist/` 或其他产品文件。
- 不研究 Pi 宿主 TUI 的官方 API 或源码，这由另一条线索负责。
- 仅允许新增研究文档 `.scratch/docs/research/codex-ui-fixed-footer-internals.md`。

# Required reading

行动前完整读取：

- `/Users/wangxuyang/.agents/skills/wangxuyang/investigate/SKILL.md`
- `/Users/wangxuyang/Code/t3code/pi-ext/docs/agents/repository-language-policy.md`

文档标题和 section headings 使用 English，正文使用中文。

# Deliverable

把证据和判断写入 `.scratch/docs/research/codex-ui-fixed-footer-internals.md`。至少覆盖：

1. 当前所有权和组件层级。
2. 现有滚动发生在哪里，谁控制可用高度。
3. “只改 codex-ui”可行、不可行或有条件可行的明确结论。
4. 最小修改范围建议，但不要实施。
5. 证据来源，使用仓库相对路径与行号。
6. Open Questions。

完成后只返回文档路径、关键结论和未决问题，不复制完整调查过程。