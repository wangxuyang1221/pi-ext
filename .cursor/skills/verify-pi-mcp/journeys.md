# MCP acceptance journeys

这些入口使用仓库安装的真实 Pi CLI、生产 `extensions/mcp/dist/index.js`、原生终端和本地 MCP 服务。只在 provider 边界生成固定响应。运行前完成 [共享准备与隔离检查](../verify-pi-ext/README.md)，确认构建对应当前源码。所有 scratch、HOME、配置和 session 都位于仓库 `.tmp/`，不会读取用户凭据。各场景独立创建环境，不占共享 helper 的验证锁。

## Commands

从仓库根目录运行所需场景。完整 MCP 验收逐条运行全部六个命令。

```bash
conda run --no-capture-output -n codex-py312 python extensions/mcp/__tests__/verification-journeys.py configuration
conda run --no-capture-output -n codex-py312 python extensions/mcp/__tests__/verification-journeys.py combination
conda run --no-capture-output -n codex-py312 python extensions/mcp/__tests__/verification-journeys.py reload
conda run --no-capture-output -n codex-py312 python extensions/mcp/__tests__/verification-journeys.py diagnostics
conda run --no-capture-output -n codex-py312 python extensions/mcp/__tests__/verification-journeys.py history
pnpm exec node extensions/mcp/__tests__/fixtures/verification/recovery.mjs
```

前五条是 CLI/PTY、文件/session 和真实本地协议证据。`recovery.mjs` 是生产 manager 加真实 HTTP 协议证据，使用真实时钟和 sleep，只固定 jitter 的随机输入。它不证明 TUI 呈现。progress 的 silent、unknown、stopped 分支仍需下面的真实 SSE 协议测试。

```bash
pnpm test extensions/mcp/__tests__/transport-fixtures.test.ts extensions/mcp/__tests__/progress-transport.test.ts extensions/mcp/__tests__/schema.test.ts extensions/mcp/__tests__/diagnostics.test.ts extensions/mcp/__tests__/history-tool.test.ts
```

## Configuration

`configuration` 驱动 `/mcp-init`，先生成模板，再把文件替换为已知原始字节。第二次调用在确认框按 Escape，断言原字节未变；第三次 Enter 接受，断言生成合法模板。未信任项目拒绝生成，项目 sentinel 不执行。

随后分别冷启动显式 `PI_MCP_CONFIG`、项目 `.pi/mcp.json` 和全局 `HOME/.pi/agent/mcp.json`，核对选中的 server。显式配置同时包含有效、disabled 和非法条目，disabled 命令不得创建 sentinel，非法 sibling 不阻塞有效 server。把最高优先级文件改为非法 JSON 后 `/mcp reload`，断言 invalid 且没有降级连接。

覆盖 `mcp-init`、`mcp-priority`、`mcp-invalid`、`mcp-disabled`、`mcp-trust`。

## Combination

`combination` 按顺序发现 stdio、Streamable HTTP、legacy SSE，通过真实工具执行调用三种传输。schema 包含 const、嵌套 union、禁止额外字段和有类型的 additionalProperties。合法参数成功；无法满足 schema 的参数返回 validation failure，服务端调用计数不增加。宿主允许参数类型 coercion，因此 boolean 可转换成 string 的输入不作为非法例子。media 工具同时返回图片与 structuredContent，核对真实 tool event、session 和可见文本。

HTTP 第一次调用发送后断流，ledger 中只能有一次 tools/call。手动 reconnect 后显式再调用成功。SSE 持续 progress 跨越软截止完成，下一次调用触发硬总截止。再重连，开始长调用后按原生 Escape，服务端必须记录取消；业务错误必须标成失败。

保存真实 session，移除 server，`/mcp reload` 后冷启动同一 session。按 Ctrl+O 展开旧卡片，核对原始结果。发后续请求，provider ledger 必须包含之前的 stdio 和 HTTP 结果。再请求旧工具，executor 必须拒绝，服务端调用计数不增加。诊断文件及唯一备份各不超过 4096 字节、权限为 0600、每行可解析。

