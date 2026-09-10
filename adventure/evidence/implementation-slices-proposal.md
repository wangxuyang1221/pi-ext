# Implementation slices

## Review status

用户已审核通过三关完整修订版，并明确要求创建三关后保存游戏进度、暂停。三关均已创建，完整 Slice、共享约束、工作位置及延期验证归属已写入正文；没有派发 worker，也没有开始编码。恢复后直接从第一关推进，无需再次审核同一版本。

规格唯一入口为 [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12)。本文保留获批切片快照，不替代规格；历史文件名保持不变以保留既有链接。后续实施结果和执行计划由各关 Issue 维护，修订切片仍须先审核。新增/修改产品提示使用英文已确认，不做全仓翻译。

## Implementation issues

1. [Implementation #17](https://github.com/wangxuyang1221/adventure/issues/17)：执行准入与工具恢复。
2. [Implementation #18](https://github.com/wangxuyang1221/adventure/issues/18)：最终异常与额度分类。
3. [Implementation #19](https://github.com/wangxuyang1221/adventure/issues/19)：计量与最终交付。

三关均是 Map #11 的原生子 Issue，原生依赖为 #18 blocked by #17、#19 blocked by #18；#17 无实施前置。当前按用户要求暂停在首关派发之前。

## Revision rationale

- 新 Slice 1 合并正常 provider 准入与工具禁用恢复，两者共同决定是否允许启动或继续 goal，避免对同一工具同步逻辑分两次改造。
- 新 Slice 2 保留独立的最终异常与额度分类，并承接工具关闭与最终异常同时发生的组合验收。原工具关卡对异常关卡的依赖来自这部分验收，不是实现工具门控的必要前置。
- 新 Slice 3 合并计量、文档和最终交付。原有验收项全部保留，按计量行为和交付审计两个阶段报告，两个阶段均通过后才通关，不把旧 Slice 5 变成一笔省略的检查。

## Shared boundaries

- 顺序为 1 → 2 → 3，无并行分组。后续验收包含前置交付的组合行为；按 adventure，一次派发一个独立 worker，在同一冒险 worktree 顺序实施。
- 使用 `adventure/goal-all-providers`；不改 main，不改 Pi 核心，不创建 PR、不合并、不部署、不发布包到 registry，不写真实凭据或全局用户配置。
- 修改源码和正式测试，`dist/` 只由构建生成。每关通过 `pnpm run check`，保存该关新增行为的证据，不用前一关绿灯替代本关验收。
- 每关相关生命周期行为在 Pi 0.84.3 和 0.85.1 实际 SDK 离线夹具中验证。合成事件测试补足边界，但不替代 SDK 时序或原生 adapter 映射。
- 支持范围仍是所有合规 Pi provider。离线 adapter 矩阵采用接口家族代表样本，不宣称每个 provider 或真实远端服务均已实测。
- 新增/修改产品提示使用英文。错误提示不泄露凭据；不新增非空纯文本续跑次数上限、强制预算、硬费用上限或任意协议适配。
- 每关完成其独立 acceptance；最终交付审计由最后一关 worker 承担，不能把前两关必需的证据推迟至最后。

## Slice 1: Provider admission and tool recovery

- goal: Pi 已选中的非 Codex 合规模型能够正常运行 goal；必要工具被关闭后停止新自动续跑，只有工具恢复并显式 /goal resume 后才继续。
- in_scope: 共享 capability、工具暴露及模型切换提示；根响应计量和子代理订阅解除 provider 名称限制；区分插件隐藏工具与外部主动禁用，提示实际缺失工具并保持显式恢复限制；处理普通输入、模型切换、重载、排队请求、旧目标事件与在途用量。
- out_of_scope: 新的最终 length/deferred 和额度分类规则、完整缺失 usage 与原生 adapter 计量矩阵、全局模型配置、任意协议适配。
- dependencies: none。
- acceptance: 双版本实际 SDK 验证非 Codex 内置风格模型、由 Pi 加载的 models.json 私有模型配置及自定义 provider 的正常 function tools 流程，创建/查询/自动续跑/完成和普通根计量正确，切换 provider 不重置目标或累计；保留 Codex 正常路径及非 TUI、非持久会话、子会话、未选模型反例。关闭任一必要工具后不擅自恢复、不发新自动请求；工具重新可用、普通输入、模型切换和重载不绕过显式恢复限制。已发请求最后一笔 usage 仍结算且可命中预算，失效排队请求不误取消用户输入，旧目标事件不污染新目标；通过 pnpm run check。
- boundaries: 不改建 provider 白名单，不发明 supportsTools 标志，不改鉴权或 HTTP，不替用户启用工具。执行门控必须与计量归属分开，不用普通输入即可释放的 continuationDeferral 替代专用恢复限制。必要持久化结构及兼容处理属于本关实现，不因此改变已确认行为。本关不宣称 Slice 2 的新终态规则已实现；工具关闭与新终态规则的交叉验收明确由 Slice 2 承接。

## Slice 2: Final outcomes and quota classification

- goal: 宿主恢复失败后明确停止，保留目标和正确状态；即使同时发生工具关闭或预算命中，也不留下 active 悬挂或误报账户额度。
- in_scope: 最终 settled 的 length/deferred/普通错误处理；成功恢复清除旧异常；内置保守额度识别及英文诊断；目标/运行归属隔离、预算状态优先级，以及与 Slice 1 工具门控的组合。
- out_of_scope: 网络重试实现、异步结果取回、自定义错误匹配配置、预算口径变更，或重新定义 Slice 1 的工具恢复行为。
- dependencies: Slice 1，验收其工具门控与本关最终异常/预算优先级的组合。
- acceptance: 双版本实际 SDK 验证中途异常恢复成功不停止，最终未恢复 length/deferred 将仍 active 的目标转 blocked 且不再自动请求；普通错误不覆盖 budget_limited，明确账户额度错误按 Spec 转 usage_limited。覆盖裸 429、billing、认证/网络错误等反例、旧运行/替换目标迟到事件及显式 resume。工具关闭不切断已归属用量或最终异常结算，工具恢复仍受显式 resume 限制；旧结果不跨运行泄漏。原有空响应、重复工具和执行失败保护回归，非空纯文本不新增计数限制；通过 pnpm run check。
- boundaries: 错误分类正例须有固定官方源码或文档依据，不能仅靠宽泛关键词。先结算并核对归属，再判断最终状态；不抢在 Pi 自身重试/压缩之前停止，不自行提高输出上限。不用工具门控掩盖真实终态，也不因观察到一次中途异常就阻止宿主恢复。

## Slice 3: Accounting and final delivery

- goal: 跨 provider 的根与受管直接子代理计量符合 Spec，并交付可安装的包、准确的使用说明和完整验收证据。
- in_scope: 按需修正根/压缩/摘要/子代理归集和去重；补齐根及子代理缺失 usage 的英文提示；保留不完整标记、软预算、停止后基线推进及恢复语义；验证与前两关的异常和工具门控交叉。更新 README 与相关说明，校正旧子代理文档的公式和迟到计量描述；核对包内入口和排除边界，从实际打包产物做双版本冒烟，对照完整 Spec 完成延期项审计及资源清理。
- out_of_scope: 新 token 公式、硬封顶、预算追加入口、任意工具内部调用或孙代理账单、停止后追补迟到子代理消耗、全仓翻译、在线发布、PR、合并、部署或自动删除冒险分支。
- dependencies: Slice 2，计量交叉验证与最终审计需要前两关交付。
- acceptance: 阶段 A 完成计量验收。双版本实际 SDK 与原生 adapter 离线样本覆盖 OpenAI-compatible 的 Completions/Responses、Anthropic、Google，并保留 Codex 和合规自定义 provider；验证 90 token 缓存/reasoning、cache-read-only、全零/非法/缺失 usage 的有无预算行为、receipt 去重、100 预算实际 110 的软收尾、根/子代理不同 provider、压缩/摘要、10→50→60 冻结恢复、编辑/重载/继承与新旧目标隔离。实际 TUI 与 get_goal 证明提示可见且旧缺口不消失，工具关闭时最后用量和最终错误优先级不回退。阶段 B 完成交付审计。在工作区内从 pnpm 打包产物验证双版本加载及非 Codex 正常流程；Spec 每项有前序证据或补验入口，全部延期项有结论，未执行项如实标注，必需项未验证不能通关；pnpm run check、包校验和文档一致性检查通过；任务进程及监听端口清理完成，提供代码提交、复现命令与整体验收报告。两个阶段均通过后交协调者验收，再提交用户确认。
- boundaries: 原生 adapter 测试必须使用目标版本真实映射，不自写 mapper 冒充验证。受管直接子代理至少有真实进程/投递/报告链路证据，不只伪造报告文件；不调用付费服务或索要真实密钥。协议夹具依据固定 SDK 源码，契约反证须回报 Planning，不自行改预算政策。前序缺陷回到对应关卡修复，不因补文档改业务规则；不把未调用真实远端模型描述为完成全 provider 远端验证。Map/Spec 在用户确认交付前保持 open。

## Deferred verification ownership

| Requirement | Primary slice | Final audit |
| --- | --- | --- |
| Pi 模型接入、正常 function tools 与保留会话准入边界 | #17 | #19 B |
| 工具禁用意图、显式恢复、排队请求及最后用量 | #17 | #19 B |
| 最终恢复时序、length/deferred、保守额度分类及旧事件 | #18 | #19 B |
| 工具关闭与最终异常、预算优先级组合 | #18 | #19 B |
| 原生 usage 映射、跨 provider 来源组合、冻结与缺口持久化 | #19 A | #19 B |
| 根/子代理缺失提示的 TUI 与工具结果可见性 | #19 A | #19 B |
| 发布包、正式文档、全规格核对和临时资源清理 | #19 B | #19 B |

来源为 [异常报告](./exception-policy-review.md#result-and-deferred-verification) 与 [预算报告](./budget-policy-review.md#deferred-verification)。每关承担其相关双版本 SDK 验证，最终审计只汇总和补齐证据，不取代各关独立 acceptance。A/B 是同一 Slice 3 的执行和验收阶段，不创建两个隐藏的 Implementation 关卡。
