# codex-compact verification map

此目录维护 codex-compact 的用户行为。先执行 [skill](../SKILL.md) 的 Launch 与 Doctor。所有 case 使用隔离状态；冷启动恢复必须在同一验证生命周期中保留 agentDir/sessionFile，退出旧进程后由新进程继续请求。

## Proof rules

- 每条子行为分别记录 passed、failed、blocked 或 unverified，并写出证据路径。
- 捕获动作与结果；修改类行为再核对文件或 session，不只看最终画面。
- 自动 case、定向测试和人工补充的覆盖不同。未驱动的入口保持 unverified。
- 缺少种子、认证、终端能力或有效历史时记录具体原因，不削弱通过条件。

使用 [场景配方](../journeys.md) 的命名场景，避免从临时审计目录复制 driver。报告分别提供 `strictTuiStatus` 和 `layeredStatus`，并列出每个必要分支的层级与证据。前者用于和既有严格 TUI 审计比较；生产算法或 SDK 断言的补充证据只计入后者，不能据此修改前者。

## Features

- [Model metadata configuration](metadata.md)：包含 `metadata-status`, `metadata-save`, `metadata-reset`, `metadata-project-priority`, `metadata-invalid`.
- [Manual and automatic compaction](compaction.md)：包含 `compact-manual`, `compact-threshold`, `compact-overflow`, `compact-pre-request`, `compact-cancel`, `compact-failure`.
- [Checkpoint continuation and model switching](resume.md)：包含 `compact-resume`, `compact-tools`, `compact-system-updates`, `compact-model-switch`, `compact-tree`, `compact-stale`.
- [History, media and budget preservation](retention.md)：包含 `compact-retention`, `compact-media`, `compact-pending-input`, `compact-legacy`, `compact-usage`.
