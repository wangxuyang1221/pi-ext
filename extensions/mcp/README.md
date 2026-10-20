# MCP extension

该扩展把 MCP server 的工具注册为 `mcp__<server>__<tool>`，支持 stdio、Streamable HTTP 和 legacy SSE。仓库锁定 `@modelcontextprotocol/sdk@1.29.0`，远程连接直接使用 SDK 的 `StreamableHTTPClientTransport` 或 `SSEClientTransport`，不需要额外代理进程。

Pi 从 `dist/index.js` 加载扩展。开发时只修改 `src/` 和测试，由构建生成 `dist/`。安装与仓库级说明见[根 README](../../README.md)。

## Configuration

扩展按以下顺序使用第一个存在的配置文件：

1. `PI_MCP_CONFIG` 指定的路径
2. 当前项目的 `.pi/mcp.json`
3. 全局的 `~/.pi/agent/mcp.json`

`PI_MCP_CONFIG` 的相对路径按当前项目目录解析。配置允许 JSON comments 和 trailing commas。较高优先级文件存在但无效时不会继续读取较低优先级文件，因此应先用 `/mcp status` 检查解析结果。

完整示例：

```jsonc
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["dlx", "@modelcontextprotocol/server-filesystem", "."],
      "cwd": ".",
      "connectTimeout": 30000,
      "requestTimeout": 60000,
      "maxRequestTimeout": 120000,
      "retry": {
        "enabled": true,
        "maxAttempts": 3,
        "baseDelayMs": 500,
        "factor": 2,
        "maxDelayMs": 5000,
        "retryAfterMaxMs": 300000,
        "background": true,
        "backgroundMaxDelayMs": 300000
      },
      "toolReplay": "never",
      "loggingLevel": "warning"
    },
    "remote": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      },
      "connectTimeout": 30000,
      "requestTimeout": 120000,
      "maxRequestTimeout": 300000,
      "toolReplay": "never"
    },
    "temporarily-disabled": {
      "disabled": true,
      "command": "example-mcp-server"
    }
  },
  "diagnostics": {
    "file": {
      "enabled": false,
      "path": ".pi/logs/mcp.jsonl",
      "maxBytes": 1048576
    }
  }
}
```

`headers` 和 `env` 的值必须是字符串。配置加载器不会展开 `${ENV_VAR}` 一类占位符；不要把占位写法误认为 secret injection。需要凭据时，应通过受控方式生成本地配置，限制文件权限，并确保配置未被提交。

### Compatibility

旧配置无需迁移即可继续使用：

- 省略 `type` 仍表示 `stdio`。
- `type: "http"` 是 `type: "streamable-http"` 的兼容别名。
- `type: "sse"` 保留给只提供 legacy SSE endpoint 的服务器。
- `timeout` 仍受支持。当新字段缺省时，它分别作为 `connectTimeout` 和 `requestTimeout` 的 fallback；显式的新字段优先。
- `disabled: true` 跳过对应服务器。

单个 server 配置无效时，该 server 会被标记为不可用，其他有效 server 仍可连接。`command` 必须是非空字符串，远程 `url` 必须使用 HTTP 或 HTTPS，timeout 必须是正整数，`maxRequestTimeout` 不能小于 `requestTimeout`。

## Deadlines

`connectTimeout` 是一次前台 `connectServer()` 的总 deadline，覆盖 initialize、首次 `tools/list`、重试 delay 和全部前台 attempt。它不是每一步分别拥有的 timeout。剩余时间不足以完成下一次 delay 时，前台重试会立即停止，资源会被关闭，后续恢复交给后台 supervisor。未配置 `connectTimeout` 或 legacy `timeout` 时，默认值为 30 s。

`requestTimeout` 控制 MCP SDK 的 tool request timer，默认值为 60 s。当 `maxRequestTimeout` 大于 `requestTimeout` 时，扩展会启用 SDK 的 `resetTimeoutOnProgress`：合法的 progress notification 可以重置当前 request timer，但不能突破 `maxRequestTimeout`。`maxRequestTimeout` 同时传给 SDK 并由扩展作为外层硬总 deadline；未配置时等于 `requestTimeout`。Pi 的 `AbortSignal` 会继续向下传递，用户取消优先于 retry 和 replay。Timeout 或取消发生后，扩展会关闭当前 client/transport，以终止 SDK signal 无法直接取消的底层 Streamable HTTP fetch；timeout 可由后台 supervisor 建立新连接，但不会重放原调用。

