# Status controls and diagnostics

验证 mcp 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `mcp-inventory`：状态清单持久显示 server 状态。
- `mcp-verbose`：verbose 展示工具列表。
- `mcp-logs`：查看近期诊断。
- `mcp-redaction`：日志屏蔽敏感配置。
- `mcp-bounded-log`：诊断文件大小有界。

## How to get to it (user POV)

/mcp；/mcp status；/mcp verbose；/mcp logs。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- --live 在这里表示真实本地 stdio MCP server，不使用用户的远程服务或凭据。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run mcp`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui mcp`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 隔离 TUI 输入 /mcp 或 /mcp status 查看持久状态清单，/mcp verbose 展开工具名；重连和 reload 分别通过 /mcp reconnect local 与 /mcp reload 执行，/mcp logs 查看最近错误；开启文件诊断后从 .pi/logs/mcp.jsonl 核对事件与大小上限，凭据和参数不应泄漏。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/mcp/__tests__/status-ui.test.ts extensions/mcp/__tests__/diagnostics.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

live smoke 主要验证调用与历史，状态清单各入口需补录。不要向证据复制真实 Authorization 或 env。

验收依据为 [status-ui.test.ts](../../../../extensions/mcp/__tests__/status-ui.test.ts)、[diagnostics.test.ts](../../../../extensions/mcp/__tests__/diagnostics.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
