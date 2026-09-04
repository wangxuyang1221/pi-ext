# MCP connection resilience optimization plan

- Status: `Complete`
- Scope: `extensions/mcp`
- Upstream Pi changes: `None`
- Delivery method: `Red-Green-Refactor`
- Final verification: `pnpm run check`

## Objective

在不修改上游 Pi 的前提下，完整优化 MCP extension 的连接可靠性、错误诊断、终端展示和生命周期管理。重点解决 Exa 等 Streamable HTTP 服务网络波动时无重试、错误正文过大、重复日志和 TUI 被污染的问题，同时补齐 stdio 诊断、后台恢复和安全重放能力。

完成后，MCP 网络故障应退化为一条短、可操作的状态信息。原始堆栈、远端 HTML 和子进程 stderr 只能进入有界、脱敏的诊断缓存或显式启用的日志文件。

## Execution rules

- 每个阶段先写失败测试，再实现最小改动，最后重构。
- 每完成一个 checkbox，立即更新本文档。阶段退出条件未满足时，不进入下一阶段。
- 测试使用本地 fixture、注入 fetch 和 fake timers，不依赖真实 Exa 或其他公网服务。
- 修改 `src/`、对应的 `__tests__/` 和文档。`dist/` 只由构建生成，不手工编辑。
- 保持现有 `mcp.json` 配置、`type: "http"` 别名和 `mcp__<server>__<tool>` 名称兼容。
- 默认不向 stdout 或 stderr 写扩展日志。TUI、RPC、JSON 和 print 模式共用这一规则。
- 普通 MCP 工具调用默认不自动重放。只有明确满足安全条件时才允许最多重放一次。
- 任何诊断数据在进入 UI、内存缓存或文件前都必须完成截断、控制字符清理和凭据脱敏。

## Completion contract

| Area | Required result |
| --- | --- |
| Terminal safety | MCP extension 默认不直接调用 `console.*`；TUI 中不出现 raw JSON、stack 或远端 HTML |
| Error reporting | 同一故障只产生一条用户通知，详细诊断可通过命令查看 |
| HTTP recovery | initialize 和 `tools/list` 对瞬时网络错误、429 和临时 5xx 执行有界重试 |
| Error fidelity | 保留 HTTP 状态、`McpError.code`、`Error.cause` 和底层网络错误码 |
| Stdio diagnostics | 子进程 stderr 被捕获到有界 ring buffer，不直接继承到终端 |
| Lifecycle | 意外 close 及时更新状态；reload、shutdown 和旧回调不会复活或删除新连接 |
| Timeout | connect、工具请求和重试等待都有明确、可取消的 deadline |
| Replay safety | 有副作用或未知工具不会因响应丢失而自动执行第二次 |
| Background recovery | 初始连接失败后可后台恢复并动态注册首次发现的工具 |
| Mode safety | JSON/RPC stdout 保持协议纯净，print 输出不混入 MCP 日志 |
| Packaging | `pnpm run check` 全部通过，发布包包含最新生成产物 |

## Design baseline

### Pre-implementation failure path

1. `extensions/mcp/src/index.ts` 的 `session_start` 并行调用 `manager.connectServer()`。
2. `extensions/mcp/src/client.ts` 为 Exa 创建 `StreamableHTTPClientTransport`。
3. SDK 发送 initialize POST，再执行 `tools/list`。
4. 网络或 HTTP 错误进入 `client.ts` catch，并调用 `logEvent()`。
5. `extensions/mcp/src/logger.ts` 通过 `console[level]()` 直接写宿主进程 stdout 或 stderr。
6. `index.ts` 又通过 `ctx.ui.notify()` 展示同一错误。
7. 工具调用失败还会在 manager、tool wrapper 和 Pi 失败工具卡中重复出现。

### Why Exa amplifies the problem

- 当前 Exa 使用远程 Streamable HTTP，经过 DNS、TLS、Cloudflare 和远程会话，网络失败面比本地 stdio 多。
- `client.ts` 只为旧 SSE transport 开启超时重试，HTTP 的最大重试次数为零。
- MCP SDK 1.29.0 会把非 2xx HTTP 响应的完整正文放入 `StreamableHTTPError.message`。
- Exa 曾返回 Cloudflare 520 HTML。现有 logger 会把整段正文和 stack 序列化为单行 JSON。
- stdio transport 当前使用 `stderr: "ignore"`，本地服务器诊断完全丢失，进一步放大了两类 transport 的展示差异。

