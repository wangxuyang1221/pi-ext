# Pi 0.87.1 to 1.3.0: Codex Compact Compatibility Review

## Scope and evidence

检查范围是 Pi `0.87.1` 基线，以及之后到本地当前版本 `1.3.0` 的全部发行记录。官方 changelog 在 `0.87.1` 后直接进入 `0.99.0`，本范围没有 `0.88` 至 `0.98` 的发行条目。共检查 12 个版本条目，其中 11 个是基线之后的版本。

实际环境：Node.js `v22.22.2`、pnpm `11.9.0`；仓库安装的 `pi-coding-agent`、`pi-ai`、`pi-agent-core`、`pi-tui` 均为 `1.3.0`。这里的“当前版本”指本次任务的已安装版本，不是对 npm 最新版本的独立声明。

证据优先级：

1. 已安装官方包的 `CHANGELOG.md`、文档和发布 JS。
2. 本仓库 `extensions/codex-compact/src/` 及现有测试。
3. Context7 的 `/earendil-works/pi/v1.3.0` 文档，核验 virtual models、compaction 和事件接口。部分检索结果指向 `main`，版本行为最终以本地 `1.3.0` 为准。
4. 禁止联网的离线探针，用官方 provider 的 `onPayload` 捕获网络前请求，并与插件重建结果比较。

初次审查没有修改插件、测试或依赖文件。后续仅修复 F1 的本地 thinking 转换，并补测试和文档，未修改上游或依赖。两阶段均没有访问真实会话或凭据，没有向模型服务发送请求。工作区开始时已有多处未提交改动，本次测试针对这些改动组成的当前工作树，不代表干净提交的测试结果。

官方入口：[v1.3.0 changelog](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/CHANGELOG.md)、[extensions](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/extensions.md)、[compaction](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/compaction.md)、[virtual models](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/virtual-models.md)。以下调查源码行号指修复前工作树或已安装发布包；F1 修复后的代码行号可能变化。

## Findings

| Priority | Finding | Status | Affected behavior |
| --- | --- | --- | --- |
| P1 | 跨模型 thinking 的本地转换没有跟上 1.3.0 | 已修复并通过离线回归 | 原问题导致 checkpoint 前缀不匹配和旧推理文本泄入重建输入；现已对齐 1.3.0 |
| P1 | 原始 transcript 中的工具声明没有应用宿主 hidden-declarations 投影 | 离线复现 | `codemode.mode: "only"` 或自定义 `prepareLoadout` 隐藏历史工具增量时，checkpoint 回放被前缀校验拒绝 |
| P2 | 新 `openai` ChatGPT 登录路径不在插件支持范围 | 源码和模型目录确认 | `/login openai` 不启用本插件的 Codex V2 压缩，即使使用 ChatGPT 订阅 |
| P2 | virtual model 路由到 Codex 不会自动启用插件 | 源码与官方文档确认，未做完整路由会话实测 | `ctx.model` 是 `pi-virtual`，被 provider/API 白名单拒绝 |
| P2 | 自定义 `originator`、`User-Agent` 的优先级与 1.1.0 起的宿主不同 | 离线复现 helper 行为 | 普通请求允许的覆盖，在插件远程压缩请求中被硬编码默认值替换 |
| Info | `gpt-6.1-sol` 的 Codex 窗口从 272000 修正到 500000 | 当前模型目录和阈值函数确认 | 默认插件自动阈值变为 450000，有效窗口变为 475000 |
| Info | 现有全量检查通过，但缺少上述关键交叉场景 | 已运行 | 不能仅凭构建和现有测试断言升级完全兼容 |

P1 表示本次确认的功能兼容性问题，不表示所有会话都会失败。两个复现都经过已有 checkpoint；没有跨模型 thinking、没有隐藏工具增量的普通路径仍通过现有测试。前缀校验是保护措施，不应为了绕过报错删除或放宽校验。

## Release-by-release review

