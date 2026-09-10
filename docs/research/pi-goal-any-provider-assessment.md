# Pi goal any-provider assessment

## Executive summary

结论不是“删掉 `openai-codex` 白名单即可”。这一步只会让调度器开始向其他 provider 发请求，却不会补上无工具模型的停机保护、跨 provider 的额度错误识别，也不会证明各 API 能正确接收 goal 工具 schema。

Pi 已经把主模型响应归一成统一的 `AssistantMessage`。`message_end`、`agent_end`、`agent_settled`、`context`、`tool_result`、压缩和分支摘要事件也不绑定 provider。因此，goal 的核心存储、主响应计费和隐藏续跑消息不需要按 provider 重写。[P1][P2][P3]

要安全地声明“支持任意 Pi provider”，建议把承诺写成：支持 Pi 0.84.3 和 0.85.1 中遵守 `Provider` 与 `AssistantMessageEventStream` 契约，且所选模型能调用普通 function tools 的 provider；如果还要保证 tokenBudget 准确，则 provider 必须返回可用 usage。不能承诺任意模型具有工具能力，也不能替不合规的自定义 provider 修复错误 usage、错误 stop reason 或不完整 tool call。

建议完整方案工作量为 **4.5 至 7 人日**，包括实现、离线 provider 矩阵、双版本真实 SDK/TUI 回归和发布检查。只删白名单约需 0.25 人日，但不能作为可发布方案。

## Scope and versions

本报告只评估 `extensions/goal/src`、对应测试及 Pi 官方实现，没有改产品源码，没有发出真实模型请求。

| Item | Verified value |
| --- | --- |
| 仓库依赖 | `@earendil-works/pi-coding-agent` 0.84.3，见 `package.json:114` 与 `pnpm-lock.yaml:23-26` |
| Pi 0.84.3 | tag `v0.84.3` 指向 commit `4e58f324fae8ebfa98a3d45181fb248072a2afac` [V1] |
| Pi 0.85.1 | tag `v0.85.1` 指向 commit `d981de1229ef899957bbe968bc8dcda02a21f477` [V2] |
| 文档核验 | 完整读取 0.84.3 的 `extensions.md`、`custom-provider.md`、`models.md`、`providers.md`、`compaction.md`、`session-format.md`，并核对 0.85.1 对应文档差异 |
| API 查询 | Context7 `/earendil-works/pi`，其索引是 main，不提供 0.84.3 或 0.85.1 固定版本，因此只用于定位，版本结论采用固定 commit 和已安装发布包 [C1] |

0.85.1 与本题直接相关的公开变化很小。它新增 `ui_prompt_start/end`，并调整编辑器和模型默认值的说明，没有改变 `Usage`、`StopReason`、goal 使用的模型事件或 tool result 契约。[P4][P5]

## Current provider coupling

产品源码只有三处直接限制 provider，均在 `extensions/goal/src/scheduler.ts`：

1. `active()` 在第 34 行要求 `ctx.model?.provider === "openai-codex"`。
2. 状态栏在第 42 行显示 `requires OpenAI Codex`。
3. `model_select` 在第 112 至 114 行对其他 provider 警告。

测试把该限制固化在 `extensions/goal/__tests__/commands.test.ts:269-275`，完整集成夹具也断言 `offline-unsupported` 不发生请求，见 `extensions/goal/__tests__/integration-runtime.mjs:31,45,48,155`。大量调度夹具把 provider 写成 `openai-codex`，但其中多数只是测试数据，并非 API 依赖。

删除上述判断以后，公开事件确实会把其他 provider 的响应送进现有调度和计费代码。然而，当前实现还有几项被 Codex 首版范围掩盖的假设：

