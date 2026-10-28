# History, media and budget preservation

验证 codex-compact 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `compact-retention`：按消息类型筛选历史，保留内容满足明文上限和最终请求窗口预算。
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
2. 运行共享 `run compact`，补验待发送输入完整保留、可证明的旧来源迁移、无法证明的来源拒绝及旧 checkpoint 不变。
3. 定向检查保留预算取 `max(0, min(64_000, 有效窗口减去固定部分))`，固定部分含 opaque、本次输入、instructions 和 tools；再按最终请求估算收紧，不能把 64k 当保证保留量。普通 assistant/tool 输出不直接进入明文保留区；合格用户消息与部分 agent 消息另有筛选。检查工具输出裁剪和纯空白输出处理。
4. 检查有效成功 usage 的 totalTokens 加新增尾部估算，失败、非法 usage 或来源变化时回退；这不是费用核算。以下测试同时补充图片标签/resize notice、inline 音频及平台格式、pending 来源与旧 checkpoint 边界。

```bash
pnpm test extensions/codex-compact/__tests__/native-compaction.test.ts extensions/codex-compact/__tests__/full-reference.test.ts extensions/codex-compact/__tests__/remote-boundaries.test.ts extensions/codex-compact/__tests__/media-resources.test.ts extensions/codex-compact/__tests__/media-decoder.test.ts extensions/codex-compact/__tests__/token-estimation.test.ts extensions/codex-compact/__tests__/usage-accounting.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

协议测试不衡量摘要质量。来源不明的旧 checkpoint 必须报 preserved_input_source_unproven；不能修改旧历史让旅程通过。

inline `input_audio` 支持按可解码时长估算，无法解码时回退文本估算，不抓取外部媒体；这不表示 Pi TUI 提供音频上传入口。`original` 图片解码有平台格式差异，按实际 OS 跑媒体测试，不能把一个 PNG 旅程推广到所有格式。线上验收另存脱敏请求来源清单和 compaction entry。

验收依据为 [native-compaction.test.ts](../../../../extensions/codex-compact/__tests__/native-compaction.test.ts)、[full-reference.test.ts](../../../../extensions/codex-compact/__tests__/full-reference.test.ts)、[media-resources.test.ts](../../../../extensions/codex-compact/__tests__/media-resources.test.ts)、[token-estimation.test.ts](../../../../extensions/codex-compact/__tests__/token-estimation.test.ts)、[usage-accounting.test.ts](../../../../extensions/codex-compact/__tests__/usage-accounting.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
