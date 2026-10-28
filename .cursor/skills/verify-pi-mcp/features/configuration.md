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

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- --live 在这里表示真实本地 stdio MCP server，不使用用户的远程服务或凭据。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run mcp`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui mcp`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 运行真实 MCP 会话，检查未信任目录的 sentinel 未写入。隔离 TUI 运行 /mcp-init，检查生成文件和 /mcp status；用无效高优先级文件确认不降级读取较低文件，单个无效 server 不阻塞其他有效 server。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/mcp/__tests__/config.test.ts extensions/mcp/__tests__/pi-modes-smoke.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

/mcp-init 需要受信任项目，已有文件会确认覆盖；模板包含 pnpm dlx，只有显式配置并 reload 才运行服务器，不能把模板生成当连接成功。helper 的 live 配置是本地 echo；配置不展开环境占位。

验收依据为 [config.test.ts](../../../../extensions/mcp/__tests__/config.test.ts)、[pi-modes-smoke.test.ts](../../../../extensions/mcp/__tests__/pi-modes-smoke.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