- `agent_end` 只处理 `stop`、`error` 和 `aborted`。稳定落到 `length` 或 `deferred` 时，第 83 行直接返回；若 Pi 没有随后压缩重试，`agent_settled` 会清除绑定，goal 仍是 `active` 却不再续跑。
- 普通 `stop` 且没有工具调用会在第 83 至 85 行再次排队。无工具模型、忽略工具的模型，或 goal 工具被用户禁用时，可以形成无上限自动请求循环。
- 失败轮审计只识别 `bash` 输出中的两段英文文本，见第 65 至 68 行。它不能识别模型从未调用工具、goal 工具参数持续无效、其他执行工具持续失败，或 provider 根本不支持工具。
- `usage_limited` 只匹配 `insufficient_quota`、`usage_limit_reached` 和一段 OpenAI 文案，见第 90 行。Pi 自己还识别 `GoUsageLimitError`、`FreeUsageLimitError`、`Monthly usage limit reached`、`available balance`、`out of budget`、`quota exceeded` 和 `billing`。[P6]

这四项是“只删白名单”的主要风险。前三项可能造成活跃 goal 静默卡住或反复请求，第四项会把明确的账户额度耗尽错记为 `blocked`。

## Provider-neutral contracts

### Events and control flow

Pi 扩展事件在两版中都使用统一的 `AgentMessage`。`AgentEndEvent` 只提供消息数组，`AgentSettledEvent` 表示重试、压缩和排队续跑均已结束，`MessageEndEvent` 提供最终消息，`ToolResultEvent` 提供统一的 `isError`、content 和可选 usage。[P2][P4]

agent loop 在 provider 边界前把消息转换为统一 LLM context，并把 `Context.tools` 交给 provider。响应中的 `toolCall` 内容块驱动工具执行；没有 tool call 时，loop 不会凭模型文字推断工具意图。[P3]

因此，goal 无需为 Anthropic、Google、OpenAI 或 Bedrock分别订阅事件。provider 差异应由 pi-ai adapter 或自定义 `Provider` 消化。goal 只应依赖最终事件，并在最终事件不满足契约时停止，而不是猜测底层 HTTP 流。

### Usage normalization

Pi 的 `Usage` 契约规定：

- `input` 是非缓存输入。
- `output` 已包含 reasoning tokens。
- `reasoning` 只是 `output` 的可选子集。
- `cacheRead` 与 `cacheWrite` 独立记录。
- `totalTokens` 通常包含缓存 token，因此不适合当前 goal 的“非缓存输入加输出”预算。[P1]

内建 adapter 按该契约处理不同原始格式。例如 OpenAI Completions 从 `prompt_tokens` 中减去 cache read 和 cache write，再把 `completion_tokens` 作为 output；Google 把 candidate 与 thought tokens 合并为 output；Mistral 从 prompt 中减 cached prompt；Anthropic 和 Bedrock分别填统一字段。[P7][P8][P9][P10][P11]

`extensions/goal/src/accounting.ts:14-18` 计算 `input + output`。这与既有规格“非缓存输入加输出，不重复 reasoning”一致，也适用于符合 Pi 契约的其他 provider。这里**无需按 provider 修改**。

边界仍然存在：自定义 provider 可以只返回初始化的全零 usage，OpenAI-compatible endpoint 也可能关闭或不支持 streaming usage。现有 `accounting.ts:55-63` 会把全零且无 cache 的响应标为 `usageIncomplete`，不会谎称精确零。这是正确的保守行为。无 usage 且无 tokenBudget 的无工具模型仍可能无限续跑，所以缺失 usage 不能代替无进展停机保护。

工具执行自身的 `ToolResultMessage.usage` 不属于主 LLM context accounting，Pi 会把它纳入 session totals，但当前 goal 没有通用订阅计费，只对本仓库 managed subagent 另行归集。[P1][P12] 若产品定义仍是“根模型加 managed subagent”，无需为 provider 通用化而改变；若要把任意工具内部模型调用也算进 goal，应另开语义变更，避免与 child report 双计。

### Errors and retries

Pi 先把 provider 失败归一成 `stopReason: "error"` 和 `errorMessage`。宿主用 provider-neutral 的文本分类处理 transient retry，并在全部重试、压缩和续跑结束后才发 `agent_settled`。[P6][P13]

