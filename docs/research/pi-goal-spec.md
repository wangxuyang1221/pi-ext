# Pi goal specification

## Status

本规格汇总 [规划关 #2](https://github.com/wangxuyang1221/adventure/issues/2) 的 C1 至 C13。七片实施方案及原生依赖保持，#4 至 #9 已由协调者验收，用户 go on 已解除历史暂停。#10 正在进行最终工作区集成验收，结果见 [Goal integration acceptance](../goal-integration-acceptance.md)，通关仍待协调者独立核验。C11/C12 已按限定范围通过，不采用 provider 检查层或 editor 重建。实现必须以本规格、[存储设计](./pi-goal-storage-design.md) 和固定版本的 [上游行为清单](./codex-goal-0.153.4.md) 为依据。候选稿中与 C10 冲突的 custom entry 唯一存储方案已被替代。

## Scope

目标是将 Codex CLI 0.153.4 goal 行为移植到标准 Pi 扩展，不修改或 fork Pi 核心。首版保证 OpenAI Codex、持久化模式的交互 TUI，包含新会话首条回复前创建目标。独立非交互 goal 循环、其他 provider、Codex app-server 协议和 SQLite 格式兼容不在范围内。

仓库开发版本 Pi 0.84.3 与当前宿主 0.85.1 为验收矩阵，不承诺未测试的更早或未来版本。模型切换到不受支持的 provider 时不得继续自动 goal 请求，保留目标并显示限制。managed subagent 即使不是主 TUI，也须上报根目标用量；这不向其开放独立 goal 循环。

产品界面英文，文档正文中文。保留适用 Apache-2.0 许可证、版权和修改说明。接口与提示词移植按固定提交 3d2ee51ca2d5db578f328aa75e20aa22c0197c9a，不从 main 自动吸收变化。

## Entry points

- `/goal` 显示状态、objective、累计时间、用量、可选预算及可用命令。
- `/goal <objective>` 创建目标；用户替换未完成目标需确认，新目标新身份且计数归零。
- `/goal clear`、`edit`、`pause`、`resume` 保留上游控制语义，按整个 trimmed 参数识别控制词。`/goal pause now` 仍是 objective。不得增加会改变原目标解析的隐藏控制词。
- `/goal-recover` 为 C10 独立恢复入口，行为见存储设计。
- `/goal-fork` 为显式继承入口，选择从历史位置 fork 或从当前位置 clone，继承当前会话目标快照，而不是把旧分支的镜像当成当前目标。普通 `/fork`、`/clone` 不继承。

工具 schema 不接受额外属性：`get_goal({})`；`create_goal({objective: string, token_budget?: positive integer})`；`update_goal({status: "complete" | "blocked"})`。工具 objective 为非空且最多 4000 Unicode 字符，预算须满足有效整数与配置上限。模型只能在明确要求时创建 goal，不从普通任务推断；此为提示约束，不伪称语义验证器。

模型创建只允许无目标或替换 complete，不能替换其他未完成状态。update 只标 complete/blocked，不能编辑 objective、预算或恢复状态。响应提供目标、状态、预算、实际累计用量与剩余额度，具体上游命名及提示在工具实现中按固定源码对照测试。

## State transitions

六种状态为 active、paused、blocked、usage_limited、budget_limited、complete；只有 active 可能自动续跑。

- 创建或用户显式恢复后为 active，仍须检查预算、生命周期及继承门禁。
- pause 保留目标与用量，不新增自动回合。用户真正中断运行时同时 pause；取消弹窗不等于中断目标。C12 的窄例外：原生重试等待中按 Esc 取消重试后，接受目标按原错误归为 blocked，而非 paused；仍须停止自动续跑，保留目标和统计，允许 `/goal resume` 恢复。C12 不推广到模型运行中的用户中断或显式 `/goal pause`。为此不接入或重建编辑器，也不修改上游 Pi。
- 模型标 complete 后不再自动续跑；不得因预算不足而假报完成。
- 普通终止错误、宿主重试耗尽或可确认的运行阻塞进入 blocked。明确识别账户额度耗尽进入 usage_limited；不可区分错误按 C6 使用 blocked 并保留可用错误信息。
- 到达 tokenBudget 进入 budget_limited。保留实际累计值，允许当前回合收尾超额，不开启下一自动回合。
- 编辑保留预算与累计值；编辑 active 保持 active，编辑 paused/blocked/usage_limited 保留状态，编辑 complete/budget_limited 按上游重新激活并重新检查既有预算。编辑不是重置预算。
- 清除记录不能因 resume、tree 或镜像恢复而复活。旧目标异步事件不得改变替换后的目标。

一般 blocker 三轮审计是模型提示规则。窄运行时规则按 C9：连续三个完整 agent turn 有实际 bash 执行失败且各轮没有成功工具时自动 blocked；不要求同一个错误。拒绝、未执行、取消不计为实际执行失败。一个 turn 可以包含多次模型与工具调用；重试和失效请求 abort 的内部事件不直接增加失败轮数。恢复 blocked 后重置连续失败审计。

## Scheduling contract

使用隐藏的目标上下文和事件驱动续跑，不伪造用户请求，不使用固定间隔轮询。续跑提示保留上游完成审计、目标忠实性和阻塞规则，对 objective 做明确边界与转义。

每个自动请求带 ownerSessionId、goalId、generation 和调度身份。提交前与请求形成上下文时均检查有效性；最多保留一个待执行的本目标续跑。上下文必须过滤失效的自有提醒，单纯 abort 不够。

C11 已确认：取消尚未发出的失效 goal 续跑时，允许调用 Pi TUI 的 `ctx.abort()`，接受其清掉尚未处理的其他扩展消息，以及把排队的用户追加消息退回编辑器、需要用户重新发送的副作用。不引入 provider 检查层。此例外不允许删除已有聊天记录或损坏已保存的 goal，不允许丢失用户追加文字，也不允许 goal 插件在无失效自有请求时随意清空队列。文档明确说明该限制；测试验证失效 goal 不发出、用户文字可找回、已有记录与目标不受损，不再断言此取消路径保留并自动执行所有其他扩展消息。

复用 Pi 原生重试与压缩，不在第一次可重试错误就新增 goal 请求，也不在 settled 中无条件立即重启。压缩失败恢复门禁只针对相应故障链；显式用户请求和手动压缩不被永久阻断。新会话、切换、reload 和 shutdown 使旧 context 与运行代次失效。

实现不得仅靠 hasPendingMessages=false 证明全部队列为空，也不得把所有 agent_end 当作完整目标轮次。实际 SDK、TUI 与本仓库 subagent 观察者的事件交错必须通过 V1 验收。

## Accounting contract

正常用量按非缓存输入加输出累计，不重复扣除 Pi cacheRead，不额外重复加入 reasoning 输出。依据真实 provider usage 映射，不使用 footer totalTokens 或 compaction tokensBefore 代替消耗。

主代理和本仓库直接受管子代理用量归集到根目标。子代理上报有身份和去重依据的累计数据或事件，根目标负责检查点与预算判断。C13 已确认保留单层拓扑，不开放孙代理，取消 grandchild 和中间父代理退出验收；第三方及嵌套代理不在首版范围。创建或替换目标时建立基线，不追溯计入创建前消耗。子代理结束、重复读取不得漏记或重复收费，旧目标迟到消息不得污染新目标。保留现有编排权限、容量和 direct-only 关闭语义。确认记录：https://github.com/wangxuyang1221/adventure/issues/2#issuecomment-5603155660 。

首版没有统一 plan-turn 接口，按 C9 不自动为第三方 plan-mode 免计费，普通规划和思考照常计入。active 时间按单调时钟累计，不把进程未运行的间隔无条件算成工作时间。

首次发现预算达到时向仍在运行的目标回合注入一次收尾提示，不硬杀模型或子代理。该回合后续实际用量继续结算。缺失 usage 不得填造精确值，诊断必须反映可见性限制。

配置提供可选最大目标 token 预算：配置上限时，创建未指定预算的目标以此为默认；显式预算不能超限；未配置且未显式指定时无 goal token 上限。保持上游 `/goal` 不解析 `--budget` 的行为。配置校验和文档归入预算切片，不改动用户现有全局配置。

## Persistence and recovery

[独立状态与恢复设计](./pi-goal-storage-design.md) 是本规格组成部分。权威目标文件提交成功后才确认状态变更并允许自动调度；Pi custom entry 为历史镜像。单写者、revision 与 goal generation 防止并发写和旧事件污染。

C7：同一会话只有一个当前目标，tree 不回退目标、状态或累计消耗。C8：普通 fork/clone 不继承；显式继承复制快照与持久化初始续跑门禁，之后两份记录分别累计，不共享可变预算。

C10：Pi 尚无 sessionFile 时仍可保存目标；恢复入口在用户选择后接管唯一记录。不能保证恢复从未落盘的对话，也不会回滚实际文件或数据库副作用。恢复、继承和普通重开时不得凭旧会话 context 发起请求。

## TUI and attachments

使用 Pi 原生摘要、编辑及确认 UI，接入 codex-ui 的目标状态显示；未加载 codex-ui 时也能查看目标与状态。不替换整个现有 editor/footer。暂停、恢复和创建失败给出英文反馈。

TUI 长 objective 与明确选择的附件保存在目标专属目录，模型读取受控引用。Pi 原生粘贴图片以临时文件路径文本进入编辑器，需要持久复制才能跨会话使用。不得扫描 objective 中任意路径并静默读取；附件识别、引用解析、路径遍历与符号链接边界必须有测试。

工具保持 4000 Unicode 字符限制；TUI 长文本可物化为文件再使用短引用。编辑只反解本插件生成且验证有效的文件引用，不能借编辑读取任意文件。失败仅清理本次创建的无用临时产物，保留其他目标和用户文件。

## Validation ownership

以下为规划遗留验收项，编号稳定。代码切片验收前回写实际证据；关键假设失败时重开或返回 #2，不自动缩减已确认范围。

| ID | Required evidence | Assigned level |
| --- | --- | --- |
| V1 | 真实 TUI 中断、运行中 user/steer/follow-up 和其他扩展交错、重试取消、压缩成功/失败后新输入、无重复调用，输入保护按 C11、重试等待取消状态按 C12 验证窄例外及其边界 | #6；#10 集成复验 |
| V2 | Codex usage 映射、创建中途基线、直接子代理归集去重、收尾超额及错误路径 | #7 主代理；#8 直接子代理；#10 完整矩阵 |
| V3 | 首条回复前保存、恢复接管、并发写入、异常退出、写盘/镜像失败、tree/fork/clone/reload 隔离 | #4 存储；#5 生命周期 |
| V4 | 工具 schema、状态迁移、完整轮次 bash 失败、提示边界、附件安全 | #6 工具与轮次；#9 附件 |
| V5 | 两版本构建和运行矩阵、codex-ui/subagent 集成、pnpm check、发布包归属说明与清理 | #10 |

#4/#5 独立存储与生命周期、#6 调度与工具、#7 主代理预算已有双版本运行验收。#7 检查点：https://github.com/wangxuyang1221/adventure/issues/7#issuecomment-5603022298 ，详细证据见 `docs/goal-budget-acceptance.md`。原生 Codex adapter 使用离线响应夹具，不是付费在线抓包。V2 直接子代理 #8 已验收，检查点：https://github.com/wangxuyang1221/adventure/issues/8#issuecomment-5605128058 ，报告 `docs/goal-descendant-acceptance.md`。当前基准为 `3972c9e` 加未提交 goal 工作区。V4 附件/UI #9 已由协调者验收，检查点：https://github.com/wangxuyang1221/adventure/issues/9#issuecomment-5605930818 ，报告 `docs/goal-ui-acceptance.md`。#10 按 V1 至 V5 重新运行完整集成矩阵，最终证据归 `docs/goal-integration-acceptance.md`。C11/C12 不扩大解释。未测试断电零丢失，不作此承诺。
