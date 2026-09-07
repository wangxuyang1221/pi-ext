# OpenAI Fast mode field verification

## Latest validation

已完成 [9 次真实 Pi SDK 三组对照](openai-fast-mode-sdk-validation.md)。当前账户、Astra 模型、Pi 0.85.1 HTTP/SSE 链路中，原样启用扩展且不补 routing hint 的综合输出速率为 62.55 tokens/s，关闭时为 33.61 tokens/s，约 1.86 倍。增加 routing hint 为 62.98 tokens/s，本轮没有明确额外收益。扩展 hook 到最终 wire body 的注入链路已验证，但不外推为所有模型、WebSocket、账户或后台计费的保证。

## Correction after the live probe

后续单次 ChatGPT OAuth 探针通过扩展函数发送 `service_tier: "priority"`，最终收到 `service_tier: "default"`。不能据此断言 Fast 未生效。Codex 仓库中，`pash-openai` 在 [#14204 的回复](https://github.com/openai/codex/issues/14204#issuecomment-4033184620) 指出，ChatGPT 登录模式的 Fast 由服务端路由处理，最终 `service_tier` 不是可靠的端到端验证字段，`default` 不代表 Fast 被忽略。这条回复发表于 2026-03-10，问题涉及 WebSocket；它不是当前所有传输、模型和账户的完整契约，但足以说明不能直接套用公开 API 的判据。

该单次探针应记录为“请求了 priority，响应返回 default，实际 Fast 状态未确认”。后续原因调查见 [default tier investigation](openai-fast-mode-default-tier-investigation.md)。用户随后另行批准的 [6 次等长对照](openai-fast-mode-live-ab-validation.md) 观察到，body priority 与 routing hint 组合配置的 Fast 组综合输出速率约为基线组的 1.68 倍，而六次最终 tier 均为 default。它支持本轮组合配置提速，不证明单独字段的贡献或后台计费。下文公开 API 的响应字段语义仅用于公开 API，不应直接用于 ChatGPT backend。

## Scope and revision

核验时间为 2026-09-06 UTC。本报告核验 OpenAI 官方字段与 Codex ChatGPT backend 的实现。本仓库扩展与测试由主 agent 独立检查，报告另据其反馈及本地 `config.ts`、`payload.ts` 复核结果，补充内置模型清单的证据边界。

GitHub API 在本次查询时返回 `openai/codex` 的 `main` 为 `6af345407d9c2a568da9d01b6c4b81a9e61495c0`，提交时间为 `2026-09-06T02:28:38Z`。以下源码链接均固定到这个 commit，不把主分支行为当成本机已安装版本的行为。来源为 [GitHub commit API](https://api.github.com/repos/openai/codex/commits/main) 和 [固定提交](https://github.com/openai/codex/commit/6af345407d9c2a568da9d01b6c4b81a9e61495c0)。

本仓库 `package.json` 的 Pi 开发依赖为 `0.84.3`，peer dependencies 未限定版本。主 agent 随后核验，工作区实际 `node_modules` 中 `pi-ai` 与 `pi-coding-agent` 也均为 `0.84.3`。这不是对用户另行安装的全局 Pi 运行时版本的声明。它没有固定官方 Codex CLI 版本，本报告未验证 Pi 传输链路，不能替代对实际 Pi provider 实现的检查。来源为仓库 [`package.json`](../../package.json)。

先用 Context7 查询 `/websites/developers_openai_api` 和 `/openai/codex`，再用 Exa 定位、读取官方页面与源码。Context7 的 Codex 版本列表只有 `rust_v0_29_1_alpha_7` 和 `rust-v0.75.0`，本次结果另有 `main` 源码片段，但没有本次 commit 的版本化索引。因此，以固定 commit 的原始源码复核映射、端点和限制。公开 API 文档是持续更新页面，不具有与该 commit 相同的版本保证。部分源码抓取路径已迁移，长文件的相关代码另通过 GitHub 公共 API 和 `raw.githubusercontent.com` 读取并按行筛选。

## Findings

| Question | Finding | Evidence |
| --- | --- | --- |
| `service_tier` 是 OpenAI 官方字段吗？ | 是。公开 Responses API 和 Chat Completions API 都记录了这个请求参数与响应字段。 | [API Fast mode guide](https://developers.openai.com/api/docs/guides/fast-mode) |
| `priority` 是猜测值吗？ | 不是。公开 API 支持它，官方 Codex 的 `ServiceTier::Fast.request_value()` 也明确返回 `priority`。 | [API guide](https://developers.openai.com/api/docs/guides/fast-mode)、[Codex enum](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/protocol/src/config_types.rs#L525-L553) |
| Codex 配置中的 `fast` 与请求中的 `priority` 相同吗？ | 内置 Fast tier 的配置别名确实如此映射。配置保存时反向写成 `fast`。 | [配置加载](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/config/mod.rs#L3882-L3895)、[配置保存](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/config/edit.rs#L235-L247) |
| 这个结论只适用于 API key 吗？ | 不是。官方 Codex 根据认证模式选择 ChatGPT backend 或公开 API，然后构建含 `service_tier` 的 Responses 请求。 | [provider 端点选择](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/model-provider-info/src/lib.rs)、[请求构建](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/client.rs#L977-L995) |
| 只要传 `priority` 就一定启用吗？ | 不能这样判断。Codex 先检查模型目录中的支持项；公开 API 也可能把 Fast 请求降级为 `default`。 | [模型过滤](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/protocol/src/openai_models.rs#L917-L929)、[API 降级规则](https://developers.openai.com/api/docs/guides/fast-mode#rate-limits-and-ramp-rate) |

结论应写成“扩展使用的 `service_tier: "priority"` 有 OpenAI 官方文档及 Codex 客户端源码依据”。不能扩大成“OpenAI 承诺所有第三方 ChatGPT backend 客户端都受支持”，也不能写成“本用户账户已经加速”。官方客户端采用该字段与某次账户请求实际获得服务，是两个不同问题。

## Configuration and wire mapping

固定 commit 的映射为：

```text
config.toml: service_tier = "fast"
    -> ServiceTier::from_request_value("fast") = Fast
    -> ServiceTier::Fast.request_value() = "priority"
    -> ModelInfo.service_tier_for_request(...)
    -> ResponsesApiRequest.service_tier = "priority"
```

`from_request_value` 同时接受 `fast` 和 `priority`。配置加载时，两者都经过 `Feature::FastMode` 判断，再归一化为 `priority`。`flex` 保持 `flex`，其他字符串可以作为目录提供的 tier ID 继续流转。保存配置时，`fast` 与 `priority` 都写成 `fast`。来源为 [enum](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/protocol/src/config_types.rs#L525-L553)、[load](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/config/mod.rs#L3882-L3895) 和 [save](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/config/edit.rs#L235-L247)。

当前公开 API 文档还明确说明，Priority processing 于 2026-07-30 更名为 Fast mode。公开 API 请求中的 `fast` 和 `priority` 对支持的模型具有相同行为。但这不构成把 Codex backend 的 wire value 改为 `fast` 的理由，当前官方 Codex 客户端仍发 `priority`。来源为 [API guide](https://developers.openai.com/api/docs/guides/fast-mode) 和 [Codex enum](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/protocol/src/config_types.rs#L538-L552)。

`features.fast_mode` 是 Codex 客户端配置开关，不是上述请求中的服务端字段。`/fast` 也是客户端命令。不能把这些名称作为额外 backend 参数一起发送。来源为 [Codex configuration reference](https://developers.openai.com/codex/config-reference)、[slash commands](https://developers.openai.com/codex/cli/slash-commands#toggle-fast-mode-with-fast) 和 [Responses 请求结构](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/codex-api/src/common.rs#L294-L305)。

## Endpoints and transports

默认端点可以从官方源码串联出来：

| Authentication | Base URL | Responses endpoint |
| --- | --- | --- |
| ChatGPT 登录，包括 `Chatgpt` 和 `ChatgptAuthTokens` | `https://chatgpt.com/backend-api/codex` | `https://chatgpt.com/backend-api/codex/responses` |
| 公开 API 认证路径 | `https://api.openai.com/v1` | `https://api.openai.com/v1/responses` |

这些是默认值，provider 可以覆盖 base URL。证据为 [ModelProviderInfo::to_api_provider 与 CHATGPT_CODEX_BASE_URL](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/model-provider-info/src/lib.rs) 和 [ResponsesEndpoint::path](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/codex-api/src/endpoint/responses.rs#L38-L46)。

`ResponsesApiRequest` 把 `service_tier` 定义成可选字符串，值为空时不序列化。WebSocket 请求结构也携带该字段，从同一个请求复制，不是只能用于 HTTP SSE 的参数。WebSocket 连接使用同一个 endpoint path。来源为 [HTTP 与 WS 请求字段](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/codex-api/src/common.rs#L294-L359) 和 [WebSocket 连接](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/codex-api/src/endpoint/responses_websocket.rs#L393-L415)。

当前 Codex 还为 backend 请求构造 `model=...;tier=...` routing hint。它是客户端路由提示，不能作为服务端已执行 Fast tier 的证据。仅凭这段源码也无法证明第三方客户端必须复制这个 hint，或证明只传 body 字段一定足够。来源为 [build_routing_hint_header](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/client.rs#L1106-L1120) 和 [请求头应用](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/client.rs#L1623-L1635)。

## Support limits

### Codex ChatGPT backend

官方 Codex Speed 文档说明 Fast mode 适用于 ChatGPT 登录后的 Codex CLI、IDE extension 和 Codex app；API key 采用 API 定价，不能使用这套 Fast mode credits。文档当前列出 GPT-5.5 和 GPT-5.4，速度描述为 1.5 倍，credits 消耗分别为 Standard 的 2.5 倍和 2 倍。不要把 Codex credits 与公开 API token 溢价混为一谈。来源为 [Codex Speed](https://developers.openai.com/codex/speed)。

当前源码的模型目录比这页产品文档更广。固定 commit 的 bundled catalog 中，`gpt-6-astra`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`gpt-5.5`、`gpt-5.4` 都列有 `id: "priority", name: "Fast"`。`gpt-5.4-mini` 和 `gpt-5.2` 的 `service_tiers` 为空。这说明不能用产品页的两个模型推断源码仅支持两个模型，也不能用 bundled catalog 推断本账户可用这些模型。此处只记录证据差异，不用源码替产品页作账户开放承诺。来源为 [固定版本 bundled catalog](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/models-manager/models.json)。

实际构建请求时，`ModelInfo::service_tier_for_request` 只保留 `service_tiers` 中存在的 tier ID，并移除 `default` sentinel。官方测试覆盖了支持 `priority`、移除未知 tier、移除显式 `default` 的行为。扩展如果仅凭 provider 名称给所有模型加 `priority`，不能把这种覆盖范围说成与当前官方 Codex 相同。来源为 [过滤实现](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/protocol/src/openai_models.rs#L917-L929)、[请求构建调用](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/client.rs#L977-L995) 和 [官方单元测试](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/protocol/src/openai_models.rs#L2052-L2090)。

TUI 的 Fast 状态还检查 `has_chatgpt_account` 和模型支持情况。`/fast` 命令按目录开放，模型未声明 Fast tier 时不显示。开关本身仍不能证明服务端处理结果。来源为 [TUI 状态判断](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/tui/src/chatwidget/service_tiers.rs#L37-L42) 和 [官方命令文档](https://developers.openai.com/codex/cli/slash-commands#toggle-fast-mode-with-fast)。

### Public API

公开 API Fast mode 只适用于支持的模型，收取 token 溢价，支持图像等多模态输入。直接抓取的最新官方指南明确 GPT-5.6 系列支持 long context，不支持 fine-tuned models 和 embeddings。GPT-6 Astra 在 EU data residency 下不支持 Fast mode，而且其 Fast mode 没有 latency SLA。Standard 与 Fast 共享模型 rate limit；快速增长的流量可能触发降级，返回 `service_tier: "default"` 并按标准费率计费。来源为 [API Fast mode guide](https://developers.openai.com/api/docs/guides/fast-mode) 和 [API pricing](https://developers.openai.com/api/docs/pricing)。

本次发现文档抓取版本差异。Exa 初次返回的指南写着 long context 不支持，`pricing.md` 也仍使用旧 Priority 标题及旧价格；随后直接读取 HTML 正文，指南已明确 GPT-5.6 支持 long context，定价页列出 Fast mode 的 long-context 价格。本报告以直接读取的 HTML 正文为准，不把索引缓存当成最新限制。来源为 [实时指南页面](https://developers.openai.com/api/docs/guides/fast-mode)、[实时定价页面](https://developers.openai.com/api/docs/pricing) 和 [存在差异的 Markdown 页面](https://developers.openai.com/api/docs/pricing.md)。

这些公开 API 限制不能逐项照搬成 ChatGPT backend 的契约。例如，公开 API 的项目默认 tier 与 Codex 的 `default` sentinel 属于不同配置层。关闭扩展后，它不再注入或覆盖请求字段，并不会删除 provider 或其他扩展已设置的 tier。即使最终请求没有该字段，也不能断言公开 API 一定采用 Standard，因为公开 API 项目可能默认使用 Fast。来源为 [API 项目级设置](https://developers.openai.com/api/docs/guides/fast-mode#configuring-fast-mode) 和 [Codex default sentinel 定义](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/protocol/src/config_types.rs#L532-L536)。

## Built-in target list is not an official support list

扩展的 `DEFAULT_CONFIG.targets` 为 `openai` 和 `openai-codex` 各写入同样的七个模型。`syncSupportedTargets` 保留 `enabled`，但将 targets 换回包内清单。payload 判断依赖该本地清单，不查询 OpenAI 模型目录。这是扩展维护者决定的注入范围，不是 OpenAI 发布或账户实时返回的支持清单。来源为本地 [`config.ts`](../../extensions/openai-fast-mode/src/config.ts) 和 [`payload.ts`](../../extensions/openai-fast-mode/src/payload.ts)。

七个模型的公开依据应分别记录：

| Model | Public API evidence | Codex backend evidence |
| --- | --- | --- |
| `gpt-5.4` | 官方定价 Markdown 的 Priority 部分列有该模型。来源为 [pricing.md](https://developers.openai.com/api/docs/pricing.md)。 | Speed 产品页明确支持；固定 commit 的 catalog 也声明 `priority`。来源为 [Speed](https://developers.openai.com/codex/speed) 和 [catalog](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/models-manager/models.json)。 |
| `gpt-5.5` | 官方定价 Markdown 的 Priority 部分列有该模型。来源为 [pricing.md](https://developers.openai.com/api/docs/pricing.md)。 | Speed 产品页明确支持；固定 commit 的 catalog 也声明 `priority`。来源为 [Speed](https://developers.openai.com/codex/speed) 和 [catalog](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/models-manager/models.json)。 |
| `gpt-5.6` | 官方 Sol 模型页明确该 alias 路由到 GPT-5.6 Sol。这是公开 API 的别名依据，不是单独的 Fast 模型条目。来源为 [Sol model](https://developers.openai.com/api/docs/models/gpt-5.6-sol)。 | 固定 commit 的 bundled catalog 没有名为 `gpt-5.6` 的条目。本次没有核实 backend 对该别名的支持，不能直接从公开 API 推导。来源为 [catalog](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/models-manager/models.json)。 |
| `gpt-5.6-sol` | 实时定价页 Fast mode 表中明确列出；Fast guide 也直接以它为例。来源为 [pricing](https://developers.openai.com/api/docs/pricing) 和 [Fast guide](https://developers.openai.com/api/docs/guides/fast-mode)。 | 固定 commit 的 catalog 声明 `priority`，不代表本账户已获开放。来源为 [catalog](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/models-manager/models.json)。 |
| `gpt-5.6-terra` | 实时定价页 Fast mode 表中明确列出。来源为 [pricing](https://developers.openai.com/api/docs/pricing)。 | 固定 commit 的 catalog 声明 `priority`，不代表本账户已获开放。来源为 [catalog](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/models-manager/models.json)。 |
| `gpt-5.6-luna` | 实时定价页 Fast mode 表中明确列出。来源为 [pricing](https://developers.openai.com/api/docs/pricing)。 | 固定 commit 的 catalog 声明 `priority`，不代表本账户已获开放。来源为 [catalog](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/models-manager/models.json)。 |
| `gpt-6-astra` | 实时定价页 Fast mode 表中明确列出，但 EU data residency 不支持。来源为 [pricing](https://developers.openai.com/api/docs/pricing)。 | 固定 commit 的 catalog 声明 `priority`，不代表本账户已获开放。来源为 [catalog](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/models-manager/models.json)。 |

这些依据证明相关名称并非全部凭空添加，但仍不能为“两个 provider × 七个模型”的完整矩阵背书。特别是 `openai-codex/gpt-5.6` 的别名解析，以及每个账户、地区、模型快照能否获得 Fast tier，尚未验证。定价页中的普通 `Speed: Fast` 性能描述也不能替代名为 Fast mode 或 Priority 的服务 tier 证据。

主 agent 报告，`before_provider_request` handler 返回替换 payload，扩展没有响应确认 hook；fake Pi 测试仅断言 payload 与 UI。应将其结果描述为“本地注入逻辑经过测试”，而不是“实际 Pi 网络请求已发送”或“服务端已加速”。主 agent 已核验工作区安装版本，但本研究没有独立验证从 hook 到网络的 Pi 传输链路。对应检查位置为 [`index.ts`](../../extensions/openai-fast-mode/src/index.ts) 和 [`extension.test.ts`](../../extensions/openai-fast-mode/__tests__/extension.test.ts)。

## Evidence of actual processing

已直接读取 [Responses create API reference 原文](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)，其 `--service-tier` 参数说明明确接受 `service_tier=fast` 和 `service_tier=priority`，并写明 Fast 响应显示 `service_tier=priority`。原文同时强调，响应字段基于实际处理模式，可能不同于请求值。不能保留“公开 API 只接受 priority、不接受 fast”的旧结论。

公开 API 的官方判据是响应对象里的 `service_tier`，它表示实际处理使用的 tier，不只是请求值的回显。当前指南明确，GPT-5.6 及更早模型，无论请求 `fast` 还是 `priority`，Fast 响应都返回 `priority`；触发降级则返回 `default`。未来模型不应机械套用这条旧模型返回值规则。来源为 [API response tier 与降级规则](https://developers.openai.com/api/docs/guides/fast-mode)。

对一次具体请求，建议区分以下证据层级。这是本报告的验收建议，不是声称本次已经完成这些检查。

1. 本地 UI 显示 Fast 或配置保存成功，只证明用户选中了 Fast。
2. 脱敏后的最终 wire payload 含 `service_tier: "priority"`，证明客户端发送了这个请求意图。
3. 对公开 API，与该请求关联的服务端最终响应含实际 `service_tier`，可据官方响应语义判定处理 tier。流式传输应优先检查终态 `response.completed.response.service_tier`，不要仅看请求日志或最初事件。ChatGPT backend 不适用这个单字段判据，见本文顶部的纠正说明。
4. 公开 API usage dashboard 按 service tier 分组可交叉核验用量，但不应假设这个 API dashboard 覆盖 ChatGPT 订阅流量。

上述区分依据为 [官方响应字段与 usage dashboard 说明](https://developers.openai.com/api/docs/guides/fast-mode) 和 [Codex 对 response.completed 的解析](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/codex-api/src/sse/responses.rs#L483-L505)。延迟变短只能作为补充观测，单次响应时间无法排除缓存、输出长度、网络和负载差异。

本次读取的 Codex SSE 解析器有一个重要观测限制。`ResponseCompleted` 仅声明 `id`、`usage`、`usage_metadata` 和 `end_turn`，转换后的 `ResponseEvent::Completed` 也没有单独保留 `service_tier`。因此，“高层事件里没看到 tier”不等于服务端没有返回它，应检查未被 SDK 裁剪的原始响应。来源为 [ResponseCompleted 结构](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/codex-api/src/sse/responses.rs#L116-L125) 和 [Completed 事件转换](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/codex-api/src/sse/responses.rs#L483-L499)。

这里仍有边界。公开 API 文档不能保证 ChatGPT backend 返回的 `service_tier` 具有相同语义。即使该 backend 返回 `default`，也不能仅凭它判定 Fast 未生效。后续查到的 [Codex #14204 回复](https://github.com/openai/codex/issues/14204#issuecomment-4033184620) 已明确说明这个限制。目前未找到可以替代它的、已核实的 backend 专用响应头契约。应报告“已请求 Fast，实际状态未确认”，或凭 request ID 向 OpenAI 核实，不能把无报错、HTTP 200 或 footer 状态当作实际生效证明。

## Verification boundary

初次文献调研没有调用付费推理，没有读取 API key、ChatGPT token 或本用户认证文件，也没有测试账户 entitlement、线上模型目录、配额与限流状态。其后用户批准了一次使用本机认证的极短探针，结果见本文顶部的纠正说明。主分支源码和官方文档可以证明字段有官方依据，但不能证明本用户账户线上生效。

本报告只创建、更新 `docs/research/openai-fast-mode-field-verification.md`，没有修改扩展源码或测试。

主 agent 已报告执行 `TMPDIR="$PWD/.tmp" pnpm run check` 全部成功，运行环境为 Node.js `v22.22.2`、pnpm `11.9.0`。完整测试结果为 52 个文件通过、1 个跳过，666 个测试通过、1 个跳过；其中 Fast mode 的 4 个测试文件、54 个测试全部通过。这是主 agent 提供的本地验证结果，本研究未重复运行。检查命令定义见 [`package.json`](../../package.json)。

类型检查、测试、构建与发布包检查通过，不等于线上推理验证。初次调研没有验证本用户的最终网络 payload；后续单次探针已观察请求与响应字段，但仍未证明实际 Fast 路由、加速效果或配额消耗。