公开 `AssistantMessage` 没有统一的 HTTP status、错误 code 或 `usage-limit` 枚举。`after_provider_response` 虽可看到部分 HTTP transport 的 status，但官方文档明确说并非所有 provider 或 transport 都暴露 headers；自定义 stream 也不必经过该 hook。[D1] 因此 goal 不能可靠地用一个结构化字段区分额度、鉴权、内容过滤和永久请求错误。

可行策略是：

- 让 Pi 继续负责 transient retry 和 context overflow recovery。
- 在 `agent_settled` 后把明确匹配账户额度的错误记为 `usage_limited`。
- 其余不可区分的 terminal error 全部记为 `blocked`，符合现有 C6。
- 额度模式至少覆盖 Pi 0.84.3 的非重试额度词。最好集中为单一 helper 并加 provider fixture，不要继续把正则内嵌在调度器。
- 允许未来配置 provider-specific 的窄匹配规则可以减少误判，但这属于可选扩展。宽泛匹配 `429` 不可接受，因为 Pi 把普通 429 当 transient rate limit，而有些服务又用 429 表示月度额度耗尽。

### Tool calling

现有 goal 工具 schema 已采用 Google 兼容的 `StringEnum`，见 `extensions/goal/src/tools.ts:3,49-50`。三个 schema 都是普通 TypeBox object，使用 function tool 所需的基本 string、integer 和 enum。Pi 官方明确要求 string enum 使用 `StringEnum` 而不是 `Type.Union`，当前实现已经满足。[D2]

Pi 的 `Model` metadata 包含 API、reasoning、输入模态、上下文、输出上限和兼容标记等字段，但没有通用的 `supportsTools` 布尔字段。[P14] `Provider` 接收可选 `Context.tools`，但这只能说明 transport 有传递工具定义的入口，不能证明所选模型会调用工具。

因此可以做的 preflight 只有：

1. 已选择模型。
2. 执行阶段至少有 `get_goal` 与 `update_goal` 处于 active tools；允许模型创建 goal 时，`create_goal` 也必须 active。
3. provider 遵守 Pi stream 契约。

第三项只能通过 provider 实现和测试确认，运行时没有认证标志。即使前三项通过，模型仍可能忽略工具、拼错工具名、持续产生无效参数，或用文字声称完成却不调用 `update_goal`。建议为重复无效调用或连续不调用工具设置有限轮数保护，触发后的状态及阈值需产品决定。不能把 prompt 指令当作能力检测。

## Required changes

以下是建议发布方案的改动清单。移除 provider gate、更新测试与支持范围是直接兼容性改动；preflight、无进展保护和 terminal outcome 处理属于跨 provider 发布时建议一并补齐的健壮性改进，不是每一种 provider 接入的技术前提。这些问题也可能发生在 Codex 模型上。

| Area | Required change | Likely files |
| --- | --- | --- |
| Provider gate | 从 `active()` 移除 Codex provider 比较；状态栏改为只报告“未选择模型”“goal 工具未启用”或存储错误；删除 `model_select` 的 Codex 专属警告 | `src/scheduler.ts` |
| Runtime preflight | 自动续跑前确认存在模型，并确认执行所需 goal 工具仍在 active tools，至少包括 `get_goal` 与 `update_goal`。缺少时不发请求，保留目标并显示可恢复限制 | `src/scheduler.ts`，可能由 `index.ts` 注入 tool-state helper |
| No-progress fuse | 对可识别的重复无效调用或连续纯文本循环设置有限轮数保护。阈值、触发状态及“有效进展”需产品决策，并明确是否跨 runtime 持久化 | `src/scheduler.ts`，必要时 `src/storage.ts` |
| Terminal outcomes | 在宿主确实 settled 后处理未恢复的 `length`、`deferred` 和未知 terminal stop reason。默认 fail closed 到 `blocked`，保留错误摘要。不要阻断 Pi 自己的 length 压缩恢复 | `src/scheduler.ts` |
| Limit classification | 抽出窄额度分类 helper，覆盖 Pi 已知非重试额度词；普通 429、网络错误、内容过滤、鉴权和未知错误保持 `blocked` | 新 helper 或 `src/scheduler.ts` |
| Test contract | 把“other provider unsupported”测试改为 provider-neutral；新增无工具、禁用 goal 工具、缺失 usage、`length`、`deferred`、额度词与 provider 切换场景 | `__tests__/scheduler.test.ts`、`commands.test.ts` |
| Provider matrix | 用离线 adapter 或协议夹具覆盖主要 API 家族和一个自定义 `Provider`，双跑 Pi 0.84.3/0.85.1；禁止真实收费请求 | 新的 `__tests__` runtime/fixture 文件及 matrix runner |
| Acceptance wording | 把承诺限定为符合 Pi 契约且模型可调用 function tools，不写“任意模型均可工作” | 后续验收文档与 README，文案另按仓库规则处理 |

