# OpenAI Fast mode SDK validation

## Conclusion

**原样启用本仓库的 `openai-fast-mode`，不添加 routing hint，在本次真实 Pi provider 对照中观察到了提速。**

2026-09-06 UTC，使用当前安装的 Pi `0.85.1` SDK、当前 Pi 账户和 `openai-codex / gpt-6-astra`，完成用户批准的 9 次 HTTP SSE 请求，每组 3 次。

| Group | Combined output rate | Mean generation interval | Mean TTFT | Mean total duration |
| --- | ---: | ---: | ---: | ---: |
| `/fast off`，无 tier、无 routing hint | 33.61 tokens/s | 29.54 s | 3.12 s | 32.90 s |
| `/fast on`，原扩展，仅 body priority | 62.55 tokens/s | 15.87 s | 2.18 s | 18.16 s |
| `/fast on`，额外添加 priority routing hint | 62.98 tokens/s | 15.77 s | 2.20 s | 18.15 s |

原扩展组的综合输出速率约为关闭组的 **1.86 倍**，平均总耗时缩短 **44.8%**。添加 routing hint 相比原扩展仅高约 **0.7%**，三次样本不能证明这点差异是稳定收益。本轮无需补头就测到了提速，不支持“缺 routing hint 导致扩展无效”的说法，也不构成在正式扩展中补头的必要性证据。

这是一项限定账户、模型、版本、时间和传输路径的性能验证，不是所有环境的保证。它没有证明后台 Fast 计费或服务端内部路由。

## What was exercised

本轮不是手写 body 后直接发送的探针。真实调用链为：

```text
Pi 0.85.1 createAgentSession
  -> DefaultResourceLoader loads the original extension factory
  -> bindExtensions emits session_start
  -> session.prompt('/fast off' or '/fast on') executes the original command
  -> session.prompt(fixed input)
  -> native openai-codex provider builds the request
  -> before_provider_request invokes the original extension handler
  -> provider serializes and zstd-compresses its HTTP body
  -> instrumented fetch checks the body and forwards it unchanged
  -> native provider parses the returned SSE
  -> AgentSession emits text_delta events
```

使用未修改的 `extensions/openai-fast-mode/dist/index.js` 中 `createPiFastModeExtension`，仅通过已有参数将 `agentDir` 指向工作区临时目录。扩展 hook、命令处理和配置读取逻辑没有替换为 mock。`extensionDir` 指向原构建目录。扩展入口的 SHA-256 已记录在原始结果中。

正式网络请求前先完成一次全离线 dry run。该检查用合成 SSE 验证 SDK 事件和流解析，网络请求数为 0；模拟 usage 不计入线上消耗，也不用于性能结论。

Pi SDK/extension 用法先通过 Context7 `/earendil-works/pi` 定位，再核验本机 `0.85.1` 完整 `docs/sdk.md`、`docs/extensions.md` 和对应 SDK examples。Context7 未提供该精确版本的独立索引，本机文档和实际 dry run 为版本行为依据。相关在线文档入口为 [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) 和 [extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)，在线主分支不作为固定版本保证。

## Isolation and controls

- 当前模型固定为 `gpt-6-astra`，endpoint 为 `https://chatgpt.com/backend-api/codex/responses`。
- 使用当前 Pi 已有 OAuth 的内存副本，不修改认证文件、不刷新 token。模型网络刷新关闭，禁止任何非预期 endpoint 的网络访问。
- 每次创建新的 in-memory session，扩展配置只写入 `.tmp/fast-mode-sdk-live/case-N/agent/`。不加载用户其他扩展、skills、AGENTS.md、prompt templates 或工具，避免发送当前对话、仓库上下文和私人文件。
- 通过 SDK 原有设置统一指定 `transport: "sse"`，关闭自动重试和自动压缩上下文。HTTP body 的 zstd 压缩由真实 provider 完成，不是探针自建格式。
- Node.js 为 `v22.22.2`。provider 实际生成的 originator 为 `pi`，User-Agent 为 `pi (darwin 25.4.0; arm64)`，OpenAI-Beta 为 `responses=experimental`。没有伪装官方 Codex CLI。
- SDK 传入 thinking level `off`，实际模型映射后 wire `reasoning` 为 `{"effort":"low","summary":"auto"}`，9 次一致。不能把这个 SDK 级 off 写成 wire 没有 reasoning。本轮 usage 中 reasoning tokens 全为 0。
- 提示词与上一轮相同，每次要求输出 `0001` 至 `0330`，单空格分隔。共同的 `before_agent_start` 诊断 hook 将系统提示设为 `Follow the output format exactly.`，确保没有时间或 cwd 文本差异。
- 三组只在扩展开关和第三组的 routing hint 上不同。每次在扩展前后读取 payload 快照，并在 fetch 边界解压只读副本检查最终 body；实际转发的字节不修改。
- 去除 `service_tier` 及每个新 session 自带的 `prompt_cache_key` 后，9 次最终 body 的 SHA-256 完全相同，为 `3d1faeb826ecd1b50fe4151b632bdeda97b8f76cd264fa774002e6c0b3d6a87a`。保留 native session/cache headers，各次 session ID 不同；实际 cached input tokens 全为 0。
- 第三组仅通过正式 `before_provider_headers` hook 添加 `x-codex-routing-hint: model=gpt-6-astra;tier=priority`。其他两组最终请求确认不存在该头。
- 每次最多一次 wire attempt，共 9 次，没有重试。每次 105 秒总超时及输出字符上限，异常时停止；本轮均未触发。

