# mcp verification map

此目录维护 mcp 的用户行为。先执行 [skill](../SKILL.md) 的 Launch 与 Doctor。所有 case 使用隔离状态，恢复旅程需在同一次实例中保留其 session。

## Proof rules

- 每条子行为分别记录 passed、failed、blocked 或 unverified，并写出证据路径。
- 捕获动作与结果；修改类行为再核对文件或 session，不只看最终画面。
- 自动 case、定向测试和人工补充的覆盖不同。未驱动的入口保持 unverified。
- 缺少种子、认证、终端能力或有效历史时记录具体原因，不削弱通过条件。

## Features

- [Configuration and project trust](configuration.md)：包含 `mcp-init`, `mcp-priority`, `mcp-invalid`, `mcp-disabled`, `mcp-trust`.
- [Tool discovery, calls and results](tools.md)：包含 `mcp-stdio`, `mcp-http`, `mcp-sse`, `mcp-schema`, `mcp-progress`, `mcp-cancel`, `mcp-error`.
- [Deadlines, retry and tool replay](reconnect.md)：包含 `mcp-reconnect`, `mcp-reload`, `mcp-offline`, `mcp-retry`, `mcp-deadline`, `mcp-replay`.
- [Status controls and diagnostics](status.md)：包含 `mcp-inventory`, `mcp-verbose`, `mcp-logs`, `mcp-redaction`, `mcp-bounded-log`.
- [History rendering and safe resume](history.md)：包含 `mcp-live-history`, `mcp-offline-history`, `mcp-cold-resume`, `mcp-import`, `mcp-tree`, `mcp-reload-history`, `mcp-history-only`.