每个版本的 Added、Changed、Fixed、Removed 和 Breaking Changes 均已检查；New Features 中重复的条目不重复计算为独立变更。表格按功能合并同版修复，不逐条翻译终端和安装器细节。

| Version | Main changes | Codex Compact impact |
| --- | --- | --- |
| 0.87.1, 2026-09-22 | GPT-6 Sol/Luna、Claude Opus 5.5；xAI 默认模型；split-turn 摘要提示修复；纯图片用户消息修复；CLI mode 校验与 Anthropic OAuth 版本修复 | 作为基线。split-turn 修复针对 Pi 文本摘要，插件 V2 使用自有远程协议，不能将它归为 V2 算法改进。图片属于回放输入兼容面 |
| 0.99.0, 2026-09-29 | 内置 MCP/codemode/tool search；工具 exposure、namespace、outputSchema、structuredContent、prepareLoadout、嵌套调用；virtual models；OpenAI 新 ChatGPT 登录；分类/图片模型和 usage；工具输出扩大；会话/RPC/模型目录/采样与 provider 修复；主题、TS7/ES2024 和加载方式变化 | 本范围最大的接口变化。新增 hidden-declarations 投影导致 F2；新登录和 virtual model 是 F3/F4 的支持缺口；工具嵌套调用和 usage 不能混入对话上下文 token 计数；全量加载和类型检查已通过 |
| 0.99.1, 2026-09-29 | GPT-6.1 Sol 上线并成为 OpenAI Codex 默认模型；修复 OpenAI 登录模块缺失 | 新会话的默认模型身份改变。影响模型 hash、窗口、切换路径；插件按模型目录查询 hash，没有写死逐模型表 |
| 0.99.2, 2026-09-30 | MCP 默认延迟发现/连接；服务器说明移入 `mcp_servers` system section；命名规范化与冲突处理；reload 工具规则；非法图片校验；模型查找性能；Retry-After 回退；Anthropic schema 等修复 | system/tool 增量更常见，必须使用真实发送的投影，不是原始 branch。工具名不能再假设旧连字符形式。插件已有通用 system/tool parity，但没有隐藏声明覆盖 |
| 1.0.0, 2026-10-01 | 默认 fullscreen；codemode prompt 缩短及错误提示；图片生成；延迟 MCP 工具恢复；MCP OAuth 强化；Radius 登录；会话渲染内存和 CLI 修复 | 默认 token 占用与工具描述变化不是压缩算法变化；需测恢复后 checkpoint 和图片结果。fullscreen 影响压缩提示展示，不改变 checkpoint 协议 |
| 1.0.1, 2026-10-03 | 工具 renderer 独立注册；MCP 项目覆盖/CIMD；codemode 输出上限；Anthropic 工具 inline；capacity 重试；Nix、登录、模型及依赖修复 | 后台 MCP 状态变化可能新增 system/tool delta；renderer 变化不应进入模型输入。宿主重试修复不会自动改变插件自有 fetch 重试 |
| 1.0.2, 2026-10-04 | `samplingParamsByThinkingLevel` | 普通 provider 可按 thinking level 注入采样参数。插件远程 body 是白名单组装，不完整转发这些参数，不能宣传压缩请求自动获得该特性 |
| 1.0.3, 2026-10-05 | Azure provider 改名；codemode 图片保存临时文件；输出文件权限收紧；OAuth 刷新取消修复；更新中 worker 和终端关闭修复 | Codex 认证通过宿主 registry，受益于刷新修复；图片附件和路径文本都可能进入输入。Azure 不在插件目标范围，不需改 Codex endpoint |
| 1.0.4, 2026-10-05 | 工具通配符和 `--no-mcp`；codemode read 返回图片；隐藏工具的 prompt guideline 修复；MCP 关闭/登录、codemode sandbox、Bedrock 重试修复 | F2 相关工具可见性进一步明确。codemode 图片必须只按实际 transcript content 估算；不能把脚本局部变量当作模型输入 |
| 1.1.0, 2026-10-07 | `agent_settled.aborted`；`--tools +/-`；工具时长和 outputPad；OSC 状态；分类能力；codemode 输出分隔；Codex headers 覆盖；输入估算 3.5 字符/token；busy 重试；模型价格/认证/终端修复 | headers 产生 F5；settled 新字段不破坏当前清理逻辑；宿主估算变化与插件 Codex 估算不是同一算法，不能机械替换常数 |
| 1.2.0, 2026-10-12 | custom-triggered `before_agent_start` 和启动 busy 语义；`serializeConversation` 去 thinking；工具 `reachesTools`/namespace aliases；MCP 资源和结构化结果修复；codemode 声明/耗时/取消/性能；OpenRouter 目录；配置 schema；远程剪贴板；retry、终端、OAuth 和未发布实验代码移除 | 插件不监听 `before_agent_start`，无直接 union 参数编译问题；goal 触发会话已有真实 runtime 测试。文本摘要去 thinking 不会自动修正本地 Responses converter。配置 schema 不替代插件自己的 `pi-codex-compact.json` 解析 |
| 1.3.0, 2026-10-15 | 跨模型丢弃 thinking；GPT-6 API key 缓存保留；Kimi 换协议；恢复 active tools；内部依赖精确版本；codemode worker/取消；模型匹配消歧；工具 JSON 校验；retry/provider 修复；Codex 500K；overlay、Nix、分享和模板修复 | F1 是直接回归。500K 自动改变插件阈值。恢复工具行为已在当前工作区 resume fixture 中适配。GPT-6 API key cache 特性不属于当前 Codex V2 路径 |