## Fixed technical decisions

### Diagnostics

- 新增可注入的 diagnostics service，取代全局 console sink。
- 每个服务器默认保存最近 100 个事件，同时限制为 64 KiB，先达到任一上限即淘汰最旧事件。
- stdio stderr 默认保存最后 100 行，同时限制为 64 KiB。
- 用户通知限制为 300 个可见字符。
- 单个结构化日志字段限制为 4 KiB，并记录截断前字节数。
- 文件日志默认关闭，只能通过显式配置启用。
- 文件日志使用单文件加一个备份文件的有界轮转；日志写入失败后禁用该 sink，避免递归故障。

### Error model

统一错误结构至少包含：

```ts
interface McpNormalizedError {
  category:
    | "cancelled"
    | "timeout"
    | "dns"
    | "connection"
    | "auth"
    | "rate-limit"
    | "session-expired"
    | "http-transient"
    | "protocol"
    | "config"
    | "server"
    | "unknown";
  message: string;
  retryable: boolean;
  code?: string | number;
  httpStatus?: number;
  retryAfterMs?: number;
  detail?: string;
  causeChain?: Array<{ name?: string; message: string; code?: string | number }>;
  truncated?: boolean;
  originalBytes?: number;
}
```

错误判断顺序固定为：SDK/HTTP 类型和错误码、`Error.cause`、标准网络 code、最后才是小写后的消息兼容匹配。

### Retry policy

- 一次 `connectServer()` 的 `connectTimeout` 是包含 initialize、首次 `tools/list`、退避等待和所有前台尝试的总 deadline。
- 前台最多尝试三次，使用 full jitter；基础延迟 500 ms，指数因子 2，单次延迟上限 5 s。
- `Retry-After` 优先于本地退避，但等待上限为 5 min。
- DNS 临时错误、连接超时、连接重置、HTTP 408、429、500、502、503、504 和 Cloudflare 520 系列可以重试。
- 401、403、非法 URL、配置错误和确定性协议错误不重试。
- 初始连接耗尽后进入后台恢复。后台等待依次扩大并封顶为 5 min，手动重连可以立即触发一次新尝试。
- 所有 sleep 使用注入 scheduler、AbortSignal 和 `unref()` timer。

### Tool replay

- transport 重建与工具调用重放是两个独立动作。
- 默认策略为 `never`，即重连成功后仍向调用方返回可重试错误。
- 可选策略 `read-only` 仅允许 `annotations.readOnlyHint === true` 的工具最多重放一次。
- 用户取消、请求超时、业务错误和无法确认请求是否送达的写工具不自动重放。

### Server state

```ts
type McpConnectionStatus =
  | "connecting"
  | "connected"
  | "degraded"
  | "retrying"
  | "offline"
  | "disabled";
```

每个服务器状态保存 `lastError`、`attempt`、`lastAttemptAt`、`nextRetryAt`、当前 Client identity 和 lifecycle generation。

## Work plan

### 1. Baseline and regression harness

- [x] 在 `extensions/mcp/__tests__/index.test.ts` 增加失败测试，复现启动失败时 raw console JSON 与 `ctx.ui.notify()` 同时出现
- [x] 在 `extensions/mcp/__tests__/client.test.ts` 增加 `fetch failed`、`Connection closed`、`ECONNRESET` 和大小写不同的 `Not connected` 用例，证明现有字符串匹配无法稳定重连
- [x] 增加 HTTP 429、HTTP 503 和 HTTP 520 加大段 HTML 的失败用例，锁定错误正文无界和 HTTP 无重试问题
- [x] 增加工具调用失败用例，证明同一错误会被 manager 和 tool wrapper 重复记录
- [x] 增加 SDK close ownership 用例，使 mock Client 在 `close()` 时真正关闭 transport，暴露当前重复 close 行为
- [x] 记录全部新增测试的当前失败原因，确认每个失败都对应本文档中的一个目标行为

Exit criterion: 新增用例稳定变红，现有测试仍保持原状态，测试不访问公网。

### 2. Diagnostics core

