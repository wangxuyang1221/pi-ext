# Goal descendant accounting report

## Current status

C13 已确认单层归集。用户已确认另一会话完成 subagent 修复并提交 `3972c9e`，旧共享写者阻塞解除。本关已在新基准加保留 goal 修改上完成实现与双版本验证，新增真实 tmux transport 证据，待协调者独立验收，#8 保持 OPEN，正文写权交回协调者。

当前结果、夹具缺陷的 Red/Green 修正、最终证据和精确源码检查点见 [acceptance](goal-descendant-acceptance.md)。[handoff](goal-descendant-handoff.md) 保留旧停点历史；不得沿用旧夹具外层漏检 isError 的成功日志证明关闭通过。

## Historical status before C13

以下为首轮原始调查，保留历史；其中“未实施”和待拓扑决策仅适用于 C13 确认之前，不代表当前状态。

[Implementation level #8](https://github.com/wangxuyang1221/adventure/issues/8) 本轮停止于拓扑契约核验，未实施子孙归集，未完成 V2 子孙验收。正文写权交回协调者，Issue 保持 OPEN。这不是 Pi 公共 API 不可行结论，也不是要求降低 #8 验收。

基准为 `f4a7e44b43070748f082523b7377b165c9471e9e` 加未提交 #4 至 #7。[#7 协调者检查点](https://github.com/wangxuyang1221/adventure/issues/7#issuecomment-5603022298) 中 accounting/index/storage/scheduler 的 SHA-256 与本轮读取相同。已有代码、研究与原型均保留。

## Contract conflict

#3/#8 要求真实 root/child/grandchild 和中间父退出的受管进程验收。但当前 subagent 的公开行为与实现不允许 managed child 管理后代：

- `README.md:302` 明确合法拓扑只有 root 到 direct child，managed child 不注册编排工具，`target: "all"` 仅处理当前 root 的 direct children。
- `extensions/subagent/src/index.ts:98` 只有无 parent 的进程注册 subagent 工具。
- `extensions/subagent/src/manager.ts:226-227` 在启动进程前拒绝 managed parent spawn；`assertRootNamespace` 拒绝其执行管理操作；`assertManagedLeaf` 把 child 持有 children 视为 topology corruption。
- `extensions/subagent/src/ownership.ts:11-12` 拒绝 managed parent 注册 child。
- `extensions/subagent/__tests__/manager.test.ts:28`、`ownership.test.ts:28` 分别验证启动前拒绝和注册拒绝。`manager-operations.test.ts`、`manager-close.test.ts` 另保护拒绝嵌套及不递归关闭的边界。这些现行测试在本轮完整 check 中通过。

因此，只添加归属和用量文件无法经现行公开工具产生合法 grandchild。修改这些守卫将改变 subagent 的公开编排能力与关闭边界，不只是内部计费选择。合成 grandchild usage 或手写损坏拓扑虽然能测纯归集算法，不能替代要求的真实受管进程证据。

## Decision needed

请协调者先核定 #3/#8 的子孙要求是否已经授权改变上述旧产品约束。若已授权，明确恢复 worker 即可，无须让用户重复审核整份实现计划；若旧限制仍须保持，则需返回规划关确认冲突，不能由本 worker 把 grandchild 验收降级为纯单元模拟。

需要确定的边界是：只为具有根 goal 归属的 managed child 开启后代编排，还是所有 managed child 都开放；中间父进程退出后，存活后代由谁显式关闭，以及是否改变既有 `target: "all"` 的 direct-only 语义。后一项影响非 goal 调用方及进程清理，不能隐含采用递归强杀。

可以保留 direct-child 可见性与逐级容量限制，同时让后代直接向根归属写累计报告。但这只是待拓扑边界确认后的技术方向，本轮没有实现，也没有声称它已经满足退出回收契约。

## Actions and verification

- 完整读取派发要求的 #1/#3/#8、#7 检查点、仓库 AGENTS、语言策略、write-todo-list、develop-with-tdd 和 unslop；计划保存于 `docs/goal-descendant-todo.md`。
- 实际版本为 Node.js 22.22.2、pnpm 11.9.0。
- `pnpm run check` 通过，日志 `.scratch/goal-8-baseline-check.log`：70 测试文件通过，1 跳过；866 测试通过，1 跳过；类型、构建、7 扩展发布包校验通过。与 #7 检查点数量一致，没有更改统计断言。
- `git diff --check` 通过。
- 未修改任何源码或测试。新增路径仅两个本关文档。`extensions/subagent/dist/tools.js` 出现构建差异，是完整 check 从既有未提交 `src/tools.ts` 生成的产物，不是本轮手改 dist。
- 无本轮新行为测试，因此没有 Red/Green 实现记录。现有拒绝测试证明约束，不能当作新功能通过。
- 未运行 Pi SDK/TUI 或真实受管进程矩阵，未调用付费模型。未查询新 Pi 接口，未对 Pi API 可行性作结论；固定版本 Pi 文档、Context7 和安装源码的接口核验留待恢复实现前完成。
- 只运行有限生命周期的 check 命令，无手动后台服务或受管模型进程。check 返回后检查进程表，无本轮 vitest/tsc/check-package/goal-8 遗留进程；没有本轮监听服务待释放。不接触现有主协调者和其他 worker 进程。
- 未写全局配置或真实用户 session；未提交、推送或部署。Issue 副作用仅限获批的 #8。

## Source checkpoint

```text
916d425b896401aab15603ad0a16b21ece12448c437634192e83eb5cd08eb448  extensions/subagent/src/index.ts
37ebd8fca4016154820a395e06a6d6ec3af36a10d2b712f828bc2757ec0572ef  extensions/subagent/src/manager.ts
8fa1aed3ea3e0f4f1d1a517916d1d55f1f45755862a96494b6a0aea1e05351e3  extensions/subagent/src/ownership.ts
d240b4d409fffe1cfceb7999254b155f45b73c1677fb41af23f82c459968a825  extensions/goal/src/accounting.ts
3785334ac1e2e0bec2225b7363c8018ea3d0369acee2a82a7a42f57da16acbf0  extensions/goal/src/index.ts
29c795292ede0186d4932130cbd3a403e8d8080ca387506cb994e41c0524be35  extensions/goal/src/storage.ts
bfcefb7780e2684ff5f5b000b4c71638aad30cc0cfab0a21be66b4abee1dd026  extensions/goal/src/scheduler.ts
```

## Continuation

先解决拓扑授权解释，再按本关计划从真实 grandchild 注册链的 Red 开始。保持 C11/C12、不包装 provider、不重建 editor、不改 Pi 核心；根凭据不得进入用量文件；不得扫描无归属 session。#8 未交付，#1/#3 的状态同步由协调者处理。
