---
name: verify-pi-goal
description: "Verify pi-ext goal through Pi persistent root TUI /goal, /goal-recover, /goal-fork and model goal tools. Use after changing its core behavior or investigating a regression."
---

# Verify Pi goal

先读 [行为索引](features/README.md)，按本次变更选择所有受影响入口。只在持久化 root TUI 验证自动推进；临时会话、headless、managed child 和无普通 function tools 的模型不具备同一执行保证。

## Launch

从仓库根目录运行。首次准备与隔离规则见 [共享运行说明](../verify-pi-ext/README.md)。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run goal
```

这是短生命周期验证。helper 创建空配置、会话和临时目录，驱动真实宿主，并在退出前清理。就绪条件是驱动观察到资源加载完成或匹配的 TUI 提示，再执行断言，不是进程成功启动。人工补充路径用 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui goal`，须通过工具的 PTY 模式运行；使用说明和限制见共享文档。

## Doctor

运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor`，核对实际 Node、pnpm、Pi 版本、构建入口与 Python/pyte。`lockPresent: true` 时先读取对应锁中的 PID，等待当前验证退出，不双重驱动。异常时同时读取本次 `summary.json` 的 case、command、scratch 和 pid，确认操作的是本次实例。

## Drive

受影响的完整旅程使用 [维护中的 TUI 驱动](DRIVERS.md)。按该表运行所有对应参数组合，并保存每个命令返回的唯一证据目录。共享 `run goal` 仅为最小工具 smoke，不覆盖完整行为索引。

- [Goal creation, editing and details](features/lifecycle.md)
- [Goal model tools and availability](features/tools.md)
- [Continuation, steering and interruption](features/continuation.md)
- [Durable recovery and lock ownership](features/recovery.md)
- [Explicit goal inheritance](features/inheritance.md)
- [Long objectives and attachments](features/content.md)
- [Usage, soft budgets and direct children](features/accounting.md)
- [Goal footer and elapsed-time display](features/footer.md)

每个 feature 的自动入口只证明文件注明的范围。补充步骤必须逐项执行并记录，不得把全部单元测试通过写成全部用户旅程通过。

## Evidence

记录 feature ID、入口、命令/按键、前后状态、实际文件或会话副作用，并分别记录子分支。完整旅程的原始 session、ANSI 和请求证据格式见 [驱动说明](DRIVERS.md#evidence)。helper 在 `.tmp/test-results/verify-<case>-<id>/` 保留 `summary.json`、`output.log` 和可用的 `artifacts/`；命令 PTY 另有 `journey.json`、`terminal.ansi` 与隔离文件副本。共享说明定义证据边界。一次 smoke 不能作为整个行为索引通过。

## Cleanup

自动 helper 在成功、失败及可处理取消后清理所启动进程和 scratch，最后应为 `cleanup: removed`。交互路径发送 `/quit`，等待外层 helper 返回，再检查 evidence 仍存在。清理未核实或缺少前置条件时不得记为通过；按 [共享清理规则](../verify-pi-ext/README.md#cleanup) 处理。

## Helpers

`pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run goal` 是本 skill 的最小验收。脚本源码与其他 case 见 [共享 helper](../verify-pi-ext/scripts/verify.mjs)。后续使用 `/maintain-verification-skill` 同步行为索引与实现。
