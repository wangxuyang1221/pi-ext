# Verification skill execution record

2026-10-27 在 macOS、本仓库 checkout 实跑。Node 22.22.2、pnpm 11.9.0、Pi 四包 1.4.0、Python 3.12.13、tmux 3.6b、fish 4.9.3。下列结果证明生成的入口可运行，并不表示全部 265 条子行为已经验收。

## Driver repair follow-up

2026-10-28 修复共享交互入口的外层 SIGTERM、独立 PTY 回收、证据归档与锁释放。修复后六项中断检查及七项运行支持回归通过；失败证据保留。Fast、permissions、subagent、skill-mentions 和 Goal 的专用入口也补齐启动失败、超时、中断及清理记录。Goal 普通生命周期与 footer 中途 SIGTERM 均保存动作、ANSI、会话和 owner；fork 登记窗口的信号回归通过。

九个扩展的正式驱动和操作说明已补齐真实取消、菜单选择、会话恢复及后续请求检查。共享 `journey` 配方成功仍标记 `manual-review-required`，需检查实际证据后记录对应行为通过。此前报告中打开选择器后按 Esc、仅 SDK 验证或单一媒体样本，仍不能作为所有用户分支通过的依据。

主代理复跑发布包的五种 PTY 模式，消费者冻结锁文件安装后字节未变，未打补丁的 Pi 上全部通过；source/dist 两轮 tmux 各 13 项通过；UI 五种工具状态模式、两个 codemode 模式及 Goal 四种 footer 模式通过。每项均核对独立进程退出与证据留存。可复现命令以各 skill 的当前入口为准，逐项状态与实际命令保存在仓库 `.tmp/skill-fixes/coordinator/summary.json`，原始证据保留于 `.tmp/test-results/`。

追加小窗口 TUI 发现重附工具声明未计入压缩后预算。修复复用冻结的真实请求投影计算固定部分，仅裁剪允许保留的历史；同一带工具场景由 11448 降到 11398 token，满足 11400 有效预算，pending 输入和工具声明保留。手动、自动、恢复和模型切换四入口均补回归。主代理随后完整 `pnpm run check` 通过，196 个测试文件、2913 项测试；日志为 `.tmp/skill-fixes/coordinator/check-budget-final.log`。

本轮严格口径为 252 passed、0 failed、13 unverified。剩余项是压缩历史分类/媒体组合的部分真实 TUI 分支、真实终端像素与拖选/剪贴板、Write/Edit 精确 Esc 时机，以及七项远端搜索分支。各项生产算法、协议或本地 TUI 证据分层保留；未实际运行的分支不改写为通过。

## Independent-use follow-up

两份独立自然任务由同一位审阅者按六项标准核对真实工具活动及应用证据，得分分别为 9/12、10/12。分数评估本次记录和任务遵约程度，不表示产品质量。原任务只要求九项日常流程，未要求 265 项完整矩阵。两份使用同一修复版，按用户要求执行者和审阅者均使用指定模型，因此没有跨模型或随机 A/B 的因果比较。

独立使用暴露了活动 Unix socket 归档失败、真实 managed Fast 入口绑定构建、缺少恢复后 reload 的固定组合，以及执行者通过技能组合入口间接运行本地 pi install 却声明未安装。原失败和错误声明均保留，另附范围更正，不将人工清理改写为原驱动成功。

后续修复只复制普通文件和目录，记录跳过的特殊文件；新增 `fast-managed` 和 `skills-combination-prebuilt`，均直接使用已有 dist；正式 subagent 旅程保留暂离、恢复、reload、继续消息的连续顺序。socket 回归已从真实复制异常转绿，Fast 两个生产 child 的 launch/首请求及 End session 清理通过；外层 SIGTERM 的七项清理与留证检查通过。技能组合验证 V1/V2/V3 快照且 installation 为空；subagent 完整旅程 330 项断言通过。记录见 `.tmp/skill-fixes/coordinator/followup-fixes.json`。

随后由全新执行者独立按当前说明运行上述三个流程，未安装、构建或改动实现。它额外将同一会话的 V1/V2 修改、菜单选回及续问串联验证，实际请求和持久历史均保留两版快照。主代理核对 389 个原始证据文件的哈希、请求内容和同一 child 的连续动作，62 个登记 PID 均已退出。记录为 `.tmp/elm/receipt.json`，核对结果为 `.tmp/skill-fixes/coordinator/elm-parent-review.json`。这是定向复验，不追加或改写前两份盲评分数。

该次独立操作还暴露 prebuilt 组合入口漏加载 codex-pi 主题。主代理增加断言，复现失败后补全主题参数；同一组合旅程再次通过，主题警告消失，V1/V2/V3 断言保留。自写 recipe 对整屏菜单背景的错误排除条件也保留原失败，重跑按选中行和会话身份判断；共享 recipe 文档已补充这个观察边界。

主题修复后的最终 `pnpm run check` 全部通过，196 个测试文件、2913 项测试，日志为 `.tmp/skill-fixes/coordinator/check-final-closeout.log`；另有共享运行器 8 项 Node 回归通过。依赖版本仍为 Node 22.22.2、pnpm 11.9.0、补丁版 Pi 1.4.0。

最终由另一位不继承操作对话的审阅者核对三个定向流程、实际工具活动和主题修复的红绿证据，六项标准均为 2 分，合计 12/12，无必须修复项。报告为 `.tmp/skill-fixes/coordinator/final-review.json`。它与此前九项任务的范围不同，分数不作直接提升比较，也不代表 265 项全部通过。

以下各节是此前运行历史。关于旧驱动兼容性、当时未修复的问题和覆盖状态，应结合当前 feature 文档与本次逐项报告读取，不将旧结果推广为当前完整覆盖。

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
