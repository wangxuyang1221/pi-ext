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
- [Planning #16](https://github.com/wangxuyang1221/adventure/issues/16) 是当前关卡，确定 usage 缺失与预算语义。

## Evolution

用户指定 adventure 仓库托管 Issues，代码仍在 pi-ext。已获准创建独立分支和 worktree，并只推送该分支。

[Planning #13](https://github.com/wangxuyang1221/adventure/issues/13) 已通关关闭。用户明确选择方案 1：Pi 负责私有化模型配置，goal 复用当前模型。由此排除 goal 自建模型接入入口；有效要求已移交 Spec。

[Planning #14](https://github.com/wangxuyang1221/adventure/issues/14) 也已通关关闭。用户明确选择全部合规 Pi provider 的方案 1，而不是仅支持 OpenAI-compatible 的较轻首版。架构可行性已核验，支持边界与 extension-only 路线已移交 Spec；#15 与 #16 已解锁。

[Planning #15](https://github.com/wangxuyang1221/adventure/issues/15) 已通关关闭。用户先排除额外纯文本循环保护，随后确认 length、必要工具关闭、deferred 和保守额度分类。固定源码与组合场景核对未发现规则冲突，有效要求已移交 Spec；新增实现的运行验证留待实施。

## Agreed Decisions and Constraints

异常规则完整内容见 Spec 的 Behavior、Design、Acceptance。接续必须保留以下核心决定：

- 不新增连续非空纯文本、未调用工具的暂停或阻塞保护。用户明确排除，不再追问阈值，也不为此强制预算；既有空响应、重复工具与执行失败保护保留。
- 先让 Pi 完成自身适用恢复。最终 settled 仍为 length 或未取回正常结果的 deferred，且 goal 仍 active 时标为 blocked，保留目标供 /goal resume。普通错误和这两类结果均不覆盖 budget_limited，不复制 Codex 网络重试，不新增异步取回流程，不误标 complete。
- 必要 goal 工具关闭时保留状态，停止新的自动续跑并提示缺失工具，不擅自重新启用。工具恢复后仍须显式 /goal resume，普通输入或模型切换不能自动解除。已经发出且归属目标的响应仍要结算，保留状态不排除实际 usage 触发预算限制。
- 最后一次用户选择方案 1：只做内置保守额度识别，不增加自定义错误匹配配置。明确账户额度耗尽为 usage_limited，其他无法恢复或分类的最终错误为 blocked。裸 429 不证明账户额度耗尽。普通错误保留 budget_limited，明确账户额度错误可沿用现有优先级改为 usage_limited。

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
- 用户追问 Codex 是否也存在该风险。在线核对本机 0.153.4、latest release 0.154.0，以及 main 固定 SHA `968835997714baaff199cfed5f89a2c65d8ca77d`：三者均无非空纯文本自动续跑次数上限；main 三轮空响应保护将非空文本记为 activity。原生依赖模型主动更新状态及预算/最终错误/外部控制等独立停止条件。证据见 [codex-text-loop-review.md](./evidence/codex-text-loop-review.md)。这是源码容许的执行路径，不是具体模型动态复现。
- 用户进一步要求核对 Codex 的单次输出上限行为。已核验 0.153.4、0.154.0 及 main 固定 SHA `eca63f0803aa334cd45908743b4696dec893b6ed`：response.incomplete/max_output_tokens 归为可重试 stream error；重试耗尽后关联且仍 Active 的 goal 转 Blocked，已命中的 BudgetLimited 不被普通错误覆盖。不会为该错误专门增大输出额度或压缩；未完成事件的 usage 不向 core 转交，预算存在观测边界。完整来源见 [codex-output-limit-review.md](./evidence/codex-output-limit-review.md)。Pi 将同类结果归一为 length，不能照搬 Codex 底层错误/transport 重试机制。
- 剩余边界已核验，见 [remaining-execution-boundaries.md](./evidence/remaining-execution-boundaries.md)：Pi 默认交互请求未启用 deferred，已查内置生产 adapter 无已找到的 producer，普通 Agent loop 不自动取回；不能排除自定义 provider 返回。Codex goal tools 不可见时停止自身续跑但保持持久化 Active，不自动重新启用工具。ExecutionUnavailable 则指三轮实际 exec 失败，不能混同两者。
- Node 22.22.2、pnpm 11.9.0。新 worktree 已运行 `pnpm install --frozen-lockfile --ignore-scripts` 和 `pnpm run check`，后者通过类型、测试、构建及发布包校验：1012 项测试通过、2 项 subagent 集成测试跳过，见 [baseline-check.log](./evidence/baseline-check.log)。这是未修改产品源码的基线结果，不是跨 provider 新功能验收。
- [异常规则场景核对](./evidence/exception-policy-review.md) 记录 #15 组合规则的静态验证及延期矩阵。已发现实现注意点：syncTools 不可无条件重加用户禁用工具；现有 continuationDeferral 会被普通用户输入释放，不能代表仅显式 resume 的新门控；工具执行门控不可混入计量 eligibility 导致最后一笔 usage 丢失。具体实现和实际 SDK 时序尚待测试，不应据此重问已确认行为。
- Map 的子 Issues 为 Spec #12、Planning #13、#14、#15、#16。#13、#14、#15 已关闭；#16 是当前主线，其原生前置 #14 已完成。Spec 和 Map 保持 open。
- 早期独立复核 subagents 已完成并关闭。Codex 输出上限复核 subagent `01a08ba1-72da-71f3-95ae-4f101e50f891` 已完成，报告已核对，保留给当前 Planning 的可能追问复用；使用前通过 subagent_list 核对是否仍存活，跨 session 不假定它存在。没有启动模型服务或需要接管的监听端口。

继续前完整读取 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md` 及其 `references/issue-templates.md`。保存使用 `/Users/wangxuyang/.agents/skills/wangxuyang/handoff/SKILL.md`，存档固定写在本文件。

## Current Assumptions

Planning #16 尚未作出预算行为决定。当前产品会对缺失、非法或未验证全零 usage 标记 usageIncomplete 并继续，tokensUsed 只反映已观测到的有效计量。推荐沿用此行为以兼容私有服务，但尚未获用户确认；另一候选是有预算目标遇到缺失 usage 时停止，无预算目标仍继续。

当前 token 公式 input + output + cacheWrite 排除 cacheRead，reasoning 已包含在 output，不重复相加。保留该公式与根响应、压缩、分支摘要、managed subagent 的归集范围是候选，不能仅因现状如此就视为用户确认。任何观测预算都不是远端费用硬上限，失败请求可能没有可用 usage。

## Continuation Point

#15 已关闭并移交 Spec，当前进入 #16。首题等待用户决定缺失 usage 时是否沿用提示并继续，或对有预算目标增加停止规则。不要重问 #13 至 #15 已确认事项。

1. 一次只问一个预算决策。先明确缺失 usage 的继续或停止行为，再按依赖确定 token 口径、检查时机、恢复和提示。能由代码回答的事实自主核验，复用现有固定来源，不索要密钥或真实服务。
2. #16 方案形成后按其通关条件验证缓存、reasoning、全零、非法 usage 和子代理归集例子，再通关移交 Spec、保存并继续。不得把静态场景推演记作新增功能已通过运行测试。
3. 每关通关后维护 Issue 正文、Spec 和本存档，提交推送冒险分支并核对 Map。只有用户决策、真实阻塞、暂停或最终确认时停下。
4. 规划收敛后读取 `/Users/wangxuyang/.agents/skills/wangxuyang/slicing/SKILL.md` 提交切片审核。把 Spec 的延期矩阵分配给 Implementation 或整体验收，审核后按 adventure 派独立 worker，一次一关；worker 使用 write-todo-list 与 TDD。当前只修改资料，尚未获批编码。
5. 最终须运行 `pnpm run check` 并按 Spec 整体验收，完成双版本延期验证和临时资源清理；Map 与 Spec 在用户确认交付前保持 open。产品文案语言仍须写入前询问。
