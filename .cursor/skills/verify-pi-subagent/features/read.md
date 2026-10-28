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
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui subagent`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 用真实 child 会话执行工具并完成，读取原生 JSONL 对照摘要与最终状态；定向测试覆盖 72 KiB 摘要、16 KiB detail、pageCursor 固定快照和 after 增量游标。读取新增记录时不可倒退或重复 activity。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/subagent/__tests__/session-reader.test.ts extensions/subagent/__tests__/cursor.test.ts extensions/subagent/__tests__/renderers.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

tmux pane 文本不作为 finalized 活动来源。协议分页边界仍是定向测试，完整用户路径若未生成足够长的真实 child 历史应标为未验证。

验收依据为 [session-reader.test.ts](../../../../extensions/subagent/__tests__/session-reader.test.ts)、[cursor.test.ts](../../../../extensions/subagent/__tests__/cursor.test.ts)、[renderers.test.ts](../../../../extensions/subagent/__tests__/renderers.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
