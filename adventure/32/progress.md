# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。遇到上下文缺口先读取所指来源，仍不足时明确缺口。
>
> 开始工作前，按当前任务识别本文适用的约束、未完成事项和必读材料。交付前逐项核对这些条件是否落实，保留影响结论的例外、未验证范围与停止条件；未落实的内容说明原因。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为 Pi subagent 增加 agent_type 配置和父子独立 Fast。入口为 [Map #32](https://github.com/wangxuyang1221/pi-ext/issues/32)，完整规格仅在 [Spec #33](https://github.com/wangxuyang1221/pi-ext/issues/33) 维护。角色配置与 Fast 规则均已确定，已创建 [Fast 实施 #37](https://github.com/wangxuyang1221/pi-ext/issues/37) 和 [角色实施 #38](https://github.com/wangxuyang1221/pi-ext/issues/38)，第一关已由 expert worker 交付并验收通过，接下来实施角色配置 #38。

## Evolution

从 main 的 501d395 建立独立 worktree 和分支。#34 确认 Pi 独立配置；#35 经逐项讨论完成，规则已移交 Spec。用户先排除角色指令，之后明确 description 只辅助主代理选择，不作为 child 指令。用户要求目录可见范围与编排工具一致，仅 root 获得。Fast #36 已确认并关闭，两个切片已获用户审核并授权施工，实施关卡已建立。

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
- 使用 adventure 流程，已确认规则不重问；两个切片已通过 slicing 审核，按关卡顺序实施。实施由主代理协调，每关一个全新上下文 worker，提供适用 skill 绝对路径，不再委派。

## Established Facts and Required Context

[基线证据](evidence/starting-point.md) 描述当前 spawn 与 Fast 行为；[角色接口证据](evidence/role-configuration.md) 包含 root-only 工具注册、Pi 0.87.0 的工具更新/reload 接口和运行验证边界。

Fast 扩展目前在加载、--fast、/fast 和 session_shutdown 保存共享配置，因此隔离必须覆盖关闭及 reload 的 shutdown，不能只处理 spawn 参数。[Fast 规划证据](evidence/fast-planning.md) 记录了该写入边界、已通过的 session 实验，以及 provider 匹配、错误识别和 provider 来源。

本 worktree 已安装依赖。#37 实现提交 04feb1f，证据提交 99bc128；协调者已核对并通过验收。Fast 真实 root/child 链路记录 23 个 HTTP payload 和 11 个文件检查点，首次回复前保存、reload、无 launch 的 true/false resume、拒绝隔离均通过。pnpm run check 的 2548 tests、构建和发布包校验通过，门控生产集成另行通过。测试进程与 socket 已清理，工作区交付时干净。详情与可复跑命令见 [Fast 实施证据](evidence/fast-implementation.md)。

继续时读取 /Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md 及必要引用；保存使用 /Users/wangxuyang/.agents/skills/wangxuyang/handoff/SKILL.md；实施准备使用 /Users/wangxuyang/.agents/skills/wangxuyang/slicing/SKILL.md。

## Current Assumptions

无待确认的规格或切片分歧。用户已明确使用 expert 类型，实际派发成功。

## Continuation Point

用户已审核 [完整切片](slices.md)，要求创建实施关卡后开始施工，执行代理类型为 expert。#37 已验收关闭，#38 已解锁，下一步派发全新上下文 expert 实施 #38，并负责完整 Spec 的整体验收。当前产品与证据基准为 99bc12890f9e7605dee7263580cde2ed53df0a33；派发时提供最新存档提交。

派发使用 expert、fork_turns none，提供 worktree、最新提交、Spec、关卡、证据和操作限制。worker 行动前完整读取 /Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md、/Users/wangxuyang/.agents/skills/wangxuyang/develop-with-tdd/SKILL.md 及必要引用，不再委派。用户批准 adventure 的提交推送范围，允许本任务实现与证据提交到冒险分支。

主代理协调并核对交付证据，不自行绕过 worker 实施。计划只在 Implementation 正文维护，详细证据在 adventure/32/evidence。#38 的 worker 承担完整 Spec 整体验收，角色默认 Fast、显式覆盖与父级继承须到实际请求验证，启动/reload 后 child 工具与模型上下文不得出现角色目录或 description。完成 pnpm run check、清理进程并确认监听释放，保存推送后等待用户交付确认。Map 与 Spec 保持 open。

主工作区 /Users/wangxuyang/Code/t3code/pi-ext 存在其他任务的 goal 扩展与 README 改动，勿修改或提交这些主工作区文件。冒险 worktree 的产品代码在 #37 交付时干净。
