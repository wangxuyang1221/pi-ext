# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。遇到上下文缺口先读取所指来源，仍不足时明确缺口。
>
> 开始工作前，按当前任务识别本文适用的约束、未完成事项和必读材料。交付前逐项核对这些条件是否落实，保留影响结论的例外、未验证范围与停止条件；未落实的内容说明原因。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为 Pi subagent 增加 agent_type 配置和父子独立 Fast。入口为 [Map #32](https://github.com/wangxuyang1221/pi-ext/issues/32)，完整规格仅在 [Spec #33](https://github.com/wangxuyang1221/pi-ext/issues/33) 维护。角色配置与 Fast 规则均已确定，当前等待用户审核 [实施切片提案](slices-proposal.md)。

## Evolution

从 main 的 501d395 建立独立 worktree 和分支。#34 确认 Pi 独立配置；#35 经逐项讨论完成，规则已移交 Spec。用户先排除角色指令，之后明确 description 只辅助主代理选择，不作为 child 指令。用户要求目录可见范围与编排工具一致，仅 root 获得。Fast #36 已确认并关闭，当前只形成待审核切片，尚未进入实施。

## Agreed Decisions and Constraints

- 仅用户级 <Pi agent directory>/agents/，默认 ~/.pi/agent/agents/，尊重 PI_CODING_AGENT_DIR；一个 JSONC 文件一个类型，文件名为 agent_type。
- description、model、thinkingLevel、fast 全部选填。description 提供给 root 辅助选择；不注入 child 提示词或 task，无角色指令字段。
- spawn 显式运行参数优先于角色设置，仅影响本次启动，不改文件。model、thinkingLevel 两处均未指定时继承主代理。Fast 两处未指定时已确认继承启动 child 时的主代理开关，此后互不跟随，child /fast 仅保存到该子代理会话，reload/resume 保留，不改共享配置与角色文件。
- 启动或 /reload 统一读取快照，公布合法角色名和可选 description；不每次 spawn 读文件。已启动 child 保持原设置。
- 错误按文件隔离，root 启动或 reload 提示错误文件和原因，错误角色不进入目录且不沿用旧配置；显式错误类型在启动前报错，不回退。普通 spawn 仍可用。
- managed child 的启动和 reload 都不注册编排工具或获得角色目录；加载、公布与诊断放在 root 分支。
- child /fast 只保存当前子代理会话的选择，reload/resume 保留；普通 root 持久化语义保持原状。Fast 模型匹配与明确拒绝沿用既有兼容行为，不新增能力探测；未知错误不关闭 Fast，失败不自动重放。
- Worktree：/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/subagent-profiles-fast；分支：adventure/subagent-profiles-fast；资料：adventure/32/。操作范围见 [Spec working agreement](https://github.com/wangxuyang1221/pi-ext/issues/33#working-agreement)，不创建 PR、不合并、不部署。
- 遵守 [仓库语言策略](../../docs/agents/repository-language-policy.md)，修改源码与测试，不手改 dist，交付前运行 pnpm run check。工作目录外写入遵守用户 AGENTS 限制；本地任务文件均在原仓库内部。
- 使用 adventure 流程，已确认规则不重问；主要规划收敛后用 slicing 审核切片再实施。实施由主代理协调，每关一个全新上下文 worker，提供适用 skill 绝对路径，不再委派。

## Established Facts and Required Context

[基线证据](evidence/starting-point.md) 描述当前 spawn 与 Fast 行为；[角色接口证据](evidence/role-configuration.md) 包含 root-only 工具注册、Pi 0.87.0 的工具更新/reload 接口和运行验证边界。

Fast 扩展目前在加载、--fast、/fast 和 session_shutdown 保存共享配置，因此隔离必须覆盖关闭及 reload 的 shutdown，不能只处理 spawn 参数。[Fast 规划证据](evidence/fast-planning.md) 记录了该写入边界、已通过的 session 实验，以及 provider 匹配、错误识别和 provider 来源。

本 worktree 尚未安装依赖，未改产品代码、未运行项目测试或构建，没有启动本任务的服务。已用主工作区安装的 Pi 0.87.0 运行 [session-state.mjs](experiments/session-state.mjs)，证明预创建空 session 的 custom entry 在首次回复前落盘且可重新打开恢复 false；普通新 session 仍会延迟 flush。实验临时文件已清理，证据不等于真实 child 全流程验收。Spec 已把跨扩展请求与生命周期验证分配给待审核切片。

继续时读取 /Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md 及必要引用；保存使用 /Users/wangxuyang/.agents/skills/wangxuyang/handoff/SKILL.md；实施准备使用 /Users/wangxuyang/.agents/skills/wangxuyang/slicing/SKILL.md。

## Current Assumptions

规格没有待用户决定的行为分歧。两切片提案尚未审核：Slice 1 先交付普通 spawn 的独立 Fast，Slice 2 再交付角色配置并完成整体验收。不要把提案当成已批准实施，不提前创建 Implementation 或派发 worker。

## Continuation Point

当前等待用户审核 [完整切片提案](slices-proposal.md) 的依赖和粒度。若用户提出调整，按 slicing skill 修订并再次审核；不得依据旧提案开始实施。

批准后，将每个切片完整写入 Implementation Issue，关联到 Map 并用原生依赖表示 Slice 2 依赖 Slice 1。更新 Spec 的延期验证归属和 Map，保存进度后派发首个可执行 worker。主代理进入实施后担任协调者。使用 worker agent_type、fork_turns none，明确 worktree、当前提交、Spec、切片、证据、操作限制和必须读取的 skill 绝对路径；worker 不再委派。

每关由 worker 使用 /Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md 在 Issue Execution 维护计划，完成编码和证据；行为修改应按项目适用的 TDD skill 执行。协调者核对证据来源和实际路径，不把 mock 注册或 CLI 参数断言当作真实 child 验收。Slice 2 的 worker 最后对照完整 Spec 验收，运行 pnpm run check，清理本任务进程并确认监听释放，保存推送后等待用户交付确认。Map 与 Spec 保持 open 到用户确认交付。

用户最新两次追问均是当前规划中的澄清，不是取消任务：Fast 不预先查询模型能力，按 provider/本地名单尝试并识别明确 Codex 拒绝；openai 与 openai-codex 来自 Pi 内置 provider，分别默认使用 API key 的 API 通道与 ChatGPT OAuth 通道。证据中有版本与源码入口，不需要重复询问已确定规则。
