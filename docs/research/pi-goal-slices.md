# Pi goal implementation slices

## Review status

本列表依据 [spec](./pi-goal-spec.md) 与 [存储设计](./pi-goal-storage-design.md)，七个 Issues 已由用户确认并创建，原生子 Issue 与依赖已核验。最初暂停已由继续指令解除，模式 do-it-all。#4 至 #9 已验收关闭，用户 go on 已解除 #8 后的历史暂停。#10 正进行整体验收，结果见 [Goal integration acceptance](../goal-integration-acceptance.md)；是否通关以协调者独立验收及 [主地图](https://github.com/wangxuyang1221/adventure/issues/1) 为准。

当前不安排并行编码。多个切片会修改 goal 注册入口和状态协调逻辑，先按依赖验收更便于定位调度与存储错误。全部完成前不发布为完整 goal 功能。

## Slice 1: Save and recover a goal

- goal: 用户能在首条模型回复前创建、查看和清除目标，退出后通过恢复入口找回唯一目标及其状态。
- in_scope: 新 goal 扩展注册、基本 `/goal` 创建/摘要/clear、权威文件与历史镜像、单写者与 revision、tombstone、`/goal-recover`、无会话文件时接管；最小英文 UI 与错误反馈。
- out_of_scope: 自动续跑、模型 goal 工具、预算执行、分叉继承、附件。
- dependencies: none。
- acceptance: 仓库内临时目录完成创建后重启读取、首条回复前恢复、同一记录竞争接管、写入失败与镜像失败注入。创建成功必须对应可重读的权威状态，失败不伪报成功，清除后不复活。完成 V3 的基础存储证据。
- boundaries: 不修改 Pi 核心、不伪造 assistant、不写用户全局配置做测试。此阶段只验收保存与恢复，不将尚未实现的自动执行宣称可用。

## Slice 2: Preserve goal ownership across sessions

- goal: 用户切换历史或会话时目标不串用，只有显式继承才在新会话携带目标。
- in_scope: tree/new/resume/reload/shutdown 归属处理、`/goal-fork` 的 fork/clone 选择、快照检查点、独立新记录和持久化初始续跑门禁、切换失败清理。
- out_of_scope: 自动调度实现、预算计算、子代理归集。
- dependencies: Slice 1。
- acceptance: tree 保留最新目标与消耗；普通 fork/clone 忽略复制镜像；显式继承后重开仍保留门禁且源记录不变；失败不清除源目标。会话替换后旧 context 不可继续写目标。完成 V3 生命周期证据。
- boundaries: 门禁不伪装成 paused；完整保存快照，不重置已用预算。不重新定义 C7/C8。

## Slice 3: Pursue and stop a goal

- goal: 模型可持续推进目标，并在完成、用户暂停或终止错误时可靠停止。
- in_scope: 三个 goal 工具及固定上游提示、状态迁移、edit/pause/resume、事件驱动调度、自有消息失效过滤、用户输入保护、错误分类、原生重试/压缩协调、完整 turn 的三轮 bash 失败、单目标 UI 状态刷新。
- out_of_scope: token 预算触发、子代理计费、附件 UI、完整 codex-ui 视觉集成。
- dependencies: Slice 2。
- acceptance: 在两版本真实 runtime 和 TUI 场景下，不出现暂停后的旧模型请求；按已确认 C11 接受取消失效自有请求时其他扩展排队消息被清除，用户追加文字可退回编辑器重发，但文字、已有聊天记录与已保存目标不得损坏；complete/blocked/usage_limited 不继续；关闭弹窗不误 pause；C12 接受原生重试等待中 Esc 取消后归为 blocked，但须停止且可 `/goal resume` 恢复，其他中断/pause 语义不变；重试/压缩失败后显式输入可继续。模型工具 schema 与同轮多次失败、跨三轮失败均有测试。完成 V1 核心与 V4 工具/轮次证据。
- boundaries: 不把底层 end 数量直接当目标轮数，不通过永久禁用压缩解决故障，不无限重试；未知额度错误按 C6 blocked。除 C11 已确认的取消队列副作用外，公共接口无法满足剩余输入保护时仍返回规划，不使用私有宿主补丁，也不引入 provider 检查层；按 C12 不为重试取消观测接入或重建编辑器。

## Slice 4: Enforce the main-agent soft budget

