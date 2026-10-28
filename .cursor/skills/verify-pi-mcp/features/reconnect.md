# Deadlines, retry and tool replay

验证 mcp 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `mcp-reconnect`：手动重连指定 server。
- `mcp-reload`：reload 清理旧连接与任务。
- `mcp-offline`：离线后后台恢复。
- `mcp-retry`：暂时错误有界退避。
- `mcp-deadline`：连接与调用遵守总截止。
- `mcp-replay`：默认不重放已发送调用。

## How to get to it (user POV)

/mcp reconnect <server>；/mcp reload；server 断开与恢复。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- --live 在这里表示真实本地 stdio MCP server，不使用用户的远程服务或凭据。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run mcp-transports`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui mcp`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 在本地故障夹具中触发连接错误、工具已发送后断线、timeout 与 cancel，检查 request 计数；默认 toolReplay=never 不重放。手动 reconnect 取消旧 generation；reload 后旧 timer/request 不再活动。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/mcp/__tests__/retry.test.ts extensions/mcp/__tests__/resilience-baseline.test.ts extensions/mcp/__tests__/client.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

通用 mock manager 单测不足以证明网络取消；需 transports 本地实际连接与服务端计数。认证/协议错误不可当暂时故障重试。

验收依据为 [retry.test.ts](../../../../extensions/mcp/__tests__/retry.test.ts)、[resilience-baseline.test.ts](../../../../extensions/mcp/__tests__/resilience-baseline.test.ts)、[client.test.ts](../../../../extensions/mcp/__tests__/client.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