覆盖 `mcp-stdio`、`mcp-http`、`mcp-sse`、`mcp-schema`、`mcp-progress`、`mcp-cancel`、`mcp-error`、`mcp-reconnect`、`mcp-replay`、`mcp-inventory`、`mcp-verbose`、`mcp-logs`、`mcp-bounded-log`、`mcp-live-history`、`mcp-offline-history`、`mcp-reload-history`、`mcp-history-only`。

## Reload

`/mcp reload` 先等待宿主空闲，再 reload。`reload` 的第一段开始 600 ms 调用，发送 reload 后短时核对没有提前换代，随后服务端必须正常完成且未取消，再观察 reload readiness。

第二段同时保留活动 SSE 调用与 HTTP 后台重试，移除配置并发送 reload，再按 Escape 取消活动调用。必须分别观察服务端取消、reload readiness、空清单，以及超过后台重试周期后请求计数不增加。取消归因于 Escape，reload 负责空闲后的连接和重试清理。这个场景不宣称 reload 会立即打断活动工具。

覆盖 `mcp-reload`；同时补证 `mcp-cancel`。

## Diagnostics

`diagnostics` 让真实 SSE server 发送 log notification，data 含合成 Authorization、Cookie、env、URL credentials 和 query token。通过 `/mcp logs sse` 看到该事件，再核对落盘文件；每种合成敏感值都必须在两处消失，保留 `[redacted]`。这些是测试值，不使用真实秘密。

覆盖 `mcp-logs`、`mcp-redaction`。stderr 的分段、长度与脱敏由 combination 和定向 diagnostics 测试补证。

## Native history

`history` 为每种启动模式重建固定 JSONL 种子，分别运行 `--session`、`--continue`、CLI `--resume`、空白启动和 `--no-session` 内存启动。CLI selector 实际按 Enter；空白和内存启动实际输入 `/resume` 并选择历史。必须观察新的 session_start，核对 session 文件身份，再发后续请求，断言模型上下文含当前分支结果且不含另一分支。内存启动的选择器使用 agentDir 默认 sessions 目录，因此 driver 为此目录单独播种。

随后打开原生 `/tree`，输入 alternate 结果内容过滤，Enter 选中，再 Enter 选择 No summary。后续请求必须包含 alternate 结果且排除原分支。再次打开菜单选择原结果，后续请求断言相反。最后通过原生 `/import <path>` 接受 Replace current session，检查 readiness 与后续上下文。

全部模式都会按 Ctrl+O 展开离线旧卡片，确认原始结果。这里没有用 `ctx.switchSession` 或 `ctx.navigateTree` wrapper 代替菜单操作。

覆盖 `mcp-cold-resume`、`mcp-tree`、`mcp-import`、`mcp-offline-history`。

## Real HTTP recovery

`recovery.mjs` 保存每次请求的时间、method、诊断和取消状态。连续三次 503 后第四次成功，实际间隔必须符合 80、160、250 ms 的有界退避。401 和 JSON-RPC InvalidRequest 各只收到一次 initialize。后台恢复后实际 echo 成功；手动 reconnect 替换旧 generation，等待后没有旧重试。

总截止场景在每次 initialize 和 tools/list 前各延迟 100 ms，第一次 list 返回 503，重试后第二次 list 挂起。整个 connect 使用同一个 1500 ms 预算，必须在期限附近失败并取消挂起 list，不能为每个阶段重置预算。

覆盖 `mcp-offline`、`mcp-retry`、`mcp-deadline`。

## Evidence and cleanup

PTY 命令打印 `.tmp/test-results/mcp-<scene>-<id>/`。其中 `<host>.json` 包含真实 argv、按键、命令、画面和 PID；对应 `.ansi` 保存原始终端输出。`checks.json` 是逐条断言，`files/` 保留配置、session、provider requests、server ledger、HTTP requests 和诊断文件。失败也保存这些文件。

成功必须同时满足 `summary.json` 的 `passed: true`、`alive: []`、`scratchRemoved: true` 和每个端口的 `refused: true`。服务关闭事件还记录 listening=false、socket 数量；协议命令的 summary 逐场景记录关闭与端口拒绝连接。SIGTERM/SIGINT 走 driver finally，按失败保存证据并清理；强杀不构成清理通过。只操作本次记录的 PID、端口和 scratch。