- [x] 新增 `extensions/mcp/src/diagnostics.ts`，实现 `McpDiagnostics` 接口、结构化事件、每服务器 ring buffer 和查询 API
- [x] 实现统一的字符串边界处理，按 UTF-8 字节和可见宽度限制 UI、字段及 ring buffer 大小
- [x] 实现 ANSI、OSC、C0/C1 控制字符清理，保留普通换行和可读文本
- [x] 实现凭据脱敏，覆盖 URL query、Authorization、Cookie、API key、access token、password、secret 及 env/header 对象
- [x] 实现 HTML 错误页摘要，提取 HTTP 状态、`title` 和有限的 Cloudflare Ray ID，丢弃其余 DOM
- [x] 实现 `Error.cause` 有界遍历，最多保留固定层级且防止循环引用
- [x] 实现事件指纹和去重窗口，累计重复次数但只触发一次用户通知
- [x] 为 diagnostics 增加无抛出保证，使序列化、脱敏或 sink 失败不会影响 MCP 主流程
- [x] 将 `McpClientManager`、配置加载器和 extension 入口改为接收同一个 diagnostics 实例
- [x] 移除生产路径中的默认 `console.*` 输出；若 `logger.ts` 无剩余职责则删除并更新导入

Exit criterion: diagnostics 单元测试转绿，MCP extension 在所有模式下默认不调用 console sink。

### 3. Optional file sink

- [x] 为 diagnostics 增加显式启用的文件 sink，默认配置不创建任何文件
- [x] 在写入前复用同一套脱敏、控制字符清理和字段截断逻辑
- [x] 实现有界 append 和单备份轮转，避免长时间运行导致日志无限增长
- [x] 使用串行写队列避免并发事件互相覆盖，并在 shutdown 时等待已排队写入完成
- [x] 文件打开、写入或轮转失败后停用 sink，并通过 diagnostics 状态暴露一次简短故障
- [x] 增加测试验证日志中不包含 header 值、URL 凭据、环境变量密钥或未截断的远端正文

Exit criterion: 未启用时零文件副作用；启用时日志有界、脱敏且并发写入顺序稳定。

### 4. Stdio diagnostics

- [x] 将 `StdioClientTransport` 配置改为 `stderr: "pipe"`，并在 `client.connect()` 前挂载监听器
- [x] 实现跨 chunk 行缓冲，正确处理早期输出、半行、超长单行和尾部无换行内容
- [x] 将 stderr 写入对应服务器的有界 diagnostics buffer，成功连接时不产生用户通知
- [x] 连接失败时把清理后的最后几行关联到本次连接诊断，而不是直接写终端
- [x] 在连接关闭、失败重试和 shutdown 时解除监听并清空临时行缓冲
- [x] 注册 MCP logging notification handler，并在服务端声明 logging capability 时按配置设置日志级别
- [x] 为早期 stderr、连续大输出、控制字符、凭据和监听器清理增加本地 stdio fixture 测试

Exit criterion: stdio 诊断可通过内存查询获得，任何子进程 stderr 都不会直接进入 Pi 终端。

### 5. Typed configuration and compatibility

- [x] 将 `McpServerConfig` 重构为 stdio、SSE 和 Streamable HTTP 判别联合，同时保留 `type: "http"` 兼容别名
- [x] 增加 `connectTimeout`、`requestTimeout`、`maxRequestTimeout`、retry、tool replay 和 file sink 的可选配置类型
- [x] 将旧 `timeout` 作为新 timeout 字段的兼容 fallback，并为冲突字段定义稳定优先级
- [x] 在 `config.ts` 校验非空 command、HTTP/HTTPS URL、正整数 timeout、字符串 header/env 和 retry 数值范围
- [x] 将配置加载结果改为区分 missing、invalid、empty 和 loaded，避免所有失败都表现为“未找到配置”
- [x] 对单个服务器的非法配置生成服务器级状态，其余有效服务器继续连接
- [x] 保证配置错误路径、URL 和字段值在进入 diagnostics 前完成脱敏
- [x] 为旧配置、完整新配置、部分非法服务器和敏感字段错误增加兼容测试

Exit criterion: 现有配置无需修改即可工作，非法服务器不会拖垮其他服务器，错误不泄露配置值。

### 6. Structured error normalization

