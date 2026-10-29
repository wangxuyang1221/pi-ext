---
name: verify-pi-subagent
description: "Verify pi-ext subagent through Pi model subagent tools, real private tmux children and root /quit. Use after changing its core behavior or investigating a regression."
---

# Verify Pi subagent

先读 [行为索引](features/README.md)，按本次变更选择所有受影响入口。此 skill 测试扩展创建的产品 child。它不授权代理把开发任务委派给其他 agent。root 与直接 child 是唯一受支持拓扑。

## Launch

从仓库根目录运行。首次准备与隔离规则见 [共享运行说明](../verify-pi-ext/README.md)。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run subagent
pnpm exec node .cursor/skills/verify-pi-subagent/scripts/run.mjs
pnpm exec node .cursor/skills/verify-pi-subagent/scripts/run.mjs "subagent-legacy-$(date +%s)" legacy
```

三个入口分别验证生产宿主组、完整 root CLI/PTY 旅程和真实 v2 writer 升级。依次运行并审查逐项断言，不能用第一项代替后两项。完整夹具、故障注入边界和 legacy 历史前提见 [driver 说明](scripts/README.md)。它们各自创建空配置和私有 tmux server，在匹配 readiness 后驱动，并保留清理证据。

## Doctor

运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor`，核对实际 Node、pnpm、Pi 版本、构建入口与 Python/pyte。`lockPresent: true` 时先读取对应锁中的 PID，等待当前验证退出，不双重驱动。异常时同时读取本次 `summary.json` 的 case、command、scratch 和 pid，确认操作的是本次实例。

## Drive

- [Spawn, roles and capacity](features/spawn.md)
- [Prompt delivery and settled generations](features/delivery.md)
- [Activity summaries and detail pagination](features/read.md)
- [Resume, ownership and lifecycle](features/ownership.md)
- [Close and root exit choices](features/close.md)

每个 feature 的自动入口只证明文件注明的范围。补充步骤必须逐项执行并记录，不得把全部单元测试通过写成全部用户旅程通过。

## Evidence

记录 feature ID、入口、命令/按键、前后状态、实际文件或会话副作用。共享宿主 helper 在 `.tmp/test-results/verify-<case>-<id>/` 保留 `summary.json`、`output.log` 和可用的 `artifacts/`。本 skill 的 runner 输出自己的 evidence 路径，其中有 `journey.json`、每个 root 的 `terminal-<pid>.ansi`、`wrapper-cleanup.json` 和隔离文件副本。共享说明定义证据边界。一次 smoke 不能作为整个行为索引通过。

## Cleanup

共享 helper 最后应为 `cleanup: removed`。本 skill runner 还须核对 `journey.cleanup.allStopped`、`wrapper-cleanup.scratchRemoved` 和 `evidenceRetained` 均为 true。交互路径发送 `/quit`，等待外层返回，再检查 evidence。清理未核实或缺少前置条件时不得记为通过；按 [共享清理规则](../verify-pi-ext/README.md#cleanup) 处理。

## Helpers

`run subagent` 是宿主协议验收。完整用户操作由 [run.mjs](scripts/run.mjs) 和 [driver.py](scripts/driver.py) 执行，其中 `/quit` 三个选择与恢复后 prompt 都是正式断言。需要人工使用普通 faux 交互入口时，先读共享说明的限制；它不自动编排本 skill 的旅程。后续使用 `/maintain-verification-skill` 同步行为索引与实现。