- goal: 用户能为目标设置 token 预算，看到累计用量与时间，预算达到后当前回合收尾而不新增自动回合。
- in_scope: 主代理 usage 映射、创建/替换基线、checkpoint、配置上限与默认规则、剩余预算、一次收尾提醒、active 时间、预算和错误交错结算。
- out_of_scope: 子孙代理用量、外部代理适配、硬费用封顶。
- dependencies: Slice 3。
- acceptance: 已知 usage 夹具与实际 provider 映射核对，缓存不重复扣除，创建前不收费，重复事件不重复记账。预算 100 实际消耗 110 保留 110 并停止后续续跑，当前回合不被硬杀。恢复/编辑不重置消耗。完成 V2 主代理证据。
- boundaries: 不将 tokensBefore 或 footer totalTokens 当消耗，不声称精确美元费用；缺失 usage 明确诊断，不虚构数值。

## Slice 5: Include descendant usage

- goal: 本仓库 subagent 为根目标工作时，直接子代理消耗计入同一个目标预算，结束或重复读取不丢失也不重复收费。
- in_scope: subagent 启动归属及用量上报协作、根目标归集、生命周期与旧 goal 隔离、完成观察语义、预算达到后的根收尾与禁止新增自动循环。
- out_of_scope: 孙代理及嵌套编排、第三方代理系统、独立子代理 goal 循环、预算到达时强杀运行中进程。
- dependencies: Slice 4。
- acceptance: root/direct child、重复事件、子代理结束、目标替换和迟到消息有可复现测试；实际受管进程夹具验证上报与清理，根检查点统计一致。不因读取活动重复计费。完成 V2 直接子代理证据。C13 已由用户选择保留单层范围，替代原孙代理验收，依赖与切片数量不变，确认见 https://github.com/wangxuyang1221/adventure/issues/2#issuecomment-5603155660 。
- boundaries: 只扩展本仓库协作契约，不读取无归属会话；主目标凭据不能传入用量文件。主会话非交互功能范围不因此扩大。

## Slice 6: Edit long goals and integrate the TUI

- goal: 用户能使用长目标与明确附件，重开后继续编辑，并在现有 codex-ui 中查看目标状态。
- in_scope: 长文本物化、Pi 粘贴图片文件的明确识别/选择与持久复制、受控引用编辑、附件失败清理、摘要/确认/编辑 UI、codex-ui 状态集成与无 codex-ui 回退展示。
- out_of_scope: 任意路径自动收集、任意剪贴板读取、像素级复刻、RPC UI。
- dependencies: Slice 4。
- acceptance: 4000 Unicode 边界、长文本保存重开编辑、图片临时源消失后目标附件仍可读取、恶意路径和符号链接拒绝、失败不删除其他记录。codex-ui 加载/未加载均可查看状态，不破坏既有 editor/footer。完成 V4 附件和 UI 证据。
- boundaries: 测试使用仓库临时夹具，不读真实用户剪贴板；使用英文产品文案并保留上游归属说明。

## Slice 7: Verify and package the complete workflow

- goal: 提供可安装且有完整验收证据的 goal 插件与必要的 codex-ui/subagent 联动版本。
- in_scope: 两版本 TUI 集成矩阵、跨切片恢复/预算/中断场景、发布包入口、配置与限制文档、许可证归属、全仓检查和进程清理，修复集成缺陷。
- out_of_scope: 新功能范围、未经批准的状态语义变更、其他 provider、自动发布到外部注册表。
- dependencies: Slice 5、Slice 6。
- acceptance: V1 至 V5 证据归档并回写原规划记录；pnpm run check 全通过；打包产物包含所需入口和许可；实际测试启动的进程退出，监听端口释放。区分受控模型验收与真实服务证据，不将模型遵从提示当成形式证明。
- boundaries: 主协调者执行最终验收，不仅依赖 worker 自报。目标行为发生变化须回到 spec，不为通过测试删减已确认需求。

## Dependency check

依赖图为 1 → 2 → 3 → 4，4 → 5 与 4 → 6，5 + 6 → 7，无环。Slice 5 与 6 在功能上无相互依赖，但考虑共享注册与集成文件，当前仍按 5 后 6 串行派发。每片验收不依赖其后续片才能判断通过。

映射：Slice 1 → [#4](https://github.com/wangxuyang1221/adventure/issues/4)，2 → [#5](https://github.com/wangxuyang1221/adventure/issues/5)，3 → [#6](https://github.com/wangxuyang1221/adventure/issues/6)，4 → [#7](https://github.com/wangxuyang1221/adventure/issues/7)，5 → [#8](https://github.com/wangxuyang1221/adventure/issues/8)，6 → [#9](https://github.com/wangxuyang1221/adventure/issues/9)，7 → [#10](https://github.com/wangxuyang1221/adventure/issues/10)。全部为 spec #3 的原生子 Issue。

#4 至 #9 均已按当前 C1 至 C13 范围验收。#10 复验 C11/C12 的窄例外和 C13 单层归集，不重新开放孙代理或扩大取消语义。切片边界和原生依赖不变；出现新的规格关键偏离仍须返回规划。
