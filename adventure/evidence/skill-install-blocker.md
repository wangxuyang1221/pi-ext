# Skill install baseline blocker

## Status

[Implementation #10](https://github.com/wangxuyang1221/pi-ext/issues/10) 中途阻塞，未完成安装交付或完整 Spec 验收。依据 [Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2) 的 Deferred verification，缺失项阻挡安装产物验证时须取得额外修复授权。本轮没有恢复文件、排除测试或修改验证门槛。

接手和执行检查的基准均为 `07f5dd1e80527583b552fe9f06c12bdc1f4dfae2`，产品基准 `c3f2284`，分支 `adventure/skill-mentions`。接手时本地与远端一致，工作区干净。实际 Node.js `22.22.2`、pnpm `11.9.0`，项目锁定 Pi `0.86.0`。

本轮只交付失败调查与回归证据，不修改产品行为，因此没有新增 TDD Red/Green。

## Reproduction

```bash
env -u PI_SUBAGENT_PARENT -u PI_SUBAGENT_LAUNCH -u PI_SUBAGENT -u PI_SUBAGENT_ID pnpm run check
pnpm run build
pnpm run package:check
env -u PI_SUBAGENT_PARENT -u PI_SUBAGENT_LAUNCH -u PI_SUBAGENT -u PI_SUBAGENT_ID pnpm exec vitest run extensions/skill-mentions/__tests__
```

| Check | Result | Evidence |
| --- | --- | --- |
| 全仓 check | 失败。typecheck 通过；2065 passed、5 skipped；1 个 MCP suite 收集失败，后续 build/package:check 未执行 | [日志](skill-install-baseline-check.log) |
| 单独 build | 通过，含 skill-mentions；dist 仅由构建生成 | [日志](skill-install-baseline-build.log) |
| 单独 package:check | 失败。首个错误为缺失 `docs/goal-descendant-acceptance.md` | [日志](skill-install-baseline-package-check.log) |
| 本功能正式测试 | 9 个文件，112/112 通过，无 skip | [日志](skill-install-baseline-tests.log) |
| git diff --check | 通过 | 本轮命令执行 |

没有运行 pack、安装或真实 PTY。build 通过只证明编译可生成，不代表 tarball 可安装或发布验证通过。

## Package verification blocker

`scripts/check-package.mjs` 先核对固定入口，再检查 requiredPublishedEntries 和全部 package.json files 路径；这些步骤完成后才会校验 MCP 生成模块、import 各扩展入口及读取主题。当前失败发生在扩展 import 之前，因此直接阻挡仓库规定的安装产物验证。

遍历实际 `package.json.files` 并用文件系统核验，发现 13 个缺失路径。只恢复首个报错文件不足以解除阻塞。

| Missing path | Deletion commit | Last available source |
| --- | --- | --- |
| `docs/subagent-runtime-reliability.md` | `96c9f65` | `96c9f65^` |
| `docs/subagent-runtime-reliability-acceptance.md` | `96c9f65` | `96c9f65^` |
| `docs/tool-status-acceptance.md` | `96c9f65` | `96c9f65^` |
| `docs/goal-footer-acceptance.md` | `96c9f65` | `96c9f65^` |
| `docs/goal-provider-support.md` | `341c22b` | `341c22b^` |
| `docs/goal-descendant-acceptance.md` | `341c22b` | `341c22b^` |
| `docs/goal-ui-acceptance.md` | `341c22b` | `341c22b^` |
| `docs/goal-integration-acceptance.md` | `341c22b` | `341c22b^` |
| `docs/goal-parity-acceptance.md` | `341c22b` | `341c22b^` |
| `docs/goal-storage-acceptance.md` | `341c22b` | `341c22b^` |
| `docs/goal-lifecycle-acceptance.md` | `341c22b` | `341c22b^` |
| `docs/goal-execution-report.md` | `341c22b` | `341c22b^` |
| `docs/goal-budget-acceptance.md` | `341c22b` | `341c22b^` |

已用 `git log --diff-filter=D` 和 `git show <source>:<path>` 核实上述历史版本存在。这里只列发布清单直接要求的文件，没有扩大为恢复所有已删除文档。旧报告里的其他链接是否完整尚未审计，旧验收记录也不能代替当前版本验收。

skill-mentions 尚未加入 `package.json.files`、`pi.extensions` 和 check-package 的期望清单，这是 #10 原定工程范围，不是上述基准问题。尚未执行这些产品改动。

## Repository check blocker

`extensions/mcp/__tests__/status-ui-prototype.test.ts` 直接依赖 `codex-startup.js`、`index.js`、`fixtures.js`、`renderers.js`；后者再依赖 `codex-renderer.js`。五个对应 TypeScript 源文件都在 `341c22b` 删除，整个 prototype 目录目前不存在。

恢复测试直接和传递依赖的最小源码集合为：

```text
prototypes/mcp-status-ui-prototype/src/codex-startup.ts
prototypes/mcp-status-ui-prototype/src/index.ts
prototypes/mcp-status-ui-prototype/src/fixtures.ts
prototypes/mcp-status-ui-prototype/src/renderers.ts
prototypes/mcp-status-ui-prototype/src/codex-renderer.ts
```

源码来源均为 `341c22b^`。已核查它们的 import 链，没有其他相对 runtime 依赖，另有对现存 `extensions/mcp/src/types.js` 的 type import。该集合针对当前 Vitest suite，不代表恢复 prototype 独立演示、tsconfig 或 PTY smoke。是否恢复后全部通过仍须实际重跑，不能从静态依赖分析推定通过。

## Approval options

建议协调者向用户申请选项 2；选项 1 是解除已确认包验证缺口的更小范围。

1. 仅批准从上述历史版本原样恢复发布清单要求的 13 份文档。保留所有包校验和测试门槛。之后继续 #10 包入口、安装与 PTY，MCP suite 失败仍单独报告，不能称全仓 check 通过。
2. 批准恢复上述 13 份文档，加上 5 个 MCP prototype 测试依赖源码。保留既有断言和校验规则，随后重跑全仓 check 和 package:check。该选项修复当前已确认的两类基准缺口，仍不承诺未执行检查必然通过。

不建议在本任务中删除清单条目、跳过测试或提供占位文件。那会改变已批准的验证门槛，且用户曾主动删除这些材料，worker 无权自行撤销该删除决定。若用户希望清理陈旧引用而非恢复文件，应由协调者另行明确范围和验收，不在本次授权中推定。

## Spec verification matrix

以下逐项对应 Spec Acceptance。通过项仅指本轮重跑的正式测试，继承的集成证据边界见 [#8 实施证据](skill-input-implementation.md) 与 [#9 实施证据](skill-history-implementation.md)。本表不是整体验收通过声明。

| Spec acceptance | Current evidence | Remaining work |
| --- | --- | --- |
| 原生/CodexEditor 句中、多行补全；Tab/Enter 选择不发送 | autocomplete/history-editor 测试通过 | 真实 PTY 与实际安装产物未执行 |
| 相邻文字/标点、名称中间、代码和转义不误触发 | references/autocomplete/loading 测试通过 | 真实终端操作未执行 |
| 手写、粘贴、菜单等效；重复去重与首次出现顺序 | autocomplete/loading 测试通过 | PTY 粘贴与中文输入未执行 |
| 多 skill 同一 user，图片保留，未知/不可读静默回退 | flow/loading/protocol 测试通过 | 当前完整扩展组合未执行 |
| 插件普通 user 可触发；其他 role 与 RPC/print 排除 | flow/registration 测试通过 | 完整 TUI 扩展组合未执行 |
| 原生 slash 与旧历史不回归；原生 skill 外观 | autocomplete/flow/history-editor 测试通过 | 真实终端与完整 codex-ui 启动未执行 |
| idle、steer、followUp、多条队列只加载一次，消费时快照、图片顺序 | lifecycle 测试通过，真实 runtime/session，替代 terminal 宿主 | 不能当作真实 PTY 证明 |
| reload/resume/tree/fork 不重读，原文编辑，孤立隐藏且不补卡 | lifecycle/history-editor/visibility 测试通过 | 实际安装与 PTY reload 未执行 |
| compaction 保留 user 时快照保留，摘要覆盖后不重注入 | lifecycle 测试通过 | 不扩展承诺超出 Pi 原生压缩边界 |
| 实际加载、重复 reload、回调/快捷键、真实终端与安装产物 | callbacks、安装顺序及重复 reload 的现有测试通过 | 包入口、发布校验、隔离安装、原生/CodexEditor 真实 PTY、中文、自定义快捷键和当前仓库扩展组合全部未完成 |

前两关的文件系统故障与首次 assistant 前不落盘限制保持原样。没有将规划实验或替代 terminal 宿主改称 PTY。

## Continuation and cleanup

本轮已在 #10 Execution 写入计划，只将缺失调查标为完成。Delivery/Verification 记录阻塞，不写 Acceptance、不关闭 Issue、不修改 Map、Spec 或 progress.md。

协调者取得授权前不能恢复上述文件或宣布包验证通过。可继续但本轮尚未推进的独立工作包括使用说明草稿、包入口 TDD、源码入口的隔离离线 PTY fixture；即使完成，也不能替代安装产物验证。取得授权后先修复获批的确切集合并复验，再继续 #10 原计划。

本轮没有启动后台服务、PTY 会话或监听服务器，没有临时安装，没有真实模型请求，没有修改全局 Pi。运行的 pnpm/node/vitest 命令均已结束，无本任务待停止的服务进程或待释放监听端口。正式测试创建的 `.flow-*` / `.lifecycle-*` worktree 临时目录已清理，`find extensions/skill-mentions/__tests__ -maxdepth 1 -name '.*' -type d` 返回为空。dist 只由 build 生成，未手改。
