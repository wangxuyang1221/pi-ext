# Tool summary prototype

## Question

同一批 MCP 与 Write 调用中，哪种成功摘要更容易扫读，又不会抢占标题？运行后切换四版，对比默认折叠、展开和窄屏显示。

## Landing map

- Target：`extensions/mcp/src/renderers.ts` 的成功摘要，以及 `extensions/codex-ui/src/tools.ts` 的 Write 成功摘要与标题。
- Context：真实 Pi CLI、Codex 主题、编辑器、页脚、Read/Edited 参考行。没有另画一套终端界面。
- Contract：真实 `ToolExecutionComponent`、`renderShell: "self"`、共享行状态、`context.invalidate()`、全局工具展开与终端宽度。切换只重绘，不执行工具。

## Run

```bash
pnpm run prototype:tool-summary
pnpm run prototype:tool-summary --variant 4
pnpm run prototype:tool-summary --variant 2
pnpm run prototype:tool-summary --variant 3 --scene long
pnpm run prototype:tool-summary --scene error --fullscreen
pnpm run prototype:tool-summary:check
pnpm run prototype:tool-summary --pty-smoke
```

在原型内用 `/summary-style 1`、`/summary-style 2`、`/summary-style 3`、`/summary-style 4` 或 `Alt+1/2/3/4` 切换。`Ctrl+O` 展开或折叠 MCP 结果。`Ctrl+D` 退出。

以下四种变体仅比较 MCP，Write 统一采用下文的状态圆点方案。

1. 保留分支、Completed，成功摘要改为灰色。
2. 去掉分支和成功状态词，元数据另起一行，MCP 展开提示靠右。
3. 成功元数据合并到标题右侧，不再占第二行。放不下时依次精简元数据，仍不足则隐藏右栏，优先保留标题。

4. Codex 风格：MCP 仅状态圆点绿/红，默认显示最多五行的灰色结果预览，不显示 Completed、类型和字节数；Write 仅保留标题、路径及行数，不显示 Written 行。

第四版沿用上面的 Landing map，只替换相同工具区域。原型是 Codex 风格适配，不是逐像素复刻：保留 Pi 标题格式、Ctrl+O 原地展开生产全文和现有失败正文；预览严格限制五行，Codex 原版使用近似五行的字符预算。Write 不推断文件新增还是覆盖，不伪造 Added 或增删统计，也不新增 diff。来源见[源码研究](../../docs/research/codex-cli-tool-summary.md)。

MCP 失败和运行中沿用生产状态行，不伪装成成功元数据。

## Write states

本次问题是：隐藏写入中的累计行数后，只通过圆点状态和完成后的总行数，能否更清楚地展示 Write？落点仍为上面的 Write 标题区域。

- 写入中：黄色圆点、Write 和路径。不显示累计行数、字节数或第二行 Writing。
- 写入成功：圆点变绿，在路径后显示灰色总行数；不显示 Written 第二行。
- 写入失败：红色圆点，保留生产错误正文，不显示成功行数。
- 四个变体共用此规则，Ctrl+O 不展开 Write 文件内容。
- `/write-replay` 或 `Alt+R` 回放四秒的写入中状态，然后恢复 fixture 最终结果；`/write-settle` 可提前结束。回放只覆盖呈现状态，不执行写入，也不伪造真实流式事件。重播、重载和退出都会清理计时器。失败 fixture 回放结束后仍显示失败。


## Real system and approximations

- 运行仓库锁定的 Pi 0.84.3；Context7 文档用于确认接口方向，实际接口以本地该版本类型和实现为准。
- 复用生产 Codex UI 与 Write 失败正文。MCP 标题及展开内容固定使用 `prototypes/codex-ui-performance/baselines/tool-summary-20260906.json.gz` 中的变更前 renderer，由启动器仅转译到本次临时 build。这样生产移除 Completed 后，原型前三版仍保留原有对比，展开内容也不会少掉首行。Write 标题和状态切换仍是原型覆盖层。
- 会话、MCP 文本/JSON、Write 参数与执行结果是 fixture。MCP 不启动服务器，Write 不写文件。模型、工具调用和用户 Bash 均被阻止。
- 临时 HOME、配置、会话、编译产物和 workspace 都在本目录 `.tmp/` 下，退出即清理；不读取用户凭据或用户扩展。
- 只验证展示选择，不验证真实 MCP 连接、Write 执行、图像结果或持续流式更新。`--scene error` 检查错误展示；运行中由组件测试覆盖。
- 原型默认正常渲染模式，未验证 `/lowpower` 切换。不要把原型覆盖层迁入生产；选定后在两个正式渲染器分别实现。

## Verification

- `pnpm run prototype:tool-summary:check`：13 项通过，覆盖四版布局、Codex 状态圆点、五行预览与 JSON 字符串、生产展开内容一致性、宽度与中文路径、Write 流式参数不显示累计行数、最终结果恢复、回放及计时器清理、失败和运行中状态、自定义展开键及执行拦截。
- `pnpm run prototype:tool-summary --pty-smoke`：真实 Pi regular 模式启动、切换、展开/折叠、Write 写入中到完成的自动回放、resize、reload 和退出通过。
- `--variant 4 --pty-smoke --fullscreen` 通过，包含第四版直接启动、Write 回放、预览/全文切换及重载后恢复启动变体。
- `pnpm run check`：类型检查通过，652 项测试通过、1 项跳过，构建和发布包边界检查通过。
- 用户已确认方案 4 和 Write 仅在完成后显示总行数的规则。生产实现、独立测试及已知宿主 reload 限制见[实施计划](../../docs/plans/codex-ui-tool-summary.md)。原型通过不代表生产功能或性能已验收。
