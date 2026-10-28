# Prompt delivery and settled generations

验证 subagent 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `subagent-task`：初始 task 获得投递凭据。
- `subagent-prompt`：后续 prompt 到对应 child。
- `subagent-followup`：忙碌时 follow-up 可见。
- `subagent-delivery-rejected`：认证拒绝单独分类。
- `subagent-unconfirmed`：未确认投递不自动重发。
- `subagent-wait`：wait 等待对应代次结束。

## How to get to it (user POV)

subagent_spawn task；subagent_prompt；subagent_wait afterSettled。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 此 skill 测试扩展创建的产品 child。它不授权代理把开发任务委派给其他 agent。root 与直接 child 是唯一受支持拓扑。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run subagent`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui subagent`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 记录 deliveryId 与 settledCursor，检查 child 原生 user turn 或 Steering/Follow-up pending 证据；后续 wait 必须等本次代次，不能消费上一轮结束。模拟拒绝与未确认时记录返回错误，不自动重发。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/subagent/__tests__/delivery-receipt.test.ts extensions/subagent/__tests__/wait.test.ts extensions/subagent/__tests__/prompt-auth.test.ts extensions/subagent/__tests__/manager-readiness.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

at-least-once 不等于 exactly-once。默认 Ctrl+C/Enter/Alt+Enter 键位是前置条件，定制键位不可当已兼容。

验收依据为 [delivery-receipt.test.ts](../../../../extensions/subagent/__tests__/delivery-receipt.test.ts)、[wait.test.ts](../../../../extensions/subagent/__tests__/wait.test.ts)、[prompt-auth.test.ts](../../../../extensions/subagent/__tests__/prompt-auth.test.ts)、[manager-readiness.test.ts](../../../../extensions/subagent/__tests__/manager-readiness.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