旧 `timeout` 只用于兼容。新配置应分别设置 connect 和 request deadline，使启动失败与长工具调用具有独立预算。

## Retry and recovery

默认 retry 配置如下：

| Field | Default | Meaning |
| --- | ---: | --- |
| `enabled` | `true` | 启用前台 retry |
| `maxAttempts` | `3` | 总 attempt 数，包含首次调用 |
| `baseDelayMs` | `500` | 指数退避基础值 |
| `factor` | `2` | 指数因子 |
| `maxDelayMs` | `5000` | 单次本地 delay 上限 |
| `retryAfterMaxMs` | `300000` | `Retry-After` 等待上限 |
| `background` | `true` | 前台失败后继续后台恢复 |
| `backgroundMaxDelayMs` | `300000` | 后台 delay 上限 |

本地 delay 使用 full jitter，即从 `0` 到当前指数上限随机选择。HTTP `Retry-After` 支持 delay-seconds 和 HTTP-date，并优先于本地 delay，但无论配置如何都不会超过 5 min。

可 retry 的情况包括临时 DNS/连接错误、timeout、连接重置、HTTP 408、429、500、502、503、504 和 Cloudflare 520–527。401、403、用户取消、非法配置和确定性 protocol error 不会 retry。

前台 attempt 受 `connectTimeout` 约束。预算耗尽后，启用的后台 supervisor 使用有界 delay 继续恢复；中间失败只进入 diagnostics，不连续弹出通知。`retry.enabled` 只控制前台 retry；要停止前台失败后的自动恢复，还需设置 `retry.background: false`。`/mcp reconnect <server>` 可立即重连指定 server；若后台 supervisor 正在等待或连接，手动操作会取消旧 generation 并立即启动新 attempt。若前台连接已经在进行，manager 会复用同一个 in-flight promise，避免并行重复连接。`/mcp reload` 和 shutdown 会取消 retry timer、pending request 和后台任务。

## Tool replay

重建 transport 与重放 tool call 是两项独立决策。默认 `toolReplay: "never"`：连接可以恢复，但原调用仍返回错误，由调用方决定是否再次执行。这是无法确认请求是否已送达时最安全的行为。

`toolReplay: "read-only"` 只允许满足以下条件的调用在重连后最多重放一次：

- tool 在初始 catalog 和重连后最新 catalog 中都明确声明 `annotations.readOnlyHint === true`
- 重连后的同名 route 仍归属于同一 server 和 tool
- 失败属于连接中断，而不是用户取消、request timeout 或 server business error
- 当前调用尚未发生过 replay

未知 annotation、写操作和可能有副作用的调用不会自动 replay。`readOnlyHint` 由 MCP server 提供，不是安全证明；只应对受信任的 server 启用此策略。即使只读操作，也可能产生计费、审计记录或访问外部系统。

## Tool call prefixes

所有 MCP 调用统一使用 `⌁`，包括搜索、非搜索工具及恢复的历史记录，不按工具名或服务名分类。前缀等待及运行中为 warning 黄色，成功为 muted 灰色，普通失败为 error 红色；可靠识别的中断和超时仍使用 warning 黄色。图标后保留一个空格，与其他工具的标题起始列对齐，不改变正文、参数、结果缩进或 `/mcp` 服务状态图标。

## Tool output limits

扩展传给模型的 MCP text（包括序列化后的 resource 等非 text block）使用 Pi 的默认边界：合计最多 50 KiB、2000 行，并且最多序列化 24 个非 text block。原生 image block 会继续按 image 传递。`structuredContent` 连同 `details` 的 JSON 序列化结果也限制在 50 KiB；超限时只保留有界 preview 与原始字节数。

工具 description 和实际截断 notice 使用英文，明确要求 agent 缩小查询范围或使用 server pagination。扩展不会把被截掉的 raw 完整输出写入临时文件或 diagnostics：这避免在用户未授权时把可能包含凭据或私有数据的响应持久化到额外位置。需要完整数据时，应使用 server 自身的 cursor/page/limit 参数分段获取，缩小过滤条件，或在确认数据范围后重新调用；不要把内存日志当作完整结果存储。

