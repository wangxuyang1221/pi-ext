# goal verification map

此目录维护 goal 的用户行为。先执行 [skill](../SKILL.md) 的 Launch 与 Doctor。所有 case 使用隔离状态，恢复旅程需在同一次实例中保留其 session。

## Proof rules

- 每条子行为分别记录 passed、failed、blocked 或 unverified，并写出证据路径。
- 捕获动作与结果；修改类行为再核对文件或 session，不只看最终画面。
- 自动 case、定向测试和人工补充的覆盖不同。未驱动的入口保持 unverified。
- 缺少种子、认证、终端能力或有效历史时记录具体原因，不削弱通过条件。

## Features

- [Goal creation, editing and details](lifecycle.md)：包含 `goal-create`, `goal-replace`, `goal-edit`, `goal-clear`, `goal-details`, `goal-pause`, `goal-resume`.
- [Goal model tools and availability](tools.md)：包含 `goal-get`, `goal-create-tool`, `goal-update-tool`, `goal-budget-default`, `goal-tool-missing`.
- [Continuation, steering and interruption](continuation.md)：包含 `goal-auto`, `goal-steer`, `goal-followup`, `goal-escape`, `goal-retry`, `goal-loop`, `goal-empty`, `goal-settled-error`, `goal-quota`.
- [Durable recovery and lock ownership](recovery.md)：包含 `goal-before-first-reply`, `goal-recover-session`, `goal-recover-orphan`, `goal-reopen-confirm`, `goal-lock`, `goal-storage-error`, `goal-tombstone`.
- [Explicit goal inheritance](inheritance.md)：包含 `goal-tree`, `goal-native-fork`, `goal-native-clone`, `goal-fork`, `goal-clone`, `goal-deferral`.
- [Long objectives and attachments](content.md)：包含 `goal-long`, `goal-content-edit`, `goal-attachment-copy`, `goal-attachment-text`, `goal-content-cancel`, `goal-content-validation`.
- [Usage, soft budgets and direct children](accounting.md)：包含 `goal-root-usage`, `goal-child-usage`, `goal-dedupe`, `goal-cache`, `goal-missing-usage`, `goal-soft-budget`, `goal-freeze`, `goal-time`.
- [Goal footer and elapsed-time display](footer.md)：包含 `goal-footer-codex`, `goal-footer-native`, `goal-footer-fullscreen`, `goal-detail-snapshot`, `goal-minute-refresh`.
