# Configuration and project trust

验证 mcp 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `mcp-init`：受信任项目生成配置模板。
- `mcp-priority`：按环境/项目/全局优先级读取。
- `mcp-invalid`：无效高优先级不静默降级。
- `mcp-disabled`：disabled server 不连接。
- `mcp-trust`：未信任项目不执行配置命令。

## How to get to it (user POV)

/mcp-init；PI_MCP_CONFIG；.pi/mcp.json；agent/mcp.json；/mcp status。

## Driving it with Pi PTY and host fixtures

完成 [Launch 与 Doctor](../SKILL.md)，运行 [固定旅程的命令](../journeys.md#commands)，选择 `configuration`。具体动作和通过条件见 [对应旅程](../journeys.md#configuration)。每个 ID 分别记录实际覆盖结果、证据层级和文件路径；需要完整验收时运行固定旅程的全部六条命令及列出的定向协议测试。

## Gotchas

/mcp-init 需要受信任项目，已有文件会确认覆盖；模板包含 pnpm dlx，只有显式配置并 reload 才运行服务器，不能把模板生成当连接成功。helper 的 live 配置是本地 echo；配置不展开环境占位。

验收依据为 [config.test.ts](../../../../extensions/mcp/__tests__/config.test.ts)、[pi-modes-smoke.test.ts](../../../../extensions/mcp/__tests__/pi-modes-smoke.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
