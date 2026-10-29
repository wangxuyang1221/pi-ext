---
name: verify-pi-codex-ui
description: "Verify pi-ext codex-ui composer, transcript, tools, Thinking, title, Working/rate, inspector and theme; print/RPC execution. Use after changing these behaviors or investigating a regression."
---

# Verify Pi codex-ui

先读 [行为索引](features/README.md)，按本次变更选择所有受影响入口。普通 TUI 与 fullscreen 是不同入口。renderer 固定帧不能替代真实工具执行的文件副作用核验。

## Launch

从仓库根目录运行。首次准备与隔离规则见 [共享运行说明](../verify-pi-ext/README.md)。

```bash
pnpm_config_verify_deps_before_run=false pnpm install --frozen-lockfile --ignore-scripts
pnpm_config_verify_deps_before_run=false pnpm run build
pnpm_config_verify_deps_before_run=false pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
pnpm_config_verify_deps_before_run=false pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run codex-ui
```

这是短生命周期验证。helper 创建空配置、会话和临时目录，驱动真实宿主，并在退出前清理。就绪条件是驱动观察到资源加载完成或匹配的 TUI 提示，再执行断言，不是进程成功启动。人工补充路径用 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-ui`，须通过工具的 PTY 模式运行；使用说明和限制见共享文档。

## Doctor

运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor`，核对实际 Node、pnpm、Pi 版本、构建入口与 Python/pyte。`lockPresent: true` 时先读取对应锁中的 PID，等待当前验证退出，不双重驱动。异常时同时读取本次 `summary.json` 的 case、command、scratch 和 pid，确认操作的是本次实例。

每次 fresh drive 先 doctor；正式 CLI/headless 驱动还会在内部每次新进程启动前调用共享只读 doctor，保存对应 `doctor-*.json/.stderr`，失败或锁占用时拒绝启动。每个 `processes`/`cases` 条目用 `doctor` 字段关联自己的前置检查。失败后先 doctor，再核对本次失败证据与清理；进程健康但 UI 卡住时重新启动已知状态。不要接着坏状态继续输入。全部 pnpm 命令使用命令级 `pnpm_config_verify_deps_before_run=false`。

## Drive

先执行受影响 feature 对应的已有 case，再运行 [正式 CLI/headless 旅程](scripts/README.md#run)。其中包含原生设置、fork/resume/tree、Markdown、配置拒绝与修复、工具副作用、工具完整显示与命令可用性、持久 Thinking 和缓存压力。新增组合无需复制临时审计脚本；驱动及离线模型边界已随 skill 维护。

- [Composer, footer and theme](features/layout.md)
- [Thinking and terminal activity](features/thinking.md)
- [Read, Bash, Edit and Write display](features/tools.md)
- [Codemode tree and inspector](features/codemode.md)
- [Execution settings and fail-closed configuration](features/execution.md)

`ui-working`、`ui-receive-rate` 从 layout 路由到 [生产 Working 旅程](../verify-pi-text-regions/features/working.md)，按其 [Launch/Doctor](../verify-pi-text-regions/SKILL.md) 使用新证据目录串行跑 regular/fullscreen。该入口复用 `scripts/local-refresh-pty.py --working`，走公开生产事件、真实权限/工具及组件，不另建 PTY 或设置内部状态。标题仍按 thinking feature 单独验证。原版回退、发布安装、交互和 CPU 矩阵的权威入口也在新 skill；修改相关生产路径时选择对应 feature，不能用旧 CPU 报告代替本次测量。

每个 feature 的自动入口只证明文件注明的范围。补充步骤必须逐项执行并记录，不得把全部单元测试通过写成全部用户旅程通过。

终端拖选、像素外观、系统剪贴板按 [人工边界](scripts/README.md#manual-boundaries) 记录。Write/Edit 没有可观察、可控制的文件操作阶段，真实 Esc 命中该阶段的缺口见 [文件修改取消边界](scripts/README.md#file-mutation-cancellation)；已完成文件改动不回滚。脚本通过时这些分支仍可为 unverified。

## Evidence

记录 feature ID、入口、命令/按键、前后状态、实际文件或会话副作用。helper 在 `.tmp/test-results/verify-<case>-<id>/` 保留 `summary.json`、`output.log` 和可用的 `artifacts/`；命令 PTY 另有 `journey.json`、`terminal.ansi` 与隔离文件副本。共享说明定义证据边界。一次 smoke 不能作为整个行为索引通过。

逐入口记录 `covered / verified-unreachable / unverified`，并保留 `passed / failed` 结果。`verified-unreachable` 必须有真实前置条件和尝试路径；没有物理终端、剪贴板授权或远程凭据的推测不足以成立。必要分支未验证时，整体 ID 保持 unverified，并列出自动通过部分。

动态 UI 的结束事件和结束后画面分别核对。排队刷新可能晚于 `agent_settled`，不能将事件刚到达时的旧画面当作已经隐藏的证据。

## Cleanup

自动 helper 在成功、失败及可处理取消后清理所启动进程和 scratch，最后应为 `cleanup: removed`。交互路径发送 `/quit`，等待外层 helper 返回，再检查 evidence 仍存在。清理未核实或缺少前置条件时不得记为通过；按 [共享清理规则](../verify-pi-ext/README.md#cleanup) 处理。

## Helpers

`pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run codex-ui` 是本 skill 的最小验收。脚本源码与其他 case 见 [共享 helper](../verify-pi-ext/scripts/verify.mjs)。后续使用 `/maintain-verification-skill` 同步行为索引与实现。

[health.py](scripts/health.py) 是 CLI/headless 复用的逐进程 preflight，不启动应用。需要单独运行时，先创建本次 evidence 目录，再执行：

```bash
conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-codex-ui/scripts/health.py "$PWD" <evidence-dir> <unique-label>
```

helper 和两个 CLI 驱动有可执行权限及固定 Conda shebang；回归命令见 [driver 说明](scripts/README.md#run)。