顺序为 `off, extension, extension-hint, extension-hint, off, extension, extension, extension-hint, off`。每个连续三次的区组中，每种模式各出现一次，三个区组轮换位置；这是预先固定的顺序，不是随机试验。相邻请求间隔 2 秒。

## Wire and lifecycle checks

| Check | Off | Original extension | Extension plus hint |
| --- | --- | --- | --- |
| Isolated persisted toggle | `false` | `true` | `true` |
| Before original payload hook | no tier | no tier | no tier |
| After original payload hook | no tier | `priority` | `priority` |
| Final decoded wire body | no tier | `priority` | `priority` |
| Final routing hint header | absent | absent | `model=gpt-6-astra;tier=priority` |
| `after_provider_response` status | 200 | 200 | 200 |
| Native SDK reconstructed expected output | yes | yes | yes |

9 次均收到 `session_start` 和 `session_shutdown`，原扩展通过 `/fast` 命令设置的值与隔离配置文件一致，均只发送一个 user input item，没有工具。

## Individual measurements

Generation interval 为首个至最后一个 `response.output_text.delta` 到达的时间，采用 `performance.now()` 单调时钟。Visible tokens/s 为实际可见输出 token 数除以该区间。首个 delta 已携带少量输出，网络缓冲也会影响到达时刻，所以这些是相同计算口径的客户端观测，不是服务端逐 token 计时。

TTFT 从 provider 调用 fetch 前到首个可见文本 delta；Total 从同一起点到 `session.prompt` 完成。SDK 初始化、`/fast` 命令和两秒间隔不计入请求耗时。

| Run | Mode | TTFT, s | Generation, s | Visible tokens/s | Total, s |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | Off | 2.441 | 29.581 | 33.57 | 32.319 |
| 2 | Original extension | 2.006 | 15.757 | 63.02 | 17.921 |
| 3 | Extension plus hint | 2.334 | 15.790 | 62.89 | 18.279 |
| 4 | Extension plus hint | 2.084 | 15.728 | 63.14 | 18.036 |
| 5 | Off | 3.115 | 29.521 | 33.64 | 32.857 |
| 6 | Original extension | 2.502 | 16.178 | 61.38 | 18.687 |
| 7 | Original extension | 2.036 | 15.690 | 63.29 | 17.885 |
| 8 | Extension plus hint | 2.190 | 15.783 | 62.91 | 18.124 |
| 9 | Off | 3.803 | 29.521 | 33.64 | 33.521 |

9 次输出与固定目标字符串逐字匹配，长度均为 1649 字符，每次输入 51 tokens、输出 993 tokens、reasoning 0、cached input 0。实际消耗为输入 **459 tokens**、输出 **8937 tokens**，合计 **9396 tokens**。credits 或金额没有通过账单核验，不从客户端 cost 估值推断。

9 次 HTTP 状态均为 200，返回模型均为 `gpt-6-astra`，终态均为 `response.completed`。中间 tier 为 `auto`，终态 tier 全为 `default`。这个字段没有区分本轮明显不同的生成速率，不作为 Fast 生效或失败的单独判据。背景见 [default-tier investigation](openai-fast-mode-default-tier-investigation.md)。

## Limits and decision

当前证据足以将结论推进为“本仓库原扩展通过真实 Pi 0.85.1 HTTP/SSE 请求链路，在本次账户和 Astra 模型上测到了约 1.86 倍的生成速率”。无需再把是否提速完全悬置为“只有补 routing hint 的组合才测过”。

本轮没有覆盖默认 `auto` 可能选择的 WebSocket、长上下文、多轮连接复用、其他 thinking level、其他模型、其他账户，或用户所有其他扩展同时加载的情况。每组三次只能说明本轮观察，不能保证长期倍速，也不说明服务器内部一定使用了某个计费档位。

添加 routing hint 的边际差异仅约 0.7%，没有统计显著性分析。不能将其包装成优化收益；本任务不据此修改正式扩展。

## Artifacts and cleanup

- 脚本：`.tmp/openai-fast-mode-sdk-validation.mjs`。
- 离线检查结果：`.tmp/fast-mode-sdk-dry/results.json`，网络请求为 0。
- 线上原始摘要：`.tmp/fast-mode-sdk-live/results.json`，包含前后 hook、wire 摘要、逐次时间、usage 和 opaque response ID，无认证值或账户 ID。
- 隔离的扩展配置位于对应 `case-N/agent/`；真实用户配置和密钥未修改。
- 脚本拒绝覆盖已有结果，避免误重复消费；所有 session 均 shutdown/dispose。任务未启动监听服务，探针 Node 进程已退出，没有需释放的服务端监听端口。
- 本报告保留逐次核心数据，`.tmp/` 为本机辅助证据，不依赖它作为永久版本化文档。
