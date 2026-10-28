# Tool discovery, calls and results

验证 mcp 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `mcp-stdio`：stdio 发现并调用工具。
- `mcp-http`：Streamable HTTP 实际连接。
- `mcp-sse`：legacy SSE 实际连接。
- `mcp-schema`：工具参数 schema 转换。
- `mcp-progress`：progress 延长软截止但不越硬上限。
- `mcp-cancel`：用户取消传播到底层。
- `mcp-error`：工具错误按失败展示。

## How to get to it (user POV)

mcp__<server>__<tool>；本地 stdio/Streamable HTTP/SSE。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- --live 在这里表示真实本地 stdio MCP server，不使用用户的远程服务或凭据。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run mcp-transports`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui mcp`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 先运行 mcp 真实 TUI 的 local/echo，再运行 transports 的本地协议服务。核对发现的工具名、参数 schema、文本/图片/结构化结果、progress、错误与取消；保存调用动作和 server 接收次数。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/mcp/__tests__/transport-fixtures.test.ts extensions/mcp/__tests__/progress-transport.test.ts extensions/mcp/__tests__/integration.test.ts extensions/mcp/__tests__/schema.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

transport helper 是协议补证，不是三种传输都经 TUI。HTTP/SSE 使用临时监听端口，退出必须确认 fixtures 的 server.close 与进程清理。

验收依据为 [transport-fixtures.test.ts](../../../../extensions/mcp/__tests__/transport-fixtures.test.ts)、[integration.test.ts](../../../../extensions/mcp/__tests__/integration.test.ts)、[schema.test.ts](../../../../extensions/mcp/__tests__/schema.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
