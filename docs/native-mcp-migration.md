# MCP integration status

## Current decision

保留 Pi AI、Coding Agent、TUI 1.3.0 升级，MCP 使用本仓库的 extension，关闭内置 MCP。原生 MCP 的专用 UI 注册器和 PTY 验收已撤销，但 MCP UI 移入 codex-ui 的改动保留。

本机切回仓库 MCP 后，真实 `subagent_spawn` 冒烟测试已正常收到首条任务并回复 `SUBAGENT_SMOKE_OK`，随后关闭测试子代理并确认进程退出。这是单次启动证据，不代表所有投递失败均已解决。subagent 生产源码未修改，mailbox 重构暂不实施，相关计划、术语文件和宿主特征测试已移除。

## Retained implementation

- `extensions/codex-ui/src/mcp-renderers.ts` 维护 MCP 调用和结果的显示，包括折叠预览、展开、状态和布局缓存。
- `extensions/codex-ui/src/mcp-text.ts` 提供控制字符清理、凭据脱敏和字节截断。脱敏只能降低泄漏风险，不是分享原始日志的安全保证。
- `extensions/mcp/src/renderers.ts` 重新导出共享 UI；`diagnostics.ts` 复用文本清理函数。无需启用 codex-ui 扩展，但发布包需要包含 `codex-ui/dist` 模块。
- `pnpm test` 和 `pnpm run typecheck` 先构建 codex-ui。完整构建仍按 codex-ui、MCP 的顺序进行，不手工编辑 `dist/`。
- 共享 renderer 对不同结果结构的兼容处理保留，但不通过 `registerToolRenderer()` 为内置 MCP 注册 UI，也不宣称已验收内置 MCP 的运行路径。
- Pi 1.3.0 的输入框光标兼容修复、恢复会话工具集测试和 MCP 历史工具过滤测试保留。

## Local configuration

`~/.pi/agent/settings.json` 中保留仓库 package，移除其 `!extensions/mcp/dist/index.js` 排除项，并在顶层设置：

```json
{
  "extensions": ["-builtin:mcp"]
}
```

将该项合并到已有数组，不覆盖其他扩展。Codemode 设置保持不变，permissions、goal 的已有排除项也保持不变。重启后 `/mcp` 由仓库插件提供，内置 MCP 不参与加载，也不产生替代警告。

`~/.pi/agent/mcp.json` 已从 `~/.pi/agent/backups/native-mcp-2026-10-20T12-55-19.798Z/mcp.json` 原样恢复。五个服务器继续使用仓库插件的配置格式，超时单位为毫秒。

切换前的两份个人配置保存在 `~/.pi/agent/backups/restore-repository-mcp-2026-10-21T00-46-38Z/`，目录权限 0700、文件权限 0600。这些备份含私人配置，不进入仓库。本轮代码整理不再修改个人配置。

## Verification

环境为 macOS、Node.js 22.22.2、pnpm 11.9.0、Pi 1.3.0。

- 共享 UI 的单元测试位于 `extensions/codex-ui/__tests__/mcp-renderers.test.ts`，包括旧插件结果和布局缓存回归。
- `extensions/codex-ui/__tests__/mcp-host.test.ts` 使用本地 HTTP MCP fixture，实际执行仓库插件的连接、发现、直接调用、Codemode 调用和宿主工具行渲染。仅模型回复与服务器端点替换为离线 fixture。
- 仓库插件在 Codemode 中按普通扩展工具返回文本，不能假定结果有内置 MCP 的 `CallToolResult.content`。fixture 使用 `text(r)`，并断言真实工具返回的内容。
- `scripts/check-pi-host.mjs` 恢复为检查仓库插件的 source/dist 加载。它刻意不关闭内置 MCP，并验证替代警告；这与个人配置显式禁用内置 MCP 后零警告的验收是两个不同场景。
- 配置切换的隔离加载检查确认只有仓库 `/mcp`，内置 MCP 未加载、Codemode 保留，零加载错误、零警告。未连接真实外部 MCP 服务。

本轮验证结果：

- 恢复不含 `registerToolRenderer` mock 的原入口测试后，测试先因残留的内置 MCP UI 注册调用失败；撤销该调用后通过。日志为 `red.log`、`green.log`。
- `pnpm test extensions/codex-ui/__tests__/mcp-host.test.ts extensions/codex-ui/__tests__/mcp-renderers.test.ts extensions/mcp/__tests__`：263 个测试通过。本地 HTTP fixture 关闭监听并确认连接清空。
- `pnpm run check`：类型检查、测试、构建、发布包及 source/dist 宿主检查通过。179 个测试文件通过、4 个条件跳过；2664 个测试通过、13 个条件跳过。未把条件跳过项算作通过。
- `git diff --check` 通过。个人 `settings.json`、`mcp.json` 与整理前的 SHA-256 一致，未修改全局配置。

日志位于忽略目录 `.tmp/native-mcp-rollback/`，其中 `before.patch` 与 `removed-files.tar.gz` 保留整理前的工作区备份。未提交或推送代码。
