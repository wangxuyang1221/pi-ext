# subagent verification map

此目录维护 subagent 的用户行为。先执行 [skill](../SKILL.md) 的 Launch 与 Doctor。所有 case 使用隔离状态，恢复旅程需在同一次实例中保留其 session。

正式入口分为生产宿主组、[完整 root/child PTY driver](../scripts/README.md) 和真实 v2 writer 的 legacy 旅程。原宿主组负责延迟 readiness 与凭据交接；PTY driver 负责 root `/quit`、恢复后继续消息、并发、分页和生命周期。逐条合并相应层级的证据。

## Proof rules

- 每条子行为分别记录 passed、failed、blocked 或 unverified，并写出证据路径。
- 捕获动作与结果；修改类行为再核对文件或 session，不只看最终画面。
- 自动 case、定向测试和人工补充的覆盖不同。未驱动的入口保持 unverified。
- 缺少种子、认证、终端能力或有效历史时记录具体原因，不削弱通过条件。

## Features

- [Spawn, roles and capacity](spawn.md)：包含 `subagent-spawn`, `subagent-role`, `subagent-overrides`, `subagent-capacity`, `subagent-readiness`, `subagent-auth`.
- [Prompt delivery and settled generations](delivery.md)：包含 `subagent-task`, `subagent-prompt`, `subagent-followup`, `subagent-delivery-rejected`, `subagent-unconfirmed`, `subagent-wait`.
- [Activity summaries and detail pagination](read.md)：包含 `subagent-list`, `subagent-recent`, `subagent-turns`, `subagent-detail`, `subagent-cursors`, `subagent-errors`.
- [Resume, ownership and lifecycle](ownership.md)：包含 `subagent-resume`, `subagent-owner`, `subagent-identity`, `subagent-session-switch`, `subagent-upgrade`.
- [Close and root exit choices](close.md)：包含 `subagent-close`, `subagent-close-all`, `subagent-close-failure`, `subagent-quit-end`, `subagent-quit-leave`, `subagent-quit-cancel`.
