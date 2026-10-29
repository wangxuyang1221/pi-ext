# Session grants and process lifetime

## Sub-features

| ID | Observable result |
| --- | --- |
| `permissions-grant-exact` | write/edit 同一目标和完全相同 bash 命令复用授权；改变 bash 文本重新审批。 |
| `permissions-grant-path` | 规范化后同一路径复用；不同目标和 write/edit 不同工具重新审批。 |
| `permissions-grant-mcp` | alpha/echo 换参数复用；alpha/other 与 beta/echo 重新审批。 |
| `permissions-grant-limit` | 513 个不同目标逐项会话批准后，最新目标免审批，最早目标重新审批；拒绝后原字节保持。 |
| `permissions-restart` | 保留同一目录、配置、文件和 sessions，退出并重启 Pi 后，write/edit/bash/MCP 旧授权均重新审批。 |

## Drive

完成 [Launch 与 Doctor](../SKILL.md)，分别运行：

```bash
pnpm exec node .cursor/skills/verify-pi-permissions/scripts/run.mjs matrix
pnpm exec node .cursor/skills/verify-pi-permissions/scripts/run.mjs capacity
```

`matrix` 验证除容量外的四个 ID。`tools` 与 `restart` 是同一 scratch 中先后启动的真实 Pi 进程；核对两个 PID、连续 action、授权复用时的工具结果和重启后拒绝的文件快照。此重启保留 sessions 目录但不恢复模型历史，验收目标是进程授权清空。

`capacity` 的一个 TUI 进程会执行 513 次 Allow this session，并逐次核对 `capacity/<n>.txt` 字节。随后重写第 513 项免审批，再拒绝第 1 项的重新审批。检查 `capacity/journey.json` 的 513 个批准动作、最新项复用、最早项重新审批、`latest-grant-retained` 与 `oldest-grant-evicted` 断言，以及保留的 workspace、session 和 ANSI。

## Gotchas

容量不是检查内部集合大小。若没有逐项真实批准、最新项复用和最早项重新审批的证据，`permissions-grant-limit` 保持 unverified。单元测试或固定路径 WRITE_PROOF 无法代替此旅程。