- [x] 在 diagnostics 或独立模块中实现 `normalizeMcpError()`，产出固定的 `McpNormalizedError`
- [x] 识别 `StreamableHTTPError.code`、`McpError.code`、AbortError、TimeoutError 和 Node/Undici cause code
- [x] 将 DNS、连接重置、拒绝连接、TLS、请求超时、连接关闭和 session 失效映射到稳定类别
- [x] 将 HTTP 401/403 映射为 auth，429 映射为 rate-limit，可恢复 5xx 映射为 http-transient
- [x] 通过受控 fetch wrapper 捕获 HTTP status 和 `Retry-After`，但保持 SDK 的认证处理语义
- [x] 把字符串匹配缩减为兼容兜底，先统一大小写并限制匹配范围
- [x] 为每个类别增加 table-driven 测试，断言 category、retryable、code、summary 和脱敏后的 detail

Exit criterion: 所有已知错误都获得稳定类别和重试决策，`fetch failed` 能显示底层 cause code。

### 7. Connection state and SDK lifecycle

- [x] 在 `types.ts` 增加服务器状态和状态快照类型，在 manager 中建立每服务器状态表
- [x] 创建 Client 后立即注册 `client.onerror`，将带外错误记录为 diagnostics 并在必要时标记 degraded
- [x] 注册 `client.onclose`，仅当回调 Client identity 仍等于当前连接时标记 offline
- [x] 为主动关闭设置 closing 标记或 generation，使 reload、shutdown 和重试清理不产生意外离线通知
- [x] 在每次状态转换时原子更新 attempt、时间、lastError 和 nextRetryAt
- [x] 保留离线服务器的配置、工具路由和最后诊断，让后续连接能够恢复
- [x] 修复 `reconnecting` Promise 的 finally，仅当 map 当前值仍是同一个 Promise 时才删除
- [x] 修复旧 Client 的迟到 onclose/onerror，确保它们不能影响已经建立的新连接
- [x] 将 `isServerConnected()`、`getConnectionCount()` 和 `/mcp status` 数据源迁移到新状态模型

Exit criterion: 状态转换测试覆盖正常连接、带外 error、意外 close、主动 close、重连和旧回调竞态。

### 8. Unified deadlines and resource cleanup

- [x] 用 deadline helper 替换独立的 connect 和 `tools/list` timeout，使一次 `connectServer()` 共用总 `connectTimeout`
- [x] 将剩余 timeout 和 AbortSignal 传给 `client.connect()` 与首次 `listTools()`
- [x] 将配置的 `requestTimeout`、`maxRequestTimeout` 和 Pi signal 传给 `client.callTool()`
- [x] 保留外层 deadline 作为底层 I/O 保险，超时后主动关闭当前 Client 以中止 transport fetch
- [x] 为 pending connection 保存 controller、deadline timer、Client、transport、stdio listener 和 generation
- [x] 实现可取消并 `unref()` 的 scheduler sleep，替换当前普通 `setTimeout` 退避
- [x] 正常清理只调用 `client.close()`，仅在其抛错时调用 `transport.close()` 兜底
- [x] 让 cleanup 幂等，确保失败 catch、onclose、disconnect 和 shutdown 可以安全竞争
- [x] 在 `disconnectAll()` 中取消连接、请求、sleep 和后台任务，并等待必要的资源清理而不等待完整 timeout

Exit criterion: fake timer 测试中不存在遗留 timer；shutdown 在固定短时间内完成；transport 只关闭一次。

### 9. HTTP retry and background recovery

- [x] 新增 `extensions/mcp/src/retry.ts`，实现错误决策、full jitter、`Retry-After` 和 deadline-aware scheduler
- [x] 将 initialize 和首次 `tools/list` 作为一个安全连接尝试，每次重试使用新的 Client 和 transport
- [x] 在 `connectTimeout` 剩余时间内最多进行三次前台尝试，超出 deadline 时停止
- [x] 对 retryable 网络错误、408、429 和临时 5xx 重试，对 auth、config 和 protocol 错误立即停止
- [x] 重试期间更新状态为 retrying，并设置 attempt 和 nextRetryAt，不为中间失败弹出通知
- [x] 重试耗尽后生成一条有界尝试摘要，并只触发一次最终失败通知
- [x] 为前台失败的服务器启动后台 supervisor，按有界退避继续恢复
- [x] 手动重连可以取消等待并立即触发新 generation，旧后台任务不得继续写状态
- [x] 后台恢复成功后发出一次连接事件，供 extension 动态注册首次发现的工具
- [x] shutdown 时停止 supervisor，验证 timer 已取消且连接不会在关闭后复活

