# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。遇到上下文缺口先读取所指来源，仍不足时明确缺口。
>
> 开始工作前，按当前任务识别本文适用的约束、未完成事项和必读材料。交付前逐项核对这些条件是否落实，保留影响结论的例外、未验证范围与停止条件；未落实的内容说明原因。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

按 adventure 流程推进 goal 的多 provider 与私有化模型适配。用户首先想知道只修改 extension 是否可行，不预先承诺所有模型均可运行。

- [Map #11](https://github.com/wangxuyang1221/adventure/issues/11) 管理进度与关卡关系。
- [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12) 是规格唯一维护位置，当前形成中。
- [Planning #15](https://github.com/wangxuyang1221/adventure/issues/15) 是当前关卡，确定异常停止与恢复规则。

## Evolution

用户指定 adventure 仓库托管 Issues，代码仍在 pi-ext。已获准创建独立分支和 worktree，并只推送该分支。

[Planning #13](https://github.com/wangxuyang1221/adventure/issues/13) 已通关关闭。用户明确选择方案 1：Pi 负责私有化模型配置，goal 复用当前模型。由此排除 goal 自建模型接入入口；有效要求已移交 Spec。

[Planning #14](https://github.com/wangxuyang1221/adventure/issues/14) 也已通关关闭。用户明确选择全部合规 Pi provider 的方案 1，而不是仅支持 OpenAI-compatible 的较轻首版。架构可行性已核验，支持边界与 extension-only 路线已移交 Spec；#15 与 #16 已解锁。

## Agreed Decisions and Constraints

沿用 Spec 的 Scope、Behavior 与 Working agreement。核心边界是复用 Pi 当前模型，不另存 base URL、API key；覆盖所有 Pi 已接入、支持普通 function tools 且履行消息/终止事件契约的 provider，不按名称设白名单。保留根会话、TUI、持久化会话要求，不改 Pi 核心，不由 goal 实现任意私有协议。不得把后续候选保护策略或旧调研建议当作已确认需求。

代码仓库为 `wangxuyang1221/pi-ext`，冒险分支为 `adventure/goal-all-providers`，worktree 为 `/Users/wangxuyang/Code/t3code/pi-ext-goal-all-providers`。不改 main，不创建 PR、不合并、不部署，不记录密钥。当前主工作目录之外的该 worktree 写入和本次 Issue、冒险分支推送已获用户“同意”。

创建材料遵循仓库 `docs/agents/repository-language-policy.md`。产品文案写入前仍须询问。实施必须先完成规划并提交 slicing 审核，之后主代理协调 worker，一次实施一关。

## Established Facts and Required Context

- 起点提交为 `870cf4961436e8252a61c00d29a300a5a4b53760`，未修改产品源码。
- `extensions/goal/src/capability.ts` 直接检查 openai-codex，并要求根会话、TUI 和持久化会话。这是本次当前代码已核验事实。
- `package.json` 与实际安装的 Pi 开发依赖均为 0.84.3，宿主为 0.85.1。已在线核对两个固定 tag，并对照两版模型接入、扩展文档与相关类型契约。详细版本来源和边界见 [provider-feasibility.md](./evidence/provider-feasibility.md)。
- 已核验的架构结论：Pi 提供模型与凭据接入、统一工具/消息/终止事件，goal 可以在 extension 层适配合规 provider，不需要为此改 Pi 核心。但 Model 没有通用 supportsTools 标志，不能承诺任意模型会可靠调用工具；统一错误没有通用额度类别，usage 也可能缺失。
- 旧评估已过时：当前有重复工具调用和空响应保护；token 公式是 input + output + cacheWrite，不是旧报告的 input + output。
- 独立源码复核确认非空纯文本 stop 仍可能无限自动续跑，最终 settled 后的 length/deferred 可能留下 active 且无续跑。证据见 [terminal-contract-review.md](./evidence/terminal-contract-review.md)。未做真实模型端到端验证。
- Node 22.22.2、pnpm 11.9.0。新 worktree 已运行 `pnpm install --frozen-lockfile --ignore-scripts` 和 `pnpm run check`，后者通过类型、测试、构建及发布包校验：1012 项测试通过、2 项 subagent 集成测试跳过，见 [baseline-check.log](./evidence/baseline-check.log)。这是未修改产品源码的基线结果，不是跨 provider 新功能验收。
- Map 的子 Issues 为 Spec #12、Planning #13、#14、#15、#16。#14 原生依赖已关闭的 #13；#15 与 #16 均原生依赖现已关闭的 #14，两关均可推进，当前主线为 #15。
- research skill 安排的独立复核 subagent 已完成并关闭，报告已核对。没有需要后续接管的本任务后台服务。

继续前完整读取 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md` 及其 `references/issue-templates.md`。保存使用 `/Users/wangxuyang/.agents/skills/wangxuyang/handoff/SKILL.md`，存档固定写在本文件。

## Current Assumptions

当前待讨论的候选已写在 Planning #15：为连续非空纯文本、始终不调用任何工具的自动续跑增加有限暂停保护，保留目标并允许用户显式恢复。收益是避免持续发请求却不调用工具，代价是可能暂停合法的长篇写作或分析。另一候选是不新增此项保护，保留现有保护与手动停止。两者均未确认；不要把没有工具调用等同于语义上没有进展。

[Planning #15](https://github.com/wangxuyang1221/adventure/issues/15) 负责异常停止与恢复，[Planning #16](https://github.com/wangxuyang1221/adventure/issues/16) 负责 usage 缺失和预算语义。阈值、状态、持久化、真实服务测试范围等均未确认。

## Continuation Point

当前 #15 等待用户决定是否对连续纯文本自动续跑增加有限暂停保护。#13 和 #14 均已关闭，不要重复询问接入职责或支持范围。#15 的候选规则尚未移交 Spec。

1. 用户确认保护方向后，再确定必要的计数阈值、重置条件和持久化范围；随后继续工具缺失、length/deferred 等最终结果的停止与恢复规则。一次只问一个问题，不提前替用户作出这些设计取舍。
2. 运行保护与预算语义按决策依赖逐题推进，复用现有证据，不重做已证明的契约调查；新方案按必要场景做离线验证，不要求密钥或真实服务。
3. 每关通关后维护 Issue 正文、Spec 和本存档，提交推送冒险分支并核对 Map。只有用户决策、真实阻塞、暂停或最终确认时停下。
4. 规划收敛后读取 `/Users/wangxuyang/.agents/skills/wangxuyang/slicing/SKILL.md` 提交切片审核，再按 adventure 派 worker 实施；worker 使用 write-todo-list 与 TDD。不得把当前证据提交视为用户已批准编码。
5. 最终须运行 `pnpm run check` 并按 Spec 整体验收，完成延期验证和资源清理；Map 与 Spec 在用户确认交付前保持 open。产品文案语言仍待写入前询问。