无进展保护不能简单复用当前“连续三轮 bash 失败”，也不能把写文件或 record revision 变化当作有效进展。调研任务可能只有只读工具，计量 checkpoint 本身也会更新 revision。可以先对连续纯文本回复、重复无效 goal 工具调用等可明确识别的循环设置保护，但应允许正常分析和调研。具体阈值、暂停还是 blocked、是否可配置，均需产品决定；例如连续 5 轮的阈值只是候选，不是已核验的上游要求。

## Optional improvements

这些改进有价值，但不是 provider 通用化的前置条件。

- 为 `goal.json` 增加 provider-specific usage-limit pattern。只允许显式 provider id 和窄正则，并校验长度与灾难性回溯风险。
- 把任意 `tool_result.usage` 纳入 goal。需要先定义是否包含 MCP、搜索、图片和 subagent 内部模型，并设计 source receipt，避免与现有 child report 双计。
- 记录每个 goal turn 的 provider/model，便于审计跨 provider 切换和估算差异。当前 receipt 已把 provider 放进 identity，但持久化统计不展示分项。
- 在模型切换后自动恢复一个因“未选择模型”或“工具未启用”而等待的 goal。当前控制语义更接近显式 `/goal resume`，自动恢复会改变用户预期。
- 推动 Pi 上游提供结构化 terminal error category 和 model tool-capability metadata。这样可删除脆弱的额度文本匹配，但两版现有 API 没有这些字段。

## No changes needed

下列部分已经建立在 Pi 通用契约上，不应为每个 provider 复制实现。

- `src/accounting.ts` 的主响应归属、receipt 去重及 `input + output` 预算公式。
- `session_compact` 与 `session_tree` 的 usage 读取。Pi 默认摘要使用当前 provider，并把统一 usage 写入 entry。[P12]
- `src/tools.ts` 的三个 schema、`StringEnum` 和运行时参数复核。
- `src/storage.ts` 的 lease、generation、checkpoint、状态提交和恢复。
- `src/content.ts`、`src/lock.ts`、附件、fork/recover 与 provider 无关的 UI。
- hidden custom message 的 continuation prompt。Pi 在 provider 边界前统一转换消息；跨 provider 历史转换由 Pi 负责。[P3]
- 现有 `ctx.abort()` 取消失效自有请求的 C11 取舍。它有排队消息副作用，但不是 provider 特有问题，本次不应顺手改成 provider wrapper。[L1]

## Acceptance matrix

“每个 provider 名称都跑一遍”成本高且价值有限。多数 provider 共享同一 adapter。验收应按 API 家族覆盖，再加 provider 特有错误与自定义实现。