Exit criterion: HTTP retry 矩阵、deadline、手动唤醒、后台恢复和 shutdown 测试全部转绿。

### 10. Safe tool reconnect and replay

- [x] 在工具发现阶段保留 MCP annotations，包括 `readOnlyHint`
- [x] 将工具失败处理拆成错误归一化、连接状态处理、transport 重建和可选工具重放
- [x] 使用 `McpError.code === ErrorCode.ConnectionClosed` 作为主要断线判断，字符串仅作兼容兜底
- [x] 默认只重建连接并返回可重试错误，不自动重放原工具调用
- [x] 实现可选 `read-only` 策略，只允许明确标注只读的工具最多重放一次
- [x] 将用户取消、请求 timeout、服务端业务错误和写工具排除在自动重放之外
- [x] 用明确的 call attempt context 替代松散递归，保证同一工具调用最多重放一次
- [x] 在响应是否到达不确定时优先避免重复副作用，并在错误 details 中标记调用结果未知
- [x] 增加只读成功重放、未知 annotation、写工具、响应丢失和重放再次失败测试

Exit criterion: 测试证明未知或有副作用工具不会执行第二次，只读策略下最多执行两次总调用。

### 11. Dynamic tool synchronization

- [x] 抽取 `syncServerTools()`，统一处理初次连接、前台重连和后台恢复发现的工具
- [x] 后台首次连接成功后调用 `pi.registerTool()` 动态注册新工具，并更新 `registeredToolNames` 与 `toolToServerName`
- [x] 已注册工具在重连后继续复用原 wrapper，由 manager 使用最新工具定义和连接
- [x] 对服务器已删除但 Pi 暂时无法注销的工具，在 wrapper 中返回明确的工具不存在错误
- [x] 对工具 schema 或描述变化定义本会话行为，并通过 `/reload` 完成需要彻底替换的情况
- [x] 增加初始失败后恢复、重复恢复、工具新增、工具删除和 schema 变化测试

Exit criterion: 初始离线服务器恢复后无需 `/reload` 即可调用新增工具，重复恢复不会重复注册。

### 12. Pi error propagation

- [x] 保留 MCP tool result 的 content、structuredContent、details 和服务端 `isError`
- [x] 注册限定于 MCP 工具的 `tool_result` handler，把 `details.isError === true` 映射到 Pi 顶层 `isError`
- [x] 确保业务错误不误触发连接重试或后台 supervisor
- [x] 保持错误 content 对模型可见，同时让 TUI 使用紧凑失败摘要
- [x] 增加服务端业务错误、结构化错误、非文本 content 和正常结果测试

Exit criterion: Pi session 中业务错误具有顶层 `isError: true`，结果内容和 details 未丢失。

### 13. Commands and UI integration

- [x] 将启动、重试耗尽、后台恢复和手动操作的用户通知集中到 `index.ts`
- [x] 扩展 `/mcp status`，显示状态、最近错误类别、尝试次数和下次重试时间，不显示敏感 detail
- [x] 增加 `/mcp reconnect <server>`，只操作指定服务器并处理 unknown、connecting、connected 和 retrying 状态
- [x] 增加 `/mcp logs [server]`，读取内存 diagnostics 并使用宽度安全、有界的 TUI 组件展示
- [x] 更新 footer 以表达 online、configured、tool count 和 retrying 数量，保持单行紧凑
- [x] 后台恢复成功时只产生一次短通知，避免再次显示完整启动摘要
- [x] 使用 `ctx.mode` 和 `ctx.hasUI` 选择展示行为，确保无 UI 模式没有直接 console fallback
- [x] 为通知去重、命令参数、状态表、日志展示宽度和非 TUI 模式增加入口测试

Exit criterion: 每个故障最多一条用户通知；状态和详细诊断按需可查；所有渲染行不超过可用宽度。

### 14. Documentation and cleanup

- [x] 更新根 `README.md` 的 MCP 配置、timeout、retry、diagnostics、状态和命令说明
- [x] 扩充 `extensions/mcp/README.md`，记录 Exa 的 Streamable HTTP 推荐配置、匿名限额、API key header 和排错流程
- [x] 说明 `mcp-remote` 只用于缺少远程 transport 支持的客户端，不是当前日志或网络稳定性问题的首选修复
- [x] 记录文件日志默认关闭、日志边界、脱敏规则和数据保留行为
- [x] 记录工具自动重放默认关闭及 `read-only` 策略的副作用边界
- [x] 删除旧字符串错误分支、不可取消 sleep、重复 close、重复日志调用和失效注释
- [x] 确认新增 source comments、public API doc comments、log messages、structured keys 和 test names 使用 English
- [x] 检查最终 diff，确认没有 API key、Authorization、真实服务器响应或其他本机敏感数据

