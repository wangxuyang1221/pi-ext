# Thinking and terminal activity

验证 codex-ui 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `ui-thinking-stream`：流式思考完整显示。
- `ui-thinking-collapse`：Ctrl+T 保留隐藏选择。
- `ui-thinking-resume`：恢复仍采用相同思考规则。
- `ui-title`：窗口标题展示运行动画。
- `ui-title-stop`：settled 或取消后标题静止。

## How to get to it (user POV)

Ctrl+T；思考流式消息；取消/重试/压缩；终端标题。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 普通 TUI 与 fullscreen 是不同入口。renderer 固定帧不能替代真实工具执行的文件副作用核验。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run thinking`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-ui`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 运行真实 thinking PTY，核对 Thinking 引用块完整文本、Ctrl+T 隐藏选择和 resize。默认 fixture 使用内存 session，成功时只输出断言日志；它不覆盖持久恢复或 OSC 标题。补验时保存原始 ANSI 与动作，在隔离持久 SessionManager 写入消息、退出并以同一 sessionFile 重开；另采集 OSC 标题，检查流中变化、settled 后静止、Esc 取消后不再变化。普通/fullscreen 分别运行。80ms 调度精度由定时器测试验证，PTY 到达间隔会受合包影响。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/codex-ui/__tests__/reasoning.test.ts extensions/codex-ui/__tests__/reasoning-inline.test.ts extensions/codex-ui/__tests__/terminal-title.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

provider 返回思考为固定 fixture。终端标题定时测试是补充，thinking smoke 不证明真实 provider 产生 reasoning。

验收依据为 [reasoning.test.ts](../../../../extensions/codex-ui/__tests__/reasoning.test.ts)、[reasoning-inline.test.ts](../../../../extensions/codex-ui/__tests__/reasoning-inline.test.ts)、[terminal-title.test.ts](../../../../extensions/codex-ui/__tests__/terminal-title.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
