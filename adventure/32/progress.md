# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。遇到上下文缺口先读取所指来源，仍不足时明确缺口。
>
> 开始工作前，按当前任务识别本文适用的约束、未完成事项和必读材料。交付前逐项核对这些条件是否落实，保留影响结论的例外、未验证范围与停止条件；未落实的内容说明原因。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为 Pi 现有 subagent 添加 agent_type 角色配置与独立 Fast 设置，支持主代理关闭而子代理开启，及主代理开启而子代理关闭。

[Map #32](https://github.com/wangxuyang1221/pi-ext/issues/32) 是入口；[Spec #33](https://github.com/wangxuyang1221/pi-ext/issues/33) 是完整规格的唯一维护位置，当前仍在形成。

## Evolution

从 main 的 501d395 建立独立 worktree 和分支。已核对当前启动与 Fast 路径，并创建方向规划 #34。用户选择 Pi 独立角色配置，方向关卡通关，解锁 #35 与 #36。未实施代码。

## Agreed Decisions and Constraints

- 使用 Pi 独立角色配置，按 agent_type 选择；不读取 Codex 角色文件。用户接受单独维护配置。配置目录、格式与字段尚未确认。
- 两种父子 Fast 开关相反的场景是明确需求，继承和持久化细节未定。
- Worktree：/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/subagent-profiles-fast。分支：adventure/subagent-profiles-fast。资料根目录为 adventure/32/。
- 本冒险的提交推送范围及操作限制见 [Spec working agreement](https://github.com/wangxuyang1221/pi-ext/issues/33#working-agreement)。不得创建 PR、合并或部署。工作目录外的写入须遵守用户 AGENTS 指令；当前所有本地任务文件都在原仓库内部。
- 遵守 [仓库语言策略](../../docs/agents/repository-language-policy.md)。修改源码与测试，不手改 dist，交付前运行 pnpm run check。
- 按用户调用的 adventure 流程逐个讨论需要用户决定的问题，已确认的决定不重复询问。规划完成后用 slicing 提交切片审核。进入实施后主代理协调，每关派一个 worker，使用全新上下文，提供必要 skill 的绝对路径，禁止再委派。

## Established Facts and Required Context

当前 spawn 支持 model 和 thinkingLevel，没有 agent_type 和 fast；child 是独立 Pi TUI。Fast 加载、--fast 和 /fast 都可能保存共享配置，独立 Fast 需要处理会话隔离。[静态核验证据](evidence/starting-point.md) 包含源码入口、工具版本及验证边界，设计时按需读取。

依赖尚未安装，未运行测试和构建，没有启动本任务的服务或后台进程。GitHub 已建立 Map、Spec、方向规划以及两个后续 Planning，归属使用子 Issue，后续 Planning 通过原生依赖引用 #34。

继续游戏时读取 /Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md 及必要引用。保存时使用 /Users/wangxuyang/.agents/skills/wangxuyang/handoff/SKILL.md；实施准备使用 /Users/wangxuyang/.agents/skills/wangxuyang/slicing/SKILL.md。

## Current Assumptions

候选推荐为用户级和项目级两个角色目录，同名角色由项目文件整份覆盖。候选默认路径为 ~/.pi/agent/agents/ 与 <project>/.pi/agents/，用户级尊重 agent directory 设置。该方案尚未得到用户确认，目录解析基准与格式仍需讨论。

## Continuation Point

当前关卡为 [角色配置加载规则 #35](https://github.com/wangxuyang1221/pi-ext/issues/35)。下一问题是只支持用户级目录，还是同时支持用户级与项目级目录。只询问这个决定，再按依赖顺序讨论字段、覆盖、发现和异常处理。

随后推进 [Fast 会话隔离 #36](https://github.com/wangxuyang1221/pi-ext/issues/36)，确定显式参数、角色默认值、缺省继承、子代理 /fast 与恢复行为。按任务要求核验 Pi 0.87.0 的实际接口，再形成可审阅切片。实施前须取得切片审核；交付须验证父子实际请求与配置隔离、完成 pnpm run check、保存提交并推送，最终等待用户交付确认。
