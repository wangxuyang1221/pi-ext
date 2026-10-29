# Checkpoint continuation and model switching

验证 codex-compact 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `compact-resume`：重开已有 checkpoint 继续对话。
- `compact-tools`：恢复仍可用的工具声明。
- `compact-system-updates`：保留中途系统提示更新。
- `compact-model-switch`：Codex 模型间恢复或转换 checkpoint；非 Codex 模型回放原历史。
- `compact-tree`：分支导航采用对应历史。
- `compact-stale`：远程等待期间状态变化取消提交。

## How to get to it (user POV)

恢复已有 session；/resume；压缩后调用工具；/model；/tree。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 使用 [专用 PTY](../SKILL.md#drive) 的隔离 agentDir/sessionFile；它在同一验证生命周期内重启，不使用用户历史或真实凭据。

1. 运行 [场景配方](../journeys.md) 的 `combination`。同进程先 `/new`，再 `/resume` 搜索并选择命名会话，核对 session 路径和实际工具请求；追加工具声明与系统提示后 checkpoint 仍保留。随后退出，以 `--session` 冷启动原文件并发送输入，核对原 checkpoint、图片与新输入恰好一次，打开历史本身不改 session 字节。选择器与冷启动分别验收。
2. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run compact`。`resume-runtime` 补验预置 checkpoint 下的工具声明与系统更新；`repair-runtime` 从生产压缩生命周期生成 checkpoint 并读回文件。保存 evidence 并核对清理。
3. 运行配方的 `navigation`，经 `/model` 选择器搜索同 hash、不同 hash、较小窗口和非 Codex 模型，每次发送后续输入检查 checkpoint 或完整原分支；再经 `/tree` 搜索根消息、选择 No summary，核对后续实际请求移除了旧后代。运行 `stale`、`stale-session`、`stale-tree` 和 `stale-tools`，分别在模型转换等待时切换模型、会话、分支和工具声明，核对旧请求 abort 或迟到响应被拒绝、checkpoint 不变与后续请求。再运行 `model-boundaries` 与 `model-boundaries-tools`，经真实选择器缩小到12000窗口，验证重压缩后的完整请求不超过11400有效预算、pending完整且声明仍在。前缀拒绝步骤明确在请求边界注入不兼容投影，核对错误通知、零服务请求、旧checkpoint不变及恢复后的后续请求。
4. 对照以下定向测试定位边界；它们不代替模型选择、分支导航及后续请求的实际记录。

```bash
pnpm test extensions/codex-compact/__tests__/resume-runtime.test.ts extensions/codex-compact/__tests__/session-projection.test.ts extensions/codex-compact/__tests__/request-projection.test.ts extensions/codex-compact/__tests__/request-lifecycle.test.ts extensions/codex-compact/__tests__/session-coordinator.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

`resume-runtime` 预置 checkpoint；`repair-runtime` 由生产逻辑提交 checkpoint，但只 open 读回，没有新进程续聊。专用 PTY 补上真实 CLI 进程退出、冷启动和后续请求，checkpoint 来自固定 SSE 响应。它证明客户端持久化和转发，不证明服务端生成的加密 checkpoint 可在线继续使用。

验收依据为 [resume-runtime.test.ts](../../../../extensions/codex-compact/__tests__/resume-runtime.test.ts)、[session-projection.test.ts](../../../../extensions/codex-compact/__tests__/session-projection.test.ts)、[request-projection.test.ts](../../../../extensions/codex-compact/__tests__/request-projection.test.ts)、[request-lifecycle.test.ts](../../../../extensions/codex-compact/__tests__/request-lifecycle.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
