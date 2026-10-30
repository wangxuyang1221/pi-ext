# Search queries and result presentation

## Sub-features

| ID | 可观察结果 |
| --- | --- |
| `search-responses` | 真实生产工具对两条 query 分别 POST responses，indexed 参数进入请求并解析 SSE。 |
| `search-standalone` | 宿主注册的 standalone 工具发送独立网页动作，返回结果进入会话。 |
| `search-progress` | 批次先显示 1/2 queries completed，再显示 2 sources · 2 queries。 |
| `search-sources` | HTTP URL annotations 进入 details、来源计数与展开内容。 |
| `search-expand` | Ctrl+O 展开显示完整来源 URL，再次按下折叠。 |
| `search-error` | HTTP 503 经生产错误分类后显示具体诊断，tool result 的 isError 为 true。 |
| `search-timeout` | 服务端 response.failed timeout 显示独立超时卡片，reload/冷恢复保留；真实调用方 deadline 终止未结束的 HTTP body，分类为 timeout，下一次请求可成功。 |
| `search-cancel` | 等待真实连接建立后按 Esc，服务器观察客户端关闭连接，TUI 显示 interrupted。 |

## Drive

完成 [Launch 与 Doctor](../SKILL.md) 后运行：

```bash
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run search-production
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run search
```

`search-production` 加载源码扩展，只有模型服务和搜索 HTTP 服务使用合成数据。它把批次、展开、standalone、非法参数、503、timeout、Esc 与恢复后的成功动作连成一次旅程。`requests.json` 保存原始请求正文和 thread-id；`events.jsonl` 保存模型上下文、工具结果和 settled 事件；`journey.json` 保存按键、画面、断言及监听端口关闭结果；`terminal-*.ansi` 保存原始输出。

`search` 是生产 renderer 的补充展示夹具，execute 返回固定结果，覆盖 2/5 进度、17 sources、宽度、部分失败与重启。它不证明请求传输。TUI timeout 旅程使用服务端超时事件。`timeout.test.ts` 另用真实 loopback 服务保持响应 body 不结束，连接建立后由调用方真实计时器触发 TimeoutError signal，生产 responses/standalone 请求退出、服务端观察连接关闭，随后同 transport 的新请求成功。两项证据分别记录协议层计时退出和 TUI 分类展示。

产品没有默认客户端 deadline 或对应配置，公开接口接收调用方的 AbortSignal。上述测试证明调用方 deadline 的传递和退出，不表示未传 signal 的请求会自动超时。

`responses-stream.test.ts` 补验协议边界：SSE 可仅用 JSON `type` 标识事件，文本、引用、搜索调用和 usage 均须保留；failed、incomplete 和 error 拒绝部分结果；EOF 或 `[DONE]` 不能代替 completed。收到 completed 后取消仍未关闭的 body，读流的 AbortError 原样传播。该测试使用内存流，生产 PTY 旅程不覆盖这些帧组合，分别记录证据层级。

```bash
pnpm test extensions/codex-search/__tests__/responses-stream.test.ts extensions/codex-search/__tests__/timeout.test.ts extensions/codex-search/__tests__/codex.test.ts extensions/codex-search/__tests__/renderers.test.ts extensions/codex-search/__tests__/compact-renderers.test.ts
```

## Remote boundary

本地结果只证明调用与呈现。`search-responses`、`search-standalone` 的真实服务鉴权、freshness 和搜索质量须按 [Manual live acceptance](live.md) 独立执行；未执行时远端分支记为 unverified。
