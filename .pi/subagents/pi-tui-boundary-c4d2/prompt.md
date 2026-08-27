# Task

你是 leaf research subagent。不得创建、调用或委派任何 subagent，必须亲自完成这条研究线索。

调查 Pi 宿主 TUI 与 extension API 的布局、渲染和终端滚动边界，回答：一个类似当前仓库 `codex-ui` 的 extension 是否能只在 extension 内实现“输入框和状态栏固定在终端底部，其他内容单独滚动”，还是必须修改 Pi 宿主。

# Scope

- 以本机安装的 Pi 官方文档、示例和包源码为第一手来源。
- 必须按项目指令完整读取相关 Pi `.md`，并继续读取其中与 TUI、extension、自定义组件相关的交叉引用。入口：
  - `/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.3/09befb10f2a2fa758010e8552a2160f1c25d5e3ec1c7aa49969903f49d96754e/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
  - `/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.3/09befb10f2a2fa758010e8552a2160f1c25d5e3ec1c7aa49969903f49d96754e/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
  - `/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.84.3/09befb10f2a2fa758010e8552a2160f1c25d5e3ec1c7aa49969903f49d96754e/node_modules/@earendil-works/pi-coding-agent/examples/extensions/`
- 可查看 Pi 包源码，追踪 extension 注册、editor/footer 替换、根布局、viewport、resize 和滚动职责。
- 不深入研究当前仓库 `codex-ui` 的内部组件实现，只可查看 manifest、入口或 API 调用点来确认它用了哪些宿主接口。
- 不修改任何产品文件。仅允许新增研究文档 `.scratch/docs/research/pi-tui-fixed-footer-boundary.md`。

# Required reading

行动前完整读取：

- `/Users/wangxuyang/.agents/skills/wangxuyang/investigate/SKILL.md`
- `/Users/wangxuyang/Code/t3code/pi-ext/docs/agents/repository-language-policy.md`

文档标题和 section headings 使用 English，正文使用中文。

# Deliverable

把证据和判断写入 `.scratch/docs/research/pi-tui-fixed-footer-boundary.md`。至少覆盖：

1. Pi 宿主与 extension 各自控制哪些区域。
2. editor、footer/status、messages 的替换或布局 API。
3. fixed-bottom + 独立滚动是否需要宿主改动，以及适用前提。
4. 若仅改 extension，可用的具体机制与限制。
5. 证据来源，使用官方文档或包源码绝对路径和行号。
6. Open Questions。

完成后只返回文档路径、关键结论和未决问题，不复制完整调查过程。