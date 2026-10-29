# Activity summaries and detail pagination

验证 subagent 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `subagent-list`：列表包含容量与诊断。
- `subagent-recent`：摘要读取已持久活动。
- `subagent-turns`：按 turn 读取固定快照。
- `subagent-detail`：按 section 分页详细内容。
- `subagent-cursors`：游标绑定身份且不倒退。
- `subagent-errors`：错误活动保留有界原因。

## How to get to it (user POV)

subagent_list；subagent_read recent_activity/turns/activity_detail；subagent_wait。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 此 skill 测试扩展创建的产品 child。它不授权代理把开发任务委派给其他 agent。root 与直接 child 是唯一受支持拓扑。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run subagent`。保存返回的 evidence 路径并核对退出码。
2. 运行 `pnpm exec node .cursor/skills/verify-pi-subagent/scripts/run.mjs`。正式 driver 从真实 root CLI 调用生产工具并操作 child；参数、受控故障和证据层级见 [driver 说明](../scripts/README.md)。逐条审查对应断言。
3. 用真实 child 会话执行工具并完成，读取原生 JSONL 对照摘要与最终状态；定向测试覆盖 72 KiB 摘要、16 KiB detail、pageCursor 固定快照和 after 增量游标。读取新增记录时不可倒退或重复 activity。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/subagent/__tests__/session-reader.test.ts extensions/subagent/__tests__/cursor.test.ts extensions/subagent/__tests__/renderers.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

full driver 通过真实 child 写入两个 120022-byte assistant turn，将 turns 撑满多页，在分页间继续追加并核对固定快照、无重复和 after 增量。五种 detail section 均生成多页 UTF-8 内容并还原，错误路径含工具失败、部分文本失败和真实取消。`/tree` 通过真实 child 选择器回退，核对 after 游标不会重发旧 activity。finalized 活动仍以原生 JSONL 为准。

验收依据为 [session-reader.test.ts](../../../../extensions/subagent/__tests__/session-reader.test.ts)、[cursor.test.ts](../../../../extensions/subagent/__tests__/cursor.test.ts)、[renderers.test.ts](../../../../extensions/subagent/__tests__/renderers.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
