# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。遇到上下文缺口先读取所指来源，仍不足时明确缺口。
>
> 开始工作前，按当前任务识别本文适用的约束、未完成事项和必读材料。交付前逐项核对这些条件是否落实，保留影响结论的例外、未验证范围与停止条件；未落实的内容说明原因。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

按 adventure 流程完成 goal 的多 provider 与私有化模型适配。用户以 `next ?` 恢复游戏，撤销先前暂停要求。三关完整切片已获批，不重复审核。

- [Map #11](https://github.com/wangxuyang1221/adventure/issues/11) 管理地图与当前状态。
- [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12) 是完整规格唯一维护位置，已确定，可用于实施，保持 open。
- [Implementation #17](https://github.com/wangxuyang1221/adventure/issues/17) 已交付并通过协调者第一次验收。
- [Implementation #18](https://github.com/wangxuyang1221/adventure/issues/18) 是下一可执行关卡，最终异常停止与额度分类。
- [Implementation #19](https://github.com/wangxuyang1221/adventure/issues/19) 依赖 #18，负责计量与最终交付，同一 worker 完成 A/B 两阶段。

本存档是 #17 通关后的自动保存。保存后继续派发 #18，不等待用户重复授权。接续时先读 Map 与当前 Issue，判断是否已派发，避免重复施工。

## Evolution

代码起点 `870cf4961436e8252a61c00d29a300a5a4b53760`。Planning #13/#14 确认 Pi 负责模型配置与接入，goal 复用当前模型，仅改 extension，覆盖所有合规且支持普通 function tools 的 provider。Planning #15/#16 确认异常、工具恢复、预算与计量规则，均已通关并移交 Spec。

用户确认新增/修改产品提示使用英文。原五个候选切片按用户要求合并为三关，完整获批快照在 [implementation-slices-proposal.md](./evidence/implementation-slices-proposal.md)。已创建 #17/#18/#19 与原生依赖，前次在 `5cfd59f` 手动保存并暂停于派发前。

本轮恢复后，独立 worker 完成 #17，提交并推送 `50ff3b0de1071acec8bd3a85acf9f9b6b431cdd7`。实际 SDK 发现宿主 reload 会重启全部扩展工具，修复为在 reload shutdown 保存必要工具的外部排除项，并在 startup 恢复禁用意图。另一 SDK Red 证明创建时已有工具缺失，必须在首请求前持久化恢复门控。两者均属于获批局部实现，不改变 Spec。

协调者核对源码差异、测试和证据，独立重跑双版本新增 SDK 矩阵及全量 check，第一次验收通过。详细记录见 [slice-1-coordinator-acceptance.md](./evidence/slice-1-coordinator-acceptance.md)。

## Agreed Decisions and Constraints

完整行为以 Spec 为准，不重问已确认决定：

- 不按 provider 名称设白名单，不另建 HTTP、鉴权或全局配置入口，不改 Pi 核心。保留根会话、TUI、持久和已选模型准入。无工具模型及不合规 adapter 不在承诺范围。
- 不新增连续非空纯文本次数上限、强制预算或远端费用硬上限。保留既有空响应、重复工具和连续失败保护。
- Pi 自身恢复结束后才处理最终 length/deferred/普通错误。仍 active 的未恢复结果转 blocked；普通错误不覆盖 budget_limited。明确账户额度可转 usage_limited，裸 429、含糊 billing、认证/网络错误不作为账户额度证据。#18 负责实现与核验。
- 必要工具关闭只限制新自动续跑，不擅自恢复工具，不切断已归属用量及终态结算。工具恢复后仍须显式 `/goal resume`，普通输入、模型切换、reload 不解锁。
- token 使用 input + output + cacheWrite，排除 cacheRead，reasoning 已包含于 output。缺失、非法、未经证实全零 usage 提示不完整并继续，只累计已知有效用量。历史缺口不能被后续有效响应、编辑、恢复、重载清除。
- 归集根响应、Pi 提供 usage 的压缩/摘要及明确归属的受管直接子代理。不扩展第三方、孙代理或任意工具内部调用。
- 预算为软收尾，100 预算允许保留实际 110，不强杀当前运行、工具或子代理，不为迟到预算报告另开收尾回合。停止或收尾结束后迟到子代理增量只推进基线，恢复前刷新基线，不补计冻结时已观察到的增量。
- 同一目标 edit/resume/reload 保留用量、预算和缺口，耗尽预算不能重置。继承累计快照但不继承活动子代理订阅，新目标独立计量，旧事件不能污染新目标。

用户已批准操作范围：代码仓库 `wangxuyang1221/pi-ext`，分支 `adventure/goal-all-providers`，worktree `/Users/wangxuyang/Code/t3code/pi-ext-goal-all-providers`。允许该主工作区之外的 worktree 写入、`wangxuyang1221/adventure` Issue 更新及冒险分支提交推送。不改 main、不创建 PR、不合并、不部署、不发布 registry、不记录真实凭据或写用户全局配置。其他工作区外副作用仍遵循批准要求。

遵循 `docs/agents/repository-language-policy.md`。用户确认本次新增/修改产品提示英文，文档正文中文、标题英文，代码/测试名/注释英文，提交信息中文。`dist/` 只由构建生成。每关必须 `pnpm run check`。

主代理只协调与验收，一次推进一个 Implementation，每关独立 worker 使用新上下文，不再委派，执行计划只写当前 Issue，使用 write-todo-list 与 TDD。后续切片修订先审核；SDK 证据推翻规格时重开对应 Planning，不自行改业务。

## Established Facts and Required Context

- #17 产品提交 `50ff3b0` 已在远端。新增 `toolRecoveryRequired` 是权威 goal 快照的可选字段，保留旧记录兼容；专用于显式恢复，不替代普通输入可解除的继承 continuationDeferral。
- reload 工具排除项使用 `pi-ext-goal-tools` session custom entry，只保存必要工具的外部禁用，不是 goal 状态权威来源。写入失败会报错并继续释放 writer，已落盘的恢复门控仍保留；无法保证失败写入下禁用选择跨 reload 保存。
- 公开 lifecycle/命令检查点观察工具开关，不轮询。两检查点之间关闭又恢复、从未观察到的瞬时变化不可追溯。
- [slice-1-provider-admission.md](./evidence/slice-1-provider-admission.md) 包含实现、TDD Red/Green、双版本 SDK 方法/结果与复现。#18 修改 scheduler/index 或最终审计时必读。正式夹具为 `extensions/goal/__tests__/provider-runtime.mjs`，可供后续复用。
- Node 22.22.2、pnpm 11.9.0；依赖 Pi 0.84.3，宿主 0.85.1。两版各新增 22 场景、60 请求通过；既有 execution SDK 各 15 场景、132 请求通过。协调者独立复跑新增双版本矩阵通过。
- #17 全量 check 和协调者独立 check 均 1024 测试通过、2 个默认 subagent 集成测试跳过，类型检查/构建/发布包校验通过。日志在 [slice-1-check.log](./evidence/slice-1-check.log) 和 [slice-1-coordinator-check.log](./evidence/slice-1-coordinator-check.log)。跳过项不是通过。
- SDK 矩阵真实运行 SDK loop、模型加载和 function tools。models.json 私有模型用原生 Completions adapter + 离线 SSE；内置风格、Codex、自定义入口使用合规 streamSimple。没有真实远端 provider 实测，不证明其他原生 adapter 映射或 PTY 视觉效果。
- [provider-feasibility.md](./evidence/provider-feasibility.md) 是架构及固定 API 依据，准备 SDK 集成时读取。Pi 0.84.3 tag 为 `4e58f324fae8ebfa98a3d45181fb248072a2afac`，0.85.1 为 `d981de1229ef899957bbe968bc8dcda02a21f477`。Context7 `/earendil-works/pi` 仅覆盖 main，具体版本用固定文档/源码。Model 没有通用 supportsTools 标志，Usage reasoning 是 output 子集，没有统一账户额度枚举。
- [exception-policy-review.md](./evidence/exception-policy-review.md)、[terminal-contract-review.md](./evidence/terminal-contract-review.md)、[codex-output-limit-review.md](./evidence/codex-output-limit-review.md)、[remaining-execution-boundaries.md](./evidence/remaining-execution-boundaries.md) 为 #18 的异常与恢复规则依据。
- [budget-policy-review.md](./evidence/budget-policy-review.md) 及 [budget-accounting.mjs](./experiments/budget-accounting.mjs) 记录 47 个生产计量/存储合成场景，只支持预算规则，不替代真实 SDK/adapter 或 steering 时序。
- 旧 `docs/goal-descendant-acceptance.md` 关于完成后迟到子代理仍归集及 input+output 的文字已过时，#19 必须校正。根 missing 直接 warning、子代理 missing 快照传播的实际 TUI/工具结果可见性归 #19。
- #17 worker session 为 `01a08c27-5df2-75ce-b52f-81ebac7b1f35`，已结束本轮任务，可用于本关返工，不用于接管 #18 的新上下文。跨会话先通过当前可用 subagent 工具核对 runtime，不能假定可访问。
- #17 worker 与协调者测试均已退出，worktree `.goal-*` 临时目录无残留，无任务后台服务或监听端口。worker runtime 留待返工，不等于遗留测试服务。

## Current Assumptions

没有待用户选择的业务规划问题，预计可按 #18 → #19 继续。这个判断不替代后续实际 SDK 验证。#18 新终态规则与 #19 计量/最终交付尚未完成，不能把 #17 绿灯当作它们通过。

#19 的原生 adapter 代表样本与实际 TUI、受管直接子代理进程链路是已获批必需验收，不是已有通过结论。真实远端模型端到端不在已取得的证据范围。

## Continuation Point

1. 本存档为 #17 通关自动保存。读 Map、Spec 和 #18，核对最新冒险分支工作区及现存 worker，若 #18 未派发则立即派发，不重问批准。将 Workspace 固定到本存档的最新提交，保留 #17 产品与全部证据。
2. #18 worker 行动前完整读取 `/Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md`、`/Users/wangxuyang/.agents/skills/wangxuyang/develop-with-tdd/SKILL.md` 及必要引用，执行计划只维护在 Issue。必须双版本 SDK 验证最终恢复、length/deferred、额度正反例、预算优先级和工具门控组合；错误正例需固定官方依据。
3. 主代理依据 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md` 和 `references/issue-templates.md` 验收。每轮在 Acceptance 追加结论，返工交回原 worker；通过后关闭、使用 handoff 更新本文件、提交推送并核对 Map/远端文件，继续下一关。
4. #19 依赖 #18，通过前不派发。新 worker 同时负责阶段 A 计量和阶段 B 完整 Spec 审计。核对原生 Completions/Responses、Anthropic、Google，保留 Codex/自定义样本；真实受管子代理进程/投递/报告链路；实际 TUI 与工具提示；预算冻结恢复；正式文档与实际打包产物双版本加载。
5. 所有关卡通过后，协调者核对 #19 同一 worker 的整体验收，保存并提交用户确认。此时 Map/Spec 保持 open，下一步写等待用户确认，停止推进。用户确认后才关闭，远端分支不自动删除。
