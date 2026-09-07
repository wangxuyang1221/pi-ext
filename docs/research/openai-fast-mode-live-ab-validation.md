# OpenAI Fast mode live A/B validation

## Follow-up SDK validation

后续已完成 [9 次真实 Pi SDK 三组对照](openai-fast-mode-sdk-validation.md)：关闭扩展为 33.61 tokens/s，原样启用扩展且不加 routing hint 为 62.55 tokens/s，扩展加 hint 为 62.98 tokens/s。原扩展在本次 Pi 0.85.1、当前账户和 Astra 的 HTTP/SSE 链路上测得约 1.86 倍生成速率。本报告下文保留较早的六次手写请求实验及其当时的证据边界。

## Result

2026-09-06 UTC，在用户批准的 6 次请求预算内完成当前 Pi 账户、`openai-codex / gpt-6-astra` 的 HTTP SSE 对照。Fast 请求组的综合可见输出速率为 **56.52 tokens/s**，Standard 请求组为 **33.58 tokens/s**，本轮比值为 **1.68 倍**。所有 Fast 请求都比 Standard 请求生成得快，但三次样本不能给出长期性能保证。

所有请求的最终 `service_tier` 都是 `default`，因此这个返回字段没有区分本轮实际观测到的速度差异。结果支持“当前账户下，这套 Fast 请求配置可以提速”，不证明服务端内部路由或实际计费档位。

本轮 Fast 同时发送 body `service_tier: "priority"` 与 routing hint 中的 `tier=priority`。没有测试只传 body 的等长对照，不能把提升单独归因于任一字段，也不能因此认定现有扩展不带 routing hint 时一定有效或无效。

## Method

