# Slice 2 acceptance

## Result

[Implementation #18](https://github.com/wangxuyang1221/adventure/issues/18) 第一次协调者验收通过。验收产品提交为 `b5ef6cd717621d132398a6a446ee11d02a2aa594`。核对完整 Slice、产品差异、正式 SDK 夹具、分类固定来源和 worker 证据，没有发现本关必需验收缺口或规格偏离。

## Verification

- 独立重跑 `env -u PI_SUBAGENT_PARENT pnpm run check`，1064 测试通过、2 项默认跳过，类型检查、构建、发布包校验通过。见[协调者检查日志](./slice-2-coordinator-check.log)。
- 独立重跑 `terminal-runtime.mjs`，Pi 0.84.3/0.85.1 各 56 场景、129 请求通过。夹具真实运行 SDK retry/compaction/settled，不用手工发出这些事件替代时序验证。复现方法见[worker 报告](./slice-2-final-outcomes.md#reproduction)。
- 检查最终状态矩阵、普通错误与明确额度的预算优先级、工具关闭后的最后用量和显式恢复、原生恢复成功与耗尽、旧目标/排队成功/compaction 失败隔离。成功恢复仍 active 的断言避免以 complete 掩盖旧异常。
- 检查分类器只使用固定来源支持的独立错误码、JSON 字段和明确文案。裸 429、billing、认证/网络、码的子串或提及以及 Codex 对裸 429 也会生成的友好提示均不误分类为账户额度。goal 诊断不回显原始 provider 错误。
- worker 双版本复跑 #17 provider 和既有 execution 矩阵，共计每版 93 场景、321 请求通过。详细日志和来源入口见[worker 报告](./slice-2-final-outcomes.md)。
- `git diff --check` 通过，协调者复跑结束后 `.goal-*` 无残留，未启动后台服务或监听端口。

## Limits and next level

全部为实际 SDK 离线验证，不是远端付费模型实测。完整原生 adapter 计量、实际 TUI 提示、真实受管子代理进程链路和打包交付审计继续由 #19 承担。两个默认跳过的 subagent 集成测试未计为通过。

#18 可以关闭，#19 解除前置阻塞。Map 和 Spec 保持 open，全部交付后仍须用户确认。
