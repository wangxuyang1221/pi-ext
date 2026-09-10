# Implementation slice proposal

## Review status

待用户审核。本文是候选切片，不授权编码，不是已确认的 Implementation 清单。用户本轮选择方案 1 仅确认新增/修改的产品提示使用英文，不做全仓翻译。

规格唯一入口为 [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12)。本文把交付结果和延期验证分配给候选切片，不替代规格正文。用户审核通过后，将每个切片的完整字段写入对应 Implementation Issue，执行计划由该关 worker 在 Issue 中维护。

## Shared boundaries

- 顺序为 1 → 2 → 3 → 4 → 5，无并行分组。后续验收包含前置交付的组合行为；按 adventure，一次派发一个独立 worker，在同一冒险 worktree 顺序实施。
- 使用 `adventure/goal-all-providers`；不改 main，不改 Pi 核心，不创建 PR、不合并、不部署、不发布包到 registry，不写真实凭据或全局用户配置。
- 修改源码和正式测试，`dist/` 只由构建生成。每关通过 `pnpm run check`，保存该关新增行为的证据，不用前一关绿灯替代本关验收。
- 每关相关生命周期行为在 Pi 0.84.3 和 0.85.1 实际 SDK 离线夹具中验证。合成事件测试补足边界，但不替代 SDK 时序或原生 adapter 映射。
- 支持范围仍是所有合规 Pi provider。离线 adapter 矩阵采用接口家族代表样本，不宣称每个 provider 或真实远端服务均已实测。
- 新增/修改产品提示使用英文。错误提示不泄露凭据；不新增纯文本续跑次数上限、强制预算、硬费用上限或任意协议适配。
- 每关完成其独立 acceptance；最终交付审计由最后一关 worker 承担，不能把前面每关必需的证据都推迟至最后。

## Slice 1: Run goals with the selected provider

- goal: Pi 已配置并选中的非 Codex 合规模型，可以创建、查询、自动推进并完成 goal，不再因 provider 名称被拒绝。
- in_scope: 调整共享 capability、正常工具暴露、模型切换提示及相关入口；让现有根响应计量和受管子代理订阅不再受 Codex 名称限制；覆盖正常目标生命周期与模型切换后的计量连续性。
- out_of_scope: 新的最终 length/deferred 和额度分类规则、必要工具被主动关闭后的恢复门控、完整缺失 usage 提示矩阵、全局模型配置入口。
- dependencies: none。
- acceptance: 双版本实际 SDK 验证非 Codex 内置风格模型、由 Pi 加载的 models.json 私有模型配置及自定义 provider 的正常 function tools 流程；创建、查询、自动续跑、完成与普通根用量正确；切换 provider 不重置目标或累计。保留 Codex 正常路径，以及非 TUI、非持久会话、子会话和未选模型等准入反例；通过 pnpm run check。
- boundaries: 不以 provider 名称改建另一份白名单，不凭空发明 supportsTools 标志，不改鉴权或 HTTP；本关不宣称后续异常/工具关闭规则已实现。正常工具暴露改动须为后续保留用户禁用意图留出空间，不把工具可见性变成计量准入条件。

## Slice 2: Stop on final unrecovered outcomes

- goal: 宿主恢复后仍未成功的运行能明确停止，保留目标和正确状态，不留下 active 悬挂或误报账户额度。
- in_scope: 最终 settled 的 length/deferred/普通错误处理；成功恢复清除旧异常；内置保守额度识别及英文诊断；相关目标/运行归属隔离和预算状态优先级。
- out_of_scope: 必要工具被关闭后的专用恢复门控、预算口径变更、网络重试实现、异步结果取回、自定义错误匹配配置。
- dependencies: Slice 1。
- acceptance: 双版本实际 SDK 验证中途异常恢复成功不停止，最终未恢复 length/deferred 将 active 转 blocked 且不再自动请求；普通错误不覆盖 budget_limited，明确账户额度错误按 Spec 转 usage_limited。覆盖裸 429、billing、认证/网络错误等反例，旧运行/替换目标迟到事件及显式 resume；原有空响应、重复工具、执行失败保护回归，非空纯文本不新增计数限制；通过 pnpm run check。
- boundaries: 错误分类正例必须有固定官方源码或文档依据，不能仅靠宽泛关键词。先结算并核对归属，再判断最终状态；不抢在 Pi 自身重试/压缩之前停止，不自行提高输出上限。

## Slice 3: Respect disabled goal tools