## Diagnostics

扩展不把 raw error、JSON log 或 stack 直接写到 Pi stdout/stderr。每个 server 使用有界内存 ring buffer 保存结构化事件：

- 最多 100 个 diagnostic events、合计 64 KiB
- 最多 100 行 stdio stderr、合计 64 KiB
- 单字段默认最多 4 KiB
- 短时间内相同错误按 fingerprint 合并并累计 repeats
- HTML error page 只保留有界摘要，例如 status、title 和有限的 Cloudflare Ray ID

HTTP response 提供有效 `Content-Length` 时，diagnostic 的 `originalBytes` 表示声明的完整正文大小；缺少该 header 且 reader 为满足边界而提前取消时，它只表示取消前已观察到的字节下界，不应视为精确总长度。

写入前会清理 ANSI、OSC 和控制字符，并对常见敏感字段脱敏，包括 Authorization、Cookie、API key、token、password、secret、URL credentials 与常见 query 参数。脱敏无法识别放在普通字段名中的所有秘密；diagnostics 仍应按敏感数据处理。

内存 ring 不写磁盘，并随当前扩展进程结束而消失。文件 sink 默认关闭，只有同时设置 `diagnostics.file.enabled: true` 和 `path` 才会创建文件。默认 `maxBytes` 为 1 MiB；达到边界时保留一个 `<path>.1` 备份，再写新的 active file。扩展在支持的文件系统上使用 `0600` 权限。写入或轮转失败会停用 sink，不影响 MCP request。

临时开启文件日志的示例：

```jsonc
{
  "mcpServers": {
    "remote": {
      "type": "streamable-http",
      "url": "https://example.com/mcp"
    }
  },
  "diagnostics": {
    "file": {
      "enabled": true,
      "path": ".pi/logs/mcp.jsonl",
      "maxBytes": 1048576
    }
  }
}
```

排错完成后应关闭 file sink，并按项目数据保留规则删除 active file 和 `.1` backup。分享日志前仍需人工检查。

### Stdio stderr

Stdio transport 使用 `stderr: "pipe"`。扩展在 connect 前接管 stderr，正确拼接跨 chunk 的行，把清理后的有界内容写入对应 server 的 diagnostics，不直接继承到 Pi 终端。连接成功不会因为 server 输出 stderr 而产生通知；连接失败时，最后 5 行会关联到对应 diagnostic event，并在启用 file sink 时写入其结构化 context。关闭、重连和 shutdown 会解除 listener。

### MCP logging

`loggingLevel` 可使用 `debug`、`info`、`notice`、`warning`、`error`、`critical`、`alert` 或 `emergency`。只有 server 在 initialize capabilities 中声明 `logging` 时，扩展才调用 MCP `logging/setLevel`；未声明该 capability 的 server 不会因为此配置而连接失败。Server 发送的 logging notifications 会进入同一个有界、脱敏的 diagnostics pipeline。该设置不改变 stdio stderr 的捕获规则。

## Commands

```text
/mcp
/mcp status
/mcp verbose
/mcp reload
/mcp reconnect <server>
/mcp logs [server]
/mcp-init
```

| Command | Behavior |
| --- | --- |
| `/mcp`、`/mcp status` | TUI 中显示按名称排序的紧凑清单，每个 server 一行，包含状态与 tool 数；RPC 保留原有状态通知 |
| `/mcp verbose` | 展开各 server 当前已连接的 tool 名称；RPC 使用有界纯文本通知 |
| `/mcp reconnect <server>` | 只重连指定 server；unknown/disabled server 会返回错误，后台 connecting/retrying 会被手动 attempt 取代 |
| `/mcp logs [server]` | 在 TUI/RPC 中查看最多 120 条内存 event 摘要；指定 server 时同时显示该 server 的有界 stderr |
| `/mcp reload` | 重新读取配置并重建全部连接；配置变更或需要彻底清理已删除 tool/server 时使用 |
| `/mcp-init` | 在项目中创建 `.pi/mcp.json` template |

