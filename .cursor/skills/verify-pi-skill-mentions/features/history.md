# History editing, queues and session changes

验证 skill-mentions 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `skill-history-source`：历史编辑取回原始引用。
- `skill-external-editor`：外部编辑器收到原文。
- `skill-steer`：steer 保留独立快照。
- `skill-followup`：follow-up 保留独立快照。
- `skill-reload`：reload 保留草稿与快照关系。
- `skill-resume`：恢复历史保持旧内容。
- `skill-equal-task`：同文本不同请求不混淆。

## How to get to it (user POV)

历史上/下；外部编辑器；steer/follow-up；/reload；/resume。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- skills helper 通过本地 pi install 加载当前 checkout 的 dist，不做 pnpm 发布包安装；发布 tarball 另跑 skill-mentions:acceptance。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run skills`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui skill-mentions`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. driver 从历史取回原始 $skill 文本，外部编辑器收到同样原文；长请求期间入队，确认各消息独立快照、同文不同请求不混淆。reload 和 --session 冷启动后历史外观与上下文仍对应原请求。另在真实 TUI 中先提交含 skill 的任务，再 /new 创建第二会话，打开 /resume：列表应显示可读任务而非 snapshot JSON；选回旧会话、展开卡片并继续请求，核对旧快照不受源文件修改或删除影响。两次打开选择器均须留屏，列表、恢复正文、模型上下文分别断言。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/skill-mentions/__tests__/history-editor.test.ts extensions/skill-mentions/__tests__/lifecycle.test.ts extensions/skill-mentions/__tests__/visibility.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

`skills` 的冷恢复入口是 --session。`skills-resume` 顺序运行 native/native-fullscreen/codex/codex-fullscreen：每模式先创建含快照的原会话和独立会话，删除源 skill，两次从独立会话打开 /resume、精确搜索并按 Enter 选回原会话。逐次断言 session 路径、选择前后历史字节、展开卡片及后续 provider 上下文，再验证首次 --resume 的冷选择器。需要单模式定位时，直接运行 `resume-summary-driver.py <新的仓库内证据目录> <mode>`。先构建并确认宿主已应用 [Pi 摘要补丁](../../../../docs/pi-session-summary-patch.md)。未补丁宿主的列表仍是原行为，不用 --session 成功或自动命名替代选择器验收。

`skills-combination` 固定覆盖 steer：初次 V1 → 多行 Enter 只选候选 → Ctrl+G 外部编辑 → F7 公开 reload 保留草稿 → 源文件 V2 → 提交 → QUEUE_HOLD 期间 Enter 入队 → 消费前改 V3 → 删除源文件 → reload → Ctrl+P 取回原文 → 后续请求。断言三个快照内容、不同 requestId 和模型 user 与 session user 一致。`skills` 的 Alt+Enter follow-up 与这里的 Enter steer 分别留证。

队列旅程使用 provider 延迟来保留真实 TUI 入队窗口。不会证明任意第三方编辑器兼容。

验收依据为 [history-editor.test.ts](../../../../extensions/skill-mentions/__tests__/history-editor.test.ts)、[lifecycle.test.ts](../../../../extensions/skill-mentions/__tests__/lifecycle.test.ts)、[visibility.test.ts](../../../../extensions/skill-mentions/__tests__/visibility.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
