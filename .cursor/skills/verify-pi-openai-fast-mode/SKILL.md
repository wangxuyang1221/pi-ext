---
name: verify-pi-openai-fast-mode
description: "Verify pi-ext openai-fast-mode through Pi TUI controls, serialized priority requests and managed child reload or cold resume. Use after changing Fast behavior or investigating a regression."
---

# Verify Pi openai-fast-mode

先读 [行为索引](features/README.md)，按本次变更选择所有受影响入口。fast footer 只表示请求 priority，不证明服务端使用了 priority 或响应更快。

## Launch

从仓库根目录运行。首次准备与隔离规则见 [共享运行说明](../verify-pi-ext/README.md)。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
pnpm exec node .cursor/skills/verify-pi-openai-fast-mode/scripts/verify.mjs full
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run subagent
```

`full` 从空配置驱动真实 Pi CLI/PTY，使用生产 Fast dist、真实 OpenAI/Codex request builder 和 SSE parser。模型服务的 fetch 返回固定离线事件，同时记录序列化请求。驱动逐项断言命令、模型切换、拒绝、重启和配置作用域，并保留每个进程的 ANSI、session 与配置副本。完整输入、种子及通过条件见 [request journey](scripts/README.md)。

`run subagent` 补齐实际 `subagent_spawn` 创建的私有 tmux child，包括角色、正反继承、reload 和真实 managed session 的 CLI 冷恢复。两条命令共同构成完整的本地验收。`run fast` 只检查四种命令和配置落盘，可用于快速定位问题。就绪条件是资源加载事件或匹配的提示。

## Doctor

依赖和 dist 已备好、此次不安装或构建时，运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run fast-managed`。先读 [child](features/child.md) 和 [subagent spawn](../verify-pi-subagent/features/spawn.md)。这条入口验证真实 root 开关、生产 managed child 的继承和首请求、End session 清理；完整角色及恢复矩阵仍使用上述宿主组。

运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor`，核对实际 Node、pnpm、Pi 版本、构建入口与 Python/pyte。`lockPresent: true` 时先读取对应锁中的 PID，等待当前验证退出，不双重驱动。异常时同时读取本次 `summary.json` 的 case、command、scratch 和 pid，确认操作的是本次实例。

## Drive

- [Root Fast Mode controls](features/toggle.md)
- [Priority requests and unsupported models](features/payload.md)
- [Child Fast Mode inheritance](features/child.md)

每个 feature 的自动入口只证明文件注明的范围。补充步骤必须逐项执行并记录，不得把全部单元测试通过写成全部用户旅程通过。

## Evidence

记录 feature ID、入口、命令/按键、前后状态、实际文件或会话副作用。`full` 输出唯一 `.tmp/test-results/verify-fast-requests-<id>/`，保留 `summary.json`、`journey.json`、各进程 `.ansi` 与隔离文件副本。`run subagent` 的 evidence 内 `artifacts/fast-source.json` 和 `fast-dist.json` 保留请求、逐步画面、完整 managed session、共享配置字节快照及 CLI 冷恢复命令。以实际输出目录为准。source/dist 标签指 subagent 的测试轮次，两轮 Fast root 均为源码 SDK，child 均为生产 dist。

本地 fetch 记录证明实际 request builder 构造了 `service_tier`；不证明远端采用 priority、计费层级或延迟改善。报告分开列出 CLI/PTY、本地请求构造、SDK root、managed tmux child 与远程服务，远程层级未执行时保持 unverified。

## Cleanup

`full` 在正常、断言失败和可处理信号退出时由 driver 保存旅程，再由 wrapper 核对进程组和独立 PTY 的退出。超时后 TERM 宽限两秒，随后强制回收并归档仍可读取的文件；缺失 journey 时行为验收失败，清理状态依据 owners、进程组与归档结果单独判定。核对 summary 的 `cleanup: removed`、`process.groupStopped: true`，以及 journey 的每个 PID 已退出。没有本地监听服务。managed 夹具另核对 `cleanup.livePids: []`、`socketUnavailable: true`。共享 helper 的中断与人工恢复规则见 [共享清理规则](../verify-pi-ext/README.md#cleanup)。

## Helpers

`pnpm exec node .cursor/skills/verify-pi-openai-fast-mode/scripts/verify.mjs smoke` 只执行 `--fast` 到实际 priority 请求，可用于排查生产字段遗漏。完整验收执行 Launch 的 `full` 和 `run subagent`。本 skill 不要求修改生产实现来验证断言敏感性。