Exit criterion: 文档与最终配置/API 一致，源码不存在未使用的旧日志或重连路径。

### 15. Final verification

- [x] 运行 MCP extension 定向测试并确认所有新增 Red-Green-Refactor 用例通过
- [x] 运行完整 `pnpm test`，确认其他 extensions 没有回归
- [x] 运行 `pnpm run typecheck`，确认判别联合、SDK error 类型和 lifecycle callback 类型正确
- [x] 运行 `pnpm run build`，由源码重新生成 MCP `dist/`
- [x] 运行 `pnpm run package:check`，确认发布包包含最新 MCP 产物且无额外日志文件或 fixture
- [x] 运行最终 `pnpm run check`，确认 typecheck、test、build 和 package check 全部通过
- [x] 使用本地故障 fixture 做 Pi TUI smoke test，确认终端无错位、无 raw JSON、无 stack、无大段 HTML且无重复错误
- [x] 在 JSON 和 RPC 模式解析全部 stdout 记录，确认不存在 MCP extension 插入的非协议内容
- [x] 在 retry sleep 中触发 reload 和退出，确认进程及时结束且无后台连接复活
- [x] 更新本文档 checkbox 和 Status，记录任何未完成项及其原因

Exit criterion: `pnpm run check` 成功，全部 completion contract 均有自动测试或明确的 smoke test 证据。

## Implementation evidence

- Red baseline：实施前新增的 5 个基线用例稳定暴露默认 console 污染、Streamable HTTP 无重试、超大 HTTP 正文、非安全工具重放和重复 transport close；随后按 Red-Green-Refactor 转绿。补充的“恰好 4 KiB 且不结束的 HTTP body”用例也先复现 hang，再由 bounded reader 修复。
- MCP 定向验证：`pnpm exec vitest run extensions/mcp/__tests__` 通过，10 个 test files、176 个 tests 全部成功，fixture 仅使用 loopback HTTP 和本地 stdio，不访问公网。另以继承的 `PI_SUBAGENT=1` 运行 client、index、integration 和 real-mode smoke 共 61 个 tests，确认测试会隔离并恢复该环境变量，spawn 的真实 Pi 进程也不会误入 subagent startup 分支。
- 全仓验证：最终 `pnpm run check` exit code 为 0；typecheck 通过，Vitest 为 46 files passed、1 个既有可选 subagent integration file skipped，614 tests passed、1 skipped。
- 构建与发布：`pnpm run build` 从 `src/` 重新生成 `dist/`；旧 `logger` source 与 generated artifacts 已删除。`pnpm run package:check` 验证 6 个 Pi extension entries、1 个 theme、7 个 MCP generated modules、runtime exports、发布排除边界及 orphan generated artifact 检测。
- TUI smoke：`integration.test.ts` 使用真实 extension 入口、真实 `McpClientManager`/SDK、本地 HTTP 520 fixture 和 mock Pi host 验证 TUI API/renderer 边界；另通过 macOS `/usr/bin/script` PTY 实际启动仓库锁定的 Pi TUI，执行 `/mcp status` 与 `/quit`。PTY transcript 为 16,798 bytes，包含有界 startup/status 摘要，且未出现 raw HTML、私有正文、stack 或 raw JSON log；进程和 fixture 均正常退出。
- Mode isolation：`pi-modes-smoke.test.ts` 实际启动仓库锁定的 Pi CLI，JSON、RPC 和 print 三种模式都连接同一个本地 HTTP 520 failure fixture，并断言 fixture 收到 3 次 `initialize`。JSON/RPC stdout 全部可按 JSONL 解析；RPC 真实提交 `/mcp status`，同时验证 `prompt` response 和 MCP `extension_ui_request`; print stdout 保持为空。三种模式 stderr 均为空，520 私有正文不外泄。
- Lifecycle：本地 fixture 与 fake scheduler 覆盖 shutdown、manual reconnect、stale callback、delayed old close、pending HTTP abort、stdio child 回收和 supervisor 停止；验证无 timer、连接或子进程复活。另一次真实 Pi PTY smoke 在 60 秒 background retry sleep 中执行 `/mcp reload`，fixture 观察到 reload 前后共 2 次 `initialize`，随后 `/quit`；整个进程在 3 秒内退出，证明 reload 与 exit 都会取消旧 sleep。
- HTTP attribution：每个非 2xx response 在 bounded fetch 中获得内部 opaque token，token 随 SDK error body 返回并映射到有界 `Map`，归一化前按 token 精确取回 status、`Retry-After` 和摘要。并发同为 429、但正文与 `Retry-After` 不同的两个 tool request 验证不会串线；内部 token 在任何 diagnostic 或用户错误生成前被移除。
- Replay：重连后再次读取最新 catalog 和 route owner；只有两次 catalog 都为显式 read-only 时才最多 replay 一次。取消、timeout、业务错误、写工具、annotation 变化和第二次响应丢失均不会继续 replay。
- Output policy：模型可见 text/序列化非 text 输出限制为 50 KiB、2000 行和 24 个序列化 block，完整 `details` JSON 也限制为 50 KiB。出于私有数据落盘风险，被截断 raw output 不自动持久化；英文工具提示要求缩小结果或使用 server pagination。
- Footer scope：MCP extension 通过独立 `mcp` status key 发布完整计数，Pi 默认 UI 可消费；仓库的 `codex-ui` profile 按既有设计只消费 Fast Mode 与 permissions，因此不会额外展示 MCP status。完整状态始终可由 `/mcp status` 查询。
- Cleanup：最终 `git diff --check`、repository language 扫描、敏感词人工复核、临时目录扫描和本地 fixture/process 扫描均无异常；没有真实 API key、Authorization 值或远端响应进入变更。`schema.ts` 的 source/doc comments 与 `schema.test.ts` 的 test names/comments 也统一为 English。
- 未完成项：无。

