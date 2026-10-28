# History, media and budget preservation

验证 codex-compact 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `compact-retention`：保留历史遵守明文预算。
- `compact-media`：图片和标签原子保留。
- `compact-pending-input`：本次待发送输入完整保留。
- `compact-legacy`：旧来源无法证明时拒绝。
- `compact-usage`：只用宿主暴露 usage 记账。

## How to get to it (user POV)

包含图片、工具输出和待发送用户输入的长会话触发压缩。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- 远程压缩只适用于 openai-codex/openai-codex-responses。离线 CLI 使用 faux 模型，只能验收配置命令；远程协议由真实 SDK 加 HTTP 边界夹具验证，线上质量需要另行实跑。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run compact`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-compact`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 先跑真实会话续跑，再以定向测试检查 64k 明文预算、工具输出裁剪、图片与相邻标签原子保留、pending user 来源和 usage。线上需要保存脱敏的请求来源清单与 compaction entry，确认本次输入未被裁剪。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/codex-compact/__tests__/native-compaction.test.ts extensions/codex-compact/__tests__/full-reference.test.ts extensions/codex-compact/__tests__/media-resources.test.ts extensions/codex-compact/__tests__/token-estimation.test.ts extensions/codex-compact/__tests__/usage-accounting.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

协议测试不衡量摘要质量。来源不明的旧 checkpoint 必须报 preserved_input_source_unproven；不能修改旧历史让旅程通过。

验收依据为 [native-compaction.test.ts](../../../../extensions/codex-compact/__tests__/native-compaction.test.ts)、[full-reference.test.ts](../../../../extensions/codex-compact/__tests__/full-reference.test.ts)、[media-resources.test.ts](../../../../extensions/codex-compact/__tests__/media-resources.test.ts)、[token-estimation.test.ts](../../../../extensions/codex-compact/__tests__/token-estimation.test.ts)、[usage-accounting.test.ts](../../../../extensions/codex-compact/__tests__/usage-accounting.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