逐版来源：已安装 `node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md:3-473`，对应上述固定 tag 官方 changelog。

## F1: Cross-model thinking replay

### Evidence

Pi 1.3.0 在 `pi-ai/dist/api/transform-messages.js:85-103` 中直接删除非同一 provider/API/model 的 thinking。官方变更为 [#10995](https://github.com/earendil-works/pi/issues/10995)。

修复前，插件 `extensions/codex-compact/src/native-compaction.ts:573-600` 将非同模型的可读 thinking 转成 `assistant/output_text`，还会因此推进 `textIndex`，让后续真实回答的 fallback ID 从 `msg_pi_1` 变成 `msg_pi_1_1`。这不仅是多发一段文本，还改变了后续 item 身份。

`session-coordinator.ts:394-409` 严格比对历史前缀。`index.ts:441-466` 捕获不匹配后 abort 并记录诊断，符合原有 fail-closed 约定。

### Reproduction

以下是修复前结果。全合成历史：旧模型 `openai-codex/gpt-5.5` 产生 thinking 和回答，新模型 `openai-codex/gpt-5.6-sol` 继续。官方 `streamSimple` 在 `onPayload` 停止，未发送网络请求。

- Pi input：user、可见回答、user。
- 插件重建 input：user、旧模型 reasoning 文本、可见回答、user。
- 给同一历史添加有效 V2 checkpoint 后，`coordinator.prepareRequest` 抛出 `HistoryPrefixMismatchError`，`mismatchIndex = 1`。

独立压缩输入重建也会保留不应再作为普通文本发送的旧 reasoning。此次仅确认构造出的 payload 差异，没有在线验证它对服务端摘要质量的影响。

### Resolution and verification

已先加入 provider-wire parity 测试，确认旧实现抛出 `HistoryPrefixMismatchError`，再删除跨模型 thinking 转普通文本的 fallback。provider/API/model 任一不同即跳过该 block，不推进文本编号。同模型有效 signed/encrypted reasoning 保留，严格前缀校验未放宽。

`responses-parity.test.ts` 从 28 项增加到 50 项。新增用例覆盖三种身份差异、可读/签名/空/redacted/仅 thinking、同模型加密 reasoning、checkpoint 前后混合历史、实际模型选择后的连续请求和手动压缩输入重建。断言比较完整 payload、顺序和 ID，核验 branch/checkpoint 未改变，并确认普通消息篡改仍失败。N/2N 混合 blocks 的访问次数保持线性，没有增加跨请求缓存。

验证结果：插件 42 个测试文件、1051 项测试通过；`pnpm run check` 为 179 个文件通过、4 个既有文件跳过，2686 项测试通过、13 项既有测试跳过，类型检查、构建、发布包及 source/dist 加载检查通过。日志分别为 `.tmp/codex-compact-thinking-red.log`、`.tmp/codex-compact-thinking-tests.log`、`.tmp/codex-compact-thinking-check.log`。新增测试全部执行，使用伪认证并禁止网络；没有验证线上 V2 质量。首次全量检查通过，后续复跑曾命中既有 `test-wrapper.test.ts:106` 的 fixture JSON 读写竞争，单独复测 10 项通过；没有修改该无关用例，失败日志保留为 `.tmp/codex-compact-thinking-check-wrapper-failure.log`。另一轮未改动的 subagent reliability 测试清理目录时报 `ENOTEMPTY`，单独复测 17 项通过；日志为 `.tmp/codex-compact-thinking-check-cleanup-failure.log` 和 `.tmp/codex-compact-thinking-reliability-recheck.log`。这两处偶发失败均未在本任务修复。

## F2: Hidden tool declarations

### Evidence

0.99.0 新增 `prepareLoadout`，允许工具仍 active/callable，但声明不发送给模型。`codemode.mode: "only"` 使用这条机制。

宿主 `pi-coding-agent/dist/core/agent-session.js:1326-1350` 的 `_installHiddenDeclarationsProjection` 过滤整个 transcript 中的 `toolsAdded` 和 `toolsRemoved`。`getActiveToolNames` 仍返回 active 集合，见同文件 `1072-1095`，所以 active 不等于 wire-declared。

插件 `session-projection.ts:22-67` 从原始 branch 处理 context edits 和 compaction，没有应用 hidden-declarations 投影；`native-compaction.ts:548-558` 会将中途 `toolsAdded` 再生成为 `additional_tools` 或 tool-search items。

### Reproduction

调用当前宿主实际的 `_installHiddenDeclarationsProjection`，将合成 `read` 工具的历史增量隐藏，再交给实际 Codex provider converter 生成 payload。插件仍读取原始 branch。

- Pi input：两条 user 消息，不含被隐藏的工具声明。
- 插件 input：两条 user 之间额外出现 `additional_tools`。
- checkpoint 回放抛出 `HistoryPrefixMismatchError`，`mismatchIndex = 1`。

这是实际宿主投影函数与插件 coordinator 的离线组合复现，不是完整交互式 MCP 会话实测。它确认隐藏历史增量这一条件下的差异，不能据此声称所有默认 `codemode.mode: "on"` 会话都失败。

此外，`remote-compaction.ts:91-100` 在没有观察到请求的 `basePayload.tools` 时，回退到 `getAllTools + getActiveTools`；`native-compaction.ts:1118-1126` 没有区分 hidden declarations。因此恢复后尚未发送请求就手动压缩，也需要专门测试工具集合。

### Recommended change

重建输入应采用与宿主最终请求一致的工具声明投影。不要仅按 `exposure` 删除工具：`prepareLoadout` 的 hidden 集合与 exposure 不是同一概念。也不要为了通过比对而删掉所有 system/tool updates，这会丢失未隐藏的真实更新。

补充 mode `on/only`、动态加载/移除、MCP 迟连接、resume/reload、首次请求前手动 `/compact` 的真实宿主测试。工具搜索结果和 nested calls 分别验证，不能假设它们都对应顶层 transcript tool calls。

## F3: New ChatGPT login is not legacy Codex

0.99.0 新增 `/login openai`，并将 `openai-codex` 标为 legacy。新登录使用 `openai/openai-responses` 和 `api.openai.com`，不是 legacy Codex backend。依据为 changelog 和 `pi-ai/dist/auth/oauth/openai-chatgpt.js:1-24`。

插件 `native-compaction.ts:153-156` 同时要求：

```typescript
model.provider === "openai-codex" && model.api === "openai-codex-responses"
```

本地模型探针确认 `openai/gpt-6.1-sol` 返回 false，`openai-codex/gpt-6.1-sol` 返回 true。`index.ts:416-418,472-474` 因此跳过新 provider 的请求改写和压缩接管；没有其他扩展接管时，走 Pi 原生压缩。若旧分支存在 V2 checkpoint，`index.ts:371-386` 会回放原始历史，而不是把 encrypted marker 当文本摘要使用。

这属于支持范围缺口，不是现有 legacy endpoint 被删除。不要只扩大 provider 判断：插件还依赖 `compaction_trigger`、beta feature header、账户 ID、turn-state 和 Codex model catalog。必须独立核验新 API 是否支持相同协议，再决定增加适配。

当前若依赖本插件，应显式选择 `openai-codex/<model>`，不要仅凭“使用 ChatGPT 登录”判断插件已启用。

## F4: Virtual models remain outside the supported path

官方 [Virtual Models](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/virtual-models.md) 明确规定 `ctx.model/ctx.thinkingLevel` 是用户选中的虚拟模型及级别，不是实际派发模型。

`pi-coding-agent/dist/core/virtual-models.js:1-9,65-82` 创建的模型 API 为 `pi-virtual`。即使 provider 名为 `openai-codex`，也不通过插件 eligibility check。`before_provider_request` 事件只有 payload；headers 事件也没有 model 字段，见 `dist/core/extensions/types.d.ts:693-710`。

因此不能简单把 `ctx.model` 当实际 Codex 模型，也不能只从 `payload.model` 猜 provider、thinking level、window 和认证信息。当前源码确认会跳过接管；完整路由场景及已有 V2 checkpoint 的行为仍需集成测试。实现支持前，应明确标注 virtual models 不受支持。

## F5: Header precedence differs

1.1.0 修复 [#10429](https://github.com/earendil-works/pi/pull/10429)，让 Codex 普通请求的 `models.json` headers 覆盖 `originator` 和 `User-Agent`。

宿主 `pi-ai/dist/api/openai-codex-responses.js:1282-1302` 先设置默认值，再合并 model/caller headers。插件 `native-compaction.ts:1183-1197` 先合并传入 headers，再强制设置 `originator=pi`、`user-agent=pi-codex-compact`。

离线传入 `custom-originator/custom-agent` 后，插件返回的仍是 `pi/pi-codex-compact`。默认自定义 UA 本身不构成 bug，但忽略用户显式覆盖与新宿主行为不同。依赖 header 路由或识别客户端的网关存在风险；是否被真实服务拒绝未测试。

建议保留插件默认值，但让允许覆盖的用户 header 优先。认证、账户和协议必需 header 另行定义，不能因此允许任意覆盖所有协议字段。

## Other relevant changes

### Context windows and accounting

1.3.0 修复 [#10840](https://github.com/earendil-works/pi/issues/10840)。本地 built-in 模型 `openai-codex/gpt-6.1-sol` 当前 `contextWindow = 500000`。

插件 `config.ts:148-159` 动态计算阈值，所以默认行为随目录变化：

| Value | Old 272000 window | Current 500000 window |
| --- | --- | --- |
| 自动压缩上限，90% | 244800 | 450000 |
| 有效压缩窗口，默认95% | 258400 | 475000 |

这不要求硬编码新数字。显式 `autoCompactTokenLimit` 仍取配置与 90% 的较小值，用户旧配置可能继续触发较早压缩；`effectiveContextWindowPercent` 也可覆盖。Pi 原生 threshold/overflow 检查仍存在，不能将 450000 解释成所有情况下唯一的压缩触发点。

本地 `openai/gpt-6.1-sol` 的 built-in 窗口仍是 272000，不能跨 provider 套用 500K。实际 runtime 还可能应用模型目录刷新或用户覆盖，最终以所选 model 对象为准。

1.1.0 的 3.5 字符/token 改动是宿主输入估算和输出预算。插件使用 Codex 来源的估算与已观察响应 usage，不应为了“同步版本”全局改为 3.5。`usage-accounting.ts:30-38` 只接受 assistant usage，不会把新增 classifier/image/nested tool 费用直接当作主请求 context tokens。还需补真实 codemode 场景，验证 structuredContent 没有被重复计数。

### Compaction serialization and lifecycle

1.2.0 的 `serializeConversation()` 去 thinking 针对 Pi 文本摘要、branch summary 和 bug report。插件 V2 不调用它，使用自己的 ResponseItem 重建，因此该修复不会自动覆盖 F1。来源：`pi-coding-agent/dist/core/compaction/utils.js:100-133` 与插件 `native-compaction.ts:506-694`。

`before_agent_start` 的 `messageType` union 不直接破坏插件，因为 `index.ts` 没注册该事件。插件按实际 `message_start(role=user)` 重置 turn state，而非 prompt 排队时重置，`agent_settled` 清理空闲状态；见 `index.ts:347-354`。1.1.0 新增 `aborted` 是可忽略的新增字段。

当前已有 `resume-runtime.test.ts` 的 goal/custom continuation、abort 后继续、工具触发 system 更新的真实宿主测试，全部通过。但新增 busy-start abort、virtual routing 和 hidden declarations 仍不在这些测试结论内。

### Active tools on resume

1.0.0 修复 deferred MCP 工具恢复；1.3.0 更完整地恢复 session active tools，CLI `+/-` 在恢复结果上应用，显式工具列表等选项另有覆盖规则。

当前工作区 `resume-runtime.test.ts:79-81` 已显式添加 fixture 的 goal 工具，注释说明针对 Pi 1.3 恢复工具集的行为。此改动在本任务开始前就存在，本次没有修改它。

这类测试 fixture 的调整是合理的，但它不证明生产环境里所有 tool exposure 和异步 MCP 连接顺序已覆盖。应保留独立的“无显式覆盖时恢复原工具集”测试。

### Retry, cancellation, and malformed tool calls

0.99.2 至 1.3.0 多次扩大宿主 transient error 识别，包含 capacity、busy、upstream、temporarily unavailable 等。插件远程压缩使用 `callRemoteCompaction()` 的自有 fetch、HTTP/SSE 分类和 backoff，见 `native-compaction.ts:1344-1418,1695-1779`。宿主修复不自动等于插件重试策略已同步。

插件已有 upstream/temporary-unavailable 正则及未知 SSE code 分支，不能仅凭常量里没有某个词就判为不重试。建议按 HTTP status、SSE code/message、Retry-After 分别增加向量，保留 quota/auth/policy 的 fail-closed，不直接复制宿主更宽的 retry 判定。

1.3.0 工具 JSON 最终校验引入 `ToolCall.argumentsError`，格式错误时 arguments 为空对象，并生成模型可见校验错误。官方与插件 Responses 转换当前都使用 `JSON.stringify(toolCall.arguments)`；未从本次审查确认新的 wire 差异。应补 malformed tool call + error tool result + checkpoint 的组合测试，而非推断已有 JSON 修复会破坏插件。

codemode worker、MCP OAuth 取消和关闭修复改善宿主终止行为。它们不替代插件已有的 lifecycle generation、AbortController 和迟到响应保护。

### Sampling, cache, and non-Codex providers

1.0.2 的 per-thinking sampling 配置由普通 provider 使用。插件 `buildCompactionRequestBody` 仅保留需要的 reasoning、service tier、text verbosity 等字段，见 `native-compaction.ts:1129-1158`，不是任意 payload passthrough。是否应发送额外采样字段需要先核验 V2 endpoint，不在本次直接修改。

1.3.0 GPT-6 cache-preserving thinking 使用 OpenAI Responses 的 configuration updates，并有 ChatGPT 登录排除条件，见 `pi-ai/dist/api/openai-responses.js:79-88`。当前插件只接管 legacy Codex，不能据此声称其压缩调用也获得该特性。

Kimi 协议、Anthropic strict/schema/error-image、Gemini thinking、MiMo levels、OpenCode endpoint 等更新不直接改变 Codex V2 请求。切换到这些模型时，插件现有完整历史回放仍是兼容边界；回到 Codex 后的跨模型 thinking 由 F1 覆盖。

### UI, packaging, and unrelated updates

默认 fullscreen、outputPad、自定义编辑器压缩 indicator 颜色和 overlay `done()` 修复主要影响展示。插件使用原生 compaction UI、above-editor widget 和 deferred notice，不使用 `ctx.ui.custom` overlay；见 `index.ts:171-238,578-617`。本次没有运行 TUI 视觉验收。

精确内部依赖、TS7/ES2024、移除 chord 和未发布 experimental exports 不要求修改当前插件 import，真实 source/dist loader 检查通过。`UPSTREAM.md` 保留 Pi `0.87.0` 原始请求核验基线，并单独记录此次 `1.3.0` thinking 适配，不宣称整个插件已完全兼容。

分享目标、OSC52 剪贴板、终端颜色/快捷键、Nix 安装与 PATH、prompt template 空参数、资源路径 `~` 展开等条目没有发现需要修改 Codex checkpoint 算法的直接关系。配置 schema 的 theme breaking change属于包中主题维护，不等于插件配置文件格式改变。

## Validation and limits

初次审查运行的基线结果如下；F1 修复验收结果见上文：

```text
pnpm run check
Test Files  180 passed | 4 skipped
Tests       2667 passed | 13 skipped
```

类型检查、全量测试、构建、发布包检查及真实 Pi source/dist 加载检查全部通过。host check 同时覆盖旧 MCP 扩展和官方内置 MCP 两种组合。完整日志位于 `.tmp/pi-compact-upgrade-check.log`。

额外离线探针为 `.tmp/pi-compact-upgrade-probe.mjs`，结果为 `.tmp/pi-compact-upgrade-probe.jsonl`。探针只使用合成历史和伪 JWT，并把 `globalThis.fetch` 改为直接抛错，同时在 `onPayload` 停止 provider。运行方式：

```bash
node .tmp/pi-compact-upgrade-probe.mjs
```

`.tmp/` 是本次本地证据，不作为发布产物或长期回归测试。关键观察已写入 F1、F2、F3、F5 和窗口章节。后续修复应把这些条件转成仓库正式测试。

未做真实 Codex V2 远程压缩、账号认证、新 OpenAI endpoint 能力验证、在线质量评估、历史版本逐个安装回归、完整 virtual routing 或 TUI 视觉验收。现有测试通过不覆盖这些未执行项。

## Recommended order

1. F1 已修复，新增真实 provider payload parity 测试，保留 encrypted reasoning 和严格前缀保护。
2. F2 按用户要求暂缓。完整支持需要宿主提供声明状态和请求绑定快照，见[接口调查](codex-compact-hidden-declarations-api-research.md)；后续再补 codemode-only、工具变更和 resume 后手动压缩测试。
3. 明确 `openai` 新登录和 virtual models 暂不支持。是否实现它们需要单独确认协议和宿主可用接口，不应扩大白名单强行接入。
4. 对齐允许覆盖的 headers，补重试错误、新窗口和 malformed tool calls 的测试。
5. 完成后更新 `extensions/codex-compact/UPSTREAM.md` 的 Pi 兼容性基线，再运行全量 check 和隔离的真实会话验收。
