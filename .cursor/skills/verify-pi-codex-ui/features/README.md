# codex-ui verification map

此目录维护 codex-ui 的用户行为。先执行 [skill](../SKILL.md) 的 Launch 与 Doctor。所有 case 使用隔离状态，恢复旅程需在同一次实例中保留其 session。

## Proof rules

- 每条子行为分别记录 passed、failed、blocked 或 unverified，并写出证据路径。
- 捕获动作与结果；修改类行为再核对文件或 session，不只看最终画面。
- 自动 case、定向测试和人工补充的覆盖不同。未驱动的入口保持 unverified。
- 缺少种子、认证、终端能力或有效历史时记录具体原因，不削弱通过条件。

## Features

- [Composer, footer and theme](layout.md)：包含 `ui-header`, `ui-composer`, `ui-status`, `ui-theme`, `ui-resize`, `ui-user-markdown`, `ui-reply-markdown`.
- [Thinking and terminal activity](thinking.md)：包含 `ui-thinking-stream`, `ui-thinking-collapse`, `ui-thinking-resume`, `ui-title`, `ui-title-stop`.
- [Read, Bash, Edit and Write display](tools.md)：包含 `ui-read-group`, `ui-bash-preview`, `ui-expand`, `ui-write-added`, `ui-write-edited`, `ui-diff`, `ui-error`, `ui-interrupted`.
- [Codemode tree and inspector](codemode.md)：包含 `ui-codemode-order`, `ui-codemode-failure`, `ui-inspect-tabs`, `ui-inspect-scroll`, `ui-codemode-cache`, `ui-codemode-resume`.
- [Low-power rendering](lowpower.md)：包含 `ui-lowpower-on`, `ui-lowpower-off`, `ui-lowpower-status`, `ui-lowpower-reset`.
- [Execution settings and fail-closed configuration](execution.md)：包含 `ui-shell-prefix`, `ui-shell-path`, `ui-image-resize`, `ui-project-trust`, `ui-settings-error`, `ui-settings-reload`, `ui-headless`.
