# Slice 2 final outcomes

## Scope

本报告记录 [Implementation #18](https://github.com/wangxuyang1221/adventure/issues/18) 的编码与验证，完整规格为 [Spec #12](https://github.com/wangxuyang1221/adventure/issues/12)。接手提交为 `3033c13972fdb76972824f7f2da374ed179b263c`，在 `adventure/goal-all-providers` 上保留 #17 交付。

本关只处理最终异常、保守额度分类及其与预算、工具门控、运行归属的组合。不修改计量公式、Pi 核心、网络重试、鉴权或输出上限，不取回 deferred 结果。Acceptance 由协调者另行记录；本报告不关闭 Issue，也不修改 `progress.md`。

## Changes

- [`scheduler.ts`](../../extensions/goal/src/scheduler.ts) 在 `agent_end` 记录 error/length/deferred，只在宿主 `agent_settled` 后停止仍 active 的目标。目标内容保留，用户通过 `/goal resume` 恢复。
- 普通最终异常不覆盖 `budget_limited`。明确账户额度错误可以将 active 或 budget_limited 转为 `usage_limited`。工具关闭只限制新的 goal continuation，不妨碍当前响应的 usage 或最终异常结算。
- 非用户取消的 compaction 失败也延迟到 settled。若失败前已有 goal continuation 排队，只取消这条属于自己的待执行请求，并保留原失败的归属。取消本插件已禁止的重复 compaction 不再误记为用户暂停。
- 新请求、成功响应和 invalidate 清除旧异常。assistant `message_start` 记录时间戳及绑定 ticket，终态处理核对目标、generation、runGeneration 和响应归属。settled 处理遇到新运行已启动时退出；异步存储返回后再次核对，不能清除替换目标的新绑定。
- [`quota.ts`](../../extensions/goal/src/quota.ts) 仅识别有固定来源的错误码或明确账户文案。英文诊断说明最终状态和恢复动作，不把原始 provider 错误复制到 goal 通知中。
- 异常记录和响应归属各保存一份，不累计历史事件。没有新增轮询、网络请求或非空文本次数限制。源码修改限于 scheduler 和分类函数，`dist/` 由构建生成。

## TDD record

修改前 goal 基线为 13 个文件、185 个测试通过，见 [baseline](./slice-2-baseline.log)。每轮先运行失败断言，最小实现后重跑目标及受影响测试。最终 goal 测试为 13 个文件、225 个测试通过，其中 scheduler 从 41 个增加到 81 个。

| 失败行为 | Red 证据 | Green 与回归 |
| --- | --- | --- |
| 最终 length/deferred 留下 active | [length](./slice-2-length-red.log)、[deferred](./slice-2-deferred-red.log) | settled 后 blocked，目标保留，无新自动请求 |
| 明确账户错误遗漏，宽泛文本又误报账户额度 | [quota](./slice-2-quota-red.log)、[context](./slice-2-quota-context-red.log) | 精确码、JSON 字段与锚定文案；反例保持 blocked |
| 通知回显潜在敏感 provider 错误 | [diagnostic](./slice-2-diagnostic-red.log) | 固定英文诊断，合成敏感标记不出现在通知 |
| 旧异常进入下一请求或覆盖新响应 | [run](./slice-2-run-red.log)、[late end](./slice-2-late-end-red.log) | 清除旧异常并核对响应归属 |
| 存储 await 期间替换目标导致异常或清除新绑定 | [settled race](./slice-2-settled-race-red.log) | 捕获本次 failure/ticket，await 后重新核对 |
| 旧 settled 在新运行启动后清除绑定 | [live settled](./slice-2-live-settled-red.log) | 只在 `ctx.isIdle()` 时处理 |
| 实际 SDK 在 compaction 失败事件就提前 blocked | [SDK compaction](./slice-2-sdk-compaction-red.log) | compaction 失败时仍 active，最终 settled 才 blocked |
| compaction 账户错误被已有预算状态遮蔽 | [compaction budget](./slice-2-compaction-budget-red.log) | 最终 usage_limited，普通失败保留 budget_limited |
| 收窄匹配后遗漏 Pi 的嵌套 summary 前缀 | [unit prefix](./slice-2-quota-prefix-red.log)、[SDK prefix](./slice-2-sdk-quota-prefix-red.log) | 仅移除固定源码证明的 Pi 前缀，不恢复任意子串匹配 |
| 延迟 compaction 收尾后，旧 continuation 越过失败继续到 complete | [SDK queue regression](./slice-2-sdk-queued-compaction-red.log)、[queued compaction](./slice-2-queued-compaction-red.log) | 门控自己的待执行 continuation，保留原失败到 settled |
| 上述取消触发的后续 compaction cancellation 被误记为 paused | [suppressed compaction](./slice-2-suppressed-compaction-red.log) | 区分本插件压制的重复恢复与用户取消 |

所有产品 Red 最终均由下方完整测试和双版本 SDK 回归覆盖。归档日志仅去除行尾空白和末尾多余空行，测试输出及断言结果未改动。`commands.test.ts` 只把合成 settled 的 `isIdle` 改为 true，以符合 SDK 合同，预算优先级断言未削弱。

[SDK fixture diagnostic](./slice-2-sdk-fixture-diagnostic.log) 是夹具初稿错误，不计作产品 Red。实际 split-turn compaction 会先做历史 summary，再做 turn-prefix summary；第一次 summary 失败时不执行第二次。夹具脚本和请求数量按实际 SDK 行为修正。`slice-2-sdk-compaction-green.log` 与 `slice-2-sdk-quota-prefix-green.log` 是中间定点复测，最终依据是完整双版本矩阵。

## SDK method

正式夹具为 [`terminal-runtime.mjs`](../../extensions/goal/__tests__/terminal-runtime.mjs)。它加载实际 `createAgentSession`、`ModelRuntime`、`SessionManager`、`DefaultResourceLoader`、extension runner 和 agent loop，通过 `pi.registerProvider` 注册普通 function-tools 离线 provider。脚本只控制 provider 响应，不合成 retry、compaction、agent_end 或 agent_settled 时序。

- 分别加载 Pi 0.84.3 和 0.85.1。每版 `pi-ai`、`pi-agent-core` 与 `pi-coding-agent` 一致，详细版本保存在 JSON。
- provider 返回真实 stream 事件与最终 stop/error/length/deferred；deferred 包含合法 handle，但从未请求异步执行或取回结果。
- 每次请求保存模型、工具、maxTokens 和请求前目标；每个生命周期事件保存状态、用量、目标 ID、终止原因。宿主 retry/compaction 事件另行保存。
- 默认关闭 retry/compaction，仅在对应场景开启 SDK 原生恢复。成功恢复场景最后保持 active 并关闭工具，证明旧错误确实清除，而不是被 complete 状态掩盖。
- 使用内存凭据容器和无效离线占位值，不加载真实 provider 凭据。全局 fetch 拒绝任何调用，两版均为 `networkAttempts: 0`。
- 工具关闭后尝试 resume、恢复工具、reload、普通输入，均不能绕过显式 resume。显式 resume 保留目标 ID；预算已耗尽时不增加预算或发出新的 goal 请求。
- 原始 JSON 的 `goal` 是整个场景结束后的快照。`final-*` 场景继续验证显式 resume，所以末尾可能为 complete 或 budget_limited；第一次 settled 的 blocked/usage_limited 及其用量见该场景 `lifecycle`，不能只读最后一个快照判断首次终态。

## SDK results

| 夹具 | Pi 0.84.3 | Pi 0.85.1 | 证据 |
| --- | --- | --- | --- |
| 新增 terminal-runtime | 56 场景、129 请求通过 | 56 场景、129 请求通过 | [0.84.3 JSON](./slice-2-sdk-0.84.3.json)、[log](./slice-2-sdk-0.84.3.log)；[0.85.1 JSON](./slice-2-sdk-0.85.1.json)、[log](./slice-2-sdk-0.85.1.log) |
| #17 provider-runtime 回归 | 22 场景、60 请求通过 | 22 场景、60 请求通过 | [0.84.3](./slice-2-provider-regression-0.84.3.log)、[0.85.1](./slice-2-provider-regression-0.85.1.log) |
| 既有 execution-runtime 回归 | 15 场景、132 请求通过 | 15 场景、132 请求通过 | [0.84.3](./slice-2-execution-regression-0.84.3.log)、[0.85.1](./slice-2-execution-regression-0.85.1.log) |

每版共 93 场景、321 请求，两版共 642 次离线请求。三套夹具在两版均退出 0，无网络调用。

新增矩阵覆盖以下可观察结果。

| 场景 | 实际结果 |
| --- | --- |
| length 宿主恢复耗尽 | 首次 length 后执行 SDK compaction 和重试；再次 length 的失败通知时仍 active，最终 settled 后 blocked |
| length/deferred/error/quota × 工具开关 × 有无预算 | 16 组验证首次终态、最后 usage 和无额外自动请求。普通异常保留预算，quota 可覆盖预算 |
| 最后响应用量跨越预算 | 7 或 110 tokens 正确结算；宿主消费已有预算收尾消息的 length/deferred 场景累计 117，门控不截断既有收尾 |
| 账户分类 | 20 组明确正例与裸 429、rate_limit_exceeded、billing、认证、网络、含糊 quota、代码子串和文档提及反例 |
| 500/429 原生 retry 成功或耗尽 | 每组恰好 2 请求；成功保持 active，耗尽 settled 后 blocked。重试请求 maxTokens 不变 |
| length/context overflow 原生 compaction 成功 | 完成双 summary 后重试成功，即使工具关闭仍 active，无错误停止通知；模型输出上限不变 |
| compaction 普通/额度失败 × 有无预算 | 等待 settled；普通失败 blocked 或保留 budget_limited，明确额度失败 usage_limited；工具关闭仍保留已归属 usage |
| 排队输入恢复 | error/quota、length、deferred 后的正常响应清除旧异常，累计用量不丢失 |
| 替换目标 | 旧 error/length/deferred 及旧 compaction 失败不停止新目标，不把旧 110 tokens 计给新目标 |
| 既有停止保护 | 3 次空自动 continuation 后 blocked；重复工具暂停、连续失败 bash 停止仍通过 execution-runtime |
| 非空纯文本 | 连续 8 次文本进展没有新计数停止，第 9 次完成工具正常执行 |

## Classification sources

具体版本事实以固定官方源码和已装包为准。Context7 `/earendil-works/pi` 只有 main，不能作为 0.84.3/0.85.1 差异的依据。

| 正例或归一化 | 固定官方来源 | 本关采用范围 |
| --- | --- | --- |
| `insufficient_quota`、`GoUsageLimitError`、`FreeUsageLimitError` | [Pi 0.84.3 retry.ts L7-L24](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/utils/retry.ts#L7-L24) 明确注释账户/订阅限制与 OpenAI quota code | 完整独立错误码或 JSON `error.code`/`error.type`，不采用同文件较宽的 billing、available balance、out of budget matcher |
| `usage_limit_reached` | [Codex 0.153.4 api_bridge.rs L133-L159](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/codex-api/src/api_bridge.rs#L133-L159) 只有匹配该 type 才构造 UsageLimitReached | 不把 HTTP 429 本身作为账户额度耗尽 |
| `You've hit your usage limit.`、`You've hit your usage limit for ...`、`Your workspace is out of credits.` | [Codex 0.153.4 error.rs L651-L745](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/protocol/src/error.rs#L651-L745) 的 UsageLimitReached 显示实现 | 从消息开头匹配固定文案，允许后续恢复建议，不扫描任意段落 |
| `Quota exceeded. Check your plan and billing details.` | [Codex error.rs L148-L149](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/protocol/src/error.rs#L148-L149) 以及 [L436-L438](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/protocol/src/error.rs#L436-L438) | 完整固定前缀；裸 `quota exceeded` 不作为正例 |
| Pi `Summarization failed:`、`Turn prefix summarization failed:` | [0.84.3 compaction.ts L703](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/compaction/compaction.ts#L703)、[L987](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/compaction/compaction.ts#L987)；[0.85.1 L545-L550](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/compaction/compaction.ts#L545-L550)、[L715](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/compaction/compaction.ts#L715)、[L1000](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/compaction/compaction.ts#L1000) | 仅剥离这些已证实的包装，之后仍要求精确码或明确文案 |
| Pi `Context overflow recovery failed:`、`Auto-compaction failed:` | [0.84.3 agent-session.ts L2324-L2327](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/agent-session.ts#L2324-L2327)；[0.85.1 L2406-L2409](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/agent-session.ts#L2406-L2409) | 支持宿主外层恢复错误前缀与内层 summary 前缀组合 |

另外只做大小写、首尾空白、英文弯引号，以及前导 HTTP 数字状态的窄归一化。HTTP 状态仍须携带上述明确码或文案才能命中。

一个容易误报的反例是 `You have hit your ChatGPT usage limit.`。[Pi 0.84.3 openai-codex-responses.ts L1560-L1569](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api/openai-codex-responses.ts#L1560-L1569) 对 `rate_limit_exceeded` 或任何 429 都可能生成这条友好提示。因此本关不把它当作明确账户额度证据，两版都有 `classification-codex-friendly-429` 反例。不能为了多识别某个 adapter 的文案而把普通限流升级为账户额度停止。

宿主最终事件顺序沿用 [terminal contract review](./terminal-contract-review.md#version-comparison) 中两版固定源码，并由本次实际 SDK traces 验证。预算优先级沿用 [codex output limit review](./codex-output-limit-review.md) 和现有 storage control，不另设规则。

## Reproduction

运行环境为 Node.js `22.22.2`、pnpm `11.9.0`。复用已安装依赖，没有写全局配置。若重新安装仓库依赖，使用 `pnpm install --frozen-lockfile --ignore-scripts`。

```bash
env -u PI_SUBAGENT_PARENT pnpm exec vitest run extensions/goal/__tests__
env -u PI_SUBAGENT_PARENT pnpm run check

SDK_0843="$PWD/node_modules/@earendil-works/pi-coding-agent"
SDK_0851="/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.85.1/4011d0a1b084fee9580232c1f0d858a8429fe70851ed74fe182409e63aa52ab9/node_modules/@earendil-works/pi-coding-agent"
for version in 0.84.3 0.85.1; do
  if [ "$version" = 0.84.3 ]; then sdk="$SDK_0843"; else sdk="$SDK_0851"; fi
  env -u PI_SUBAGENT_PARENT \
    GOAL_TERMINAL_EVIDENCE="adventure/evidence/slice-2-sdk-$version.json" \
    pnpm exec node extensions/goal/__tests__/terminal-runtime.mjs "$sdk" \
    > "adventure/evidence/slice-2-sdk-$version.log" 2>&1
  env -u PI_SUBAGENT_PARENT \
    pnpm exec node extensions/goal/__tests__/provider-runtime.mjs "$sdk" \
    > "adventure/evidence/slice-2-provider-regression-$version.log" 2>&1
  env -u PI_SUBAGENT_PARENT \
    pnpm exec node extensions/goal/__tests__/execution-runtime.mjs "$sdk" \
    > "adventure/evidence/slice-2-execution-regression-$version.log" 2>&1
done
```

SDK 路径须指向目标版本的实际包，并保留相邻同版本 pi-ai/pi-agent-core；夹具将解析并输出实际版本。根测试移除 worker 宿主的 `PI_SUBAGENT_PARENT`，#17 正式夹具中的显式子会话反例仍运行。

最终 `env -u PI_SUBAGENT_PARENT pnpm run check` 退出 0，见 [check log](./slice-2-check.log)。类型检查、构建、发布包边界校验通过；81 个测试文件、1064 个测试通过。2 个 subagent 集成测试按仓库默认配置跳过，未计为通过。发布包校验确认 7 个编译后的 extension entry、1 个 theme entry、10 个 MCP 生成模块。本关没有发布 registry。

## Limits and cleanup

- 这是实际 SDK 加受控离线 provider 的时序验证，不是真实付费 provider 或全部原生 adapter 实测。不连接真实模型，也不要求真实密钥。
- SDK 绑定的 UI 回调记录真实扩展通知，但没有 PTY/TUI 视觉验收。#19 的原生 adapter 计量矩阵、真实子代理链路与最终交付审计仍未执行。
- 分类器刻意不穷举私人服务的自定义码或同义表达，不添加用户自定义 matcher。缺乏明确账户证据的最终错误按普通 blocked 处理。
- 任意乱序事件以单测补充；它不能替代双版本 SDK 已验证的恢复、排队输入和替换目标时序，也不构成对不合规 adapter 的保证。
- 三套 SDK 夹具均已退出。临时 `.goal-*` 目录通过 finally 删除，最终 `find . -maxdepth 1 -name '.goal-*'` 无结果。进程检查未发现 terminal-runtime、provider-runtime、execution-runtime 或 vitest 残留；未启动后台服务，无本任务遗留监听端口。宿主 Pi/MCP 和系统既有进程未改动。
- `git diff --check` 通过，`progress.md` 未修改。产品实现和证据交由协调者验收，不在此写 Acceptance 通过结论。
