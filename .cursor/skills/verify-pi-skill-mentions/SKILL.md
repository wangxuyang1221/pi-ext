---
name: verify-pi-skill-mentions
description: "Verify pi-ext skill-mentions through Pi TUI inline $skill completion, submission, label editing and history. Use after changing its core behavior or investigating a regression."
---

# Verify Pi skill-mentions

先读 [行为索引](features/README.md)，按本次变更选择所有受影响入口。以下固定驱动均在仓库中维护，不依赖历史审计目录。

## Launch

从仓库根目录运行。首次准备与隔离规则见 [共享运行说明](../verify-pi-ext/README.md)。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run skills
```

这是最小 native 验收，通过本地 pi install 加载当前 dist。完整索引还需顺序执行：

若依赖和 dist 已备好，且本次禁止安装或构建，先读 [loading](features/loading.md)、[history](features/history.md) 和 [integration](features/integration.md)，改用 `run skills-combination-prebuilt` 与 `run skills-resume`。前者直接加载 dist，后者实际从菜单选中旧会话并续问。下面的 `skills-combination`、`skills-unreadable` 和安装验收仍会执行本地安装，不能用“未安装依赖”代替“未执行 pi install”。

```bash
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run skills-resume
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run skills-combination
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run skills-unreadable
pnpm run skill-mentions:acceptance
```

变更请求快照读取或保存时，再执行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run skills-mutation`。它在仓库内私有副本编译 baseline、按路径缓存变异和恢复版本，用同一组合旅程验证第二次请求必须读取 V2；生产源码及 dist 保持原样。三个阶段、期望失败位置和源码哈希都必须留证。

helper 创建空配置、会话和临时目录，等待资源加载或匹配的 TUI 提示后断言，退出前核对所启动进程。人工补充路径用 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui skill-mentions`，须通过工具的 PTY 模式运行；使用说明和限制见共享文档。

## Doctor

运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor`，核对实际 Node、pnpm、Pi 版本、构建入口与 Python/pyte。`lockPresent: true` 时先读取对应锁中的 PID，等待当前验证退出，不双重驱动。异常时同时读取本次 `summary.json` 的 case、command、scratch 和 pid，确认操作的是本次实例。

## Drive

- [Inline skill completion](features/completion.md)
- [Skill loading and snapshot delivery](features/loading.md)
- [Label editing and icon preference](features/labels.md)
- [History editing, queues and session changes](features/history.md)
- [Editor combinations and package installation](features/integration.md)

每个 feature 的自动入口只证明文件注明的范围。补充步骤必须逐项执行并记录，不得把全部单元测试通过写成全部用户旅程通过。

## Evidence

记录 feature ID、入口、命令/按键、前后状态、实际文件或会话副作用。helper 在 `.tmp/test-results/verify-<case>-<id>/` 保留 `summary.json`、`output.log` 和可用的 `artifacts/`。`journeys.mjs` 输出唯一证据目录，可用第二个参数指定新的仓库内 `.tmp` 目录；保留 commands、summary、逐键 actions、完整 ANSI/provider events 与 session 副本。发布包保留五模式结果、消费 lock 及其哈希。共享说明定义证据边界。一次 smoke 不能作为整个行为索引通过。

自动完整路径仍缺少真实终端拖选复制，`skill-selection` 整体保持 unverified，并单列整体删除已通过。按 [人工步骤](features/labels.md#manual-terminal-selection) 取得剪贴板证据后才可改为 passed。CLI/PTY、离线 provider 和本地 MCP 不证明真实模型服务、物理字体或 IME。

## Cleanup

自动 helper 在成功、失败及可处理取消后清理所启动进程和 scratch，最后应为 `cleanup: removed`。交互路径发送 `/quit`，等待外层 helper 返回，再检查 evidence 仍存在。清理未核实或缺少前置条件时不得记为通过；按 [共享清理规则](../verify-pi-ext/README.md#cleanup) 处理。

## Helpers

`pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run skills` 是本 skill 的最小验收。脚本源码与其他 case 见 [共享 helper](../verify-pi-ext/scripts/verify.mjs)。后续使用 `/maintain-verification-skill` 同步行为索引与实现。
