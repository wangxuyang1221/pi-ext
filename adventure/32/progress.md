# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。遇到上下文缺口先读取所指来源，仍不足时明确缺口。
>
> 开始工作前，按当前任务识别本文适用的约束、未完成事项和必读材料。交付前逐项核对这些条件是否落实，保留影响结论的例外、未验证范围与停止条件；未落实的内容说明原因。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为 Pi subagent 增加 agent_type 配置和父子独立 Fast。入口为 [Map #32](https://github.com/wangxuyang1221/pi-ext/issues/32)，完整规格仅在 [Spec #33](https://github.com/wangxuyang1221/pi-ext/issues/33) 维护。角色配置已确定，当前继续 [Fast 规划 #36](https://github.com/wangxuyang1221/pi-ext/issues/36)。

## Evolution

从 main 的 501d395 建立独立 worktree 和分支。#34 确认 Pi 独立配置；#35 经逐项讨论完成，规则已移交 Spec。用户先排除角色指令，之后明确 description 只辅助主代理选择，不作为 child 指令。用户要求目录可见范围与编排工具一致，仅 root 获得。尚未进入实施。

## Agreed Decisions and Constraints

- 仅用户级 <Pi agent directory>/agents/，默认 ~/.pi/agent/agents/，尊重 PI_CODING_AGENT_DIR；一个 JSONC 文件一个类型，文件名为 agent_type。
- description、model、thinkingLevel、fast 全部选填。description 提供给 root 辅助选择；不注入 child 提示词或 task，无角色指令字段。
- spawn 显式运行参数优先于角色设置，仅影响本次启动，不改文件。model、thinkingLevel 两处均未指定时继承主代理。Fast 两处未指定时已确认继承启动 child 时的主代理开关，此后互不跟随，其他运行隔离规则仍待 #36。
- 启动或 /reload 统一读取快照，公布合法角色名和可选 description；不每次 spawn 读文件。已启动 child 保持原设置。
- 错误按文件隔离，root 启动或 reload 提示错误文件和原因，错误角色不进入目录且不沿用旧配置；显式错误类型在启动前报错，不回退。普通 spawn 仍可用。
- managed child 的启动和 reload 都不注册编排工具或获得角色目录；加载、公布与诊断放在 root 分支。
- Worktree：/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/subagent-profiles-fast；分支：adventure/subagent-profiles-fast；资料：adventure/32/。操作范围见 [Spec working agreement](https://github.com/wangxuyang1221/pi-ext/issues/33#working-agreement)，不创建 PR、不合并、不部署。
- 遵守 [仓库语言策略](../../docs/agents/repository-language-policy.md)，修改源码与测试，不手改 dist，交付前运行 pnpm run check。工作目录外写入遵守用户 AGENTS 限制；本地任务文件均在原仓库内部。
- 使用 adventure 流程，已确认规则不重问；主要规划收敛后用 slicing 审核切片再实施。实施由主代理协调，每关一个全新上下文 worker，提供适用 skill 绝对路径，不再委派。

## Established Facts and Required Context

[基线证据](evidence/starting-point.md) 描述当前 spawn 与 Fast 行为；[角色接口证据](evidence/role-configuration.md) 包含 root-only 工具注册、Pi 0.87.0 的工具更新/reload 接口和运行验证边界。

Fast 扩展目前在加载、--fast、/fast 和 session_shutdown 保存共享配置，因此隔离必须覆盖关闭及 reload 的 shutdown，不能只处理 spawn 参数。[Fast 规划证据](evidence/fast-planning.md) 还记录了 Pi 0.87.0 custom entry 延迟 flush 的条件，不能未经实测就认为首次回复前状态已可靠落盘。

本 worktree 尚未安装依赖，未改产品代码、未运行测试或构建，没有启动本任务的服务。主工作区安装的 Pi 0.87.0 仅用于只读接口核验。静态接口可行性不等于运行验收通过；Spec 已记录真实 child 请求上下文与跨扩展延期验证。

继续时读取 /Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md 及必要引用；保存使用 /Users/wangxuyang/.agents/skills/wangxuyang/handoff/SKILL.md；实施准备使用 /Users/wangxuyang/.agents/skills/wangxuyang/slicing/SKILL.md。

## Current Assumptions

#36 中 Fast 缺省值已由用户确认。当前候选推荐为 child /fast 仅修改该子代理会话，reload/resume 保留最后设置；另一候选为临时切换，reload/重启恢复 spawn 初始值。该项尚未确认。

## Continuation Point

当前停点为 #36：用户已经选择 Fast 缺省时继承 spawn 当时的主代理设置，此后独立。下一问题是 child /fast 是否持久保留到该会话的 reload/resume，还是 reload/重启回到 spawn 初始值；随后确定模型支持边界与恢复场景。

随后核验跨扩展传递和状态恢复，补齐 Spec，使用 slicing 形成独立可验收切片并取得用户审核。实施及整体验收需覆盖角色目录 root/child 可见差异、快照与错误隔离、父子相反 Fast 实际请求和共享配置不被 child 改写。完成 pnpm run check、保存推送并等待用户交付确认。
