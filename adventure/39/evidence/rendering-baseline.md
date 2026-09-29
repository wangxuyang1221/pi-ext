# Goal tool rendering baseline

## Scope and status

对应 [Planning #42](https://github.com/wangxuyang1221/pi-ext/issues/42)。产品源码基准 `31f1ed84526cd9df5fc035e881245cbefb627e00`，本场尚未修改产品代码。本报告是源码与文档核验，不是候选 UI 的运行时验收。候选信息密度与异常规则待用户确认。

## Current tools

- `extensions/goal/src/tools.ts` 的三个工具无自定义渲染。`response()` 返回模型侧 JSON 文本与同内容的结构化 `details`，包含目标、状态、预算、已用 tokens、耗时、时间戳、剩余 tokens、usage 完整性和完成后的汇报提示。
- 不存在目标时 `goal: null`，不是调用失败。`update_goal` 的参数状态只有 complete、paused、blocked，读取结果还可出现 active、budget_limited、usage_limited。
- `extensions/codex-ui/src/tools.ts` 为 Read、Write、Edit、Bash 使用 `renderShell: "self"`，避免 Pi 默认背景框。
- `extensions/codex-ui/src/tool-status.ts` 定义 `⏺` 状态标记：pending/running 为 warning，completed 为 success，failed 为 error；被中断或超时为 warning。
- `extensions/codex-ui/src/bash-group-layout.ts` 的完整模式显示 `⏺ Bash(command)`，首行结果前缀为 `  ⎿  `，后续结果缩进五列；默认显示最多三个视觉行，展开后显示完整内容，使用现有展开快捷键。
- Write/Edit 标题使用操作词、路径及可选变更统计，正文缩进；与 Bash 共用标记和主题语义，但并非所有工具完全同一布局。
- `extensions/subagent/src/renderers.ts` 在独立 extension 内实现相同圆点与语义颜色，明确避免跨 extension 构建依赖。可作为 Goal 集成的已有模式。
- Goal 的 `presentation.ts` 是 footer 的事件与计时展示实现，不应为这次工具渲染修改它的行为。历史工具结果应读本次调用的快照，不应读当前 footer 或实时 goal 存储。

## Pi API verification

项目 package.json 与本地实际安装包均为 `@earendil-works/pi-coding-agent` 0.87.0。当前 harness 提供的文档路径为 0.87.1，不以其替代 0.87.0 的具体接口证据。

Context7 定位 `/earendil-works/pi` 并查询自定义工具渲染，结果说明 `renderShell`、`renderCall`、`renderResult` 和行局部 context；检索内容指向 main，没有 0.87.0 的版本保证。因此以下事实再按本地 0.87.0 安装包核验：

- `dist/core/extensions/types.d.ts` 的 ToolDefinition 定义 `renderShell: "default" | "self"`、renderCall、renderResult。
- ToolRenderContext 提供 args、toolCallId、state、lastComponent、invalidate、executionStarted、argsComplete、isPartial、expanded、isError。
- `dist/modes/interactive/components/tool-execution.js` 在展示路径调用 renderer，传入 content 与 details，不要求改变 execute。槽位渲染异常可回退；延后到 Component.render 的错误不应依赖该保护。
- `examples/extensions/todo.ts` 展示保留工具 content/details，仅增加调用标题、结果摘要、展开详情的用法。
- 0.87.1 的 extensions.md、tui.md、themes.md 用于补充生命周期与 TUI 原则；必要接口以上述目标版本的已发布类型和实现为准。

## Candidate integration

以下是技术候选，不代表用户已确认完整方案。

在 Goal 内定义工具 renderer，并在原工具注册处附加 renderShell/renderCall/renderResult。使用 Pi TUI 组件和相同语义主题色，沿用 subagent 独立构建的模式，不从 codex-ui 的 src 跨 rootDir 导入，也不重新注册或包装 execute。不新增计时器，不在渲染时读写文件或 goal 存储。

历史展示以该条 result.details 为准。无结构化详情的错误结果应显示错误文本；其他旧数据/异常数据的回退需要后续明确，不伪造目标状态。

## Candidate default display

待用户决定默认收起视图的信息密度。

候选 A：默认显示操作及目标状态、目标内容预览，再附 tokens/预算和耗时，约三行。示意：

```text
⏺ Updated goal · Complete
  ⎿  统一 Goal 工具 UI
     12.4k / 50k tokens · 3m 12s
```

候选 B：默认只显示操作、目标状态和目标预览，统计信息移至展开详情。更短，但查看用量需要展开。

示意只用于讨论信息层级，不是已运行原型，也不代表标题与各字段的最终格式已确认。

## Verification still required

- 默认摘要、展开字段、状态与异常规则的用户决定。
- 是否制作原型的决定，不能以文本示意代替体验审阅。
- 实施后验证三个工具与真实 codex-ui 同屏、等待/成功/失败、无目标、长目标、窄屏、中文与终端控制字符、展开/收起、主题变化、历史恢复、普通与 fullscreen 模式。
- 原执行、schema、工具 content/details 不变的回归验证，以及 `pnpm run check`。
