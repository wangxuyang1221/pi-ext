# Codemode validation

## Scope

正式接入方案 2 调用树与共用 `/inspect`。生产入口不包含布局切换、离线 provider、权限测试 hook 或原型命令。`registerCodemodeUi()` 只注册 renderer、事件观察和命令，不替换 codemode 执行器，不增加模型请求，不修改工具声明、权限、模型可见输出或计费信息。

实现入口：

- `extensions/codex-ui/src/codemode.ts`：renderer、事件订阅、当前分支恢复和面板。
- `codemode-model.ts`：按 ID 记录父子关系、状态和元数据。
- `codemode-data.ts`：有界数据副本与原始子结果缓存。
- `codemode-view.ts`：调用树与响应式面板布局。
- `codemode-presentation.ts`：现有 Read/Bash 布局、Edit/Write renderer 复用及派生缓存。

Read/Bash 使用原有布局函数，但为子调用创建独立、短命的分组，不把子调用加入顶层分组。Edit/Write 只调用已有 renderer，不调用执行函数。数据被截断时退回通用预览，不从残缺 patch 生成 diff。

## Host contract

依据锁定依赖 Pi 1.3.0 的 `docs/extensions.md`、`docs/tui.md`、`docs/codemode.md`、SDK 示例及 `dist/core/nested-tool-calls.js` 核验，并用真实 QuickJS 执行验证。

- `tool_execution_*` 的 `parentToolCallId` 连接实际父子调用。兄弟按开始顺序固定，树遍历让后启动的后代仍紧邻自己的父节点。
- `details.calls` 中的 `parent/?` 是临时条目，不计数。普通工具使用嵌套执行事件；`models.*` 依赖快照，增量检查新增槽位及尚未结束的模型调用。
- `nestedCalls` 是宿主持久化的元数据，不含原始子结果。宿主上限为 256 项、每项参数 8 KiB、总参数 32 KiB；`complete: false` 不能解释为全部成功。`details.calls` 可以提供额外摘要，但不能补造原始正文。
- 父执行结束和最终消息覆盖较早的快照。最终状态之后的迟到执行事件不再改写记录；`unfinished` 不覆盖已观察到的取消状态。宿主中断时可能只留下未结束子项，该项显示 `unknown`，父项仍显示 `Interrupted` 或 `Timed out`。
- 脚本错误类型依据失败结果最后一段宿主 `Script error:` 诊断识别，不因普通输出中的超时文字而标为超时。不执行或解析 JavaScript 来推断子调用。
- 恢复仅使用当前分支的 `buildContextEntries()`。重启、分支切换、reload、compaction 清理运行时子结果，缺失开始时间、参数和正文明确说明。

## Budgets

以下是 UI 自身的条数和记账预算，不是进程 RSS 上限，也不限制宿主会话原文。

| Data | Limit | On limit |
| --- | --- | --- |
| Parent records | 32 | 淘汰旧记录，已挂载旧行保留不可用提示 |
| Child records | 每父 1024，合计 4096 | 标记不完整，必要时淘汰旧父记录 |
| Child arguments | 4096 字符预算，最多 2048 节点、12 层 | 保留有界副本，明确参数缺失；敏感键值脱敏 |
| Script / parent output | 各 65536 字符 | 截断提示；保留宿主输出路径但不自动读文件 |
| Child results | 总记账 4 MiB，每份副本 32 Ki 字符预算，加 256 字节记账开销 | FIFO 淘汰，不改变调用状态；图片只保留占位 |
| Derived layouts | 4 MiB | 使用现有 `ToolRenderCache` 淘汰 |
| Derived counts | 128 KiB | 使用现有缓存预算 |

收起态只遍历前 5 个调用，不准备子项正文；失败摘要最多 3 条，另显示剩余失败数量。展开最多显示保留的 1024 项。详情只准备所选调用，滚动复用同一份折行结果；宽度、主题、低功耗、内容版本和结果淘汰改变缓存键。没有新增轮询或动画计时器。

## Verification

环境为 Node v22.22.2、pnpm 11.9.0、Pi 1.3.0。

```bash
pnpm run check
pnpm run codemode:check
pnpm run prototype:codemode-ui:check
```

