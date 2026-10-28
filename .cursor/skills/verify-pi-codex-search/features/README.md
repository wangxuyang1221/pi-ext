# codex-search verification map

此目录维护 codex-search 的用户行为。先执行 [skill](../SKILL.md) 的 Launch 与 Doctor。所有 case 使用隔离状态，恢复旅程需在同一次实例中保留其 session。

## Proof rules

- 每条子行为分别记录 passed、failed、blocked 或 unverified，并写出证据路径。
- 捕获动作与结果；修改类行为再核对文件或 session，不只看最终画面。
- 自动 case、定向测试和人工补充的覆盖不同。未驱动的入口保持 unverified。
- 缺少种子、认证、终端能力或有效历史时记录具体原因，不削弱通过条件。

## Features

- [Search configuration and enabled tools](settings.md)：包含 `search-settings`, `search-status`, `search-reset`, `search-scope`, `search-env`, `search-enabled`.
- [Search queries and result presentation](queries.md)：包含 `search-responses`, `search-standalone`, `search-progress`, `search-sources`, `search-expand`, `search-error`, `search-timeout`, `search-cancel`.
- [Follow-up actions and reference limits](references.md)：包含 `search-open`, `search-click`, `search-find`, `search-reference`, `search-screenshot`, `search-lookups`, `search-single-action`.
- [Search history across resume and reload](history.md)：包含 `search-resume`, `search-reload`, `search-disabled-history`, `search-theme`, `search-fullscreen`.
