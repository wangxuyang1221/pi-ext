# Verification skill execution record

2026-10-27 在 macOS、本仓库 checkout 实跑。Node 22.22.2、pnpm 11.9.0、Pi 四包 1.4.0、Python 3.12.13、tmux 3.6b、fish 4.9.3。下列结果证明生成的入口可运行，并不表示全部 265 条子行为已经验收。

## Product regression follow-up

2026-10-28 完成五项产品修复及相关反例，完整记录见 [验收结果](../../../docs/verification-fix-results.md)。MCP 使用真实 SSE，Goal 额度使用 native adapter/SDK，Search 使用生产工具到本地 HTTP，Goal Esc 和 Skill Mentions 恢复选择器使用真实 PTY。未验证的其他 ID 与远程边界仍保留原状态。

新增共享 helper `search-references`、`skills-resume` 均退出 0、cleanup=removed，证据目录分别为 `.tmp/test-results/verify-search-references-uAunNq`、`.tmp/test-results/verify-skills-resume-41staS`。mcp-transports 已纳入 progress-transport.test.ts。完整 `pnpm run check` 退出 0，193 个测试文件、2869 项测试通过；Pi 补丁的冻结安装、发布包消费和 source/dist 加载也通过。

## Executed journeys

所有目录位于仓库 `.tmp/test-results/`。证据不提交，也不随 scratch 清理。

| Extension | Journey | Evidence directory |
| --- | --- | --- |
| codex-compact | metadata 查询、设置、重置；实际配置文件核对 | `verify-metadata-LzPb1M` |
| openai-fast-mode | /fast 四种命令和落盘开关 | `verify-fast-7wtXhk` |
| permissions | Deny 不写文件、Allow once 写入、取消 full 升级 | `verify-permissions-JuDpOi` |
| goal | 真实 TUI 三个 goal 工具、混合真实工具与恢复卡片 | `verify-goal-H6mKZP` |
| mcp | 本地 stdio echo、离线历史恢复和 reload，导出按键与 terminal | `verify-mcp-8d5B7q` |
| subagent | 两轮各 13 个真实 tmux/root/child 检查，含 Fast 继承 | `verify-subagent-IbOE2P` |
| codex-ui | 真实 QuickJS、本地 MCP、调用树、inspect、恢复与 resize | `verify-codex-ui-sJVheX` |
| codex-search | 生产 renderer 的搜索进度、完成/失败/取消与重启 | `verify-search-SAP4SC` |
| skill-mentions | 本地 CLI install 后 native PTY 的 28 项检查、37 次固定模型请求 | `verify-skills-Msr8pU` |

额外执行：`verify-compact-ffKmWa` 是真实 SDK 的 resume/repair 协议检查。`verify-permissions-r6KgU5` 是交互 helper 的菜单选择、接受 full 确认、切回 default 和正常退出，包含人工复核 verdict.md。自动 helper 与人工 helper 的结果区分为 passed 与 manual-review-required；后者须有复核结论。

## Evidence and cleanup

已通过的自动旅程 summary 都记录退出码 0、cleanup=removed 和进程清理结果。subagent 的嵌套宿主日志确认 livePids 为空、私有 socket 不可用；MCP 记录 child_pids_exited 和 ports=[]。命令 PTY 没有创建监听端口。证据保留了动作、终端状态以及适用的文件、session 或请求记录。

权限驱动第一次在取消弹窗后立即发 /quit，导致按键被当前弹窗消费，该次失败证据保留在 `verify-permissions-9wpsvg`，且完成清理。驱动现等待弹窗实际关闭后再发送下一条命令，重新运行通过。

## Boundaries