后台首次恢复成功后，新发现的 tool 可以动态注册；schema 或 description 变化时，同名注册也会在当前会话更新。Pi 当前不能在原 extension instance 中注销已注册 tool，因此 server 删除 tool 或配置删除 server 后，应执行 `/mcp reload` 完成彻底清理。

### Startup and inventory UI

TUI 启动时，在输入框上方显示动态状态行：

```text
• Starting MCP servers (1/4): beta, gamma, mysql (1s • esc to interrupt)
```

进度表示本轮已结束的前台启动任务数，成功和失败都计入；禁用和无效配置不参与连接进度。待启动名称按名称排序，最多展示三个，其余省略。单服务使用 `Booting MCP server`。终端较窄时截断状态行。

所有前台启动任务结束后，状态行自动收起。全部成功不再追加启动汇总通知；失败显示 `MCP startup incomplete`，失败服务仍按原有策略决定是否后台恢复。配置缺失或无效的提示会保留。

启动期间按 Esc 只取消本轮尚未完成的连接及其前台重试，保留已经连接的服务。被取消的连接不会自动转入后台重试，可通过 `/mcp reconnect <server>` 重新连接。已经结束前台启动、正在后台恢复的服务不属于本轮待取消任务。取消会关闭相应 transport，因此界面收起后，进程清理仍可能需要短暂等待。

`/mcp` 的紧凑清单不再显示连接比例、attempt 或重试时间。`/mcp verbose` 展开工具名称，错误细节继续通过 `/mcp logs [server]` 查看。当前没有认证能力或资源清单的可靠数据源，因此不会输出原型中的 `Auth: Unsupported`、`Resources: (none)` 等模拟字段。

两种 TUI 清单都是查询时的快照，保存在会话历史中，但不进入模型上下文。快照仅包含经过清理的展示字段，不保存 transport 配置、headers 或 env。主题颜色跟随 Pi，支持深色与浅色终端。RPC 不创建动画或终端输入监听；JSON、print 模式保持静默。

### UI verification

```bash
pnpm exec vitest run extensions/mcp/__tests__
conda run --no-capture-output -n codex-py312 python extensions/mcp/__tests__/ui-host-smoke.py
pnpm run check
```

PTY smoke 使用真实 Pi 与正式 MCP extension，只连接本地 stdio fixture，覆盖启动成功、单服务、失败、Esc、手动重连、窄终端和浅色主题。HOME、配置与缓存隔离在仓库 `.tmp/` 下，正常结束后删除，并检查宿主及所记录的子进程已退出。

动画期间只运行一个 50 ms 定时器，每帧只请求重绘，不读取连接状态或发起 MCP 请求。状态行按当前终端宽度限制绘制工作，完成、取消、会话替换和退出时清理定时器与输入监听。

可用 `ui-host-smoke.py --baseline` 对照 Git HEAD 的启动实现，使用 `--measure` 测量工作区实现。应在相同环境交替多次运行；输出包含启动耗时、进程累计 CPU 时间与状态标题出现次数。标题出现次数只是 PTY 输出观测，不等同于精确帧数。`--baseline` 依赖 HEAD 仍是待比较的旧实现。

## Exa Streamable HTTP

Exa 官方 endpoint 是 `https://mcp.exa.ai/mcp`。该扩展原生支持 Streamable HTTP，推荐直接配置：

```jsonc
{
  "mcpServers": {
    "exa": {
      "type": "streamable-http",
      "url": "https://mcp.exa.ai/mcp",
      "headers": {
        "x-api-key": "YOUR_EXA_API_KEY"
      },
      "connectTimeout": 30000,
      "requestTimeout": 120000,
      "maxRequestTimeout": 300000,
      "retry": {
        "maxAttempts": 3,
        "baseDelayMs": 500,
        "factor": 2,
        "maxDelayMs": 5000,
        "retryAfterMaxMs": 300000,
        "background": true,
        "backgroundMaxDelayMs": 300000
      },
      "toolReplay": "never"
    }
  }
}
```

