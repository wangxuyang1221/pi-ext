# Pi goal design candidate

## Status and evidence

本方案属于 [Planning level #2](https://github.com/wangxuyang1221/adventure/issues/2) 的候选设计，不是已批准 spec 或实现切片。C1 至 C10 已确认，包括下文三项 Pi 适配规则；完整 spec 与实现切片尚未批准。尚未开始正式功能编码。新增 [存储实验](./pi-goal-storage-probe.md) 推翻了只依赖 custom entry 实现首条回复前持久化的假设，用户已按 C10 选择独立保存与恢复入口。本文保留候选设计的演化，当前实施依据为 [正式规格](./pi-goal-spec.md) 与 [存储设计](./pi-goal-storage-design.md)。

依据：[Codex 0.153.4 源码核验](./codex-goal-0.153.4.md)、[Pi 能力与确认记录](./pi-goal-extension-feasibility.md)、[双版本十三项 runtime 实验](./pi-goal-runtime-probe.md)。官方库接口使用本地对应版本文档及源码核验，Context7 此前访问失败。不得把受控模型实验当作真实服务或完整 TUI 验收。

## Confirmed boundaries

- 对齐 Codex CLI 0.153.4，不追随 main。
- 标准 Pi 扩展，不修改宿主核心；允许修改本仓库 codex-ui 和 subagent。
- 首版仅保证 OpenAI Codex、交互 TUI；非交互入口不自动续跑 goal。
- 产品界面英文，文档正文中文。
- 能明确识别账户额度耗尽时使用 `usage_limited`；无法区分的终止错误使用 `blocked`，保留错误信息。不改变 goal token 预算的 `budget_limited`。
- 同一会话只有一个当前 goal。`/tree` 不回退目标、状态、累计消耗。
- 普通 `/fork`、`/clone` 不继承。显式继承复制快照和累计消耗，但初始不自动续跑。

## State and commands

沿用六种状态 `active`、`paused`、`blocked`、`usage_limited`、`budget_limited`、`complete`。仅 `active` 可以自动续跑，且仍受会话生命周期、初始继承门禁和调度条件约束。

保留 `/goal`、`/goal <objective>`、`/goal clear`、`/goal edit`、`/goal pause`、`/goal resume`。裸 `/goal` 输出目标摘要与可用命令，不改成只有交互菜单。参数按完整控制词匹配，不占用原本可作为 objective 的额外词语。显式继承入口使用独立命令，具体名称在 spec 中确定，不把 `/goal fork` 悄悄改成新的保留语法。

保留模型工具 `get_goal`、`create_goal`、`update_goal`。模型只能用 update 标记 complete 或 blocked，不能直接恢复或更改额度受限状态。创建前必须已有明确请求、完成审计和一般 blocker 三轮规则保留为模型指令，不宣称运行时能够证明用户意图或验收质量。

新目标使用新身份并清零统计。模型工具不能替换未完成目标；用户替换需确认。编辑保留预算与累计消耗，并按上游规则决定是否重新 active。编辑已耗尽预算的目标不等于补充预算，不能获得无上限续跑。

## Scheduling and interruption

候选实现使用隐藏的 goal 提醒与自动续跑消息，不伪造用户的再次请求。事件驱动，不用固定间隔轮询。新请求提交前与模型上下文形成前都核对 session、goal 身份和运行代次；暂停、清除、替换及切换使旧请求失效。

沿用 Pi 原生重试和压缩。不能在 `agent_settled` 中无条件立即重启，也不能把 `hasPendingMessages()` 为 false 当作所有队列为空的证明。此前实验支持 `agent_end` 队列加执行前门禁的受控路径。新增实验确认用户 follow-up 排在失效 goal 前后两种顺序均可被保留，但仅 abort 旧 goal 仍会让旧提醒留在下一次用户请求的上下文。必须同时过滤自有的失效 goal 提醒，不删除用户消息或其他扩展消息。完整候选仍需验证运行中的真实 TUI 输入和多来源消息。

用户真正中断运行时同时 pause；关闭弹窗或取消选择不应误停目标。压缩失败后的抑制仅限当前失败恢复链，显式用户输入不能永远被旧门禁阻止。运行错误在宿主重试耗尽后停止 goal，不再由 goal 无限重试。

## Accounting and storage

按非缓存输入加输出统计，不能重复减去 Pi 已拆分的 cacheRead，也不能额外把 reasoning 输出重复相加。统计主代理和本仓库 subagent 的子孙代理；子进程不获得独立自动 goal 循环，但仍向根目标上报消耗。外部未知代理系统的用量不可假定可见。

用量事件须有去重身份、根归属和目标代次，异步晚到的旧事件不得污染新目标。目标创建前的用量不追溯计入；当前绑定回合达到预算后仍可产生收尾消耗。预算不是硬终止开关，不保证真实费用或 token 永不超额。

到达预算时改为 budget_limited，对仍运行的目标回合发送一次收尾提示，阻止后续自动续跑。记录 Pi 实际暴露的 usage，缺失时不伪造精确数值。尚未验证真实 Codex 服务的异常与中断用量完整性。

原候选方案将目标快照写入 Pi 会话 custom entry，不引入 SQLite。此方案目前仅在会话已实际落盘时获实验支持；新会话首条 assistant 前、分叉路径不含 assistant 时，custom entry 不会立即写盘，不能保证跨进程恢复。现已按 C10 确认采用独立目标状态文件与恢复入口，不限制 goal 只能在已落盘会话使用。以下 owner 规则仍需保留，不再将 custom entry 唯一存储视为已定架构。记录拥有者 session ID，读取当前会话的最新有效快照和清除记录，不因当前树路径缺少最新记录而回退。分叉复制过来的旧拥有者记录不视为新会话当前目标。

显式继承先结算源目标，再为新会话建立归属明确的快照与持久化一次性门禁。继承之后两个会话独立累计，不形成共享可变预算池。沿用上游下一次显式 turn 清门禁的原则；非 active 状态不会仅因门禁清除而恢复。不能在创建完新会话后继续使用旧扩展 context。

## Confirmed Pi adaptations

C9：用户澄清连续三轮失败与 agent turn 的含义后回复“ok, 接受你的推荐适配方案”，确认以下三项。

1. Codex 原生 `exec` 对应 Pi 内置 `bash`。保留窄运行时停止规则：连续三轮有实际执行的 bash 失败，且各轮均无成功工具时自动 blocked。权限拒绝、未执行及用户取消不算执行失败，其他工具失败不冒充 bash 失败。这里的一轮是完整 agent turn，可包含多次模型与工具调用，不是一个工具调用。宿主重试或门禁中止产生的内部 start/end 不得直接增加连续失败轮数。
2. 首版不为第三方 plan-mode 插件自动免计费。本仓库没有统一的 plan-turn 标记，不能根据聊天里出现“规划”或“plan”就排除用量。普通思考和规划照常计入目标预算；若要支持特定规划插件，另行核验其明确接口。
3. goal 摘要和对话框使用 Pi TUI；状态显示接入现有 codex-ui，未加载 codex-ui 时提供独立状态展示。不覆盖整个现有 editor/footer，不承诺 Rust TUI 的像素级复刻。

## Objective files

工具 objective 保留 4000 Unicode 字符限制。TUI 超长文本可保存为目标附件，再交给模型受控引用。Pi 原生 TUI 粘贴图片会把临时图片文件路径插入文本，不能假设 slash handler 能收到结构化图片附件。

附件须复制到持久化的 goal 专属目录，引用解析和编辑只访问明确授权的自身文件，不因为 objective 中出现任意路径而自动读文件。显式附件识别、符号链接处理、大小限制和失败清理需要在文件适配设计中验证。不会读取真实用户剪贴板做实验，也不在规划期间写用户全局配置。

## Scenario review

以下是设计推演，不是新增运行证据。

| 场景 | 预期结果 | 依据或待证项 |
| --- | --- | --- |
| active 目标完成一轮，模型未停止目标 | 无竞争输入时续跑一次，不重复提交 | 九项实验仅支持部分调度路径；V1 |
| 已排队续跑后用户暂停或清除 | 不再发起该旧目标的模型请求 | 已有 context guard 受控实验；真实 TUI V1 |
| 预算 100，结算时已用 110 | 显示实际 110、剩余 0；收尾后不续跑 | 上游软预算规则；用量集成 V2 |
| 账户限额错误缺少可区分信息 | blocked 并展示错误，不猜测精确额度原因 | C6 |
| `/tree` 返回目标完成前的消息 | 目标仍 complete，消耗不回退 | C7；持久化 V3 |
| 普通 fork/clone 复制到含 goal 的历史 | 新会话没有当前 goal | C8；所有创建入口 V3 |
| 显式继承 active，立即 reload | 快照仍 active，但初始门禁阻止自动开跑 | C8；生命周期 V3 |
| 继承后源会话又产生用量 | 不自动增加新会话独立累计值 | 上游快照复制；V2/V3 |
| 连续三轮 bash 失败，第二轮有其他成功工具 | 不符合连续三轮窄失败规则 | C9；V4 |
| 模型说“我先做规划” | 不据此免除 token 计费 | C9 |

## Validation gates

- V1：真实 TUI 中断、用户消息与其他扩展消息交错、重试取消、压缩成功及失败恢复。若出现旧请求继续调用模型或吞用户输入，阻止调度实现验收，必要时回到本关调整方案。
- V2：原生 Codex usage 映射、创建中途基线、子孙代理跨生命周期去重和预算软停止。无法精确统计的路径必须说明，不以模拟值填补真实服务证据。
- V3：new/resume/reload/tree/fork/clone、显式继承门禁和源目标替换后的隔离。不得靠内存标志保证跨重启规则。
- V4：实际执行与拒绝/取消的区分、bash 三轮失败、模型工具 schema 和状态迁移、附件路径边界。
- V5：两套 Pi 版本兼容性、codex-ui/subagent 集成、完整 pnpm check、发布包许可证及无残留进程。最低兼容版本尚未最终确定，不将九项双版本实验扩大成全部功能兼容承诺。

V1 至 V5 已在正式 spec 分配给拟定切片，实施 Issues 在用户审核切片后创建。C10 已解决；不能把本文的历史待决措辞当成当前决定，也不能把条件通过的规划结论当作已完成实现验收。
