---
name: verify-pi-permissions
description: "Verify permissions modes, write/edit/bash/MCP approval, process grants, 513-entry eviction, print refusal, and RPC confirmation through real Pi CLI journeys. Use after permissions behavior changes or regressions."
---

# Verify Pi permissions

先读 [行为索引](features/README.md)，按变更选择对应正式 driver。默认权限模式下核对真实文件副作用；本验证显式设置 `PI_PERMISSIONS_MODE=default`，另有 full 和未设置变量的独立启动。

## Launch

从仓库根目录运行。首次准备与凭据隔离见 [共享运行说明](../verify-pi-ext/README.md)。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
pnpm exec node .cursor/skills/verify-pi-permissions/scripts/run.mjs all
```

`all` 依次执行 matrix、capacity、headless，覆盖索引的 18 个 ID。要缩短反馈循环，可单独传入这三个名称；范围见各 feature 文件。`capacity` 需要在同一 Pi 进程中批准 513 次，保留完整过程后才算通过。

正式 driver 创建唯一 evidence 和 scratch，独立于共享 helper 的固定锁。它直接加载当前 `extensions/permissions/src/index.ts`；生产 CLI、权限实现、工具、TUI、session 和文件操作均保留，只替换模型服务及本地 MCP 服务边界。MCP 扩展仍使用构建后的生产入口。验证打包入口时运行：

```bash
PI_PERMISSIONS_VERIFY_ENTRY=extensions/permissions/dist/index.js pnpm exec node .cursor/skills/verify-pi-permissions/scripts/run.mjs all
```

## Doctor

共享 doctor 只检查环境，不证明行为通过。确认实际 Node、pnpm、Pi、Python/pyte、构建入口与工作目录。正式 driver 的运行位置和 PID 在其 `summary.json` 中，不靠进程存活判断就绪；PTY 等待宿主 `resources_discover`，再观察目标提示或工具结束事件。

## Drive

- [Permission mode selection](features/modes.md)
- [Approval and file side effects](features/approval.md)
- [Session grants and process lifetime](features/grants.md)
- [Print refusal and RPC approval](features/headless.md)

需要验证拒绝断言能发现回归时运行：

```bash
pnpm exec node .cursor/skills/verify-pi-permissions/scripts/regression.mjs
```

它先运行正常的 `deny-probe`，再在 evidence 内复制 permissions 源码，仅让副本的 Deny 返回允许，用完全相同的 probe 核对非零退出、`write-denied-unchanged` 失败及禁写文件字节。正常源码保持原样。

运行器本身的启动失败和超时清理回归用 `pnpm exec node .cursor/skills/verify-pi-permissions/scripts/runner-regression.mjs`。它验证证据目录创建失败、隔离配置准备中途失败、执行文件不存在、进程永不退出、忽略 SIGTERM 和清理证据损坏，核对有界返回、日志保留及清理不确定时保留 scratch。

原共享 `run permissions` 与 `run permissions-modes` 可作快速 smoke，覆盖范围以共享说明为准，不能替代此处完整矩阵。手动尝试用共享 `tui permissions`；它只提供固定 `WRITE_PROOF`，其成功不能推断 edit/bash/MCP 或授权容量通过。

## Evidence

正式 driver 每次创建 `.tmp/test-results/permissions-journeys-<id>/`，标准输出给出确切路径。先核对 `summary.json` 的 scenario、命令、entry、PID、退出码和 cleanup，再审查对应子目录：

- `journey.json` 保存按键动作、每次审批前后文件、请求和真实 tool result、MCP 调用记录与进程状态。
- PTY 场景保留每个进程的 `.ansi`、`.screens.json`、`workspace/`、`sessions/`、`agent/`。
- headless 场景保留各进程 stdout/stderr、RPC 请求/应答、workspace、session 与配置副本。
- 每个场景另有 `runner.json` 和 `output.log`，即使启动或清理失败也记录原始错误、deadline、进程组及 scratch 状态。

逐 ID 写 passed、failed、blocked 或 unverified，并引用本次证据。四种修改工具、四种只读工具与跨进程重启各有断言。完整矩阵未运行时，不将未运行的 ID 记为 passed。失败也保留已执行动作和文件快照，拒绝后文件变化即失败。

## Cleanup

正常退出、断言失败和可处理的 SIGINT/SIGTERM 均收集证据并停止本次子进程。外层仅在 `journey.processStopped` 与进程组检查同时通过后删除 scratch，scenario 必须为 `cleanup: removed`。本地 MCP 使用 stdio，没有监听端口。取消时等待外层退出，复核 evidence；清理状态未确认时按 [共享清理规则](../verify-pi-ext/README.md#cleanup) 处理，不记录通过。

每个场景有独立 deadline，matrix/headless/deny-probe 为 3 分钟，capacity 为 10 分钟。需要调整时显式设置正整数 `PI_PERMISSIONS_VERIFY_TIMEOUT_MS`。超时先向驱动进程组发送 SIGTERM，留 2 秒让 Python/headless 的 finally 落盘；随后强制停止驱动组，并按即时记录的 PID 回收独立 PTY/CLI 进程组。无完整清理证据时保留 scratch，不能把超时视为正常通过。

## Limits

离线验收证明本地真实宿主和工具行为，不证明付费模型、远程 MCP、RPC 客户端失联后的超时或重连。跨平台和未打补丁宿主需另行运行并记录版本。