| Matrix row | Offline evidence | Required assertions |
| --- | --- | --- |
| OpenAI Chat Completions compatible | mocked SSE，provider id 不为 `openai-codex` | 三个工具 schema 可序列化；tool call 执行；`input` 去缓存、output 含 reasoning；stop/toolUse 映射 |
| OpenAI Responses | mocked SSE | tool call、responseId 去重、cache read/write、content filter、length |
| Anthropic Messages | mocked stream | `StringEnum` 工具、toolUse、cache fields、thinking 为 output 子集、额度文本 |
| Google Generative AI | mocked stream | schema 被接受；thought tokens 只计一次；function call 驱动 goal tool |
| Bedrock Converse | mocked SDK transport | toolUse、usage 字段、aborted 与 throttling terminal behavior |
| Mistral Conversations | mocked stream | cached prompt 归一化、tool call、未知 finish reason |
| `pi-messages` 或 deferred-capable provider | 构造本地 provider stream | `deferred` 不让 active goal 静默悬挂，恢复策略符合产品决定 |
| Custom conforming provider | `createProvider` + 本地 event stream | 任意 provider id 可续跑、计费、complete；零网络 |
| Toolless or tool-ignoring model | faux provider，仅返回 text stop | 无进展 fuse 在有限请求数内 blocked |
| Goal tools disabled | 运行时 `setActiveTools` 移除 goal tools | 零模型请求，状态栏解释恢复办法，目标数据不变 |
| Missing or malformed usage | 零 usage、非法 usage、自定义 stream error | observed tokens 不虚构，`usageIncomplete=true`，不会靠预算停止无工具循环 |
| Provider switch | goal turn 间从 A 切 B，并覆盖切换回 A | 旧响应不记入新 goal；续跑使用当前模型；无 stale tool mutation |
| Error classes | transient 429 后成功、retry exhausted、明确额度、auth、content filter、unknown | Pi 先重试；最终状态分别符合 blocked 或 usage_limited；额度不靠裸 `429` 判断 |
| Compaction and branch summary | 每个代表 family 至少一个压缩场景，完整矩阵可抽样 | usage 只计实际 summary response，不计 `tokensBefore`；失败和取消状态正确 |
| Pi versions | 上述核心矩阵跑 0.84.3 与 0.85.1 | 相同 goal 结果；0.85.1 新 UI prompt 事件不改变调度 |
| TUI regression | 两版真实 `InteractiveMode` + PTY + faux/offline provider | pause/resume/edit/clear、Esc、C11 队列副作用、状态栏和零网络保持 |

实际 adapter 夹具不必为同一 OpenAI-compatible adapter 的二十多个 provider 重复。至少应选一个内建 provider id、一个 `models.json` 风格自定义 id、一个完整 `Provider` 对象。官方建议自定义 provider 复用 stream、tokens、abort、overflow、tool-call 和 cross-provider handoff 测试，这支持按协议而不是按品牌建矩阵。[D3]

## Effort estimate

估算假设：一名熟悉现有 goal 与 Pi 测试设施的工程师；不修改 Pi 上游；不做真实收费请求；保留 C11/C12；支持范围是 Pi 0.84.3 与 0.85.1；不把任意工具 nested usage 纳入本次。

| Work item | Estimate |
| --- | ---: |
| 调度 gate、状态栏、active-tool preflight | 0.5 日 |
| 无进展 fuse、`length`/`deferred`/未知 stop reason 状态机及单测 | 1.0 至 1.5 日 |
| provider-neutral 额度分类与错误矩阵 | 0.5 至 0.75 日 |
| 离线 API 家族夹具与自定义 provider runtime 测试 | 1.5 至 2.5 日 |
| 双版本 SDK、真实 TUI、压缩、切换和 C11/C12 回归 | 0.75 至 1.0 日 |
| 文档、打包检查、失败修复余量 | 0.25 至 0.75 日 |
| Total | **4.5 至 7 日** |

分档估算：只解除限制并更新对应单测约 0.25 至 0.5 人日；若保留当前状态机语义，只承诺合规且支持工具的 provider，增加代表性 provider 与双版本回归约 1.5 至 3 人日。上表 4.5 至 7 人日还包含通用停机保护和较广的协议夹具，不能把这些全部称作解除限制的最低成本。离线夹具只能证明已覆盖的契约，不能证明所有真实服务和模型的端到端行为。

如果要求逐个内建 provider 品牌做协议级夹具，增加约 2 至 4 日，但仍不能证明远端服务或模型行为。若要求结构化额度分类且不接受文本匹配，需要 Pi 上游 API 设计、发布和本仓库升级，另估 2 至 4 日，不含上游 review 等待。若要通用计入所有 `tool_result.usage`，另估 1.5 至 2.5 日。

## Release decision

建议发布门槛如下：

