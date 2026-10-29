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

完成 [Launch 与 Doctor](../SKILL.md)，运行 [固定旅程的命令](../journeys.md#commands)，选择 `combination`。具体动作和通过条件见 [对应旅程](../journeys.md#combination)。每个 ID 分别记录实际覆盖结果、证据层级和文件路径；需要完整验收时运行固定旅程的全部六条命令及列出的定向协议测试。

## Gotchas

transport helper 是协议补证，不是三种传输都经 TUI。HTTP/SSE 使用临时监听端口，退出必须确认 fixtures 的 server.close 与进程清理。

验收依据为 [transport-fixtures.test.ts](../../../../extensions/mcp/__tests__/transport-fixtures.test.ts)、[integration.test.ts](../../../../extensions/mcp/__tests__/integration.test.ts)、[schema.test.ts](../../../../extensions/mcp/__tests__/schema.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
