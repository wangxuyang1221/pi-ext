# Tool summary implementation plan

- Status: `Implemented; acceptance pending`
- Scope: `extensions/mcp`, `extensions/codex-ui`
- Design: `Approved variant 4 with final-only Write line count`
- Delivery method: `Red-Green-Refactor`

## Understanding

将用户确认的[原型方案 4](../../prototypes/codex-tool-summary-prototype/README.md)落到生产渲染器：MCP 使用状态圆点和灰色结果预览；Write 写入中不显示累计行数，成功后才显示总行数。生产渲染已接入，最终验收尚未关闭。真实 CLI 的历史 MCP reload 样式存在变更前已可复现的宿主限制，详见下方 Implementation results。

### Accepted behavior

| Area | Required behavior |
| --- | --- |
| MCP title | 保留现有工具名、参数摘要、对齐和宽度规则。成功仅圆点变绿，失败圆点变红；正文不因成功变绿。进行中保留现有 Calling/Running 表达 |
| MCP collapsed | 去掉 Completed、类型、字节数及成功行的 expand 提示；显示最多五个终端视觉行的灰色预览，首行 `  └ `，续行四列缩进。超限以 `...` 收尾；空结果不增加空白摘要行 |
| MCP expanded | 沿用 Pi 的全局 Ctrl+O，不迁移 Codex 的 Ctrl+T。显示灰色详细内容，保留生产展示上限与截断说明；“展开”不意味着绕过原有结果限制 |
| MCP JSON | 折叠预览使用带分隔空格的紧凑 JSON；展开保留现有格式化内容。失败保留明确错误正文，不只靠颜色表达 |
| Write pending | 黄色圆点、Write 和路径。不显示累计行数、字节数或第二行 Writing；参数逐步到达也不统计正文行数 |
| Write success | 绿色圆点，在路径后显示灰色最终总行数，如 `Write src/config.ts (20 lines)`；没有 Written 第二行，不新增文件内容展开 |
| Write failure | 红色圆点和现有错误正文，不显示成功行数，不将取消或异常归为成功 |
| Other tools | Read、Edited、Grouped Bash、用户 `!` Bash、编辑器、页脚及其交互不变 |

## Todo

### 1. Locate

- [x] 核对 MCP 注册入口 `extensions/mcp/src/index.ts` 与 `renderers.ts`、Write 在 `extensions/codex-ui/src/tools.ts` 的 full/low-power 两条路径，确定 call/result 共享状态和历史恢复的完成判定；记录需更新的生产断言，避免把原型的状态投影直接迁入生产。

### 2. Implement

- [x] 在 MCP 生产渲染器接入方案 4 的圆点颜色、五行灰色预览及灰色展开内容；显式区分未完成、成功和失败，兼容 `context.isError` 与 `details.isError`，保留参数脱敏、控制序列清理和现有结果上限。
- [x] 让 MCP 预览复用现有结果规范化路径，保留纯文本、JSON、structuredContent、图像及混合结果的可用展示；停止生成已删除的成功类型/字节数摘要，不以原型的 text-only fixture 取代生产兼容逻辑。
- [x] 在 Write 的 full/low-power 路径统一实现“进行中圆点、完成后总行数”；删除累计行数和字节数的渲染计算，最终有效内容只计数一次并复用，保留路径格式化、错误正文和宿主非法参数处理边界。
- [x] 扩展现有真实 Pi 工具 fixture 与性能入口，加入生产 MCP 预览/展开/宽度切换的 before/after 对比，并复用已有 Write 参数流负载；快照和报告纳入本次两个扩展的源码哈希，不能用旧 Bash 基线冒充本轮基线。

### 3. Deliver

- [ ] 更新根 README 与本计划的实施结果，清理正式渲染器中不再使用的成功摘要代码；保留原型用于追溯，不把变体切换、回放计时器或 fixture provider 打包进生产。记录功能和性能验收证据及仍未验证的范围。

## How To Test

### Behavior and regressions

实现每项前先添加对应失败测试，最小实现转绿后再重构。测试落在 `extensions/mcp/__tests__/`、`extensions/codex-ui/__tests__/`，不要只改原型测试来证明生产完成。

