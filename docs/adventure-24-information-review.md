# Adventure information review

审阅日期：2026-09-22。对象为 [Map #24](https://github.com/wangxuyang1221/pi-ext/issues/24)、关联 Spec、六个关卡及交付材料。本文用于改进 adventure skill 的信息组织与验收方式。

## Assessment

这场冒险的基本拆分合理，产品要求和多数验证边界也有记录。主要问题出在信息汇总与保存：细节报告中的限制没有约束上层的通过结论；同一事实被复制到多处后，部分内容逐渐失效；已结束任务仍使用随 main 变化的文件入口。

我建议优先处理三件事：

1. 验收结论必须对应具体行为和实际执行路径，不能用测试数量或几个局部通过结果替代。
2. 已关闭冒险的存档与证据固定到交付提交，避免后续清理 main 时破坏入口。
3. 明确每类信息的维护位置，减少 Map、Spec、关卡和 progress.md 的重复叙述。

本次 wait 名称问题属于实现 bug，也暴露了验收覆盖缺口。Spec 已要求六类工具名称一致；优化 skill 的重点应是让这类要求进入可检查的验收，而不是把漏实现重新解释成未提出需求。[规格](https://github.com/wangxuyang1221/pi-ext/issues/25#acceptance)、[原交付源码](https://github.com/wangxuyang1221/pi-ext/blob/ad638b57d06e55287175f1f97adbb5840924d4d7/extensions/subagent/src/tools.ts#L381)、[后续修复](https://github.com/wangxuyang1221/pi-ext/commit/b0f4f1b5d2673d92a2cca7b70090bd9e6615c649)。

## Audit scope

| Artifact | Responsibility | Observed state |
| --- | --- | --- |
| [Map #24](https://github.com/wangxuyang1221/pi-ext/issues/24) | 导航、当前进度、交付入口 | 已关闭；原生子 Issue 包含 #25–#31 |
| [Spec #25](https://github.com/wangxuyang1221/pi-ext/issues/25) | 视觉与英雄名的完整规格 | 已关闭，正文注明已交付 |
| [Planning #26](https://github.com/wangxuyang1221/pi-ext/issues/26) | 确定优先问题及六工具范围 | 已关闭，要求已移交 Spec |
| [Planning #27](https://github.com/wangxuyang1221/pi-ext/issues/27) | 确定视觉规则并审阅原型 | 已关闭，保存用户决定与原型入口 |
| [Planning #28](https://github.com/wangxuyang1221/pi-ext/issues/28) | 确定英雄名分配与兼容规则 | 已关闭，说明实施阶段仍需验证的事项 |
| [Implementation #29](https://github.com/wangxuyang1221/pi-ext/issues/29) | 清理阻断标准检查的失效引用 | 已关闭，有修改边界及检查结果 |
| [Implementation #30](https://github.com/wangxuyang1221/pi-ext/issues/30) | 生产视觉集成 | 已关闭，真实 UI 宿主配合固定 execute 数据 |
| [Implementation #31](https://github.com/wangxuyang1221/pi-ext/issues/31) | 英雄命名与整体验收 | 已关闭，原生 blocked-by 关系为 #29、#30 |

通过 gh 读取了上述 Issues 的正文、标签、评论和原生关系。八个 Issue 当前均无评论。已从远端 `adventure/subagent-ui-consistency` 分支读取 progress.md、#30/#31 证据、最终验收矩阵和原型审阅记录，并核对交付源码及测试。该分支当前仍指向 `ad638b57d06e55287175f1f97adbb5840924d4d7`，下文对历史材料使用该提交的固定链接。

同时完整读取了当前本地 [SKILL.md](/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md)、[Issue templates](/Users/wangxuyang/.agents/skills/wangxuyang/adventure/references/issue-templates.md) 和 [Prototyping](/Users/wangxuyang/.agents/skills/wangxuyang/adventure/references/prototyping.md)。本报告对照的是当前 skill，不能据此断言执行冒险时使用的文件版本完全相同。

审阅依据是现存记录与代码，没有逐轮用户对话原文。因此，可以评价决定是否被清楚保存，不能仅凭这些材料判断当时是否问了过多问题、是否遗漏实际授权。也没有重新执行原冒险的全部视觉实验。

## What to preserve

- 关卡按决定和交付目标拆分。#26 确定范围，#27 确定视觉，#28 处理后来新增的命名目标，没有把所有问题塞进一关。#29 独立处理真实存在的检查阻塞，也有明确边界。
- GitHub 原生关系已经有效使用。#24 有完整子 Issue，#31 有真实阻塞关系；不能因为 Map 正文没有再列一遍关卡，就判定地图不完整。#30 的先后安排与技术依赖也有区分，不应把所有执行顺序都强制变成 blocked-by。
- 规格集中在 Spec，Planning 通关后改为引用规格并保留理由。这条原则应继续保留。
- 详细证据明确说明了固定 execute、离线 provider、truecolor 和未运行场景等限制。这些是有用信息，应该更靠近其支持的结论，而不是删掉。[#30 证据](https://github.com/wangxuyang1221/pi-ext/blob/ad638b57d06e55287175f1f97adbb5840924d4d7/adventure/evidence/implementation-30.md#host-evidence)、[#31 证据](https://github.com/wangxuyang1221/pi-ext/blob/ad638b57d06e55287175f1f97adbb5840924d4d7/adventure/evidence/implementation-31.md#verification)。
- 截图、复现命令、失败清理测试和版本信息应保留在证据页。30 张截图位于专门的证据目录，并不因为数量多就构成噪声。问题在于上层页面重复叙述其数量，却没有说明某条要求由哪一个场景证明。

## Noise and misplaced information

这里的“噪声”指不帮助当前读者作出决定、恢复工作或核对结论的内容。同一信息放在证据页可能有价值，复制到每个入口就会妨碍阅读。

| Example | Why it adds noise | Recommended treatment |
| --- | --- | --- |
| Map、Spec Delivery、#31 Verification/Acceptance、progress.md 和最终矩阵反复出现 2393 项测试、两个真实场景、进程清理等结果 | 多次陈述同一结果，读者仍需打开底层证据才能知道覆盖了什么 | 详细结果只在对应证据中维护；关卡给出结论与证据链接；Map 只保留交付状态和验收入口 |
| Spec Working agreement 写 worker 模型、执行次序；progress.md Evolution 还保留 sol 改 astra 且前一 worker 未改代码的过程 | 这不是产品规格，已结束后也不影响恢复；当前 worker 配置与历史选型过程混在一起 | 生效配置放派发上下文或存档；没有影响产物的尝试过程移入历史，Spec 不承载 |
| 多处重复未创建 PR、未部署、未改主工作区、未操作用户原型 | 操作边界有价值，但反复复述不能增加证据强度 | 约定集中维护；本关只记录差异、特殊授权或实际清理结果。比如用户后来明确授权合并，值得保留一条带范围的记录 |
| #29 的清理数量和检查结果在 Execution Notes、Delivery、Verification、Acceptance 中反复展开 | 四个职责不同的章节变成四份工作总结，后续修改容易不同步 | Execution 保留执行项；Delivery 写代码变化与提交；Verification 写结果；Acceptance 只写协调者判断和未覆盖项 |
| Spec Deferred verification 仍展开已由 #29 解决的旧原型和 13 份文档引用问题 | “尚待核验”与“曾经阻塞但已解决”混在一起，读者需要自行判断时态 | 开放项保留责任人、时机和失败影响；完成后写简短结果链接，清理清单留在 #29 证据 |
| #26 用第一次选择 1、第二次选择 1 解释用户决定 | 脱离当时选项，数字没有信息量 | 记录选择的语义及理由；原话只有在能解释歧义时才引用 |
| 32 个英雄称号与核心分配规则放在同一段落层级 | 名单是确定的产品数据，但长串名称会打断生命周期规则阅读 | 保留名单，放到 Spec 的独立 Name pool 小节并链接来源；无需删除已确认的数据范围 |

这些例子可在 [Spec](https://github.com/wangxuyang1221/pi-ext/issues/25)、[#26](https://github.com/wangxuyang1221/pi-ext/issues/26)、[#29](https://github.com/wangxuyang1221/pi-ext/issues/29) 和 [最终存档](https://github.com/wangxuyang1221/pi-ext/blob/ad638b57d06e55287175f1f97adbb5840924d4d7/adventure/progress.md) 对照。削减重点是重复和错误归属，不是按篇幅机械删减。

## Information that needs to be added

### Acceptance across component boundaries

最重要的缺口是跨关卡、跨组件的行为如何被证明。

#30 用真实 Pi UI 加固定 execute 数据证明视觉呈现；#31 用真实 Pi/tmux 证明工具正常返回的名称一致。这两份证据都成立，但组合起来仍不能证明“实际 wait 执行中的名称更新”和“失败结果经过宿主处理后仍保留名称”。原生产集成测试调用 execute 时没有提供 onUpdate，随后只检查 wait 的 settled 结果。[#30 方法](https://github.com/wangxuyang1221/pi-ext/blob/ad638b57d06e55287175f1f97adbb5840924d4d7/adventure/evidence/implementation-30.md#host-evidence)、[原集成测试](https://github.com/wangxuyang1221/pi-ext/blob/ad638b57d06e55287175f1f97adbb5840924d4d7/extensions/subagent/__tests__/production-integration.test.ts#L133)。

最终矩阵却把“重载与六工具名称一致”整行标为通过。原交付提交中，wait 的 onUpdate 仍把 agentId 填进 name，renderer 也会在错误结果缺少详情时失去名称。这说明缺口在交付时就存在，不能归因于后续鉴权修改。[验收矩阵](https://github.com/wangxuyang1221/pi-ext/blob/ad638b57d06e55287175f1f97adbb5840924d4d7/adventure/evidence/subagent-ui-final-acceptance.md#L16)、[等待更新](https://github.com/wangxuyang1221/pi-ext/blob/ad638b57d06e55287175f1f97adbb5840924d4d7/extensions/subagent/src/tools.ts#L381)、[详情覆盖](https://github.com/wangxuyang1221/pi-ext/blob/ad638b57d06e55287175f1f97adbb5840924d4d7/extensions/subagent/src/renderers.ts#L170)。

建议在准备实施时识别少量跨组件不变量，并给最终集成关卡明确责任。本例是名称从持久化状态经过等待更新、异常转换、结果持久化到历史渲染，始终指向同一目标。需要增加的是这条路径的验收，不是再创建一个庞大的规划关卡。

### Observable behavior and exception boundaries

Spec 已有名称一致性的总体要求，但以下边界值得明确，避免实现和测试各自缩小理解。这是把既有契约写得可执行，不是认定原先没有要求。

| Situation | Expected observation |
| --- | --- |
| 已识别目标，wait 尚未结束 | 标题显示已保存名称，而非 agentId |
| 正常返回 settled、timeout、interrupted 或 closed | 名称保持一致，结果状态仍各自表达 |
| 已识别目标后抛错或取消 | 保留名称、原始错误和失败标记 |
| 重新打开修复后产生的失败记录 | 不依赖上一轮组件内存，仍能显示名称 |
| 未能确认目标身份或所属关系 | 允许回退为短 ID，不猜测或泄露其他目标名称 |
| 升级前已存在的代理与不同父会话 | 旧代理沿用其持久化名称；不同父会话各自分配，可使用相同英雄名 |

同时给“旧会话”“父会话”各补一句定义即可：前者指功能引入前已经创建的代理记录，后者指负责管理这些直接子代理的 Pi session。不要为两个局部概念引入整套术语文档。

### Evidence matched to claims

建议把 Verification 从命令清单改为按验收断言组织。测试总数仍可作为运行结果，但不作为需求覆盖依据。

| Claim | Actual evidence at delivery | Appropriate conclusion |
| --- | --- | --- |
| 给定工具结果时，状态、色彩、布局符合规则 | 生产 renderer、真实 UI 宿主、固定 execute 数据 | 对给定输入的呈现已验证 |
| 六类工具正常返回同一名称 | 真实工具执行及 Pi/tmux，wait 为 settled | 正常结果的名称已验证 |
| 等待中、失败及失败历史重建仍显示名称 | 上述两组测试没有连通这条路径 | 未验证，需要本项负责人补验 |

每条有风险的验收项只需补齐：可观察断言、适用代码提交、测试或证据入口、实际执行与替代的部分、已证明的范围及剩余缺口。只有存在缺口时才补责任关卡和最晚验证时机。无需给所有简单改动增加大型矩阵。

协调者应检查证据里的断言能否排除一个具体反例。例如：如果 wait 的成功结果有英雄名，但 onUpdate 写的是 ID，当前测试会失败吗？原验收对此的答案是否定的。这比再抄一次 2393 passed 更能发现问题。

### Decision provenance and specification revisions

Planning 应保留决定的含义、理由和确认范围。#27 保存了用户要求收敛原型及指定颜色的语义，比 #26 的选项编号更容易恢复。涉及移除公开参数、扩大范围或允许合并等决定，宜增加日期及可获得的对话定位；没有可公开链接时，保留准确摘要并注明来源是本次对话，不伪造可追溯性。[#26](https://github.com/wangxuyang1221/pi-ext/issues/26)、[#27](https://github.com/wangxuyang1221/pi-ext/issues/27)、[#28](https://github.com/wangxuyang1221/pi-ext/issues/28)。

Spec 在形成后仍会变化，Implementation 应记录采用的 Spec 修订号或修订日期。只对改变行为、范围、验收的修改递增修订；正文保留简短变更说明。对跨关卡要求可增加少量稳定编号，方便 slice、延期验证和最终验收引用，不必给每句话编号，也不另维护一份完整 Spec 文件。

## Organization that needs to change

### Durable entry points

审阅时，#24 的 progress.md、整体验收矩阵和截图说明三条入口都指向 `main/adventure/...`。GitHub 查询这三个对象均不存在；它们已随 [9ceafd3](https://github.com/wangxuyang1221/pi-ext/commit/9ceafd3f925afc8405af2d398c600466151ba564) 从 main 删除。远端冒险分支和 `ad638b5` 中仍可读取，所以问题是入口失效，资料没有丢失。

当前 skill 要求删分支前安排材料入口，但没有同样明确地要求交付归档使用固定提交。建议区分：进行中的入口可以指向冒险分支，关闭时把存档、验收和审阅证据固定到最终提交；代码开发入口仍可单列分支。保存时验证文件路径实际存在，不能只验证分支或提交存在。

这样 main 后续清理、分支继续修改或本地 worktree 删除，都不会让历史冒险失去入口。无须为此恢复已经删除的材料到 main。

### Current state versus historical state

存在几类容易误导接手者的时态：#26 开头仍称规格形成中；#28 Follow-up 仍写保存暂停、恢复后形成切片；最终 progress.md 开头要求继续当前冒险并标记 continuation，后面却写冒险已结束。[#26](https://github.com/wangxuyang1221/pi-ext/issues/26)、[#28](https://github.com/wangxuyang1221/pi-ext/issues/28)、[最终存档](https://github.com/wangxuyang1221/pi-ext/blob/ad638b57d06e55287175f1f97adbb5840924d4d7/adventure/progress.md)。

这些内容大多是当时的事实，不应一律删除。但应改成“本关通关时的移交”，只说明它产生了什么决定、把什么交给了下一关。当前该做什么只从 Map 和最新存档读取。已关闭关卡不要保留没有时间限定的当前状态或继续执行指令。

最终存档应首先说明已完成、无需继续实施，并给出交付入口。可以保留重新排查所需的限制，不再沿用进行中交接的开场命令。模板中的 Spec 状态也应包含“已交付”，与 skill 的结束流程一致。

同理，Map 记录本地 worktree 保留，是结束时的机器状态；本次检查只发现 main worktree，`.scratch/u` 已不存在。应把这种信息放在注明时间的本地环境备注里，而非长期材料入口。不能据此推断原来记录错误或后续删除未经授权。

### Information ownership

| Location | Maintain here | Refer to elsewhere |
| --- | --- | --- |
| Map | 当前状态、下一步、Spec、存档、交付入口；关系使用原生子 Issue 与依赖 | 不复制规格、测试明细、机器清理过程 |
| Spec | 产品行为、关键设计、约束、验收、未决问题和开放延期验证 | 不维护 worker 选型历史、关卡执行进度和完整交付日志 |
| Planning | 决定及理由、确认依据、验证边界、向 Spec 的移交 | 通关后的有效规则通过 Spec 章节引用 |
| Implementation | 已审核 slice、工作位置、执行项、交付提交、验证结果、协调者判断 | Execution 不再次复述 Slice 与 Spec 的全部要求 |
| progress.md | 恢复所需最小上下文、当前工作区状态、唯一下一步 | 不重复每关结果；已完成时改为结束存档 |
| evidence | 方法、版本、具体断言、真实/替代边界、复现入口和必要截图 | 不承担当前游戏状态或发布授权的维护 |

不是所有重复都应消除。独立 worker 必须拿到完整的已审核 slice；它可以保存必要范围和验收摘要，同时注明适用 Spec 修订。需要避免的是在 Execution、Delivery 和 Acceptance 再生成几份完整的产品规则。

Implementation 的 Verification 由 worker 提供证据，Acceptance 由协调者作判断，两者应保留。Acceptance 写“核对了哪些要求、还缺什么、是否通过”，不再全文复制 Verification。返工记录只保留导致未通过的反例和修正后的结论。

### Materials scoped to one adventure

本场基准的 adventure/ 已有 388 个文件，交付提交中有 440 个。progress.md 因而需要提醒接手者忽略继承的历史任务材料。这说明独立分支和 worktree 隔离了修改位置，却没有自动隔离任务资料。[基准目录](https://github.com/wangxuyang1221/pi-ext/tree/262824026e192e8c421ce1e1796db7b269723038/adventure)、[交付目录](https://github.com/wangxuyang1221/pi-ext/tree/ad638b57d06e55287175f1f97adbb5840924d4d7/adventure)。

建议开局确定本场资料根目录，例如 `adventure/24-subagent-ui/`，其下放 progress.md、evidence/、prototypes/ 和 experiments/。Map 记录根目录，所有 skill 引用从它派生。已有冒险可沿用原目录，仅索引本场所需材料；不要为了统一布局强制迁移或恢复历史文件。

### Corrections after delivery

原矩阵的验收结论与后续发现的 wait bug 之间，应有一条可追溯的修正关系。保留“当时用户确认交付”的事实，同时记录哪一条工程验收证据不足、后续由什么提交补齐。可在 Map 增加简短的交付后修正入口，不需要抹掉原记录，也不必因每个后续 bug 重启整场冒险。

本例可链接到 [b0f4f1b](https://github.com/wangxuyang1221/pi-ext/commit/b0f4f1b5d2673d92a2cca7b70090bd9e6615c649) 及 [修复验收记录](https://github.com/wangxuyang1221/pi-ext/blob/b0f4f1b5d2673d92a2cca7b70090bd9e6615c649/docs/subagent-wait-name-todo.md)。这些是交付后的补充证据，不能倒算为原冒险当时已经覆盖。

## Recommended skill changes

先区分已有规则没有落实，还是规则本身缺少约束，避免每次复盘都继续堆叠同义指令。

| Finding | Existing rule or gap | Revision approach |
| --- | --- | --- |
| Spec 与多处摘要重复维护规则 | 当前 skill 已规定移交后以 Spec 为准 | 收紧模板填写说明及更新职责，不再增加一条同义原则 |
| 固定数据的视觉验证被汇总成完整行为通过 | 当前 skill 已要求说明证据边界；缺少汇总时如何限制结论的具体标准 | 给验收模板增加断言与执行路径对应关系 |
| Map 文件链接随 main 清理失效 | 现有保存检查可确认当时可读，但没有保证关闭后入口稳定 | 增加交付提交固定链接规则 |
| 已关闭 Planning 和最终存档仍像进行中任务 | 当前模板主要描述创建与推进，没有充分区分结束形态 | 增加通关、暂停、已交付三种情况下应保留的行动信息 |
| 后续反例未反映到历史验收入口 | 当前 Close the level 已要求更新失效结论，但交付后如何保留修正关系不明确 | 补充交付后修正入口，不另建一套问题处理流程 |

| Priority | Change point | Concrete change | Expected benefit |
| --- | --- | --- | --- |
| 优先 | SKILL.md：Prepare Implementation、Beat Implementation、Win the game | 识别跨关卡行为，指定集成验收责任；每项通过结论必须有对应断言，替代掉被验收路径的测试不能单独证明该路径 | 防止视觉通过与数据通过被直接合并为完整行为通过 |
| 优先 | SKILL.md：Save game progress、Win the game；Map 模板 | 进行中使用分支入口，交付归档使用提交固定链接；核验存档、验收与证据文件可读取 | 防止 main 清理后地图入口失效 |
| 随后 | Issue templates：Spec、Implementation | 为重要跨关卡要求提供稳定引用；记录采用的 Spec 修订；Verification 按断言、执行路径、结果、边界组织 | 让协调者能直接检查证据覆盖，而非只看通过数量 |
| 随后 | SKILL.md：Save game progress；Planning 与 Map 模板 | 区分当前行动和历史移交；关卡通关移除过时的进行中提示；结束存档明确无需继续实施 | 防止新会话按旧 Follow-up 重复施工 |
| 随后 | SKILL.md：Set up the map；Prototyping | 开局记录本场资料根目录，原型与证据放入同一任务目录 | 缩小恢复时的材料范围，避免继承其他冒险上下文 |
| 顺带 | Issue templates：Implementation；各模板填写说明 | 保留完整审核 slice；Execution 只写行动与新增验证设计；Delivery、Verification、Acceptance 各司其职 | 减少重复更新与结论漂移 |
| 顺带 | SKILL.md：Win the game | 后续反例影响已交付结论时，保留原记录并增加明确修正入口 | 区分历史验收、当前已知缺陷和后续修复 |

建议先修改前两项，再调整模板。不要先增加更多关卡、审批、报告或强制截图数量；本例缺的是验收结论与证据之间的约束。

以下文字可作为 skill 修订的起点，仍需结合现有章节合并，避免再建立一套平行流程：

> 进入实施前，识别本次要求中跨越多个组件或关卡的行为，并指定集成验收责任。按实际风险选择进行中、失败、取消、恢复等场景，不机械展开全部组合。

> 验收通过须对应具体的可观察断言。注明实际执行与替代的部分；如果替代部分正是被验收的行为路径，证据只能支持剩余部分。测试总数与用户确认不能替代缺失的工程证据。

> 当前进度由 Map 和最新存档维护。已关闭关卡记录当时的决定及移交，不保留无时间限定的继续执行指令。交付后把存档、验收与关键证据固定到提交，并逐一检查入口。

> 不重复维护同一要求。Spec 保存有效规格，已审核 slice 保存执行边界；执行计划写如何完成，验证记录写证明了什么，协调者验收写是否足够及原因。

## Example of a smaller closed map

下面是组织示例，没有修改远端 #24。关卡仍由原生子 Issues 展示，不再手写一份关卡状态表。

```markdown
## Progress

- 状态：已交付，用户于 2026-09-22 确认。
- 下一步：无。
- 交付提交：ad638b5 的 commit 链接。
- 结束存档：ad638b5 下 adventure/progress.md 的固定链接。

## Entrances

- Spec：#25。
- 整体验收：ad638b5 下 subagent-ui-final-acceptance.md 的固定链接。
- 冒险资料：ad638b5 下 adventure/ 的固定链接。
- 冒险分支：adventure/subagent-ui-consistency。

## Follow-up

- wait 名称在进行中及失败路径遗漏：后续修复 b0f4f1b，附修复验收入口。
```

实际填写时使用完整 GitHub 链接。测试数量、worker 型号、绝对 worktree 路径和未执行操作的重复说明不进入这个入口页。

## How to evaluate the revised skill

用本案例做一次离线恢复与验收演练即可，不必重新开发产品：

- 从关闭的 Map 出发，能在不搜索 Git 历史的情况下打开 Spec、结束存档、原交付验收及后续修正。
- 即使 main 中的 adventure/ 已删除，交付入口仍可读取；本地 worktree 是否存在不影响历史审阅。
- 新接手者能判断冒险已经结束，不会执行 #28 当时的暂停后续动作。
- 给验收者提供原 #30 和 #31 的证据时，应能指出 wait 进行中、失败与失败历史的名称仍未获证明，而不是给出整项通过。
- 任取一条跨关卡要求，能找到其规格、责任关卡、实际测试断言和未覆盖边界；反过来，证据中的限制也能反映到验收结论。
- 调整一个产品决定后，只修改其规格归属及受影响的引用或验收结果，不需要重写多个页面中的同一段规则。

这些结果可以检验 skill 是否更容易恢复、核验和维护。篇幅缩短是副作用，不能代替上述判断。
