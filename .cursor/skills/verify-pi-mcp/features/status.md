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

完成 [Launch 与 Doctor](../SKILL.md)，运行 [固定旅程的命令](../journeys.md#commands)，选择 `diagnostics 与 combination`。具体动作和通过条件见 [对应旅程](../journeys.md#diagnostics)。每个 ID 分别记录实际覆盖结果、证据层级和文件路径；需要完整验收时运行固定旅程的全部六条命令及列出的定向协议测试。

## Gotchas

live smoke 主要验证调用与历史，状态清单各入口需补录。不要向证据复制真实 Authorization 或 env。

验收依据为 [status-ui.test.ts](../../../../extensions/mcp/__tests__/status-ui.test.ts)、[diagnostics.test.ts](../../../../extensions/mcp/__tests__/diagnostics.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
