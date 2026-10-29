# Composer, footer and theme

验证 codex-ui 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `ui-header`：启动使用 Pi wordmark。
- `ui-composer`：输入框保持实色背景。
- `ui-status`：footer 展示模型与目录状态。
- `ui-theme`：保存主题跨会话替换保持。
- `ui-resize`：窄屏 resize 不破坏内容。
- `ui-user-markdown`：用户 Markdown 保留原语义。
- `ui-reply-markdown`：回复外层列表不改变模型原文。

## How to get to it (user POV)

启动 TUI；/settings 选择 codex-pi；/new；/resume；/fork；/reload。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 普通 TUI 与 fullscreen 是不同入口。renderer 固定帧不能替代真实工具执行的文件副作用核验。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run codex-ui`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-ui`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 按 [正式旅程](../scripts/README.md#run) 运行 `cli.py regular` 与 `cli.py fullscreen`。驱动通过原生设置菜单选择 light/codex-pi，逐列断言输入行背景，在 40/80/140 列和原生 fork/resume 后复验；实际加载 fast/permissions 检查 footer 组合。Markdown 通过 bracketed paste 进入真正模型请求与 session，同时保存 TUI 渲染画面。主题设置落盘与 composer 的 codex-pi 颜色必须同时成立。
4. `ui-composer` 的像素与拖选、`ui-reply-markdown` 的系统 `/copy` 仍须执行 [人工边界](../scripts/README.md#manual-boundaries)。未执行时明确写出这些 ID 的自动通过部分及整体 unverified。
5. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/codex-ui/__tests__/layout.test.ts extensions/codex-ui/__tests__/theme.test.ts extensions/codex-ui/__tests__/user-markdown.test.ts extensions/codex-ui/__tests__/reply-markdown.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

内存 ThemeObject 兜底不持久化。codemode fixture 的整体画面不等于每个用户 Markdown 分支和持久主题均验证。

验收依据为 [layout.test.ts](../../../../extensions/codex-ui/__tests__/layout.test.ts)、[theme.test.ts](../../../../extensions/codex-ui/__tests__/theme.test.ts)、[user-markdown.test.ts](../../../../extensions/codex-ui/__tests__/user-markdown.test.ts)、[reply-markdown.test.ts](../../../../extensions/codex-ui/__tests__/reply-markdown.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