- 使用真实本地 Pi、文件、PTY、tmux 和 MCP stdio。模型/搜索结果由生产边界上的固定 provider 或 HTTP 响应替代。
- 自动旅程没有证明实时搜索准确性、远程压缩质量、真实 provider priority 采用情况，或第三方 MCP 服务可用性。
- 本轮 skill-mentions 使用 checkout 的本地安装，并非发布 tarball。包安装完整矩阵保留为单独的 skill-mentions:acceptance 入口。
- 按键及状态覆盖以具体 driver 和日志为准。各 feature 文件中的其余 ID 保持 unverified 或缺少前置条件时的 blocked，不能据此记录整个扩展全覆盖。
- 真实目标不会自带 faux provider、预置历史、本地 echo server 与测试 role 文件；这些是本次验证环境的前置步骤。

## Repository checks

基线 `pnpm run check` 通过，187 个测试文件、2831 项测试，包含构建、类型检查、发布包和源码/dist 加载检查。最终 `pnpm install --frozen-lockfile --ignore-scripts` 与 `pnpm run check` 均退出 0，187 个测试文件、2831 项测试通过。最终权限 helper 再次通过，证据为 `verify-permissions-YxkEcF`。日志保存在 `.tmp/verification/final-check.log`，汇总为 `.tmp/verification/proof-summary.json`。

## Audit corrections

随后九个 gpt-6.1-sol high 任务逐项报告全部 265 个 ID，原始汇总为 221 passed、7 failed、36 unverified、1 blocked，见仓库 `.tmp/parallel-verification-TXdlMV/VERIFICATION.md`。其中部分 passed 只覆盖行内注明的范围，不能作为完整用户入口覆盖率。该历史报告保留原样。

本次修订纠正 permissions 的 RPC 审批预期、Goal 继承 recordId/goalId、多个 SDK/冷启动与原生选择器的覆盖区别、512 条容量的测试引用、标签删除与拖选复制的边界。共享说明增加缓存隔离、Git 副本、socket 路径检查和逐分支判定标准；Goal 的旧驱动兼容性单独列出。产品问题仍保持失败预期，修复方案在 `docs/verification-fix-plan.md`，没有为了通过而修改产品。

修订后的实际 CLI 证明：

| Case | Evidence under .tmp/test-results | Verified behavior |
| --- | --- | --- |
| metadata | verify-metadata-UFq6lZ | 查询、保存、reset 保留其他字段、六种非法输入无写入；无模型请求 |
| metadata-project | verify-metadata-project-4vlIVT | 隔离 --approve 冷启动、项目优先、全局操作不改项目字节、非法输入拒绝 |
| permissions-modes | verify-permissions-modes-ksyLtl | print/json 拒绝写入及升级；RPC 拒绝、取消升级后仍审批、确认 Full access 后真实写入 |
| tool-status | verify-tool-status-FjqNCk | 五种模式均通过；artifacts 含五个 tool-status-smoke JSON 与 tool-status-last.ansi，补上原证据采集遗漏 |

以上 summary 均为 passed、cleanup=removed；两个 metadata 和 permissions-modes 的 journey.processStopped=true。新的 RPC driver 保存发送动作、实际 stdout/stderr 和文件副作用。metadata 首轮适配暴露换行及终端增量重绘观察问题，修订为保留 pyte 屏幕状态、等待完整提示及新增错误通知；失败证据保留，未削弱原有文件断言。print 的 UI 通知不输出到 stdout，因此无 UI 升级通过“命令被本地消费且后续修改仍被阻止”证明，不伪称捕获了该通知。

修订后完整 `pnpm run check` 退出 0，187 个文件、2831 项测试通过，构建、类型检查、发布包及源码/dist 加载校验通过；日志为 `.tmp/skill-fixes/check-final.log`。首轮文档检查拒绝指向被忽略 .tmp 的 Markdown 链接，已将本地证据位置改为路径说明后完整重跑，没有绕过检查。helper 清理审计在 `.tmp/skill-fixes/cleanup.json`，包含失败尝试的共 23 个记录 PID 均退出，scratch 与验证锁均无残留。tool-status 的清理由外层 summary 和五份帧中的 PID 核对，不要求其提供 commands.py 专用的 journey 文件。
