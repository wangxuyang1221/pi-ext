# Budget policy verification

## Decision supported

[Planning #16](https://github.com/wangxuyang1221/adventure/issues/16) 的预算决定已经得到用户确认。本报告验证既有计量机制是否支持这些决定，完整有效要求移交 [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12)，不在报告中另存规格。

结论：当前生产计量代码、既有测试与本轮合成事件实验支持本关方案，未发现需要改变已确认预算规则的矛盾。这不是跨 provider 功能已实现的结论。

## Baseline and method

- 冒险分支 `adventure/goal-all-providers`，实验前提交 `36e68c7`，产品代码仍为 `870cf4961436e8252a61c00d29a300a5a4b53760`。本轮仅新增冒险证据和实验，不修改产品源码、正式测试或手工编辑生成产物。
- 实际 Node.js 22.22.2、pnpm 11.9.0，开发依赖 Pi 0.84.3。`pnpm run check` 通过类型检查、1012 项测试、构建和发布包校验，2 项 subagent 集成测试按默认开关跳过。完整日志见 [budget-planning-check.log](./budget-planning-check.log)。
- [budget-accounting.mjs](../experiments/budget-accounting.mjs) 使用这次构建出的生产 `registerGoalAccounting`、`GoalStore` 与 `ChildUsageReporter`，不复制 token 公式。根事件由最小合成上下文投递，存储和子代理报告使用真实文件读写。
- 实验保留当前 Codex capability 条件，未移除白名单，也没有调用真实 SDK、adapter 或模型。调度预算回调为空实现，不能用实验本身证明 steering 或自动续跑时序。那些现状由既有 scheduler/commands 测试支持，新跨 provider 时序仍延期验证。
- 实验 47 个场景通过，见 [budget-accounting-results.json](./budget-accounting-results.json)。15 组用量分别覆盖无预算根目标、有预算根目标和子代理报告，共 45 项，另加来源组合与缺失标记持久化 2 项。

## Results

| Scenario | Observed result | Evidence |
| --- | --- | --- |
| Cache and reasoning | 归一化 input 50、output 10、cacheWrite 30、cacheRead 20、reasoning 8 计 90，不再加 reasoning | 三种来源/预算组合均通过 |
| Cache read only | input/output 为零、cacheRead 20 时计 0，但不是全零缺失值 | 三种组合均通过 |
| Cache write only | cacheWrite 10 计 10 | 三种组合均通过 |
| Unverified zero | 四项均为零时计量不完整，不当作可信零消耗；有预算目标仍 active | 三种组合均通过 |
| Missing or invalid | 无 usage、缺字段、负数、小数、字符串、NaN、Infinity、非法缓存字段及和溢出均不虚构数量 | 三种组合均通过 |
| Later valid usage | 随后收到 3+4 正常累计 7，已存在的 missing 标记保留 | 全部用量场景覆盖 |
| Replay | 同一 receipt 重放不重复加量 | 根响应与子代理报告均覆盖 |
| Combined sources | 根 10、压缩 20、分支摘要 10、子代理 30 共 70；再收到根 30 达 100，后续已归属收尾 10 保留为 110 | 组合实验通过，真实计量/存储，不含 scheduler |
| Exhausted budget | 110/100 经 edit/resume 保持 budget_limited 和实际 110 | 组合实验及既有 budget/controls 测试通过 |
| Frozen child reports | 暂停、blocked、usage_limited、complete 或预算收尾结束后报告只推进基线；恢复前刷新，不追补冻结时已收到的增量 | 既有 child-budget/commands 测试在本轮 check 中通过；组合实验补验预算已停止后的报告 |
| Incomplete persistence | 已有缺口经过 pause/edit/resume/reopen 仍保留；创建新目标清零用量并独立计量 | 持久化实验通过 |

没有把“归一化数据合法”解释为“provider 真实报告绝无遗漏”。provider 不暴露失败请求用量时，extension 无法恢复真实消耗；报告时点也不能精确还原尚未报告的实际发生时间。

## Current code and documentation findings

当前源码与测试入口：

- [accounting.ts](../../extensions/goal/src/accounting.ts)、[storage.ts](../../extensions/goal/src/storage.ts)、[scheduler.ts](../../extensions/goal/src/scheduler.ts)、[children.ts](../../extensions/goal/src/children.ts)、[subagent usage.ts](../../extensions/subagent/src/usage.ts)。
- [accounting.test.ts](../../extensions/goal/__tests__/accounting.test.ts)、[budget.test.ts](../../extensions/goal/__tests__/budget.test.ts)、[child-budget.test.ts](../../extensions/goal/__tests__/child-budget.test.ts)、[controls.test.ts](../../extensions/goal/__tests__/controls.test.ts)、[commands.test.ts](../../extensions/goal/__tests__/commands.test.ts)、[subagent usage.test.ts](../../extensions/subagent/__tests__/usage.test.ts)。
- `GoalLease.accountChild` 按状态与预算收尾门控计费，停止后的报告仍推进累计基线。`resumeGoal` 先刷新报告，`agent_settled` 结束预算收尾计费。
- 必要工具被关闭但 goal 状态未变时，不属于上述冻结条件；#15 要求的已归属最后一笔 usage 仍须结算。后续改造不可把工具执行门控混入计量准入。
- 根计量已有直接警告，子代理报告通过目标快照传播 missing。实施时须核对缺失提示在根响应和子代理来源上的实际可见性，不能只凭持久化标记宣称提示验收通过。
- 旧 [goal-descendant-acceptance.md](../../docs/goal-descendant-acceptance.md) 的“完成后的晚到用量仍归集”及 input+output 描述已过时，当前代码和本轮测试均不支持。正式交付时需校正。旧文档不是本次规格依据。

## Upstream contracts

沿用 [provider-feasibility.md](./provider-feasibility.md) 中已固定的模型与 usage 归一化证据。本轮再用 Context7 `/earendil-works/pi` 定位文档，但它只返回 main，未把它当作目标版本证明。

在线读回固定 [Pi 0.84.3 types.ts](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/types.ts) 和 [Pi 0.85.1 types.ts](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/types.ts)，两版均明确 reasoning 是 output 的子集。旧 [Codex 输出上限核验](./codex-output-limit-review.md#accounting-caveat) 说明失败请求的 usage 存在观测边界，不要求本项目复制 Codex 对 incomplete usage 的处理。

## Deferred verification

下列内容归属后续 Implementation 或整体验收，在切片审核时分配，最晚在交付前完成：

- 移除 provider 名称限制后的根、压缩/摘要和受管直接子代理归集，包含不同 provider 的组合，不丢来源或重复计算。
- Pi 0.84.3/0.85.1 实际 SDK 与原生 adapter 离线夹具的正常/缺失 usage 映射、软收尾与最终错误优先级。不用本实验的合成上下文替代这层证据。
- 必要工具关闭、最后一笔 usage、预算命中、恢复和旧目标迟到事件的组合，沿用 [exception-policy-review.md](./exception-policy-review.md) 的矩阵。
- 根与子代理 missing 的用户可见提示，编辑/恢复/重载后查询和工具结果中的持续诊断。
- 正式文档中计量公式、冻结边界、软预算保证与支持范围的一致性。

预算规则无需增加前置 Planning。产品文案语言仍待用户确认，是写入前的操作约定，不是预算关卡的未决业务规则。没有真实远端模型端到端验收结论。

## Reproduction and cleanup

```sh
pnpm run check
node adventure/experiments/budget-accounting.mjs
```

实验临时目录位于 `adventure/experiments/.budget-*`，通过 finally 删除，运行后确认没有残留。未启动独立后台服务或真实模型请求。完整检查中的夹具自行回收子进程与 HTTP fixture；检查结束后 `lsof -nP -a -d cwd <worktree>` 只列出本次检查命令，没有遗留运行进程。`git diff --check` 通过。