## How to test

### Target behavior

- Exa 风格 `fetch failed`：扩展在 deadline 内有限重试，最终只展示一条短错误；diagnostics 保留底层网络 code。
- Cloudflare 520 HTML：UI 不超过 300 个可见字符，日志字段不超过 4 KiB，保留 HTTP 520 和有限 Ray ID。
- HTTP 429：按 `Retry-After` 等待；401、403 和非法配置不重试。
- Stdio early stderr：终端不直接显示；内存 diagnostics 保存脱敏后的尾部内容。
- Unexpected close：状态立即进入 offline 或 retrying；旧 Client 回调不影响新连接。
- Tool replay：未知或写工具不自动执行第二次；显式只读策略最多重放一次。
- Shutdown during backoff：所有 timer、fetch、Client 和 transport 被取消，进程及时退出。
- Initial offline recovery：后台连接成功后动态注册工具，无需 `/reload`。
- Mode isolation：TUI、print、JSON 和 RPC 的 stdout 均不包含 MCP extension 自行打印的日志。

### Automated verification

```bash
pnpm exec vitest run extensions/mcp/__tests__
pnpm run typecheck
pnpm test
pnpm run build
pnpm run package:check
pnpm run check
```

预期结果：命令全部以 exit code 0 完成；构建只更新生成的 `dist/`；测试不访问公网。

### Manual smoke verification

- 使用本地 Streamable HTTP fixture 模拟超时、429、503、520 HTML 和连接中断。
- 使用本地 stdio fixture 模拟启动前 stderr、异常退出和长输出。
- 在 Pi TUI 中观察启动失败、工具失败、后台恢复和手动重连。
- 在重试等待中执行 `/mcp reload` 和退出。
- 分别启动 JSON/RPC 模式，并用 JSON parser 校验 stdout 的每条记录。

预期结果：TUI 不出现布局污染和原始堆栈；同一故障只有一条用户通知；按需命令能读取有界诊断；退出后没有残留 timer 或子进程。

## Expected file map