1. 完成 Required changes，并让 acceptance matrix 的核心行在两版通过。
2. 文档把“任意 provider”限定为“任意符合 Pi provider 契约、且所选模型能可靠调用 function tools 的 provider”。
3. 明示 tokenBudget 依赖 provider usage。缺失 usage 时只提供 observed usage，不能保证预算硬上限。
4. 明示 no-progress fuse 只能限制损失，不能让无工具模型完成 goal。
5. 不以 provider id 白名单替代能力验证，也不以一次成功 tool call 推导该模型在所有任务中可靠。

在这些条件下，改动集中在 scheduler、错误 helper 和测试设施，存储与计费主体可保持。若产品要求字面上的“所有 Pi provider 和所有模型都能完成 goal”，当前 Pi API 和模型能力都无法支持该保证。

## Sources

### Repository evidence

- [L1] [`docs/research/pi-goal-provider-gate.md`](./pi-goal-provider-gate.md)，既有 provider wrapper 实验、C11 决策及 wrapper 归属风险。
- [L2] [`extensions/goal/src/scheduler.ts`](../../extensions/goal/src/scheduler.ts)，当前 provider gate、续跑、stop reason 和额度分类。
- [L3] [`extensions/goal/src/accounting.ts`](../../extensions/goal/src/accounting.ts)，统一 usage 读取、缺失 usage 与 receipt。
- [L4] [`extensions/goal/src/tools.ts`](../../extensions/goal/src/tools.ts)，goal tool schema 与 `StringEnum`。
- [L5] [`extensions/goal/__tests__/integration-runtime.mjs`](../../extensions/goal/__tests__/integration-runtime.mjs)，当前 unsupported provider 和 Codex adapter 集成边界。

### Pi fixed sources

- [V1] [GitHub tag API for v0.84.3](https://api.github.com/repos/earendil-works/pi/git/ref/tags/v0.84.3)
- [V2] [GitHub tag API for v0.85.1](https://api.github.com/repos/earendil-works/pi/git/ref/tags/v0.85.1)
- [P1] [Pi 0.84.3 `Usage`, `StopReason`, `AssistantMessage`, `ToolResultMessage`](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/types.ts#L382-L465)
- [P2] [Pi 0.84.3 extension agent/message/tool events](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/extensions/types.ts#L729-L970)
- [P3] [Pi 0.84.3 agent loop context、tool call 与工具执行](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/agent/src/agent-loop.ts#L155-L250)
- [P4] [Pi 0.85.1 extension agent/message/tool events](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/extensions/types.ts#L729-L988)
- [P5] [Pi 0.85.1 `Usage` 与 `StopReason`](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/types.ts#L383-L452)
- [P6] [Pi 0.84.3 retry error patterns](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/utils/retry.ts#L1-L81)
- [P7] [Pi 0.84.3 OpenAI Completions usage normalization](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api/openai-completions.ts#L1470-L1500)
- [P8] [Pi 0.84.3 OpenAI Responses usage 与 stop reason](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api/openai-responses-shared.ts#L556-L594)
- [P9] [Pi 0.84.3 Google usage normalization](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api/google-generative-ai.ts#L220-L243)
- [P10] [Pi 0.84.3 Anthropic usage mapping](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api/anthropic-messages.ts#L730-L765)
- [P11] [Pi 0.84.3 Bedrock usage mapping](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/api/bedrock-converse-stream.ts#L685-L697)
- [P12] [Pi 0.84.3 compaction and branch usage contract](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/compaction.md)
- [P13] [Pi 0.84.3 post-agent retry, compaction and settled flow](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/agent-session.ts#L1070-L1120)
- [P14] [Pi 0.84.3 `Model` definition](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/ai/src/types.ts#L821-L850)

### Pi documentation

- [D1] [Extension lifecycle and provider hooks, fixed at Pi 0.84.3](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/extensions.md)
- [D2] [Custom tool schema and Google `StringEnum`, fixed at Pi 0.84.3](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/extensions.md#custom-tools)
- [D3] [Custom provider stream and test guidance, fixed at Pi 0.84.3](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/docs/custom-provider.md)
- [C1] [Context7 library `/earendil-works/pi`](https://context7.com/earendil-works/pi)
