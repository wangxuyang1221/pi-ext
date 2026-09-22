# Implementation 29

## Scope

本关对应 [Issue #29](https://github.com/wangxuyang1221/pi-ext/issues/29)。接手基准为 b28a148150cb9265402d0b8eab83d24756364657，分支为 adventure/subagent-ui-consistency。仅修改本冒险 worktree，未改主工作区、生产 UI 或英雄命名。

清理失效测试、脚本及已删除报告的发布声明。不恢复旧资料，不删除生产测试，不扩大 Vitest 忽略范围，不改变发布校验的路径存在性、运行时导出和包排除检查逻辑。

## Investigation

Node v22.22.2、pnpm 11.9.0 满足 engines 与 packageManager 要求。沿用现有依赖，无需安装。

`status-ui-prototype.test.ts` 的全部被测实现和 fixture 来自已删除的 `prototypes/mcp-status-ui-prototype`。删除历史为 341c22b。两个 `prototype:mcp-ui` scripts 也只指向该目录。

发布清单实际引用 13 份缺失文档。协调者核对已审核切片后确认，这些同类已删除报告的引用均在本关范围。逐项执行 `git log -1 --diff-filter=D --format='%h %s' -- <path>`，结果如下。路径均位于 `docs/`。

| Deleted document | Deletion commit |
| --- | --- |
| subagent-runtime-reliability.md | 96c9f65 |
| subagent-runtime-reliability-acceptance.md | 96c9f65 |
| tool-status-acceptance.md | 96c9f65 |
| goal-footer-acceptance.md | 96c9f65 |
| goal-provider-support.md | 341c22b |
| goal-descendant-acceptance.md | 341c22b |
| goal-ui-acceptance.md | 341c22b |
| goal-integration-acceptance.md | 341c22b |
| goal-parity-acceptance.md | 341c22b |
| goal-storage-acceptance.md | 341c22b |
| goal-lifecycle-acceptance.md | 341c22b |
| goal-execution-report.md | 341c22b |
| goal-budget-acceptance.md | 341c22b |

## Changes

- 删除仅覆盖已删除原型的 `extensions/mcp/__tests__/status-ui-prototype.test.ts` 与两个 MCP 原型 scripts。
- 从 `package.json` 的 files 删除上述 13 项，从 `scripts/check-package.mjs` 的必需条目删除其中 5 项。
- 从 `extensions/goal/__tests__/package-artifact.mjs` 删除其中 8 项报告声明。保留其余断言。
- 保留有效文档、运行时文件、许可声明、生产测试及全部测试配置。此次仅减少失效声明，没有新增执行路径或性能风险。

## Verification

2026-09-22 在本冒险 worktree 执行。

| Command | Result |
| --- | --- |
| 修改前 `pnpm exec vitest run extensions/mcp/__tests__/status-ui-prototype.test.ts` | 退出 1，缺少原型 codex-startup.js，suite 无法加载 |
| 修改前 `pnpm run package:check` | 退出 1，缺少 goal-descendant-acceptance.md |
| 修改后 `pnpm run check` | 退出 0；typecheck、test、build、package:check 全部通过 |

完整检查的测试阶段为 159 个文件通过、3 个文件跳过；2376 项测试通过、11 项跳过。未增加 skip 或修改生产断言。构建包含 media copy 校验。发布校验确认 8 个 compiled Pi extension entries、1 个 theme entry、13 个 MCP generated modules、必需 MCP runtime exports 及 package exclusion boundaries。

只执行一次修改后的完整 check，无失败重试。原始输出为本地 `.scratch/implementation-29/check.log`，未提交运行日志。本关未启动持久服务；命令已退出，进程核对无本 worktree 测试进程遗留。未操作用户自行打开的原型进程。

## Boundaries and remaining work

独立历史脚本 `extensions/goal/__tests__/package-artifact.mjs` 不在 `pnpm run check` 中。其原有 7 个 extensions 和旧 license 断言已与当前 manifest 不一致。本关按协调者确认仅清理相同已删报告引用，未运行或宣称该独立脚本通过，未改其无关历史断言。当前标准发布包校验已通过。

生产视觉、英雄命名及整体验收仍分别属于后续关卡。本关未更新 Map、Spec、progress.md 或 Acceptance。
