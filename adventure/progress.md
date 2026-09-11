# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。遇到上下文缺口先读取所指来源，仍不足时明确缺口。
>
> 开始工作前，按当前任务识别本文适用的约束、未完成事项和必读材料。交付前逐项核对这些条件是否落实，保留影响结论的例外、未验证范围与停止条件；未落实的内容说明原因。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

goal 多 provider 与私有化模型适配已完成本地分支实施和验收。三关 Implementation 均由独立 worker 交付并通过协调者第一次验收，最后一关的同一 worker 已完成完整 Spec 整体验收。用户要求手动保存游戏进度，本次保存后停止推进，停在已配置安装、等待用户试用及最终交付确认的位置。Pi全局本地包来源已切至冒险worktree；代理没有重载当前会话，用户是否已自行重载尚未核实。

- [Map #11](https://github.com/wangxuyang1221/adventure/issues/11) 与 [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12) 保持 open，用户确认后才关闭。Spec 是完整规格唯一维护位置。
- [Implementation #17](https://github.com/wangxuyang1221/adventure/issues/17)、[#18](https://github.com/wangxuyang1221/adventure/issues/18)、[#19](https://github.com/wangxuyang1221/adventure/issues/19) 均验收通过。
- 产品提交为 `7bff254d732c769d2e88474da645bf911fc5f6f8`，安装记录检查点为 `61b2041cbc469b6447cba0f7ab44341ef9440a87`；之后只更新资料，本次未修改产品源码或Pi安装配置。
- [完整交付审计](./evidence/slice-3-spec-audit.md)、[最终协调者验收](./evidence/slice-3-coordinator-acceptance.md)、[正式使用说明](../docs/goal-provider-support.md) 为主要入口。

无需继续派发新的 Implementation，也不因没有真实远端模型实测就自行扩大范围。用户提出具体修改时再恢复对应关卡。

## Evolution

产品起点 `870cf4961436e8252a61c00d29a300a5a4b53760`。Planning #13/#14 确认 Pi 负责模型接入和凭据，goal 仅改 extension，支持全部合规且支持普通 function tools 的 provider。#15/#16 确认异常、工具恢复、预算与计量规则，全部移交 Spec 并关闭。

用户确认新增/修改产品提示使用英文。原五个候选切片按用户要求合为三关，完整获批快照在 [implementation-slices-proposal.md](./evidence/implementation-slices-proposal.md)。创建 #17/#18/#19 后曾于 `5cfd59f` 手动保存暂停。

用户以 `next ?` 恢复，撤销暂停。主代理顺序派发三个独立 worker，每关验收后自动保存，不重复审核：

1. #17 产品 `50ff3b0`，存档 `3033c13`。移除 provider 白名单，持久化独立工具恢复门控。实际 SDK 发现 reload 会重加扩展工具，补保存外部排除项；创建时工具已缺失则首请求前落盘门控。
2. #18 产品 `b5ef6cd`，存档 `46114b5`。终态等宿主 settled，保守额度分类。SDK Red 修复 compaction 失败后旧 continuation 越过失败、内部取消误记暂停及嵌套 summary 前缀遗漏。
3. #19 产品 `7bff254`。补齐子代理缺失 usage 的即时英文 warning，未改公式或前序业务。完成双版本原生计量、真实受管进程/tmux、实际 TUI、实际包加载、文档和完整 Spec 审计。协调者独立复跑后验收通过。

所有局部发现都在获批切片范围内解决，没有更改业务规格，也没有重开 Planning。

最终验收存档 `4bb1225` 后，用户要求安装以自行验收。代理核对原安装来自main工作区，说明只替换全局packages中的pi-ext本地路径及回退方式，用户回复“同意”。已切至冒险worktree，pi list核对通过，未重载当前会话，也未将安装授权当作交付确认。详见 [user-installation.md](./evidence/user-installation.md)。

用户随后要求“保存游戏进度”。核对本地与远端均为 `61b2041`、工作区干净，安装来源仍为冒险worktree，当前没有存活或待创建worker。按手动保存更新本文件与Map，保留三关已关闭、Map/Spec等待用户确认的状态。此次保存不代表用户已经完成验收，不派发新任务或自动重载Pi。

## Agreed Decisions and Constraints

完整行为以 Spec 为准，接续不要重问以下决定：

- 复用 Pi 当前模型与配置，不按 provider 名称设白名单，不建独立HTTP、鉴权或凭据入口，不改Pi核心。保留根会话、交互TUI、持久和已选模型边界，不保证无工具模型或不合规adapter。
- 不新增连续非空纯文本次数限制或强制预算。保留原有空响应、重复工具和连续执行失败保护。
- Pi恢复结束后最终未恢复length/deferred/普通错误将仍active目标转blocked。普通错误不覆盖budget_limited，明确账户额度可转usage_limited；裸429、billing、认证/网络不构成账户额度证据。不复制重试、不提高输出上限、不取回deferred结果。
- 必要工具关闭不擅自重开，只停止新自动续跑；已归属用量和终态仍结算。工具恢复后须显式 `/goal resume`，普通输入、edit、模型切换和reload不能绕过。
- token公式 `input + output + cacheWrite`，排除cacheRead，reasoning已含于output。缺失、非法、未经证实全零usage提示不完整并继续，有无预算均适用；只计已知有效值，后续有效响应、edit/resume/reload不能清除历史缺口。
- 归集根响应、Pi提供usage的压缩/摘要及明确归属受管直接子代理。不扩展任意工具内部、第三方或孙代理账单。
- 软预算允许实际110/100，不强杀当前运行、工具或子代理，不再发后续goal自动续跑。根已结束后迟到预算不另开提示回合。停止或预算收尾结束后child只推进基线，恢复前刷新，不补计冻结时已观察到的增量。10→50→60最终贡献20，不保证按真实发生时间精确切账。
- 同目标保留用量、预算和缺口，耗尽预算不能靠resume/edit重置或追加。继承累计快照但不继承活动child订阅，新目标独立计量，旧事件不能污染新目标。

用户已批准操作范围：代码仓库 `wangxuyang1221/pi-ext`，分支 `adventure/goal-all-providers`，worktree `/Users/wangxuyang/Code/t3code/pi-ext-goal-all-providers`；允许该主工作目录之外worktree写入、`wangxuyang1221/adventure` Issues更新及冒险分支提交推送。不得改main、PR/合并/部署/registry发布、Pi核心、真实凭据或全局用户配置。后续用户另行明确批准试用安装，只将 `/Users/wangxuyang/.pi/agent/settings.json` 的pi-ext包来源切至冒险worktree；该项为全局配置限制的已批准例外。其他工作区外副作用仍须批准，必要依赖安装例外。

遵循 `docs/agents/repository-language-policy.md`。本次新增/修改产品提示英文已确认；文档正文中文、标题英文，代码/测试名/注释英文，提交信息中文。`dist/` 只能构建生成，完成前 `pnpm run check`。

Adventure由主代理协调，一次一关，worker新上下文、不再委派，执行计划只在Issue，使用write-todo-list与TDD。后续切片修订先审核；若SDK证据推翻规格则重开Planning，不自改业务。Map/Spec在用户确认前open；远端冒险分支不自动删除。

## Established Facts and Required Context

### Product and verification

- Pi日常安装来源已从 `../../Code/t3code/pi-ext` 切为 `../../Code/t3code/pi-ext-goal-all-providers`，配置位于 `~/.pi/agent/settings.json`。其余package条目及配置保留，特别是独立codex-search仍从main路径加载。切换后pi list与7extension/1theme入口核验通过，check再跑1067通过/2默认跳过。当前会话需用户 `/reload` 或重启才能加载，代理未自动重载；本地安装直接引用worktree，不是固定提交副本。详情和回退见 [user-installation.md](./evidence/user-installation.md)。
- #17的权威goal快照新增可选 `toolRecoveryRequired`，旧记录兼容。它与普通输入可解除的继承continuationDeferral不同。reload通过 `pi-ext-goal-tools` session custom entry保存必要工具外部排除项。写入失败会报错并释放writer，但不能保证失败写入下的禁用项跨reload保存。公开检查点之间关闭又恢复且从未被观察到的瞬时变化不可追溯。
- #18 scheduler复核响应/运行/目标归属，settled异步存储前后再次核对。quota分类器只有固定来源的精确码和锚定文案。`You have hit your ChatGPT usage limit.` 可能由Codex adapter对裸429生成，不作为明确账户额度证据。详见 [slice-2-final-outcomes.md](./evidence/slice-2-final-outcomes.md#classification-sources)。
- #19只在child计量成功提交后首次完整→不完整时通知，没有改公式、冻结或计费路径。Google两版原生cacheWrite为0，实际90样本是80+10+0，其他家族及公式测试验证50+10+30。未伪造Google字段。
- Node22.22.2、pnpm11.9.0；依赖Pi0.84.3、宿主0.85.1。Context7 `/earendil-works/pi` 只有main，固定版本依据官方源码/已安装包。两版共12份adapter源码与source map逐字节核对，见 [source hashes](./evidence/slice-3-fixed-sources.json)。
- 本次手动保存重新运行 `env -u PI_SUBAGENT_PARENT pnpm run check`，1067测试通过、2项默认跳过，类型/构建/包校验通过；本地存档引用均可访问，检查后没有遗留测试进程。日志 [manual-save-check.log](./evidence/manual-save-check.log)。
- 最终worker与协调者check均1067测试通过、2项默认跳过，类型/构建/包校验通过。隔离subagent integration由worker另行1项通过，默认在线项未运行，不能计为通过。协调者日志 [slice-3-coordinator-check.log](./evidence/slice-3-coordinator-check.log)。
- 两版原生根计量各74场景/288请求、真实受管IPC各16场景/16child；协调者独立重跑均通过。worker另跑两版tmux late/pending各2场景。真实进程有生产投递/报告/close，不是只伪造报告文件。
- worker实际InteractiveMode PTY两版×根/child×无预算/1000共8组通过。协调者另抽验0.84.3根无预算与0.85.1 child预算1000，通过，edit/reload/resume后7token与旧缺口可见。
- 前序双版本每版provider22场景/60请求、terminal56/129、execution15/132在#19再次通过；#17/#18之前已有协调者独立复验。
- worker实际包306文件、416196bytes，SHA256 `88cadd23a22df27c42184a0b08fc2b5ca493cdad5088ebb99c3b361a12a65412`，305个非manifest文件与最终构建逐字节一致。两版由Pi发现全部7入口、4个非Codex原生家族各20请求通过，包内完整计量矩阵亦通过。协调者独立pack、解压、artifact检查及双版本正常流程通过。临时包已删，可按正式命令重建，不是已发布registry。

### Evidence entrances

- [slice-3-spec-audit.md](./evidence/slice-3-spec-audit.md)：最后worker的完整Spec/Acceptance/延期逐项对照、包和文档核验、复现与限制。交付确认或后续修改先读。
- [slice-3-coordinator-acceptance.md](./evidence/slice-3-coordinator-acceptance.md)：最终独立验收与清理；[runtime摘要](./evidence/slice-3-coordinator-runtime.json)记录协调者PTY和包复验。
- [slice-3-accounting.md](./evidence/slice-3-accounting.md)：原生adapter、真实child、实际TUI方法和命令，展开计量/TUI缺陷时读。
- [slice-1-provider-admission.md](./evidence/slice-1-provider-admission.md)及[协调者验收](./evidence/slice-1-coordinator-acceptance.md)：准入、工具恢复和reload证据；[slice-2-final-outcomes.md](./evidence/slice-2-final-outcomes.md)及[协调者验收](./evidence/slice-2-coordinator-acceptance.md)：最终异常、额度来源和归属。
- [provider-feasibility.md](./evidence/provider-feasibility.md)、[exception-policy-review.md](./evidence/exception-policy-review.md)、[budget-policy-review.md](./evidence/budget-policy-review.md)：规划依据和固定版本入口。历史推演不是新增实现已通过的唯一证据。
- 正式夹具在 `extensions/goal/__tests__/`：`provider-runtime.mjs`、`terminal-runtime.mjs`、`accounting-runtime.mjs`、`accounting-child-runtime.mjs`、`accounting-tui-driver.py`、`package-provider-runtime.mjs`。根测试使用 `env -u PI_SUBAGENT_PARENT`，仍保留显式child准入反例。
- 当前说明在 [README](../README.md#goal-extension) 与 [goal-provider-support.md](../docs/goal-provider-support.md)，已纠正旧descendant公式和完成后的迟到归集。其他旧报告已注明历史适用范围。

### Cleanup and limits

三名本场worker runtime已关闭，不应尝试使用旧agentId继续派发。本次手动保存再次核对subagent列表为空，无须等待或中止实施。所有结果已经入库并在Issue正文记录。协调者核对78个测试/worker PID均退出；无任务监听端口、`.goal-*`、`.slice-3*`、`.coordinator-*`临时目录。未停止用户原有宿主服务。PTY必要依赖pyte0.8.2已按依赖安装例外装入既有conda `codex-py312`，没有写Pi全局配置。

未运行真实远端/付费模型、所有私有额度文案、Windows/Linux实际TUI、断电恢复或默认在线subagent integration。没有精确远端费用/硬封顶、未暴露服务端用量或孙代理账单保证。上述范围不属于本次必需验收；不能因离线矩阵通过宣称远端全部实测。

## Current Assumptions

所有获批实施与必需本地验收均已完成，没有已知失败断言或必需未验证项。用户尚未确认最终交付，不能把协调者验收等同于用户接受。后续修改或外部环境变化可能要求重跑受影响测试，但当前不自动扩大范围。

## Continuation Point

本次为用户要求的手动存档，保存并核对远端后停止。暂停位置是新版已配置安装，等待用户试用和最终交付确认；不是编码途中或切片审核。代理没有执行 `/reload`，用户是否自行重载尚未核实。安装授权和“保存游戏进度”均不等于验收通过。试用期间不要删除worktree；用户若反馈问题，先确认其运行实例是否已重载。

1. 读取Map及用户最新回复。用户明确确认交付后，更新Spec状态和Map下一步，关闭Map/Spec，并用 `/Users/wangxuyang/.agents/skills/wangxuyang/handoff/SKILL.md` 更新本文件、提交推送、核对远端。只读查看或模糊的继续不等于批准PR、合并或部署。
2. 用户提出修改时，按受影响规则恢复对应关卡。先读本文件引用的当前实现/验收证据，不重做已完成调研或重问已确认规格。旧worker已关闭，需要时依adventure安排新的独立worker，执行前完整读取write-todo-list/TDD技能绝对路径及引用。修订切片须用户审核，业务规则失效重开Planning。
3. 不自动删除冒险分支或worktree，不创建PR、合并、部署、发布。远端分支删除由用户决定，删除前先安排仍需保留的资料链接。
