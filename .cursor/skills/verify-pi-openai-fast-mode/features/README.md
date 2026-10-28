# openai-fast-mode verification map

此目录维护 openai-fast-mode 的用户行为。先执行 [skill](../SKILL.md) 的 Launch 与 Doctor。所有 case 使用隔离状态，恢复旅程需在同一次实例中保留其 session。

## Proof rules

- 每条子行为分别记录 passed、failed、blocked 或 unverified，并写出证据路径。
- 捕获动作与结果；修改类行为再核对文件或 session，不只看最终画面。
- 自动 case、定向测试和人工补充的覆盖不同。未驱动的入口保持 unverified。
- 缺少种子、认证、终端能力或有效历史时记录具体原因，不削弱通过条件。

## Features

- [Root Fast Mode controls](toggle.md)：包含 `fast-bare`, `fast-on`, `fast-off`, `fast-toggle`, `fast-flag`, `fast-persist`, `fast-scope`.
- [Priority requests and unsupported models](payload.md)：包含 `fast-openai`, `fast-codex`, `fast-unmatched`, `fast-unsupported`, `fast-error-scope`.
- [Child Fast Mode inheritance](child.md)：包含 `fast-child-inherit`, `fast-child-override`, `fast-role`, `fast-child-reload`, `fast-child-resume`, `fast-shared-config`.
