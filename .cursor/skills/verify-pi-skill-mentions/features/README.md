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

## Required entry points

命令缩写 `skills`、`skills-resume`、`skills-combination` 指 [Launch](../SKILL.md#launch) 中的共享 case。每个 ID 均独立记录状态；同一行列出的其他 ID 通过，不能补足未执行的分支。

| Behavior IDs | Required evidence |
| --- | --- |
| `skill-dollar`, `skill-multiline`, `skill-tab`, `skill-enter-select`, `skill-enter-send`, `skill-boundaries` | `skills`；其他 editor/模式由发布包五模式保留同样断言 |
| `skill-multi`, `skill-dedupe`, `skill-punctuation`, `skill-unknown`, `skill-native-card` | `skills`；去重读取次数另用 loading.test.ts 补证 |
| `skill-unreadable` | `skills` 的删除文件降级，以及 `journeys.mjs permission` 的真实权限拒绝和恢复读取 |
| `skill-request-snapshot` | `skills` 和 `skills-combination` 的多版本、旧历史及 session/provider 对照；改动快照逻辑时另跑 `journeys.mjs mutation` |
| `skill-icon-cube`, `skill-icon-command`, `skill-cursor`, `skill-undo`, `skill-resize` | `skills`；物理字体和 IME 单独报告 |
| `skill-selection` | `skills` 的整体删除及 [真实终端人工拖选复制](labels.md#manual-terminal-selection)，缺任一分支整体 unverified |
| `skill-mouse` | 发布包 native-fullscreen/combined-fullscreen 的真实 SGR 点击和原文插入断言 |
| `skill-history-source`, `skill-external-editor`, `skill-followup`, `skill-reload`, `skill-equal-task` | `skills`；`skills-combination` 补充外部编辑、reload 和源文件变更的连续操作 |
| `skill-steer` | `skills-combination` 的 Enter 队列、消费时 V3 和独立 requestId |
| `skill-resume` | `skills-resume` 四模式的两次进程内选择、首次冷选择、session 身份、历史字节、卡片和续问上下文 |
| `skill-native`, `skill-codex`, `skill-combined`, `skill-fullscreen`, `skill-package` | 默认发布包五模式，全部 dist 比对、安装入口导入、消费锁冻结且字节不变；组合含本地 MCP 工具结果 |