- MCP 成功：默认预览不出现 Completed、类型/字节数行或逐行展开提示，只有状态圆点使用成功色。多行文本、长单行和多个 content block 合计不超过五个视觉行；空内容无多余结果行，超限有 `...`。
- MCP 内容：紧凑 JSON 保留字符串中的逗号、冒号、引号、反斜杠和 Unicode；structuredContent 回退仍有效。纯图像和混合结果不丢失现有图像展示或可用提示，不泄露原始编码数据。仅凭“尚无结果”不能判定失败或成功。
- MCP 状态与展开：覆盖 pending、partial、成功、传输异常、`details.isError`、取消。Ctrl+O 展开/收起后正文一致，错误文字和生产截断说明保留；主题切换不得留下旧颜色。
- Write 参数流：固定路径，依次送入 0、3、10、20 行的累计参数快照。最终结果到达前始终只有黄色圆点与路径，无行数、字节数和 Writing 行；成功结果到达后一次显示绿色圆点与 20 行，失败则显示红色圆点与错误正文。Ctrl+O 不增加 Write 正文。
- Write 边界：空字符串为零行、尾随换行沿用现有计数语义；非字符串或缺失参数不伪造零行成功。恢复历史时，即使 `argsComplete` 未置位，只要已有最终成功结果，也应直接显示绿色圆点和最终行数。
- 宿主回归：使用真实 `ToolExecutionComponent` 检查 call/result 无重复行、无多余空卡片；覆盖宽度 0/1/2/24/60/120、中文/emoji/ANSI、并发工具、reload、会话恢复和切换。full/low-power 均遵守 Write 新契约，不改变已有的行级模式锁定规则。
- 真实 CLI：复用隔离 provider/MCP fixture，在 regular 与 fullscreen 下验证生产渲染、Write 真实工具生命周期、Ctrl+O、自定义展开键、resize、reload 和新进程恢复。所有写入仅限仓库内临时 workspace；结束清理本次进程和临时目录，不触碰用户正在运行的原型。JSON/RPC/print 输出不混入 TUI 文案。

### Performance

本次涉及参数流和终端重绘关键路径，需要单独验收，功能测试通过不等于性能通过。

- 基线时机：第一次修改生产源码前，保存当前工作树两个扩展的不可变源码快照及哈希。记录 Node、Pi 实际版本与模块路径、主题、终端尺寸和运行参数；保留旧报告，不覆盖历史基线。当前已有未提交的 Bash 改动属于基线的一部分，不能回退到 HEAD 比较。
- 确定性成本：Write 参数流期间正文换行扫描和字节统计均为零；完成后同一有效内容的行数统计只执行一次，重复绘制、展开和 resize 不重新计数。没有累计进度导致的标题变化，但不额外节流宿主更新。
- MCP 成本：同一已准备结果不因状态着色或普通重复绘制重新 JSON 解析；折叠路径不要先生成完整展开布局再取前五行。先应用现有输入上限，预览达到可见边界及超限判定后停止布局；若新增缓存，必须有明确容量和会话清理，不建立无界多宽度历史。
- 代表负载：复用[现有基准](../../prototypes/codex-ui-performance/README.md)的 Write 256 KiB 内容、每 256 字符一次参数更新、每 16 次更新绘制一帧，并包含已有的含/不含累计 JSON 两种口径。MCP 使用短结果、长无空格文本、接近现有展示上限的 JSON、多块结果；覆盖 0/20 个历史工具及折叠/展开、宽度往返，不机械叠加所有最大负载。
- 测量方式：先运行 `pnpm --dir prototypes/codex-ui-performance run build`，再顺序运行对应 `bench` 与 `memory` 场景。Write 流式场景复用 `PI_PERF_ONLY=streams`；MCP 使用上述扩展后的入口，并在报告记录精确命令。基准不得并行，使用相同环境多轮和正反顺序比较 CPU、帧耗时中位数/p95、终端输出字节与 GC 后保留内存。
- 通过依据：成本断言全部通过；Write 流式正文扫描归零且不再因累计行数重放历史；未变路径无超出本轮基线波动的稳定退化，重复结果/resize 后内存不持续增长。新增 MCP 预览的成本与旧摘要不是相同工作量，需单独报告增量；尚无绝对毫秒或内存预算，不虚构阈值，出现稳定退化或资源增长时先定位并确认是否接受。

