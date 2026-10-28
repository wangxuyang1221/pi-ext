# History rendering and safe resume

验证 mcp 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `mcp-live-history`：真实调用写入可恢复历史。
- `mcp-offline-history`：server 离线仍能显示旧卡片。
- `mcp-cold-resume`：各冷启动恢复入口读取历史。
- `mcp-import`：导入历史后识别工具身份。
- `mcp-tree`：树导航只展示当前分支。
- `mcp-reload-history`：reload 不重执行旧工具。
- `mcp-history-only`：display-only 定义不能执行。

## How to get to it (user POV)

--session/--continue/--resume；/resume；/tree；/reload；离线历史工具卡片。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- --live 在这里表示真实本地 stdio MCP server，不使用用户的远程服务或凭据。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run mcp`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui mcp`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. live 驱动执行 local echo 后移除 server，再做 session replacement/reload；历史仍显示紧凑 Called 卡片，展开原始内容，不再执行旧工具。补跑 resume-ui-host 的 cold-mode 与 history-tool 定向测试，核对分支历史和 display-only 工具不可执行。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/mcp/__tests__/history-tool.test.ts extensions/mcp/__tests__/history-session.test.ts extensions/mcp/__tests__/history-handoff.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

自动 live 只覆盖默认 cold-mode=session。分别运行 resume-ui-host.py 的 --cold-mode session、continue、resume、blank，以及单独的 --memory；每条都需隔离运行并设置 PI_VERIFY_EVIDENCE。--memory 不与 --repeat 1 组合：当前驱动 empty fork 后仍要求旧卡片，该组合是夹具错误。CLI --resume 选择器与进程内 /resume 是不同入口；fixture 调用 ctx.switchSession/ctx.navigateTree 也不等于操作原生 /resume、/tree 菜单。菜单和 history-only 工具的模型执行拒绝需额外旅程，缺少时保持 unverified。

验收依据为 [history-tool.test.ts](../../../../extensions/mcp/__tests__/history-tool.test.ts)、[history-session.test.ts](../../../../extensions/mcp/__tests__/history-session.test.ts)、[history-handoff.test.ts](../../../../extensions/mcp/__tests__/history-handoff.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
