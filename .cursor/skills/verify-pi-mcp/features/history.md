# History rendering and safe resume

验证 mcp 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `mcp-live-history`：真实调用写入可恢复历史。
- `mcp-offline-history`：server 离线仍能显示旧卡片。
- `mcp-cold-resume`：各冷启动恢复入口读取历史。
- `mcp-import`：导入历史后识别工具身份。
- `mcp-tree`：树导航只展示当前分支。
- `mcp-reload-history`：reload 不重执行旧工具。
- `mcp-history-only`：display-only 定义不能执行。

## How to get to it (user POV)

--session/--continue/--resume；/resume；/tree；/reload；离线历史工具卡片。

## Driving it with Pi PTY and host fixtures

完成 [Launch 与 Doctor](../SKILL.md)，运行 [固定旅程的命令](../journeys.md#commands)，选择 `history 与 combination`。具体动作和通过条件见 [对应旅程](../journeys.md#native-history)。每个 ID 分别记录实际覆盖结果、证据层级和文件路径；需要完整验收时运行固定旅程的全部六条命令及列出的定向协议测试。

## Gotchas

CLI `--resume` 与进程内 `/resume` 是两个入口，固定 history 旅程均实际选择会话。`/tree` 通过搜索、Enter 和 No summary 完成导航，并检查后续请求只含所选分支。旧 resume-ui-host 的 fixture wrapper 可用于定位 SDK 边界，不作为原生菜单验收证据。展开、会话身份、后续请求或清理缺失时保持 unverified。
