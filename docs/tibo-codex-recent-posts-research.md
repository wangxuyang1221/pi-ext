# Tibo's recent Codex posts

## Scope and findings

研究基准日为 2026-10-15，时区为中国标准时间 CST，即 UTC+8。优先检索 2026-09-15 至 2026-10-15，最终选取 10 条帖子，覆盖 2026-10-04 至 2026-10-15 UTC。换算 CST 后为 2026-10-05 至 2026-10-15。最新核验帖发布于 2026-10-15 14:28:13 CST。

最明确的变化是，Tibo 这轮发帖集中讨论 Codex 的实际使用成本和交互体验，包括响应速度、途中纠偏、自动审批、上下文容量、本地磁盘占用和额度重置。不能把这些帖子简单归纳成又发布了一个更强的编程模型。

下文的“事实”表示已核验账号确实发布了相应说法，不表示本研究独立测试过性能数字或确认每个账户都已收到功能。所有产品效果和数字均保留发布者的适用范围。

## Identity verification

- [OpenAI Forum 的官方活动介绍](https://forum.openai.com/public/events/codex-is-for-everyone-why-codex-matters-beyond-code-fa40puy7wi)明确写出 Thibault “Tibo” Sottiaux，并称其为 Head of Codex，正文也写明他在 OpenAI 领导 Codex。活动日期为 2026-05-13，这只能证明当时的职务表述，不是新的任命公告。
- 本次读取的 X 官方嵌入数据均返回 `user.name = Tibo`、`user.screen_name = thsottiaux`，账号 ID 一致。其帖子直接引用带 OpenAI 企业标记的 `@OpenAIDevs` 产品公告。
- [OpenAI Developer Community 的跟踪讨论](https://community.openai.com/t/28-days-of-shipping-at-openai/1403897)也将 Tibo 的公告对应到 `https://x.com/thsottiaux/status/2106845241357824205`。这是一篇社区用户维护的汇总，不能仅因域名属于 OpenAI 就把其中所有评论当成公司声明。

上述证据相互吻合，本报告将用户所指的 Codex 负责人 Tibo 识别为 Thibault Sottiaux，账号为 [@thsottiaux](https://x.com/thsottiaux)。没有仅凭蓝标认定身份。

## Verification method

先用 `codex_search` 的 `live` 模式检索身份、最近一个月和具体帖子，再用 Exa 检索和读取候选页面。搜索最初主要返回第三方镜像，X 正常网页读取失败，MultiFetch 还出现了域名解析地址被拦截的错误。

随后通过 X 自己的公开嵌入数据端点成功核验了下表每条帖子的作者、`id_str`、`created_at` 和 `text`。端点格式如下，将 `POST_ID` 替换成原帖链接里的数字即可。

```text
https://cdn.syndication.twimg.com/tweet-result?id=POST_ID&lang=en&token=0
```

这一步使用 `curl` 只读请求，未登录、未调用付费 X API、未写入认证信息。该端点偶尔返回空响应，磁盘优化帖在重试后返回了正文。

有 `note_tweet` 的长帖，嵌入数据只返回约 280 字符的开头，不返回完整长文。下表只把这个可直接核验的部分列为一手事实。镜像补充的信息另行标注。发帖时间取自 X 的 `created_at`，不是搜索抓取时间、镜像页面创建时间，也不是“Day N”所采用的美国当地日期。

## Verified posts

| # | Publication time | Post and verified statement | Interpretation and boundary |
| --- | --- | --- | --- |
| 1 | UTC 10-04 20:33:43；CST 10-05 04:33:43 | [28 天交付承诺](https://x.com/thsottiaux/status/2106845241357824205)。原文承诺未来 28 天，每天要么交付一项对多数 Codex/Work 用户有明确帮助的改进，要么重置额度。 | 事实是他作出了这个承诺。不能据此认定未来每天都已经交付，更不能把临时活动解释成固定额度制度。 |
| 2 | UTC 10-05 17:20:29；CST 10-06 01:20:29 | [默认速度提升约 50%](https://x.com/thsottiaux/status/2107158998495748264)。可见正文明确提到 GPT-6 Astra 和 GPT-6.1 Sol 的订阅访问，以及通过 Sign in With ChatGPT 使用的产品和伙伴，点名 OpenCode、Pi、Amp、Devin。 | 这是发布者的速度声明，不是本研究的基准测试。不能推广成 API 全量请求、所有模型或端到端任务都快 50%。嵌入正文在最后一句中截断。 |
| 3 | UTC 10-06 07:13:54；CST 10-06 15:13:54 | [Auto-review 对 ChatGPT 登录用户免费](https://x.com/thsottiaux/status/2107368734981517634)。可见正文说明免费，并给出 settings > permissions > auto-review 的入口，提到逐次审批造成 decision fatigue。 | [同日后续汇总帖](https://x.com/thsottiaux/status/2107575657014468879)的一手可见正文进一步确认其不消耗套餐 usage。长文镜像解释了第二个 agent 审核主 agent 操作的机制，但本条长帖的一手返回正文没有覆盖完整机制说明。免费不等于无需安全约束。 |
| 4 | UTC 10-06 20:53:10；CST 10-07 04:53:10 | [Decisions API 上线](https://x.com/thsottiaux/status/2107574912349303197)。他表示会在自家应用中使用它改善体验，并称之为 realtime general classifier。引用的 [OpenAI Developers 公告](https://x.com/OpenAIDevs/status/2107573382229188645)称其面向所有开发者公开测试，用于选择模型、工具或动作。 | 可以确认这是决策/分类用途的 API 发布，而不是另一个负责完整编程任务的模型。公告的“up to 10x faster”只比较决策任务与通过 Responses API 使用 GPT-6 Luna，不能泛化到应用整体提速十倍。 |
| 5 | UTC 10-08 19:15:14；CST 10-09 03:15:14 | [即时 steering 与 Sol ultrafast](https://x.com/thsottiaux/status/2108275041276420573)。他表示模型能更快响应用户中途调整，减少错误方向上的工作，同时提到 GPT-6.1 Sol ultrafast。引用的 [OpenAI Developers 公告](https://x.com/OpenAIDevs/status/2108262812489531498)说明 ultrafast 向 API、Codex、ChatGPT Work 推出。 | 推断是交互式纠偏比等待整轮完成更受重视。官方“up to 8x”比较的是 Sol Standard 与 ultrafast 的速度，不是任务成功率。没有据帖子推导第三方客户端可直接调用的稳定中断协议。 |
| 6 | UTC 10-09 19:47:58；CST 10-10 03:47:58 | [Composer predictions](https://x.com/thsottiaux/status/2108645667451318747)。桌面应用向 Pro 套餐提供输入预测，且不消耗 usage。引用的 [OpenAI Developers 公告](https://x.com/OpenAIDevs/status/2108624138369929725)明确称其仍为 beta，会根据对话和用户表达方式建议下一条消息。 | 这是辅助用户写下一条消息，不是模型自动取得新的执行授权，也不能当作所有套餐已有的功能。 |
| 7 | UTC 10-11 23:45:59；CST 10-12 07:45:59 | [默认上下文从 272k 增至 500k](https://x.com/thsottiaux/status/2109430343346581527)。可见正文限定为通过 Codex 和 Work 使用 GPT-6.1 Sol，目标包括减少 compaction 和支持保留大量上下文的任务。 | 更大的默认上下文不等于无限记忆，也不证明长上下文质量或每次任务成本必然更好。社区汇总及镜像还提到可配置至 1M、订阅不收长上下文附加费，但这些内容不在本次一手可见片段内，不能冒充已读取完整原帖。 |
| 8 | UTC 10-13 23:32:43；CST 10-14 07:32:43 | [桌面应用磁盘状态存储优化](https://x.com/thsottiaux/status/2110151780478927344)。原文称 ChatGPT 与 Codex 桌面应用已推出状态存储优化，预期让磁盘存储量减少 60%，原因是重度用户反馈磁盘空间不足。 | 必须保留原文的“should”。这不是实际测得每台机器节省 60%，更不是总安装包或内存占用下降 60%。X 数据标记该帖已编辑，链接指向本次返回的最新版本。 |
| 9 | UTC 10-15 04:55:51；CST 10-15 12:55:51 | [Day 10 重置公告](https://x.com/thsottiaux/status/2110595484180214059)。正文调侃 reset 按钮没有丢，并写出“Day 10/ Reset”。 | 可以确认他宣布重置；单看这条短帖不能得出适用套餐、地区、具体额度窗口或全部账户已完成。 |
| 10 | UTC 10-15 06:28:13；CST 10-15 14:28:13 | [后续完成确认](https://x.com/thsottiaux/status/2110618732666257557)。正文为“Done and dusted”，引用帖正文为“Landing within the next 2 hours”。 | 结合前一条和引用内容，可理解为此次重置的完成确认。不能把这句话当作独立的服务 SLA，也没有实际登录账户检查到账。 |

表内时间均属于 2026 年。第 9、10 条属于同一事件的宣布和确认，保留两条是为了区分“承诺发生”和“宣称已完成”，不是两次不同重置。

## What this suggests about Codex

以下为基于上述帖子作出的判断，不是 OpenAI 正式路线图。

### Lower overhead in everyday use

速度提升、输入预测、磁盘优化分别处理等待、重复输入和本地资源占用。它们表明团队在回应持续使用中的具体问题。对开发者而言，评估 Codex 时应测量从提出任务到验收通过的总时间，而不是只看 tokens/s。

### More control during long tasks

即时 steering 让用户更早改正方向，Auto-review 则试图减少重复人工审批。两者解决的是不同问题。接入自己的工具或审批流程时，仍需明确哪些操作需要人工批准，不能因为有自动审核就允许高风险命令不受限制地执行。

### Subscription integration matters to third-party clients

速度公告直接点名 Pi 等通过 Sign in With ChatGPT 接入的产品。这说明部分服务端改进可能影响第三方客户端，而不仅是 OpenAI 自家 UI。但桌面输入预测、本地存储优化和 Codex 的 steering 不能因此视为 Pi 自动获得的功能。需要逐项核验客户端、模型与协议支持。

### Context size is a trade-off, not a quality score

500k 默认上下文减少压缩频率的目标很清楚。代价和实际收益仍需按仓库测试，包括任务成功率、额度消耗、响应延迟和旧信息干扰。不能把窗口增大直接换算成理解能力按比例上升。

### Reset announcements do not replace capacity planning

这轮公告持续使用额度重置回应用户需求，但临时赠送不适合作为 CI 或业务自动化的容量保证。[OpenAI Help Center](https://help.openai.com/en/articles/20001498-how-banked-codex-resets-work)明确区分 banked reset 与 automatic/global reset，并说明未来重置不保证提供。可保存重置也不是现金或 API credits，且可能过期。

因此，自动化任务应保留限额处理、重试和失败告警；预算以账户实际 usage 页面与适用条款为准，不以某次重置推文为准。

## Source quality and limitations

- 本次没有获取完整 X 时间线，也不能保证 2026-10-15 14:28:13 CST 之后没有更新。这里的“最新”只表示本次找到并成功读取的最新帖子。
- 最近一个月的搜索结果高度偏向额度重置追踪站和十月的 28 天活动。本表不是对这一个月所有原创、回复、转发的穷尽统计，也不能据发帖数量判断研发投入比例。
- X 正常网页不能直接读取，但下表帖子均通过 X 官方嵌入端点核验，证据不再仅依赖搜索摘要。长帖全文仍有缺口，报告已经逐条限定。
- [TopicDigg](https://topicdigg.com/x/thsottiaux)、[Did Codex Reset 的 Day 1 页面](https://didcodexreset.com/oct28/day1.html)、[Day 2 页面](https://didcodexreset.com/oct28/day2.html)、[Day 9 页面](https://didcodexreset.com/oct28/day9.html)用于发现帖子和补充上下文。其正文、HTML 中的引用链接与结构化日期帮助定位原帖，但都不是作者控制的一手来源。
- Day 10 追踪页按美国当地活动日称为 10-14，本次两条最新帖的 X `created_at` 实际为 10-15 UTC。报告没有直接拿活动页标题当发布日期。
- [Codex changelog](https://developers.openai.com/codex/changelog)此次通过 Exa 返回的顶部条目停留在 2026-07-23，无法据此验证十月功能。本报告没有把该抓取结果当成截至十月的完整更新记录。
- 性能数字、免费范围和上线状态是发布者陈述，未做账户验证或实测。社区的自动汇总、评论与 API 探测结论没有被当成官方协议承诺。
- 本次仅新增研究文档。已按仓库要求运行 `pnpm run check`，类型检查、测试、构建、发布包与宿主校验通过，2657 项测试通过，13 项跳过。
