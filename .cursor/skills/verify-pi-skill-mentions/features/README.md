# skill-mentions verification map

此目录维护 skill-mentions 的用户行为。先执行 [skill](../SKILL.md) 的 Launch 与 Doctor。所有 case 使用隔离状态，恢复旅程需在同一次实例中保留其 session。

## Proof rules

- 每条子行为分别记录 passed、failed、blocked 或 unverified，并写出证据路径。
- 捕获动作与结果；修改类行为再核对文件或 session，不只看最终画面。
- 自动 case、定向测试和人工补充的覆盖不同。未驱动的入口保持 unverified。
- 缺少种子、认证、终端能力或有效历史时记录具体原因，不削弱通过条件。

## Features

- [Inline skill completion](completion.md)：包含 `skill-dollar`, `skill-multiline`, `skill-tab`, `skill-enter-select`, `skill-enter-send`, `skill-boundaries`.
- [Skill loading and snapshot delivery](loading.md)：包含 `skill-multi`, `skill-dedupe`, `skill-punctuation`, `skill-unknown`, `skill-unreadable`, `skill-native-card`, `skill-request-snapshot`.
- [Label editing and icon preference](labels.md)：包含 `skill-icon-cube`, `skill-icon-command`, `skill-cursor`, `skill-selection`, `skill-undo`, `skill-mouse`, `skill-resize`.
- [History editing, queues and session changes](history.md)：包含 `skill-history-source`, `skill-external-editor`, `skill-steer`, `skill-followup`, `skill-reload`, `skill-resume`, `skill-equal-task`.
- [Editor combinations and package installation](integration.md)：包含 `skill-native`, `skill-codex`, `skill-combined`, `skill-fullscreen`, `skill-package`.
