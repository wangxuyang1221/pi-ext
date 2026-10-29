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

完成 [Launch 与 Doctor](../SKILL.md)，运行 [固定旅程的命令](../journeys.md#commands)，选择 `reload 与 recovery.mjs`。具体动作和通过条件见 [对应旅程](../journeys.md#reload)。每个 ID 分别记录实际覆盖结果、证据层级和文件路径；需要完整验收时运行固定旅程的全部六条命令及列出的定向协议测试。

## Gotchas

`/mcp reload` 先等待空闲。活动调用正常完成后才 reload，或先按 Escape 取消再 reload；取消不能归因于 reload。固定旅程分别验证两条路径。后台 retry、真实 HTTP 退避和全阶段总截止见 [协议旅程](../journeys.md#real-http-recovery)。

验收依据为 [retry.test.ts](../../../../extensions/mcp/__tests__/retry.test.ts)、[resilience-baseline.test.ts](../../../../extensions/mcp/__tests__/resilience-baseline.test.ts)、[client.test.ts](../../../../extensions/mcp/__tests__/client.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