- goal: 必要 goal 工具被关闭后不再自动续跑；工具恢复也不会自行重启，只有显式 /goal resume 才继续。
- in_scope: 区分插件隐藏工具和外部主动禁用；停止新请求、提示实际缺失工具；保持需要显式恢复的限制；处理模型切换、普通输入、排队请求、会话重载及在途计量与最终异常的交叉。
- out_of_scope: 自动替用户启用工具、检测模型是否主动调用工具、修改非空纯文本策略、改预算公式或子代理冻结规则。
- dependencies: Slice 2，复用其最终异常与归属处理，验收工具关闭和最终结果同时发生时的组合。
- acceptance: 双版本实际 SDK 验证关闭任一必要工具后无新 goal 自动请求、不擅自恢复；工具重新可用、普通输入、模型切换及重载不绕过显式恢复限制。已发请求最后一笔 usage 仍结算且可命中预算，最终异常仍遵守 Slice 2 的优先级；失效排队请求不误取消用户输入，旧目标事件不污染新目标；通过 pnpm run check。
- boundaries: 不用普通输入即可释放的 continuationDeferral 替代专用限制，不把执行门控混入计量 eligibility。需要的持久化结构及兼容处理属于本关实现；不能因此改变已确认行为。

## Slice 4: Preserve accounting across providers

- goal: 换 provider 后，根与受管直接子代理的用量、缺失诊断、软预算和恢复统计仍按 Spec 一致工作。
- in_scope: 按需修正跨 provider 的根/压缩/摘要/子代理归集和去重；补齐根及子代理缺失 usage 的英文提示；保留不完整标记、停止后的基线推进及恢复语义；验证预算、最终错误和工具恢复门控交叉。
- out_of_scope: 新 token 公式、硬封顶、预算追加入口、任意工具内部调用或孙代理账单、在停止后追补迟到子代理消耗。
- dependencies: Slice 3，验收与已完成异常处理及工具门控的组合。
- acceptance: 双版本实际 SDK 与原生 adapter 离线样本覆盖 OpenAI-compatible 的 Completions/Responses、Anthropic、Google，并保留 Codex 和合规自定义 provider。验证 90 token 的缓存/reasoning 例子、cache-read-only、全零/非法/缺失 usage 有无预算均按规则继续、重复 receipt 不重计、100 预算实际 110 的软收尾；覆盖根/子代理不同 provider、压缩/摘要、10→50→60 的冻结恢复、编辑/重载/继承及新旧目标隔离。实际 TUI 与 get_goal 结果证明缺失提示可见且旧缺口不消失；工具关闭时最后用量与最终错误优先级不回退；通过 pnpm run check。
- boundaries: 原生 adapter 测试必须使用目标版本真实映射，不自写 mapper 冒充验证。受管直接子代理至少有真实进程/投递/报告链路证据，不只伪造报告文件；不调用付费服务或索要真实密钥。协议夹具具体形状由固定 SDK 源码确定，发现契约反证时回报 Planning，不自行改预算政策。

## Slice 5: Deliver an installable package and guide

- goal: 用户能按交付说明使用构建出的发布包，并明确知道支持范围、停止/恢复规则和预算观测限制。
- in_scope: 更新 README 与相关验收/使用说明，校正旧子代理文档的公式和迟到计量描述；核对包内生成入口、文档及排除边界；从实际打包产物做双版本冒烟；最后一个 worker 对照完整 Spec 完成整体验收、延期项审计与资源清理。
- out_of_scope: 新功能、全仓翻译、在线发布、PR、合并、部署或自动删除冒险分支。
- dependencies: Slice 4。
- acceptance: 在工作区内从 pnpm 打包产物验证双版本加载和非 Codex 目标正常流程；Spec 每项都有前序验收或补验入口，全部延期项有结论，非执行项明确写出证据边界而不冒充通过。pnpm run check、包校验与文档一致性检查通过；本任务进程和监听端口清理完成；提供代码提交、复现命令及整体验收报告，由协调者核对后交用户确认。
- boundaries: 前序通过的业务验收不因缺少交付文档而重写，发现缺陷回到对应关卡修复；不把未调用真实远端模型描述为已完成全 provider 远端验证。Map/Spec 在用户确认交付前保持 open。

## Deferred verification ownership

| Requirement | Primary slice | Final audit |
| --- | --- | --- |
| Pi 模型接入、正常 function tools 与保留会话准入边界 | 1 | 5 |
| 最终恢复时序、length/deferred、保守额度分类及旧事件 | 2 | 5 |
| 工具禁用意图、显式恢复、排队请求及最后用量交叉 | 3 | 5 |
| 原生 usage 映射、跨 provider 来源组合、冻结与缺口持久化 | 4 | 5 |
| 根/子代理缺失提示的 TUI 与工具结果可见性 | 4 | 5 |
| 发布包、正式文档、全规格核对和临时资源清理 | 5 | 5 |

来源为 [异常报告](./exception-policy-review.md#result-and-deferred-verification) 与 [预算报告](./budget-policy-review.md#deferred-verification)。每关都承担其相关双版本 SDK 验证，最终审计只汇总和补齐证据，不取代各关独立 acceptance。
