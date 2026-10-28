# Checkpoint continuation and model switching

验证 codex-compact 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `compact-resume`：重开已有 checkpoint 继续对话。
- `compact-tools`：恢复仍可用的工具声明。
- `compact-system-updates`：保留中途系统提示更新。
- `compact-model-switch`：非 Codex 模型回放原历史。
- `compact-tree`：分支导航采用对应历史。
- `compact-stale`：远程等待期间状态变化取消提交。

## How to get to it (user POV)

恢复已有 session；压缩后调用工具；/model；/tree。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 远程压缩只适用于 openai-codex/openai-codex-responses。离线 CLI 使用 faux 模型，只能验收配置命令；远程协议由真实 SDK 加 HTTP 边界夹具验证，线上质量需要另行实跑。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run compact`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-compact`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 运行 resume-runtime，记录预置 checkpoint 下请求投影、工具声明与续跑输入的 SDK 证据；再运行列出的定向测试检查分支与模型切换。文件名 resume-runtime 不表示已完成进程退出、重开并继续请求。验收 compact-resume 还需在同一隔离 agentDir/sessionFile 中停止原进程，冷启动新进程、发送后续输入，核对实际请求与返回结果。真实会话切换非 Codex 模型时应回放原始分支，前缀不匹配应拒绝而非删除 checkpoint。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/codex-compact/__tests__/resume-runtime.test.ts extensions/codex-compact/__tests__/session-projection.test.ts extensions/codex-compact/__tests__/request-projection.test.ts extensions/codex-compact/__tests__/request-lifecycle.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

SDK 夹具预置历史 checkpoint，并替换模型目录与 HTTP 响应。它没有证明一个真实远程 checkpoint 从生成到重启的完整链路。

验收依据为 [resume-runtime.test.ts](../../../../extensions/codex-compact/__tests__/resume-runtime.test.ts)、[session-projection.test.ts](../../../../extensions/codex-compact/__tests__/session-projection.test.ts)、[request-projection.test.ts](../../../../extensions/codex-compact/__tests__/request-projection.test.ts)、[request-lifecycle.test.ts](../../../../extensions/codex-compact/__tests__/request-lifecycle.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
