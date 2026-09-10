# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。遇到上下文缺口先读取所指来源，仍不足时明确缺口。
>
> 开始工作前，按当前任务识别本文适用的约束、未完成事项和必读材料。交付前逐项核对这些条件是否落实，保留影响结论的例外、未验证范围与停止条件；未落实的内容说明原因。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

按 adventure 流程推进 goal 的多 provider 与私有化模型适配。所有已发现的业务 Planning 已通关，进入实施准备，尚未修改产品源码。

- [Map #11](https://github.com/wangxuyang1221/adventure/issues/11) 管理进度与关卡入口。
- [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12) 是完整规格的唯一维护位置，已注明已确定、可用于实施，保持 open。
- [Planning #16](https://github.com/wangxuyang1221/adventure/issues/16) 已关闭，预算规则与延期验证已移交 Spec。

下一步先确认新增或修改的产品提示文案语言，再按 slicing 提交实施切片审核。语言不是本关未决业务规则，不要因此重开 #16。没有获批切片，没有 Implementation worker 正在运行。

## Evolution

用户指定 adventure 仓库托管 Issues，代码仍在 pi-ext，已同意独立分支、worktree 和仅推送冒险分支的范围。

[Planning #13](https://github.com/wangxuyang1221/adventure/issues/13) 确认 Pi 负责私有模型接入，goal 复用当前模型；[Planning #14](https://github.com/wangxuyang1221/adventure/issues/14) 验证 extension-only 可行，用户选择全部合规 Pi provider，而非只支持 OpenAI-compatible 的较轻首版。两关已关闭。

[Planning #15](https://github.com/wangxuyang1221/adventure/issues/15) 已确认异常终止、必要工具不可用、保守额度分类及不新增非空纯文本续跑限制，已关闭。前次手动存档停在 #16 首题，提交 `36e68c7`。

本轮用户恢复后连续选择四个方案 1：缺失 usage 提示并继续、保留排除 cacheRead 的公式、软预算收尾、停止后冻结迟到子代理计费增量。随后以“yep”确认剩余计量范围、恢复和提示兼容规则。完成本关验证，关闭 #16 并移交 Spec。本次是通关自动保存，不是用户要求暂停。

## Agreed Decisions and Constraints

完整行为以 Spec 的 Scope、Behavior、Design 和 Acceptance 为准。接续不得重问以下核心决定：

- 只改本仓库 extension，复用 Pi 当前模型、凭据及公开工具/消息/生命周期接口。不改 Pi 核心，不另建 provider HTTP 或鉴权链路，不按 provider 名称设白名单。覆盖支持普通 function tools 且履行 Pi 契约的内置、models.json 私有模型及自定义 provider；不承诺无工具模型或违规 adapter。保留根会话、TUI、持久化要求。
- 不新增连续非空纯文本、未调用工具的暂停或阻塞保护，也不强制预算。保留既有空响应、重复工具、连续执行失败机制。
- 等 Pi 自身恢复结束后，最终 settled 未恢复的 length/deferred 将仍 active 目标转 blocked；不复制 Codex 网络重试，不自行增加输出上限或增加异步结果取回。普通错误及 length/deferred 不覆盖 budget_limited。明确账户额度错误可依既有优先级转 usage_limited；裸 429、billing 等含糊信息不构成账户额度证据，不新增用户自定义错误匹配配置。
- 必要 goal 工具关闭时，保留目标状态、停止新自动续跑并提示缺失工具，不擅自重新启用。工具恢复后须显式 /goal resume，普通输入和模型切换不能解锁。已归属请求仍结算，不能用工具门控丢掉最后用量或抑制已知预算命中。
- 缺失、非法、未经证实全零 usage 提示不完整并继续，有无预算都适用。只累计已知有效用量；后续有效响应、编辑、恢复、重载不清除旧缺口。新目标独立计量。
- token 公式 input + output + cacheWrite，排除 cacheRead，reasoning 已在 output 内。归集根响应、Pi 提供 usage 的压缩/分支摘要及明确归属的受管直接子代理，不扩展任意工具内部调用、第三方或孙代理。
- 已知用量达预算后软收尾，保留实际超额值，不强杀当前回合、工具或子代理，不启动后续 goal 自动续跑。停止或预算收尾结束后，迟到子代理报告仅推进基线，不给目标加量；恢复前刷新基线，不补计冻结时已收到的增量。这不是远端费用硬上限，也不是精确的实际发生时间账单。
- 同一目标编辑、恢复、重载保留累计值及预算，耗尽预算不能靠 resume/edit 重置，不新增追加预算入口。继承复制累计快照，不继承活动子代理订阅；创建/替换新目标重新计量，旧事件不污染新目标。

操作范围：代码仓库 `wangxuyang1221/pi-ext`，分支 `adventure/goal-all-providers`，worktree `/Users/wangxuyang/Code/t3code/pi-ext-goal-all-providers`。当前主工作目录之外的该 worktree 写入、本次 Issue 更新及冒险分支提交推送已获用户“同意”。不改 main，不创建 PR、不合并、不部署，不记录密钥。遵循 `docs/agents/repository-language-policy.md`，产品文案语言尚待确认。

实施必须先提交切片审核。审核通过后主代理只协调和验收，按 adventure 派独立 worker，一次一关，同一 worktree 顺序接手；worker 新上下文，不继续委派，使用 write-todo-list 与 TDD。

## Established Facts and Required Context

- 产品起点 `870cf4961436e8252a61c00d29a300a5a4b53760`，当前产品源码仍未修改。`extensions/goal/src/capability.ts` 仍直接检查 openai-codex，因此通过现有测试不等于新增 provider 支持已实现。
- 开发依赖和实际安装均为 Pi 0.84.3，宿主为 0.85.1。固定 tag 对应 `4e58f324fae8ebfa98a3d45181fb248072a2afac` 与 `d981de1229ef899957bbe968bc8dcda02a21f477`。Context7 `/earendil-works/pi` 只覆盖 main，具体版本结论使用固定文档/源码。两版 Model 没有通用 supportsTools 标志，Usage 的 reasoning 是 output 子集，错误没有通用账户额度类别。
- [provider-feasibility.md](./evidence/provider-feasibility.md)：模型接入、公开事件与工具契约、支持边界及双版本固定来源。准备改准入或 SDK 集成时读取。对应 extensions/models/custom-provider 文档此前已全文核对，不必无新反证就重做。
- [exception-policy-review.md](./evidence/exception-policy-review.md)：#15 的组合规则及延期矩阵。实施切片必须分配其中的 SDK 恢复、工具门控/计量交叉、额度反例和旧事件隔离。当前 syncTools 会重加工具，现有 continuationDeferral 会被普通输入释放，两者均不能直接满足新规则。
- [budget-policy-review.md](./evidence/budget-policy-review.md)：#16 的本轮验证和延期矩阵。47 个实验场景通过，使用生产计量/存储代码和合成根事件，包含有/无预算、缓存、reasoning、全零、非法值、重放、来源组合、110/100、缺口持久化。实验没有真实 SDK 或 provider，预算回调为空实现，不证明 steering 时序。源码见 [budget-accounting.mjs](./experiments/budget-accounting.mjs)，结果见 [budget-accounting-results.json](./evidence/budget-accounting-results.json)。
- 本轮 Node 22.22.2、pnpm 11.9.0。`pnpm run check` 通过类型检查、1012 测试、构建与发布包校验，2 项 subagent 集成测试默认跳过，日志 [budget-planning-check.log](./evidence/budget-planning-check.log)。既有 child-budget/commands/controls 测试验证了冻结与恢复基线。前次安装及基线结果仍在 [baseline-check.log](./evidence/baseline-check.log)。
- 当前 `accounting.ts` 已计算 input+output+cacheWrite；`storage.ts` 的 accountChild 在停止后只推进基线。旧 `docs/goal-descendant-acceptance.md` 关于“完成后的迟到用量仍归集”以及旧 input+output 的描述与当前代码不符，不能用作本次规格，交付时需校正。
- 根 usage 缺失已有直接 warning，子代理 missing 通过目标快照传播。实施须验证两类来源的实际用户提示及查询/工具结果，不能只凭标记落盘宣称可见性通过。
- 其余已存证据按需要读取：[terminal-contract-review.md](./evidence/terminal-contract-review.md) 是最终结果与非空纯文本路径；[codex-text-loop-review.md](./evidence/codex-text-loop-review.md) 说明固定 Codex 版本无非空文本自动续跑上限；[codex-output-limit-review.md](./evidence/codex-output-limit-review.md) 说明 Codex 输出上限重试、最终 Blocked 与 incomplete usage 边界；[remaining-execution-boundaries.md](./evidence/remaining-execution-boundaries.md) 说明 deferred 和工具可见性。它们解释既有决定，不授权重新加入用户排除的保护或复制 transport 行为。
- Map 子 Issues 为 Spec #12、Planning #13/#14/#15/#16，四个 Planning 均关闭，Map 和 Spec 保持 open。没有实施 worker 或调研 subagent 在执行。本轮未启动独立后台服务；实验临时目录已清除，测试夹具自行回收，工作区 lsof 检查未发现遗留运行进程。

## Current Assumptions

未确认项只有实施准备中的产品文案语言、切片与验收分配。建议新改动提示沿用现有英文，不做全仓中文化，但用户尚未选择，不能当作已授权。

预计无需新的业务 Planning；若实际 SDK 运行证据推翻已确认设计，必须重开对应关卡、更新 Spec 与依赖，不能自行改业务取舍。预算实验和当前 check 不替代双版本新增跨 provider 验收。

## Continuation Point

本次 #16 通关自动保存后继续至产品文案语言问题。用户尚未回答这道题；本轮最后“yep”仅确认剩余预算兼容规则，不是文案语言或实施切片批准。

1. 先确认新增/修改的产品提示采用英文还是中文，推荐英文以保持当前界面一致。旧英文提示不因本次任务自动整体翻译；如用户选中文，写清仅本次改动范围还是更广范围，避免自行扩展。
2. 已完整读取 `/Users/wangxuyang/.agents/skills/wangxuyang/slicing/SKILL.md`。根据 Spec 和两份验证报告形成可独立验收的实施 slices，完整列出 goal/in_scope/out_of_scope/dependencies/acceptance/boundaries，交用户审核。将双版本 SDK、跨 provider、工具门控与用量交叉、提示可见性、文档和最终清理分配到具体关卡。审核前不创建 Implementation，不编写产品代码。
3. 审核通过后创建 Implementation Issues，写原生归属与依赖，保存并派发首个 worker。按 `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md` 及 `references/issue-templates.md` 执行；worker 接手前完整读取被交接的 `/Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md` 和 `/Users/wangxuyang/.agents/skills/wangxuyang/develop-with-tdd/SKILL.md`。一次一关，不继承协调者整段对话。
4. 每关验收、移交及保存后继续推进，只有用户决定、真实阻塞、暂停或最终确认时停下。保存使用 `/Users/wangxuyang/.agents/skills/wangxuyang/handoff/SKILL.md`，固定更新本文件，不另建常规 handoff 路径。
5. 最后一关 worker 对照完整 Spec 做整体验收，运行 `pnpm run check`、补齐双版本延期验证、核对交付文档与临时资源清理。协调者保存并提交用户确认；用户确认交付前 Map 和 Spec 保持 open。远端冒险分支不自动删除。
