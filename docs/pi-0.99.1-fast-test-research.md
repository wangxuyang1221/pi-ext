# Fast transcript test investigation

## Finding

本轮确认 `extensions/subagent/__tests__/fast-production.test.ts:185` 的失败来自测试等待条件不足，而不是此次观察到的 Fast 开关或记录顺序错误。测试等待子代理发出 HTTP 请求后，立即比较 Fast 状态与第一条 assistant 回复的落盘位置。此时回复可能尚未结束，文件中没有 assistant，`findIndex()` 返回 `-1`，于是合法执行被 `4 < -1` 判为失败。[S1][S2][S3]

未修改 HTTP 响应的观测探针连续三次复现上述状态；回复真正落盘后，三次都为 Fast index `4`、assistant index `8`、Fast `enabled: false`。完整原测试连续运行三次，前两次在原第 185 行失败，第三次通过。只在临时副本里增加落盘等待后，完整场景连续三次通过。[E1][E2][E3]

正式测试、provider fixture 和生产 `src/` 本轮均未修改。tmux 空锁问题按用户要求不处理。结论仅针对这个顺序断言，不能推广为所有 Fast 行为均无缺陷。

## Contract and source trace

场景先在父代理执行 `/fast on`，再以 `fast: false` 创建 child。原测试先验证 child 的实际请求没有 `service_tier: "priority"`，之后才检查会话 entry 顺序。这些失败运行已经通过请求参数断言，不是“明确关闭 Fast 却仍发送 priority 请求”。[S1]

事件与持久化路径如下：

1. Fast 插件在 `session_start` 中读取 launch state。child 未保存过状态时，立即 `pi.appendEntry("pi-fast-mode-session", ...)`。[S4]
2. HTTP fixture 在 `fetch` 入口先 `appendFile(payloadLog, ...)`，然后才构造并返回模拟 SSE 响应。[S2]
3. `spawn()` helper 只等待 payload 文件非空。这证明请求已发出，不能证明响应完成。它之前等待的 `session.waitForIdle()` 属于父 session，不能替代 child 的完成条件。[S1]
4. Pi 0.99.1 在 `message_end` 才调用 SessionManager.appendMessage 持久化完整 assistant；流式 pending assistant 不落盘。SessionManager 以同步写入追加 entry，但同步写入并不意味着响应尚未完成时已经有 entry。[S3][S5][S6]
5. 0.99.1 会在出现 user 或 assistant 时创建会话文件。因此请求发出时看到用户消息和 Fast state，而还没看到 assistant，是合法状态。[S5]

Context7 提供的最高对应版本为 `v0.99.0`，仅用来定位接口，精确行为以仓库安装的 `0.99.1` 文档与源码为准。运行环境为 macOS、Node `v22.22.2`、pnpm `11.9.0`；证据报告分别记录父宿主和 child 的四个 Pi 包版本，均为 `0.99.1`。[E1][E2][E3]

## Experiments

证据目录为 `.scratch/pi-0.99.1-test-research/fast/`。这里的探针和日志不纳入发布包，关键观察保留如下。

| Experiment | Change from original | Result |
| --- | --- | --- |
| Original, three runs | 不改正式用例，开启既有 evidence 输出 | 两次原第 185 行失败，一次完整通过 |
| Observed, three runs | 复制用例，原比较位置记录索引；随后等待 assistant 并记录同一会话；到该场景后结束 | 三次原比较均为 `4 < -1`、child `running`；最终均为 `4 < 8`、Fast false |
| Held, three runs | 仅在离线 HTTP fixture 中暂不返回 child-explicit-off 的响应，payload 已记录；主测试读取索引后释放 | 三次都确定性得到 `4 < -1`，释放后 `4 < 8`；无需改生产行为即可使原判断错误 |
| Synchronized, three runs | 完整原场景临时副本，仅修改这一处等待和断言 | 三次完整通过，每次保留 13 个配置隔离 checkpoint、角色/开关/reload/resume/错误降级验收 |

Observed 没有额外延迟 HTTP 响应。Held 使用与既有 `hold:first` 相同的可释放握手，只改变响应何时返回，不改变 payload、SSE 数据或宿主处理结果。它证明“等待请求已发出”不是有效的顺序验证前置条件，不依赖重复运行碰运气。[E1][E2]

每份报告保存 `before`、`after` 的真实 JSONL entries、请求 payload、运行状态及清理结果。Fast state 在 before 中已存在且为 false；assistant 在 after 中出现且位于其后。这比只观察断言是否通过更能区分“回复尚未出现”和“顺序真的错了”。[E1][E2]

## Proposed test-only correction

只在 child `b` 的顺序断言前，使用现有 `until()` 等待第一条 assistant 出现在真实会话文件中，然后基于同一份快照比较：

