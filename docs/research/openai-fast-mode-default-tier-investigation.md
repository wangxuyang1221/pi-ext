# Codex Fast mode default-tier investigation

## Follow-up experiment

最新的 [9 次真实 Pi SDK 三组对照](openai-fast-mode-sdk-validation.md) 已进一步验证原扩展：关闭时 33.61 tokens/s，原样启用且不加 routing hint 为 62.55 tokens/s，加 hint 为 62.98 tokens/s。当前账户与 Astra 的 Pi 0.85.1 HTTP/SSE 链路中，原扩展本轮约 1.86 倍提速，无需补 hint 就有效。终态 tier 全为 default，所以本报告对该字段判据的纠正仍然成立。

本报告之后，用户另行批准并完成了 6 次等长 HTTP SSE 对照。携带 body priority 与对应 routing hint 的 Fast 组综合输出速率为 56.52 tokens/s，基线组为 33.58 tokens/s，约 1.68 倍；六次最终 tier 仍全是 `default`。这支持组合配置在本轮提速，不证明服务端路由、计费或 routing hint 的独立作用。完整方法、指标和限制见 [live A/B validation](openai-fast-mode-live-ab-validation.md)。下文保留实验前的原因调查与当时的授权边界。

## Conclusion

这次实验确认，客户端请求 `priority`，ChatGPT backend 的终态字段返回 `default`。它没有确认 Fast 实际失效，更没有确认失效原因。