- 认证使用当前 Pi 已有的、未过期的 ChatGPT OAuth，仅在内存中使用，不刷新、不输出或保存认证值。
- 请求直接发送到 `https://chatgpt.com/backend-api/codex/responses`，不经过第三方网关或官方 CLI，不经过完整 Pi provider 传输链路。
- 模型固定为 `gpt-6-astra`，顺序为 Standard、Fast、Standard、Fast、Standard、Fast，相邻请求结束后等待 2 秒，不并发、不重试。
- Fast body 通过当前构建产物的 `getFastModePayload` 注入 `priority`。Standard body 不指定 `service_tier`，按官方客户端移除 default sentinel 的方式作为基线。这里的 Standard/Fast 指请求配置，不是已经确认的服务端路由标签。
- Standard routing hint 为 `model=gpt-6-astra`；Fast 为 `model=gpt-6-astra;tier=priority`。该格式依据 [官方固定源码](https://github.com/openai/codex/blob/6af345407d9c2a568da9d01b6c4b81a9e61495c0/codex-rs/core/src/client.rs#L1106-L1120)。
- 两组其余 headers 相同，包含真实标识 `originator: pi`、探针固定的 `User-Agent: pi/0.84.3`、`OpenAI-Beta: responses=experimental`、JSON content type 和 SSE accept；不伪装官方 CLI，不使用 responses-lite 格式。
- 两组 body 均设置 `store: false`、`stream: true`、`text.verbosity: "low"`；不指定 reasoning effort、temperature、cache key 或工具。
- 每次超时上限为 100 秒；认证或 HTTP 错误、流错误、输出格式不符、输出字符超限时停止，不自动重试。未触发这些条件。
- 本轮未修改账户配置、扩展源码或测试，未启动后台服务。

Instructions 固定为：

```text
Follow the output format exactly.
```

User input 固定为：

```text
Output exactly the integers 0001 through 0330 in ascending order, separated by single spaces. No prose, no code fence, no omissions, and no trailing commentary.
```

实际输出逐次与本地生成的目标字符串比较，6 次均精确匹配，长度均为 1649 字符，输出均为 993 tokens。输入均为 51 tokens，缓存命中及 reasoning tokens 均为 0。总输入 306 tokens，总输出 5958 tokens，合计 6264 tokens。没有估算实际 credits 或账单金额。

## Measurements

时间采用同一 Node.js `v22.22.2` 进程的单调时钟 `performance.now()`。

- TTFT 从调用 fetch 前计时，到收到第一个 `response.output_text.delta`。
- Generation interval 从第一个可见文本 delta 到最后一个可见文本 delta，不含末尾 completed 事件的等待。
- 可见输出速率为 `output_tokens - reasoning_tokens` 除以 Generation interval。首个 delta 已带有部分输出，因此这不是严格的服务端逐 token 测量，但同样的计算方式用于全部请求。
- Total duration 从 fetch 前到流处理结束。
- 网络缓冲会影响 delta 到达时刻；额外记录了 first-delta-to-terminal 时长，原始摘要保存在本机工作区。

| Run | Requested mode | TTFT, s | Generation interval, s | Visible tokens/s | Total duration, s | Final reported tier |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | Standard | 3.183 | 29.572 | 33.58 | 33.004 | `default` |
| 2 | Fast | 3.556 | 21.140 | 46.97 | 24.887 | `default` |
| 3 | Standard | 3.739 | 29.555 | 33.60 | 33.547 | `default` |
| 4 | Fast | 4.853 | 15.776 | 62.94 | 20.773 | `default` |
| 5 | Standard | 4.003 | 29.587 | 33.56 | 33.801 | `default` |
| 6 | Fast | 4.210 | 15.791 | 62.88 | 20.167 | `default` |

| Aggregate | Standard | Fast |
| --- | ---: | ---: |
| Request count | 3 | 3 |
| Mean TTFT | 3.642 s | 4.206 s |
| Mean generation interval | 29.572 s | 17.569 s |
| Combined visible tokens / combined generation interval | 33.58 tokens/s | 56.52 tokens/s |
| Mean total duration | 33.451 s | 21.942 s |

Fast 的综合生成速率约为 Standard 的 1.68 倍，平均生成区间缩短 40.6%，平均总耗时缩短 34.4%。首字延迟平均增加约 0.56 秒，本轮没有观察到首字改善。

6 次均返回 HTTP 200、`response.completed` 和请求的 `gpt-6-astra` 模型。中间的 created/in_progress tier 均为 `auto`，completed tier 均为 `default`。响应没有可读取的 `x-request-id` 或 `request-id` header，但保留了 response ID，供必要时进一步追踪。

## Interpretation and limits

1. 本轮观测到 Fast 配置与较快输出相伴，差异不是输出长度、reasoning tokens 或已报告的缓存命中造成的。
2. 每组只有三次，固定交替顺序而非随机顺序，无法完全排除负载、连接状态、路由变化与时间趋势。不能据此承诺每次 1.68 倍，也没有测量统计显著性。
3. 本轮同时改变 body tier 与 routing hint tier，验证的是组合配置，不是对现有扩展的完整端到端验收。验证 header 的独立作用，需要另经用户批准的无 hint / 有 hint 对照。
4. 返回 `default` 与较快输出可以同时出现，与 [Codex #14204 的回复](https://github.com/openai/codex/issues/14204#issuecomment-4033184620) 所述 ChatGPT backend 元数据限制一致。不能把本轮速度差异反向当成 Fast 计费或服务端路由的权威证明。
5. 这轮没有验证 WebSocket、其他模型或其他账户，没有新增后台进程。没有重放失败请求，因为六次全部成功。

## Artifacts

本机复现脚本为 `.tmp/openai-fast-mode-ab-probe.mjs`，脱敏结果为 `.tmp/openai-fast-mode-ab-results.json`。结果仅保存请求配置、时间、token 数、tier 元数据和 opaque response ID，不保存密钥、账户 ID、认证 headers 或完整服务端响应。脚本若发现结果文件已存在会拒绝再次运行，防止误重复消费。

`.tmp/` 不作为长期版本化证据，本报告保留完整实验方法及逐次核心指标。先前调查见 [default-tier investigation](openai-fast-mode-default-tier-investigation.md)，字段官方依据见 [field verification](openai-fast-mode-field-verification.md)。
