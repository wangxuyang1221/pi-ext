# History, media and budget preservation

验证 codex-compact 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `compact-retention`：按消息类型筛选历史，在明文上限和最终请求预算内收紧可选历史；固定部分超窗时仍完整保留 pending 和声明，由服务判断接受性。
- `compact-media`：图片和相邻标签、resize notice 原子保留；媒体协议估算按可解码格式处理。
- `compact-pending-input`：本次待发送输入完整保留。
- `compact-legacy`：旧来源无法证明时拒绝。
- `compact-usage`：窗口占用以有效成功响应 usage 为基线并估算增量；基线失效时回退本地估算。

## How to get to it (user POV)

包含图片、工具输出和待发送用户输入的长会话触发压缩。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- [专用 PTY](../SKILL.md#drive) 提交固定长文本与 PNG，实际生成 checkpoint 并冷启动续聊；无需线上认证。其他媒体、预算及 usage 边界由定向测试补充。

1. 运行 [专用 PTY](../SKILL.md#drive)。核对原长文本完整到达压缩请求，保留区文本被裁剪，PNG 和标签保留，冷启动后的实际请求仍含原图片。该旅程只证明固定 PNG 和长文本场景。
2. 运行 [场景配方](../journeys.md) 的 `overflow`、`automatic`，核对真实 TUI 的 pending 输入完整且仅出现一次、自动取消后重试。运行 `legacy-provable`、`legacy-truncated`，真实 CLI 冷启动历史 marker 并检查迁移或拒绝，拒绝时不发压缩请求且旧 checkpoint 不变。共享 `run compact` 提供补充 SDK 证据。
3. 定向检查保留预算取 `max(0, min(64_000, 有效窗口减去固定部分))`，固定部分含 opaque、本次输入、目标模型投影的 instructions、tools、重附声明和移除提示；再按最终请求估算收紧，不能把 64k 当保证保留量。普通 assistant/tool 输出不直接进入明文保留区；合格用户消息与部分 agent 消息另有筛选。检查工具输出裁剪和纯空白输出处理。
4. 运行配方的 `usage-invalid`、`usage-failed`、`usage-source`，先以真实 TUI 证明有效小 usage 可避免长历史触发压缩，再分别检查非法 usage、失败响应和系统提示变化后，本地历史估算触发压缩。以下测试补充 totalTokens 加尾部增量的精确值、图片标签/resize notice 原子性、inline 音频及平台格式、pending 来源与旧 checkpoint 边界。usage 是窗口占用而非费用核算。

```bash
pnpm test extensions/codex-compact/__tests__/native-compaction.test.ts extensions/codex-compact/__tests__/full-reference.test.ts extensions/codex-compact/__tests__/remote-boundaries.test.ts extensions/codex-compact/__tests__/media-resources.test.ts extensions/codex-compact/__tests__/media-decoder.test.ts extensions/codex-compact/__tests__/token-estimation.test.ts extensions/codex-compact/__tests__/usage-accounting.test.ts extensions/codex-compact/__tests__/replay-budget.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

协议测试不衡量摘要质量。来源不明的旧 checkpoint 必须报 preserved_input_source_unproven；不能修改旧历史让旅程通过。

inline `input_audio` 支持按可解码时长估算，无法解码时回退文本估算，不抓取外部媒体；这不表示 Pi TUI 提供音频上传入口。`original` 图片解码有平台格式差异，按实际 OS 跑媒体测试，不能把一个 PNG 旅程推广到所有格式。线上验收另存脱敏请求来源清单和 compaction entry。

验收依据为 [native-compaction.test.ts](../../../../extensions/codex-compact/__tests__/native-compaction.test.ts)、[full-reference.test.ts](../../../../extensions/codex-compact/__tests__/full-reference.test.ts)、[media-resources.test.ts](../../../../extensions/codex-compact/__tests__/media-resources.test.ts)、[token-estimation.test.ts](../../../../extensions/codex-compact/__tests__/token-estimation.test.ts)、[usage-accounting.test.ts](../../../../extensions/codex-compact/__tests__/usage-accounting.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