最重要的新证据来自 OpenAI 官方仓库的 [#14204 回复](https://github.com/openai/codex/issues/14204#issuecomment-4033184620)。`pash-openai` 明确说，ChatGPT 认证模式的 Fast 由服务端 Codex routing 处理，最终响应中的 `service_tier` 不是可靠的端到端验证字段，看到 `default` 不意味着 Fast 被忽略。因此，下一步首先要确认 backend 的观测语义，不应直接按公开 API 的 tier 契约判为降级。

缺少 `x-codex-routing-hint` 是已经核实的客户端差异，值得作为后续单变量对照，但目前没有证据证明它必需，更没有证据证明补上即可解决。官方仓库已有用户报告，在携带该头、使用官方 CLI、HTTP SSE 及目录声明支持 Fast 的情况下，仍返回 `default` 且没有测出加速。该报告不是 OpenAI 的根因确认。来源为 [#37345](https://github.com/openai/codex/pull/37345) 和 [#32191 的 2026-08-23 评论](https://github.com/openai/codex/issues/32191#issuecomment-5384802156)。

本轮读取公开资料及脱敏的本机配置、模型缓存，不读取认证，不发送额外推理，也不修改扩展代码。用户上一轮的一次推理授权已经用完。旧报告已补充判据纠正说明。

## Observed request

以下事实由主 agent 提供，本研究未重放该请求。它们是本次实验摘要，没有可公开的外部 URL。

| Item | Observation |
| --- | --- |
| Provider / model | `openai-codex / gpt-6-astra` |
| Endpoint / transport | `https://chatgpt.com/backend-api/codex/responses`，直接 `fetch`，HTTP SSE |
| Authentication | 使用本机已有 OAuth；本报告不记录认证值或账户 ID |
| Body | 扩展 `getFastModePayload` 注入 `service_tier: "priority"`；`store: false`、`stream: true`；instructions 和 user input 均要求只回复 OK；`text.verbosity: "low"` |
| Client headers | `originator: pi`、`User-Agent: pi/0.84.3`、`OpenAI-Beta: responses=experimental`、SSE accept 与 JSON content type；含认证及账户头，没有 routing hint、session headers |
| Result | HTTP 200，`response.created` 和 `response.in_progress` 为 `service_tier: "auto"` |
| Terminal result | `response.completed` 为 `service_tier: "default"`，model `gpt-6-astra`、status `completed` |
| Usage / duration | 20 input tokens、5 output tokens，2380 ms |

这里只有 5 个输出 token，2380 ms 不能用来估计稳定生成速率，也不能与产品页的倍速宣传直接比较。实验确认的是请求与终态字段不一致，不是实际路由、计费或吞吐差异。

## Evidence levels and revision

- `A` 为本任务观测，来自主 agent 的单次请求摘要。可说明这一请求发生了什么，不能外推到其他请求。
- `B` 为固定 commit 的官方客户端源码或官方产品文档。可说明客户端行为或公开承诺，不能代替未公开的服务端实现。
- `C` 为官方仓库中的具名贡献者回复。这里只核验 GitHub 作者及关联字段，不据此断言作者是 maintainer 或 OpenAI 员工。保留回复日期和适用环境，不自动当作所有未来模型的永久协议。
- `D` 为官方仓库中的外部用户报告。可提供复现线索，不能因为仓库属于 OpenAI 就称为官方确认。
- `H` 为待验证假设，只用于安排检查顺序。

2026-09-06 UTC 再次读取 GitHub API，`main` 仍为 `6af345407d9c2a568da9d01b6c4b81a9e61495c0`，提交时间 `2026-09-06T02:28:38Z`。源码链接固定到此版本。来源为 [commit API](https://api.github.com/repos/openai/codex/commits/main) 与 [固定 commit](https://github.com/openai/codex/commit/6af345407d9c2a568da9d01b6c4b81a9e61495c0)。Context7 `/openai/codex` 用于定位文档，具体字段和行文再按固定源码复核。

## Backend response semantics

### Project response in issue 14204

`pash-openai` 于 2026-03-10 对 ChatGPT 认证、Codex CLI `0.113.0`、GPT-5.4 的问题回复：

> In this mode, Fast is handled by Codex routing logic server-side, so `service_tier` is not an end-to-end field you can reliably verify in the final response payload.
>
> Because of that, seeing `response.service_tier = "default"` does not mean Fast was ignored.

来源为 [原始评论](https://github.com/openai/codex/issues/14204#issuecomment-4033184620)。通过 [GitHub comments API](https://api.github.com/repos/openai/codex/issues/14204/comments?per_page=100) 核验其作者及正文，`author_association` 为 `CONTRIBUTOR`；[作者公开资料 API](https://api.github.com/users/pash-openai) 的 company 为 `@openai`。这比搜索摘要更可追溯，但 company 属于公开账户资料，不能作为员工身份或 maintainer 权限的独立证明。本报告仅称其为 Codex 仓库的 `pash-openai` 回复。

证据等级为 `C`。这是 2026-03-10 对历史 WS 路径的回复；本次 Astra 通过现代 HTTP SSE 请求，没有独立核验该路径的 tier 元数据契约。回复说明了当时的 backend 语义，不证明当前 Astra 的请求一定已经 Fast。不过，它足以阻止把“终态 default”直接翻译成“Fast 未生效”。旧报告已补充纠正说明，后续汇总结论应保留这条限定。

### Later user reports

| Source | Report | Limit |
| --- | --- | --- |
| [#30413](https://github.com/openai/codex/issues/30413) | 2026-06-28，ChatGPT 登录的 Desktop、`0.142.0-alpha.6`、GPT-5.5，wire 中有 `priority`，终态是 `default`，本地 catalog 声明支持 Fast。 | `D`，作者为外部用户；本次 API 查询无评论，issue 为 open，没有根因确认。 |
| [#32191](https://github.com/openai/codex/issues/32191) | 2026-07-10，官方 CLI `0.144.0` 的 `codex exec`，GPT-5.6 Sol 和 GPT-5.5，WS 出站有 `priority`，created 为 `auto`，completed 为 `default`。 | `D`，与本次字段序列接近，但不能证明 headless 被限制。 |
| [#32191 2026-07-17 评论](https://github.com/openai/codex/issues/32191#issuecomment-5007379595) | `0.144.5` 账户 live `model/list` 的 tiers 为空，app-server 将 tier 清成 null；作者明确自己的计时不能证明 backend 忽略有效 priority 请求。 | `D`，这是发出前过滤，和本次已发出 priority 的直接 fetch 不同。 |
| [#32191 2026-08-23 评论](https://github.com/openai/codex/issues/32191#issuecomment-5384802156) | `0.149.0`、Plus、Sol、HTTP SSE，包含 body priority、routing hint 与 responses-lite 头，Standard 和 Fast 均返回 default；三组对照各输出 3005 tokens，约 52 tokens/s。 | `D`，支持“问题不限于缺 hint 或 WS”，但没有服务端解释，模型也不是 Astra。 |

本次读取 [#32191 comments API](https://api.github.com/repos/openai/codex/issues/32191/comments?per_page=100)，上述两条作者 `author_association` 均为 `NONE`。不能把他们认为发生了 downgrade 的措辞当作官方 backend 契约。

### External issue 2558

通过 [openai/codex #30413 timeline API](https://api.github.com/repos/openai/codex/issues/30413/timeline?per_page=100) 确认，引用的 #2558 属于第三方仓库 **lidge-jun/opencodex**，不是 OpenAI 仓库。已读取 [issue #2558 原文](https://github.com/lidge-jun/opencodex/issues/2558)。

作者在 2026-08-25 报告，其代理把所有 ChatGPT backend 的非 priority 响应自动标为 `downgraded / response-declined`。33 个 priority 请求与 17 个无 tier 请求的粗略均速约为 116 与 98 tokens/s，但作者明确承认短输出带来噪声，不能证明每次 Fast 生效。问题重点是将公开 Platform API 的响应契约套到了 ChatGPT 私有 endpoint，导致观测分类过强。

该项目维护者随后称已在自身 [PR #2589](https://github.com/lidge-jun/opencodex/pull/2589) 修复，按目标地址设置 `responseTierAuthoritative`，保留原始 `responseServiceTier`，但不再从 ChatGPT 的 default 元数据断言 downgrade。其评论同时影响自身代理的成本归类。证据等级为 `D`，这说明第三方项目修正了观测逻辑，不是 OpenAI 确认其全部样本获得 priority，也不证明 OpenAI 的实际账单如何计算。本轮没有独立审核该第三方补丁或重现其测量。

这条线索与前述 `pash-openai` 回复方向一致。对本任务应纠正的是“返回 default 就已证明 Fast 未启用”的判断，不能反向改成“返回 default 也已证明 Fast 启用”。准确结论仍为请求 priority、终态元数据 default、实际 Fast 路由未确认。

## Routing hint and request differences

### Exact routing hint

当前官方客户端对本次模型和请求 tier 构造的精确值是：

```http
x-codex-routing-hint: model=gpt-6-astra;tier=priority
```

`build_routing_hint_header` 使用 `format!("model={model};tier={tier}")`，无空格。没选 tier 时只发 `model={model}`。`uses_codex_backend` 要求 Codex backend 认证、OpenAI provider、`requires_openai_auth`，并排除 env key、provider bearer、command auth 与 AWS 路径。来源为 [client.rs 1060-1069](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/client.rs#L1060-L1069) 和 [1106-1120](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/client.rs#L1106-L1120)。证据等级为 `B`。

已合并的 [PR #37345](https://github.com/openai/codex/pull/37345) 说明该头用于 Responses HTTP、远程 compact、WS handshake 及 prewarm。其 merge commit 为 `270d93268ce97e8c5606a6cf12b4192d71b2581a`，通过 [PR API](https://api.github.com/repos/openai/codex/pulls/37345) 核验。PR 没有承诺“没有头就忽略 body tier”，源码也不包含服务端解析规则。所以“缺 hint 导致本次 default”仍为 `H`。

### Originator, version and features

官方默认 originator 为 `codex_cli_rs`，User-Agent 由 originator、构建版本及平台信息组成；内置 provider 另发 `version: <CARGO_PKG_VERSION>`。源码还定义 first-party originator 分类，但本次没有找到它与 Fast 服务端资格直接关联的规则。来源为 [default_client.rs](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/login/src/auth/default_client.rs#L133-L174) 与 [provider version header](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/model-provider-info/src/lib.rs#L396-L401)。

`originator: pi` 和 `User-Agent: pi/0.84.3` 与官方 CLI 不同，这属于已确认的请求差异，不是已确认的阻断条件。不建议伪装官方客户端身份来碰运气。如果需要官方客户端对照，应使用真实官方客户端并保留真实版本。

当前 `Feature::FastMode` 为 Stable、默认 true，是客户端的选择和请求开关。不能由此推断服务端不再有账户或发布限制，也没有证据要求额外发送 `x-codex-beta-features: fast_mode`。来源为 [features/src/lib.rs](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/features/src/lib.rs#L1660-L1665)。

官方客户端还发 session/thread metadata 和部分模型的 responses-lite 格式。本次 Astra bundled catalog 的 `use_responses_lite: true`，但 `service_tier` 的请求构建与该格式开关分开。它们值得记录为兼容性差异，当前没有证据证明 plain Responses 不能使用 Fast。来源为 [模型 catalog](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/models-manager/models.json) 和 [请求构建](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/client.rs#L977-L995)。不要把 responses-lite 头单独加在旧格式 body 上，源码会同时调整 body 格式。

### HTTP and WebSocket

当前源码为 HTTP 与 WS 构建同样的 service tier，并向两条路径发送 routing hint。WS 专用 beta 值为 `responses_websockets=2026-02-06`，这是 WS 协议标志，不是 Fast 激活标志。HTTP 实验中的 `responses=experimental` 与它不同，也不能据此断言 HTTP Fast 不支持。来源为 [WS beta 常量](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/client.rs#L152-L169)、[WS header 构建](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/client.rs#L1238-L1261)、[HTTP hint](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/client.rs#L1623-L1635) 和 [WS hint](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/client.rs#L1773-L1782)。证据等级为 `B`。

因此，“必须 WS 才能 Fast”缺乏证据，优先级低于确认响应语义、账户目录和 routing hint 差异。

## Astra, entitlement and quota

当前官方 bundled catalog 的 `gpt-6-astra` 明确列有 `id: "priority", name: "Fast", description: "2x speed, increased usage"`，并设置 `prefer_websockets: true`。这是 `B` 级客户端支持证据，不是本账户的授权结果。来源为 [固定 catalog](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/models-manager/models.json)。本次能成功调用 Astra 只证明模型请求被接受，不能据此证明账户有 Astra Fast 权限。

[Codex Speed 页面](https://developers.openai.com/codex/speed) 说明 Fast 会增加 credits 消耗并适用于 ChatGPT 登录；[Codex Pricing 页面](https://developers.openai.com/codex/pricing#what-happens-when-you-hit-usage-limits) 说明额度耗尽时可购买 credits、切换较小模型，正在运行的 turn 在 fair-use 限制下可以继续。此次没有找到“Fast 专用额度耗尽就静默改为 Standard 且终态 default”的官方 ChatGPT backend 规则。不能把“Fast 花费更多”改写成“存在已确认的 Fast 独立额度池及降级算法”。

当前 app-server 文档提供 `account/rateLimits/read`，包含 `ordinaryUsageAllowed`、primary/secondary windows、credits 等信息，也描述另一个 Luna Reserve 模型回退流程。这不是 Fast → Standard 的证明。查看限额可以排查账户状态，却不能单凭剩余百分比推导 Fast 权限。来源为 [固定 app-server README](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/app-server/README.md#L2800-L2854)。本轮没有调用该方法。

公开 API 有 Fast ramp-rate 降级、模型和地区限制，但它们描述 `api.openai.com`，不是本次 ChatGPT backend。尤其不能把公开 API 的 Astra EU residency 限制、`default` 响应含义或 TPM ramp 条件直接当成本次根因。来源为 [公开 API Fast guide](https://developers.openai.com/api/docs/guides/fast-mode)，并对照 [ChatGPT 特有语义回复](https://github.com/openai/codex/issues/14204#issuecomment-4033184620)。

## Local read-only findings

以下由主 agent 只读核验并提供，本研究未读取这些用户目录文件，也未接触认证。

- 本机 `~/.codex/models_cache.json` 的 `fetched_at` 为 `2026-09-06T04:46:40.998052Z`，`client_version` 为 `0.153.4`。Astra 条目包含 `service_tiers: [{id: "priority", name: "Fast", description: "2x speed, increased usage"}]`、`visibility: "list"`、`supported_in_api: true`。这比 bundled catalog 多了一份本机缓存证据，但尚未核验该缓存和 Pi 是否属于同一账户，不能作为 Pi 当前 entitlement 证明。
- Pi models-store 的当前模型 `baseUrl` 为 `https://chatgpt.com/backend-api`，没有 `service_tiers` 元数据；本机 `models.json` 没有 `openai-codex` 覆盖。没有 tier 元数据不等于服务端不支持，只说明不能从此 Pi 模型记录完成资格判断。
- `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`、`NODE_OPTIONS`、`NODE_USE_ENV_PROXY`、`NODE_EXTRA_CA_CERTS`、`SSL_CERT_FILE`、`OPENAI_BASE_URL` 和 `CODEX_HOME` 均未设置。这排除了这些环境变量造成的显式覆盖，不能扩大为已排除系统代理或所有网络中间层。
- `~/.codex/config.toml` 的 `model` 为 `gpt-6-astra`、`service_tier` 为 `default`。本次独立 fetch 不读取该配置，因此不能把该值作为实验返回 default 的原因。
- 工作区安装的 Pi `0.84.3` provider 默认 transport 为 `auto`，这不是对当前全局 Pi 运行时版本的核验；已做实验则是手写 fetch 的 HTTP SSE。实验使用了扩展的 payload 注入函数，但未经过完整 Pi provider 传输链路。不能写成“Pi 正常对话请求已确认返回 default”，也不能假设 Pi auto 与此次 SSE 的协议和请求头完全相同。

这些是本地观测 `A`，没有外部 URL。它们降低了“仅因内置模型清单误标 Astra”这一猜测的优先级，但没有消除跨账户、缓存时效和实际路由的不确定性。

## Ranked hypotheses

| Priority | Hypothesis | Current evidence | What would distinguish it |
| --- | --- | --- | --- |
| 1 | backend 响应 tier 不能反映 Codex Fast 路由，实验判据不足 | `C` 级项目回复直接支持这种可能；本次仅有短输出和终态字段 | 由 OpenAI 按已有 request ID 确认该请求实际路由和计费，或明确当前 Astra backend 的权威字段 |
| 2 | Pi 风格请求缺少当前官方 routing hint 或其他兼容信号 | `B` 级源码确认差异；没有服务端必需性证明 | 保持身份、body、HTTP 不变，仅改变 routing hint 的对照，但需要重新授权，且仍不能只凭 default 判失败 |
| 3 | Pi 所用账户当前模型目录、权限或发布状态不提供 Fast | 本机 Codex 缓存声明 Astra priority，但未核验与 Pi 同账户；`D` 级报告曾出现 live tiers 为空 | 在不披露认证的前提下核验账户对应关系及目录时效；必要时另授权获取官方账户目录 |
| 4 | 服务端容量、配额或路由异常导致实际未加速 | 多个 `D` 级用户报告类似现象；没有本次 backend 原因码 | OpenAI request-level 诊断；必要时授权固定输出长度的对照测量 |
| 5 | `originator: pi`、版本或 HTTP 单独导致 Fast 不可用 | 仅有客户端差异，没有 Fast gating 合同；官方 HTTP 与 WS 都实现 tier | 官方真实客户端与相同认证、模型的诊断对照，再缩小变量，不伪装 originator |

以上排序是调查顺序，不是根因概率。不能宣布“缺头”“套餐不支持”“额度用完”或“必须 WS”中的任何一项已成立。

## Minimal verification plan

当前没有剩余推理授权，以下仅是方案，不执行。

1. 先使用已有请求的时间、model、request ID 和 response ID，向 OpenAI 询问“实际 Codex Fast 路由是否启用、是否按 Fast credits 计费，以及为何终态 tier 为 default”。不附 OAuth、账户认证头或完整提示词。若已有记录没有 request ID，明确缺少，不读取认证重放。
2. 复用主 agent 已核验的 Codex 缓存时间、版本字段和 Astra priority 条目，不重复读取。剩余问题是该缓存是否对应 Pi 同一账户、是否仍有效，以及有没有可用 quota 快照。缓存的 `client_version` 不等于已经核验当前官方可执行文件版本。不要为了查询能力直接开启 `supportsLunaReserve` 等会参与实验的参数。
3. 若用户另行明确授权一次新推理，可先复用相同短请求，只增加 `x-codex-routing-hint: model=gpt-6-astra;tier=priority`，其余参数不变。它只检验这个差异是否改变返回元数据或错误，不足以用五个输出 token证明倍速。一次新请求与历史请求相比仍有时间、负载差异，结论要保留此限制。
4. 若仍需验证实际速度，应另约定预算，用同账户、模型、reasoning、固定输出长度和相同传输做 Standard/Fast 成对测试，并同时记录 TTFT、生成区间、实际 output tokens 与可确认的计费。不要把单次总耗时或整个请求时长除以五个 token 作为吞吐基准。
5. 若优先核验兼容性，应运行真实官方客户端作对照，不能只把 Pi 的 User-Agent 改成 Codex。官方客户端会增加其他 metadata、目录过滤和格式变化，结果即使不同也只能说明客户端路径不同，需进一步控制变量才能归因。

结束条件为拿到服务端可解释的处理依据，或明确记录“已请求 Fast，但当前可观测信息不足以确认其实际路由”。不要用补头后仍为 default 作为自动否定 Fast 的条件。

## Work performed

本轮新增此报告，并在旧报告 `openai-fast-mode-field-verification.md` 中纠正 ChatGPT backend 的判断依据。没有修改扩展源码或测试，没有读取 OAuth/API key，没有追加推理。主 agent 已执行 `TMPDIR="$PWD/.tmp" pnpm run check`，类型检查、666 个测试、构建和发布包检查通过，1 个测试跳过。这些本地检查不证明 backend 的实际路由。