Exa 官方将 free plan 定位为 casual use；hosted MCP 可匿名使用，但匿名请求受 rate limit 限制。具体额度和认证政策可能变化，以 [Exa MCP documentation](https://docs.exa.ai/reference/exa-mcp) 的当前说明为准，不在这里固定数值。用于 production、提高 rate limits 或处理持续 429 时，应从 Exa dashboard 获取 API key，并通过 `x-api-key` header 发送。上例的 placeholder 不会自动替换，不能把真实 key 提交到仓库。

默认启用的工具是 `web_search_exa` 和 `web_fetch_exa`。需要改变工具集合时可使用 `?tools=...`；该参数会选择新的集合，因此应列出全部需要的工具：

```text
https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa,web_search_advanced_exa
```

如果未使用 API key，可删除整个 `headers` 对象。启用 Exa 的长时 agent tool 时，应按任务时长提高 `requestTimeout` 和 `maxRequestTimeout`，而不是取消总 deadline。

[Exa MCP issue #100](https://github.com/exa-labs/exa-mcp-server/issues/100) 记录过 Streamable HTTP 错误把整页 Cloudflare 520 HTML 带入错误输出的场景。本扩展会限制 response body，并把 HTML 压缩为 status、title 与有限 Ray ID 摘要；原始整页内容不进入用户通知。

### Why not mcp-remote

Exa 官方只在客户端不支持 remote MCP 时建议使用 `mcp-remote`。该扩展已经通过锁定版本 SDK 原生支持 Streamable HTTP 和 SSE，因此它不是处理 Exa 429、5xx、Cloudflare 520、DNS/TLS 错误或大段日志的首选修复。

增加 bridge 会多出一个 Node subprocess、stdio channel 和独立 lifecycle，无法修复上游限流或网络故障，还会增加排错面。只有对端要求 bridge，或运行环境确实无法直连远程 transport 时才考虑它。

## Security boundaries

`.pi/mcp.json` 能启动本地进程、设置环境变量、发送 HTTP headers，并向模型暴露可能有副作用的工具，应将其视为可执行配置。项目尚未获得 Pi trust 时，扩展会跳过项目级 `.pi/mcp.json`，`/mcp-init` 也会拒绝写入；由启动环境显式提供的 `PI_MCP_CONFIG` 和全局配置仍由操作者负责。

- 只在审查项目配置后批准 Pi 的 project trust prompt。
- 对不受信任的仓库优先使用全局配置，并避免启用项目配置。
- 不要提交 API key、Authorization、Cookie 或含凭据的 URL。
- 只连接受信任的 MCP endpoint，并审查 tool description、schema 和 annotations。
- `toolReplay: "read-only"` 不替代权限确认、server trust 或业务幂等设计。
- Diagnostics 的脱敏与边界处理不构成秘密存储方案。

Project trust 不是 server sandbox，也不能验证远程返回内容。Stdio server 继承到的权限和远程 tool 可执行的操作仍取决于本机环境、凭据和 Pi 权限模式。

## Troubleshooting

1. 运行 `/mcp`，确认 connection state 和 tool 数；需要工具名称时运行 `/mcp verbose`。
2. 运行 `/mcp logs <server>` 查看有界 event 摘要和该 server 的内存 stderr；需要持久化复现过程时，再临时启用 file logging。
3. 按错误类别处理：
   - 401/403：检查 endpoint 和认证 header；不要反复 retry。
   - 429：等待 `Retry-After`，或按服务商当前政策配置 API key。
   - 500/502/503/504/520–527：通常是临时 server、gateway 或 Cloudflare 故障；让有界 retry/background recovery 工作。
   - DNS、`fetch failed`、connection reset：检查 DNS、proxy、VPN、TLS 和本机网络。
   - Protocol/config：核对 URL 是否为 MCP endpoint、transport type、command、header/env 字符串与 timeout 范围。
   - Timeout：先判断是 connect 还是 tool request，再提高对应 deadline；不要仅扩大所有 timeout。
4. 使用 `/mcp reconnect <server>` 立即重试单个 server，避免影响其他健康连接。
5. 修改配置、删除 tool/server，或需要完整刷新 schema 时使用 `/mcp reload`。
6. 只有内存信息不足时才临时启用 file sink。复现后关闭，并在分享前再次脱敏。

若直连 Streamable HTTP 已经失败，不要先切换到 `mcp-remote`。先确认 HTTP status、`Retry-After`、底层 network code 和 endpoint 配置，bridge 通常只会隐藏原始故障位置。