| Path | Planned responsibility |
| --- | --- |
| `extensions/mcp/src/diagnostics.ts` | 错误归一化、清理、脱敏、ring buffer、去重、可选文件 sink |
| `extensions/mcp/src/retry.ts` | 重试决策、full jitter、`Retry-After`、可取消 scheduler |
| `extensions/mcp/src/types.ts` | 判别配置、服务器状态、工具 annotations、诊断类型 |
| `extensions/mcp/src/config.ts` | 配置加载、兼容 fallback、字段校验和结构化加载结果 |
| `extensions/mcp/src/client.ts` | Client/transport 生命周期、deadline、状态、连接与安全重放 |
| `extensions/mcp/src/index.ts` | Pi lifecycle、动态工具同步、命令、footer 和唯一用户通知出口 |
| `extensions/mcp/src/logger.ts` | 已删除；diagnostics service 取代原 console sink |
| `extensions/mcp/__tests__/diagnostics.test.ts` | 截断、脱敏、HTML、cause、ring buffer、去重和 sink |
| `extensions/mcp/__tests__/retry.test.ts` | 错误矩阵、jitter、`Retry-After`、deadline 和取消 |
| `extensions/mcp/__tests__/config.test.ts` | 兼容配置、判别校验和敏感错误 |
| `extensions/mcp/__tests__/client.test.ts` | transport 生命周期、状态、超时、重连、重放和资源清理 |
| `extensions/mcp/__tests__/index.test.ts` | Pi UI、命令、动态工具、错误传播和模式隔离 |
| `extensions/mcp/__tests__/fixtures/` | 本地 HTTP 与 stdio 故障 fixture |
| `README.md` | 用户配置和整体 MCP 能力说明 |
| `extensions/mcp/README.md` | MCP 专项配置、Exa、日志和排错说明 |

## Risks and controls

### Duplicate side effects

网络响应丢失时无法证明服务端是否已执行工具。默认不重放可以避免写操作被执行两次。只读重放必须依赖明确 annotation 或配置。

### Callback races

旧 transport 的 onclose 可能晚于新连接。所有 callback 和 Promise finally 都必须校验 Client identity 与 lifecycle generation。

### Hidden diagnostics leakage

内存日志同样属于日志。所有数据先清理再入库，不允许先存原文、展示时才脱敏。

### Startup latency

所有服务器并行连接，单服务器重试必须受总 `connectTimeout` 约束。后台恢复承担超出前台预算的尝试。

### Dynamic tool removal

Pi 当前提供动态 `registerTool()`，但没有公开 `unregisterTool()`。本会话可以动态增加工具；服务端删除的工具由 wrapper 返回“工具不存在”，彻底清理通过 `/reload` 完成。该限制不要求修改上游 Pi。

### SDK behavior

Context7 的部分检索结果可能引用重构后的 main 分支。实施以项目锁定的 `@modelcontextprotocol/sdk@1.29.0` 本地发布包为准，官方文档用于交叉验证。

## Resolved decision

用户已明确选择新增 user-facing product copy 使用 English。`/mcp logs`、`/mcp reconnect`、状态、错误通知、工具输出边界和 pagination 提示均按英文实现；仓库说明文档继续遵循 English heading、中文正文的 repository policy。

## References

以下 source 行号描述实施前的 historical baseline；对应旧路径已由本计划替换或删除：

- Historical `extensions/mcp/src/logger.ts:34`：原 `console[level]()` sink，现已删除。
- Historical `extensions/mcp/src/client.ts`：原 HTTP 无重试、松散字符串断线判断、重复 close、独立 timeout 和 `stderr: "ignore"` 路径，现由 `diagnostics.ts`、`retry.ts` 与新 lifecycle 取代。
- Historical `extensions/mcp/src/index.ts`：原启动与工具 wrapper 重复报告路径，现由 manager events 和单一 UI 出口取代。
- `package.json`：锁定 `@modelcontextprotocol/sdk@1.29.0`。
- MCP SDK 1.29.0 `client/streamableHttp.js`：非 2xx body、transport-owned fetch、session ID 和 SSE reconnect 行为。
- MCP SDK 1.29.0 `shared/protocol.js`：request timeout、progress reset、transport ownership、onerror/onclose 和连接关闭行为。
- MCP SDK 1.29.0 `client/stdio.js`：stdio spawn、stderr pipe 和生命周期。
- Exa MCP documentation: <https://docs.exa.ai/reference/exa-mcp>
- Exa Cloudflare 520 report: <https://github.com/exa-labs/exa-mcp-server/issues/100>
- Pi extension documentation: `@earendil-works/pi-coding-agent/docs/extensions.md`
- Pi TUI documentation: `@earendil-works/pi-coding-agent/docs/tui.md`
- Pi RPC documentation: `@earendil-works/pi-coding-agent/docs/rpc.md`
