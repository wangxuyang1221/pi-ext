# Codex Compact thinking compatibility todo

## Understanding

本次仅修复跨模型 thinking 的请求重建差异，对齐已安装 Pi 1.3.0 的行为，不修改 Pi 上游。依据见[兼容性审查 F1](pi-0.87.1-to-1.3.0-codex-compact-review.md#f1-cross-model-thinking-replay)。修复已完成，验收结果见下文；隐藏工具声明问题仍暂缓。

## User visible changes

- 切换模型后，旧模型 thinking 不再被插件作为普通回答发送，也不再因此导致 checkpoint 后续请求因前缀不匹配而中断。
- 同模型的有效 signed/encrypted reasoning 继续保留。原始历史和已有 checkpoint 不变，真实历史不匹配仍拒绝请求。

## Todo

- [x] 修正 `extensions/codex-compact/src/native-compaction.ts`：丢弃不同 provider/API/model 的 thinking，不推进文本编号；保留同模型有效 signed/encrypted reasoning，使后续文本 item ID 与宿主一致。在现有遍历中完成判断，不增加全历史扫描、重复转换或跨请求缓存。
- [x] 根据实际验收更新 `extensions/codex-compact/UPSTREAM.md` 和兼容性审查 F1，记录 thinking 行为的适配版本、覆盖范围与验证结果；不将整个插件标为完全兼容 Pi 1.3.0。

## How to test

### Red, green, refactor

先在 `extensions/codex-compact/__tests__/responses-parity.test.ts` 及必要的生命周期测试中加入失败用例，确认当前实现失败，再做最小修复。核对旧测试预期，不能保留“跨模型 thinking 应作为普通文本发送”的断言。

使用合成原始 session 消息，通过实际 Pi provider converter 生成网络前 payload，再与插件的 branch 重建和 coordinator 回放结果比较。拦截网络、使用伪认证，不手工删去输入中的 thinking 来绕过待验证路径。

覆盖：

- 同 provider 不同 model、跨 provider，以及 API 身份不同的历史。
- thinking 后有可见回答、只有 thinking、空 thinking、redacted thinking。
- 同模型有效 signed/encrypted reasoning，包括 thinking 文本为空但带有效签名的情况。
- 混合模型消息位于 checkpoint 前后、模型切换后的连续请求，以及手动压缩输入重建。

通过条件：

- 全部 input items、顺序和文本 item ID 与宿主一致，不只检查 thinking 文本是否消失。
- checkpoint 回放保留加密项和当前用户输入，不再因本问题抛 `HistoryPrefixMismatchError`。
- 手动压缩输入不把旧模型 thinking 当作普通回答；原始 branch 和已有 checkpoint 内容未被修改。
- 人为改变普通消息内容的负例仍拒绝请求；既有取消、重试和模型切换保护继续通过。

### Cost and evidence boundaries

跨模型跳过只需在现有 content 遍历中做常量成本判断。代码审查确认没有为每个 thinking block 重扫历史或重新执行完整转换；使用 N、2N 个混合 content blocks 的访问计数检查新增判断的线性增长，不以不稳定的墙钟耗时设门槛。

离线测试保留真实 provider 转换、插件转换和 coordinator 路径。模拟远程响应只能证明本地契约，不代表线上 V2 压缩质量已验证。不解密、重写或迁移已有 checkpoint 中的不透明内容。

### Final verification

```bash
pnpm test extensions/codex-compact/__tests__
pnpm run check
```

新增用例必须执行并通过，不以 skip 代替验收。类型检查、全量测试、构建、发布包和 source/dist 宿主加载检查均需通过。执行后在本节记录结果；失败未查明时不勾选完成。

此前全量检查通过不代表本次修复已完成。调查中曾出现 `test-wrapper.test.ts` 临时 JSON 读取失败，单测和全量复跑通过；若再次出现，应保留失败证据并核验，不静默重跑至通过，也不将其当成 thinking 已修复的证明。

实施结果：

- Red：新增 checkpoint 回放用例在旧实现上抛出 `HistoryPrefixMismatchError`，证据为 `.tmp/codex-compact-thinking-red.log`。删除跨模型 thinking 的文本 fallback 后通过。
- 新增 22 项 thinking 回归，`responses-parity.test.ts` 全部 50 项通过；包括身份差异、边界、同模型签名、模型切换后连续请求、手动重建、不变性、普通内容篡改和线性访问计数。
- `pnpm test extensions/codex-compact/__tests__`：42 个文件、1051 项测试通过，日志为 `.tmp/codex-compact-thinking-tests.log`。
- `pnpm run check`：179 个文件通过、4 个既有文件跳过，2686 项通过、13 项既有测试跳过；类型检查、构建、发布包和 source/dist 加载检查通过。日志为 `.tmp/codex-compact-thinking-check.log`。新增测试无跳过。首次全量检查通过；文档更新后的复跑曾在既有 `test-wrapper.test.ts:106` 读取尚未写完的 fixture JSON 时失败，日志保留为 `.tmp/codex-compact-thinking-check-wrapper-failure.log`。该用例只等待文件存在便解析，写方使用非原子 `writeFileSync`，存在读写窗口。本轮未修改该文件；单独复测 10 项通过，日志为 `.tmp/codex-compact-thinking-wrapper-recheck.log`。另一轮全量检查在未改动的 `extensions/subagent/__tests__/reliability.test.ts` 清理 fixture 目录时出现 `ENOTEMPTY`，日志为 `.tmp/codex-compact-thinking-check-cleanup-failure.log`；单独复测 17 项通过，日志为 `.tmp/codex-compact-thinking-reliability-recheck.log`。未修改这两处无关测试，也未将单次复测通过视为清理竞争已修复。最终全量结果以 `.tmp/codex-compact-thinking-check.log` 为准。
- 连续请求用例最初选了当前目录不存在的 `gpt-5.4`，导致 fixture 初始化失败；已改为实际存在且 fixture hash 相同的 `gpt-5.6-sol/terra`。这次测试设置错误不作为 Red 证据，原日志保留在 `.tmp/codex-compact-thinking-parity.log`。

原始分支与 checkpoint 未修改，前缀校验未放宽；没有修改上游、依赖或隐藏声明逻辑。生产代码只减少旧 fallback，不需要额外重构。离线验证不代表线上压缩质量验证。

## Notes

- 隐藏工具声明修复暂缓，不属于本次 Todo。完整支持需要宿主提供有效声明状态和请求绑定快照，详见[接口调查](codex-compact-hidden-declarations-api-research.md)。此次 thinking 修复不会解决这类前缀错误。
- 不修改上游、`node_modules`、依赖版本、压缩协议或前缀校验规则，不新增 provider/virtual model 支持，也不调整 headers 或重试策略。
- 只修改对应 `src/`、`__tests__/` 和说明文档，不手工编辑 `dist/`，不覆盖工作区已有改动。