- `pnpm run check` 通过类型检查、测试、构建、发布包与宿主加载检查。182 个测试文件通过，2703 项通过；仓库已有 4 个文件、13 项条件性测试跳过。宿主 source/dist 加载均无错误，保留已有仓库 MCP 替代内置 `/mcp` 的提示。
- Codemode 专项 17 项单元/集成测试通过。覆盖稳定顺序、临时 ID、模型辅助调用快照、状态优先级、恢复、预算、宽度、隐藏失败、原始输出分离、缓存局部失效和无历史提示。
- TDD 回归包含快照重复全扫、取消状态被未完成记录覆盖、脚本普通输出误判超时、长行裁剪缺少省略号，以及展开 Bash 仍使用三行预览。均先观察对应断言失败，再修复通过。
- 生产离线入口以 faux provider 发送真实调用，使用真实 QuickJS、工具校验和权限 hook。9 个 headless 场景全部通过：成功、捕获子失败、脚本抛错、超时、权限拒绝、多层嵌套、MCP、24 项、无调用。Read/Edit/Write/Bash 均真实执行，只操作隔离临时 workspace。MCP 使用真实本地 stdio 测试服务器。
- 普通及全屏 PTY 均通过：调用树、原生 diff、三个面板视图、宽度 40/80/120、主题切换、低功耗、中断、分支往返、reload、compaction、保存并重启恢复。历史检查要求显示 raw result unavailable，不能复用旧分支缓存正文。
- 原有仓库 MCP HTTP 集成测试仍验证直接 MCP 和 codemode 均只执行一次，并增加调用树断言和执行函数身份不变断言。退出时检查服务停止且 sockets 清空。
- 六布局原型的 7 项测试、5 个真实 QuickJS 场景、普通/全屏 PTY 全部通过。原型只屏蔽生产 codemode renderer 和 `/inspect` 注册，保留自己的比较入口。

验收入口、fixture 和 PTY 脚本均在 `extensions/codex-ui/__tests__/`。临时 HOME、agent dir、session、workspace 全部位于仓库 `.tmp/`，不读用户凭据，不连接生产网络，退出清理目录和子进程。

## Measurements

下表来自专项检查中的 `fixtures/codemode-benchmark.mjs`。使用固定通用工具元数据，逐项提供 1 KiB 或 1 MiB 文本；包含副本截断与淘汰，不代表完整大输出渲染成本。耗时是单次观察，不作为通过阈值；断言检查预算、隐藏正文零准备、详情滚动复用和清理归零。

| Calls | Input per child | Expanded cold / hot ms | Inspector cold / hot ms | Retained results | Result bytes | Layout bytes |
| --- | --- | --- | --- | --- | --- | --- |
| 24 | 1 KiB | 2.103 / 0.442 | 0.213 / 0.010 | 24 | 59616 | 34372 |
| 24 | 1 MiB | 1.337 / 0.361 | 1.815 / 0.007 | 24 | 1579008 | 233630 |
| 256 | 1 KiB | 7.932 / 3.231 | 0.047 / 0.006 | 256 | 635904 | 298872 |
| 256 | 1 MiB | 4.943 / 2.275 | 0.859 / 0.011 | 63 | 4144896 | 366334 |
| 1024 | 1 KiB | 27.426 / 13.325 | 0.157 / 0.025 | 1024 | 2543616 | 1176084 |
| 1024 | 1 MiB | 20.884 / 9.217 | 0.760 / 0.016 | 63 | 4144896 | 718234 |

大量展开项仍需拼装可见行，热渲染不是常数时间。大结果工作负载更快的原因包含淘汰后显示缺失提示，不代表大输出比小输出便宜。

## Remaining limits

- 不新增完整原始结果持久化，也不读取输出路径补齐被截断内容。重新打开历史时可能只有参数和状态，不保证 diff 可恢复。
- 分类器、图片生成的状态元数据有单元覆盖，但未调用付费服务验收；没有专属图片/分类器面板。
- 生产 `/inspect` 当前无仓库命令冲突；外部扩展若注册同名命令，仍需在安装配置中处理冲突，不静默改名。
- 原型是设计对照，不进入发布包。生产只启用方案 2。