```typescript
const transcript = await until(
  () => lines(b.sessionFile),
  entries => entries.some(entry => entry.message?.role === "assistant"),
  "first child assistant persisted",
);
const fastIndex = transcript.findIndex(entry => entry.customType === entryType);
const assistantIndex = transcript.findIndex(entry => entry.message?.role === "assistant");
assert.ok(fastIndex >= 0, "Initial Fast state must be persisted");
assert.equal(transcript[fastIndex].data.enabled, false);
assert.ok(assistantIndex >= 0, "First assistant must be persisted");
assert.ok(fastIndex < assistantIndex, "Fast state must precede the first assistant");
```

这不改变原验证目标，也不放宽超时。`until()` 仍为原来的 12 秒，完整 test timeout 仍为 180 秒。另显式断言两个 entry 存在，避免反向漏洞：原表达式在 Fast entry 缺失时也可能因为 `-1 < assistantIndex` 而误通过。[S1][E3]

不能把等待统一加到 `spawn()`。此前的 child `a` 故意阻塞首个响应，验证回复前 Fast 状态已保存、命令可修改它。如果所有 spawn 都等 assistant，会破坏或卡住那段测试。等待应只针对需要比较回复位置的 child `b`。[S1]

临时副本验证了这个最小修正，但本轮按调研范围没有应用到正式文件，也没有删除或跳过失败断言。

## Reproduction

`generate-probes.py` 从当前原用例生成三个副本并将相对导入定位到仓库现有实现；完整修正副本仍使用原 provider。独立配置仅发现本证据目录中的探针。[E4]

```bash
conda run -n codex-py312 python .scratch/pi-0.99.1-test-research/fast/generate-probes.py

PI_SUBAGENT_ISOLATED_INTEGRATION=1 \
PI_FAST_EVIDENCE="$PWD/.scratch/pi-0.99.1-test-research/fast/observed-new.json" \
pnpm test --config .scratch/pi-0.99.1-test-research/fast/vitest.config.ts \
  .scratch/pi-0.99.1-test-research/fast/observed.test.ts
```

将 `observed` 改为 `held` 或 `synchronized` 可运行对应实验。正式原用例使用 `pnpm test --no-file-parallelism extensions/subagent/__tests__/fast-production.test.ts`，同样设置隔离开关和唯一的 evidence 路径。

此 Fast 用例的父 SDK 使用源码，child 根据 package manifest 加载现有 dist。它不读取 `PI_SUBAGENT_FIXTURE_DIST`，因此不能把设置该变量的同一 Fast 测试说成另一套完整 source/dist 证明。[S1]

## Cleanup

所有十二次运行都执行原 fixture 的 finally，停止各自私有 tmux server，并验证所记录的 PID 退出、socket 不可用。每份 evidence 的 `cleanup.livePids` 为空，`socketUnavailable` 为 true。结束时再次核验 84 个已记录 PID，均已退出，未发现 Fast 或 Goal 探针残留进程，见 `.scratch/pi-0.99.1-test-research/cleanup.json`。没有接触用户 tmux session、真实凭据或付费模型。没有为本研究重建或手工修改 dist。

`git diff --check` 通过。按仓库要求复跑 `pnpm run check`，仍为 `2640 passed / 2 failed / 13 skipped`，两项失败是此前保留的 Write null/number 拒绝预期，与本轮 Fast 研究无关。日志为 `.scratch/pi-0.99.1-test-research/check.log`。

## Sources

- [S1] `extensions/subagent/__tests__/fast-production.test.ts:18-22, 88-108, 146-186, 307-332`：等待 helper、父/子执行边界、held 首响应、失败断言、finally 清理。
- [S2] `extensions/subagent/__tests__/fixtures/fast-provider.ts:18-37`：真实 Codex adapter 的 HTTP 边界替换，先记录 payload、后返回 SSE。
- [S3] `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:725-750`：message_end 后持久化。
- [S4] `extensions/openai-fast-mode/src/index.ts:70-93, 171-188`：child 状态选择、appendEntry 与 session_start。
- [S5] `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:786-836`：user/assistant 触发文件创建、同步 append。
- [S6] `node_modules/@earendil-works/pi-coding-agent/docs/sdk.md` 的 Prompting / Subscribing to events；`docs/message-types.md` 的 AssistantMessage；`docs/session-format.md` 的 CustomEntry：idle、finalized message、状态 entry 的公开语义。
- [E1] `.scratch/pi-0.99.1-test-research/fast/observed-{1,2,3}.{json,log}`。
- [E2] 同目录 `held-{1,2,3}.{json,log}`。
- [E3] 同目录 `synchronized-{1,2,3}.{json,log}`，以及 `original-{1,2,3}.{json,log}`。
- [E4] 同目录 `generate-probes.py`、`vitest.config.ts`、三个生成的测试副本及 `held-provider.ts`。