### Final verification

- `pnpm run prototype:tool-summary:check`：保留已批准原型的行为参照，但不替代生产测试。
- `pnpm run check`：类型检查、生产测试、构建和发布包边界全部通过；`dist/` 仅由构建生成，不手工修改。
- 将真实 CLI 和性能报告路径写回本计划。受环境限制无法验证的项目明确记录缺少的证据，不以静态截图或原型回放替代。

## Implementation results

生产只改动 `extensions/mcp/src/renderers.ts` 与 `extensions/codex-ui/src/tools.ts` 的 Write 区域及已删除摘要对应的 helper。相对本轮快照，Bash 等其他源码保持不变。Locate 记录、逐轮 Red/Green、源码哈希、精确复现命令、CLI 与性能数据见[生产验收报告](../research/codex-ui-tool-summary-validation.md)。

- 变更前快照：`prototypes/codex-ui-performance/baselines/tool-summary-20260906.json.gz`，包含当前 Bash 与 MCP 全部源码。变更前生产测量位于 `results/tool-summary-baseline-streams`、`results/tool-summary-baseline-mcp-terminal`、`results/tool-summary-baseline-mcp-memory-complete`，这些 results 路径均位于 `prototypes/codex-ui-performance/`。
- 生产组件覆盖 MCP 显式状态、灰色预览/展开、有界成本、JSON/structuredContent/图像提示、空结果、控制序列、错误、主题与并发行；Write 覆盖流式零扫描、最终一次计数、历史恢复、非法参数、模式锁定、宽度和失败状态。
- `pnpm run check` 通过，666 项测试通过、1 项跳过；原型 13 项通过。原型 MCP renderer 已固定到变更前快照，避免生产变更破坏已批准的对照。
- CLI 报告：`results/tool-summary-final-cli*`，包含 Pi 0.84.3 与本机 0.85.1 的 regular/fullscreen、默认 Ctrl+O/自定义 Ctrl+G、真实 Write 成功/失败、本地 stdio MCP、resize、收起、新进程恢复。
- 性能报告：`results/tool-summary-final-streams*`、`results/tool-summary-final-mcp*`、`results/tool-summary-final-stable*`。Write 正反顺序测试均显示流式输出从约 11 KiB 降到 164 B；累计 JSON 解析成本不变。MCP 新增预览有额外绘制与约 1.5 至 2.2 MiB 的 20 行结果保留开销，未观察到随结果/宽度持续累计。增量按新增工作量单独报告，不设置虚构预算。
- `results/tool-summary-final-verify` 通过 2203 项帧/宽度比较和 56 个解析终端帧。

Deliver 暂不勾选。README 和验收记录已更新，但 `/reload` 后历史 MCP 行回退到默认渲染；`results/tool-summary-cli-baseline-reload` 证明变更前快照也有该问题，0.85.1 同样复现。宿主在 `session_start` 的动态工具注册之前重建历史行。未修改上游私有组件或连接机制；需要后续修复此宿主时序问题，或由用户明确接受该已知限制后再关闭验收。重启并恢复会话可正常显示新样式。

真实 CLI 的会话切换、图像协议显示、中途取消仍未独立验收；low-power 已通过组件测试，未新增人工视觉确认。未将原型回放或静态截图当作这些项目的证据。

## Notes

- 本次是方案 4 加最终版 Write 规则，不是 Codex CLI 逐像素复刻，也不是此前“只有元数据、结果完全隐藏”的方案 2/3。
- 原型仅在 Pi 0.84.3 上验证；实际交付版本需结合仓库依赖与目标安装再次核对。Context7 只提供接口参考，目标版本本地类型和官方示例才是接入依据。
- low-power 未在原型中确认；本计划拟保持其低成本实现和模式切换机制，只统一上述 Write 可见状态，不扩大到其他工具的 low-power 改造。
- 不修改 MCP 传输/重试、工具参数和结果、文件写入语义、权限、取消机制或上游 Pi；不增加设置项、主题颜色键和产品状态文案。
- 不迁移 `/summary-style`、`/write-replay`、Alt+R 或任何原型 timer。真实状态只能来自工具生命周期。
