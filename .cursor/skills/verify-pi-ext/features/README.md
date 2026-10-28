# Pi extension verification map

完整行为按扩展维护，避免在总入口重复描述。先读 [共享运行说明](../README.md)，再读相应索引。机器可读条目见 [features.json](../features.json)。

## Features

- [Codex compact](../../verify-pi-codex-compact/features/README.md)
- [Fast Mode](../../verify-pi-openai-fast-mode/features/README.md)
- [Permissions](../../verify-pi-permissions/features/README.md)
- [Goal](../../verify-pi-goal/features/README.md)
- [MCP](../../verify-pi-mcp/features/README.md)
- [Subagent](../../verify-pi-subagent/features/README.md)
- [Codex UI](../../verify-pi-codex-ui/features/README.md)
- [Skill mentions](../../verify-pi-skill-mentions/features/README.md)
- [Codex search](../../verify-pi-codex-search/features/README.md)

## Proof rules

每个子行为分别标记 passed、failed、blocked 或 unverified。真实宿主 smoke、离线定向测试和联网验证各自报告；任一入口缺少前置条件时记录原因，不用另一入口的结果代替。清理后证据仍须存在。
