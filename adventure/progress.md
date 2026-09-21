# Handoff

> 本冒险已完成唯一 Implementation 并通过协调者验收。Map 与 Spec 保持开放，等待用户确认最终交付。用户确认后关闭 Map 与 Spec，并按 Adventure 完成最终存档；若用户提出修改，则从受影响的关卡继续。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

本轮目标是在用户通过 `/quit` 正常退出时选择 `End session` 或 `Leave temporarily`，按选择回收或保留当前 session 所属 subagent；没有经过选择的退出保留 subagent 并允许之后 resume。

产品实现、正式回归和整体验收均已完成。[Implementation #23](https://github.com/wangxuyang1221/pi-ext/issues/23) 已关闭。当前只等待用户确认最终交付，不需要继续编码、重新规划或重复验收。

## Evolution

最初候选是主进程退出便关闭子代理。用户指出退出可能只是暂时离开，因此路线改为让用户在正常 `/quit` 时表达意图。Planning #19、#20 和 #21 依次确定选择规则、失败处理、未选择退出时的保留与恢复；#22 因用户收缩范围而以 not planned 关闭。

用户批准单一实施切片后，[Implementation #23](https://github.com/wangxuyang1221/pi-ext/issues/23) 由独立 worker 完成。实现提交 [acc97fa](https://github.com/wangxuyang1221/pi-ext/commit/acc97faa530df76b9ecb700668b2dc14ae704693) 已推送到 `adventure/subagent-cleanup`。worker 完成单元、并发、正式 build PTY 与信号恢复矩阵；协调者独立复核关键测试、类型检查、结构化证据和资源清理后通过验收并关闭 #23。

## Agreed Decisions and Constraints

- 正常 `/quit` 先查询当前 session 的 subagent。没有存活或正在启动的代理时直接退出。
- 有存活代理时显示 `End session` 与 `Leave temporarily`，默认选中前者。Escape 取消退出并保留主 Pi 与 subagent。
- `End session` 中止工作中的主 agent，关闭当前 session 所属全部 subagent，确认 active 与 pending 均为 0 后退出。查询或清理失败时保留主 Pi，显示错误并允许重试。
- `Leave temporarily` 不关闭 subagent。没有经过选择的 SIGHUP、SIGTERM、SIGKILL、Ctrl+D 或其他退出也不主动清理，之后可在进程和状态仍可用时 resume。
- 长期遗忘提醒、跨 session 统一管理入口、超时或闲置自动回收不在本轮范围。停止进程不删除 session 历史。
- 冒险工作只在 `/Users/wangxuyang/Code/t3code/pi-ext-subagent-cleanup` 和 `adventure/subagent-cleanup` 进行。不创建 PR、不合并、不安装到用户日常 Pi 配置，不操作用户已有 tmux 会话。
- 主工作区的未提交删除不属于本冒险。产品文案、Issue、提交和资料遵守仓库语言策略；`dist` 只由构建生成。

## Established Facts and Required Context

- [Map #17](https://github.com/wangxuyang1221/pi-ext/issues/17) 是地图；[Spec #18](https://github.com/wangxuyang1221/pi-ext/issues/18) 是最终规格；[Implementation #23](https://github.com/wangxuyang1221/pi-ext/issues/23) 保存执行、交付和协调者验收记录。
- 产品实现位于 `extensions/subagent/src/quit.ts`，由 `extensions/subagent/src/index.ts` 在 root TUI 的 `resources_discover` 阶段组合 editor factory。实现复用 manager 的 namespace、process identity、并发 barrier 和 5 秒操作截止时间。
- 测试位于 `extensions/subagent/__tests__/quit.test.ts`、`index.test.ts` 和 `manager-races.test.ts`。README 已补充行为说明。
- [实施报告](evidence/subagent-quit-implementation.md) 汇总范围、命令、结果与边界。结构化证据为 [产品场景矩阵](evidence/subagent-quit-product-results.json) 和 [编辑器入口矩阵](evidence/subagent-quit-product-entry-results.json)。
- worker 验证：subagent 203 passed、5 skipped；dist 入口 13/13；编辑器矩阵 12/12；产品场景矩阵 13/13；独立 build 与 `pnpm pack --dry-run` 通过。所有隔离 tmux、进程、socket 与临时目录已清理。
- 全量 `pnpm run check` 的 typecheck 通过，2350 tests passed、5 skipped。唯一失败是基准已有的 MCP prototype 缺 `prototypes/mcp-status-ui-prototype/src/codex-startup.js`，命令因此未进入 build/package。
- 独立 `pnpm run package:check` 因基准也缺 `docs/goal-descendant-acceptance.md` 失败。本关没有扩大范围修复这两项既有问题，也不宣称 canonical check 或 package:check 全部通过。
- 协调者独立重跑 42 项关键测试和 `pnpm run typecheck`，均通过；`git diff --check 6ba2e7c..acc97fa` 通过。协调者还核验 13/13 与 12/12 矩阵全部通过，且记录中的 live PID 为空、tmux socket 不可用。
- 当前冒险 worktree 干净，`acc97fa` 与 `origin/adventure/subagent-cleanup` 一致。最终存档提交会在其后追加。

## Current Assumptions

无影响交付的未验证假设。SIGHUP 结果只证明该信号路径，不外推所有终端应用的关闭行为。恢复依赖原有 tmux server、child 进程和 session 状态仍然存在。

## Continuation Point

当前停点是 Adventure 的最终用户验收。向用户提供分支、实现提交、Spec、Implementation 和实施证据入口，请用户确认交付。

如果用户确认，更新 Map 与 Spec 为完成状态，记录最终确认，关闭 #17 和 #18，再更新本存档、提交并推送。远端冒险分支是否删除由用户决定，不自动删除。

如果用户要求修改，识别受影响的 Spec 条目和关卡。局部实现问题重开或新建 Implementation；业务规则或原方案失效时重开对应 Planning。不得把新范围直接塞进已关闭的 #23。
