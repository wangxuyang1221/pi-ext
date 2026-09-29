# MCP render cache todo

## Understanding

修复长会话中 MCP 历史记录反复排版造成的高 CPU 和输入延迟。先在扩展中缓存未变化组件的最终显示行，保持显示和交互契约；修复后再判断是否还有需要 Pi 上游处理的历史遍历开销。

## User Visible Changes

- 无预期的用户可见行为变化。预览行数、截断文本、状态颜色、展开与收起、历史滚动、终端缩放及主题切换保持原样。

## Evidence

- 目标会话：`01a0eb37-8914-7226-b34d-245e420ba7d0`。用户在在线采样期间确认输入有明显延迟。
- 原进程 CPU profile：不输入的 10 秒基线中，MCP 渲染调用链占非空闲采样时间的 88.3%；20 秒输入采样窗口中占 76.8%。两段运行状态不同，不能用这两个比例推导输入本身增加了多少 CPU。
- 调用链：`Pi.doRender → ToolExecutionComponent.render → ResponsiveLinesComponent.render → previewLines / truncateToWidth → Unicode 分段与测宽`。
- 主要修改位置：`extensions/mcp/src/renderers.ts`。该组件已有结果预处理缓存，但没有最终显示行缓存，`invalidate()` 目前为空。
- 离线实验使用约 500 条有效 MCP 历史记录时，未缓存的组件渲染约 80～90 ms；仅在实验包装层缓存相同宽度的显示结果后，热路径约 0.03 ms 或更低。这不是完整 TUI 输入延迟，也未证明失效逻辑正确。
- 在线环境为 Node.js 22.22.2、Pi 0.87.1；实际调用栈中的扩展依赖为 `pi-tui@0.87.0`。基准需分别记录宿主和扩展依赖版本，不混用不同版本的测量。
- 本地证据：`.scratch/session-input-profile/baseline.cpuprofile`、`typing.cpuprofile` 及对应时间记录。它们不作为必须提交的测试数据，不复制原会话内容到仓库。

## Todo

### 1. Locate

- [x] 核对 Pi 实际更新组件的顺序，明确参数、结果、共享状态、`lastComponent`、主题及 `invalidate()` 的变化如何影响显示；特别确认结果更新后调用行的状态失效，以及宿主是否会原地修改结果内容，形成完整的缓存依赖清单。

### 2. Implement

- [x] 在 `ResponsiveLinesComponent` 缓存最终显示行，覆盖调用行和结果行；同宽、同内容、同状态的重绘不再执行分段、折行、着色或截断。参数、结果、运行状态、错误或警告、展开状态、宽度和主题变化后，下次绘制必须显示最新内容。
- [x] 将缓存失效与生产更新路径连接，避免仅按宽度或闭包身份判定；保留现有 JSON 预处理复用。命中判断只检查必要的轻量状态，不逐帧序列化、哈希或深比较完整结果；每组件仅保存一份当前布局，替换后释放旧引用，不累计宽度历史，不额外复制原始图片或完整工具输出。
- [x] 在 `extensions/mcp/__tests__/` 增加可重复运行的渲染基准工具，支持合成历史和可选的本地会话只读输入，分别报告组件热路径与宿主重绘成本；不依赖个人会话才能运行，不在输出中泄露工具内容。优先复用已有宿主测试设施。

## How To Test

### Contract and regression

- 按 Red-Green-Refactor 执行。先在 `extensions/mcp/__tests__/renderers.test.ts` 写出能检出重复分段、测宽、折行和截断的失败测试，再实现缓存。断言实际昂贵计算的调用次数，不能只断言返回数组引用相同。
- 核对已有测试的输入与预期后复用，尤其保留“JSON 仅预处理一次”和“结果状态影响调用行”的覆盖，不通过删除旧断言掩盖回归。
- 先绘制并缓存 `Calling`，再通过结果渲染路径更新共享状态，不额外重建调用组件；下一次调用行必须正确显示成功、失败、超时或取消。覆盖首次绘制前完成、部分结果、多次更新及无结果状态，按实际生产生命周期构造输入。
- 覆盖内容与参数更新、宿主包装对象替换、展开与收起、窄宽切换、主题切换、显式 `invalidate()`；如宿主允许原地修改内容，也覆盖该更新方式。每次变化后的结果与同状态的新建组件一致。
- 保持中文、emoji、组合字符、ANSI、空结果、JSON、图片提示及超长输出的既有文本、颜色、预览行数和截断规则。不能因缓存改变返回时机、执行顺序、错误语义或工具执行次数。
- 宿主验收输入从本地 MCP 测试服务生成，经 MCP 客户端、工具结果事件、Pi `ToolExecutionComponent` 和实际渲染组件进入终端；覆盖部分结果到完成、失败、展开、缩放及主题切换。静态 fixture 只证明渲染逻辑，不能替代上述生成和传递路径。复用 `ui-host-smoke.py`、`resume-ui-host.py` 前确认其覆盖范围，必要时补足。

### Performance

- 确定性约束：固定宽度和状态预热后，连续 100 次绘制不增加分段、折行或截断调用次数；单个组件变化只使受影响组件的布局失效，不能导致全部历史重算。对 50、500、2000 条记录分别验证，不以总时间降低替代这些断言。
- 资源约束：反复切换宽度、展开和主题后，每个组件仍只保留一份当前布局，不出现按绘制次数增长的缓存；显示行存储允许随组件数量和当前展开内容增长，不要求整个会话使用恒定内存。
- 耗时测量：实现前后使用相同机器、依赖版本、主题、记录和终端宽度，分别测试 100、160 列；预热后至少测量 100 次，记录 p50、p95。约 500 条折叠 MCP 记录的组件热路径 p95 目标为不超过 5 ms。该目标依据是已验证的轻量缓存命中路径及约 1000 个组件的简单遍历成本，并为波动留出余量，不是从旧实现耗时按比例推导。
- 分别记录首次布局、内容更新、展开和缩放的成本，确认它们仍按原有截断上限处理，不把全部历史的昂贵工作转移到每次状态更新。若耗时目标未通过，查明原因再调整实现，不能直接把首次实现的测量值改成验收线。
- 端到端验收使用相同负载分别覆盖模型等待和持续输出期间的输入；比较事件循环等待、输入到绘制延迟和 CPU profile，区分 MCP 组件、Pi 历史遍历与终端输出成本。通过条件是未变化历史不再反复进入昂贵布局路径，且实际输入延迟得到改善；组件基准通过不等于端到端验收通过。
- 原会话可能持续增长，前后比较使用只读快照或相同生成数据，不直接比较不同时间的活动会话。原进程复测、重新开启调试端口、重载扩展或重启会话均须另行确认；测试完成后关闭诊断端口并停止本任务启动的服务。

### Final validation

- 运行 `pnpm exec vitest run extensions/mcp/__tests__/renderers.test.ts`、适用的宿主回归与新增基准，最后运行 `pnpm run check`。
- 在本节记录运行命令、版本、测量结果及未验证项。功能保护和性能验收均通过后，才勾选对应实现项；缺少在线或宿主证据时明确保留未完成项。

### Verification results

2026-09-29 完成实施，未重载、重启或修改用户原会话。

- 生命周期核验依据为本地 Pi 0.87.0 与 0.87.1 的 `ToolExecutionComponent.updateDisplay()`、`updateResult()` 和主题失效路径；Context7 的 0.87.1 文档用于交叉确认。宿主先调用调用行工厂，再调用结果行工厂，实际绘制在后面。因此调用行在绘制时检查共享的状态与警告标志，其余更新通过 `setRenderer()` 或 `invalidate()` 清除当前布局，不按闭包身份判断。
- MCP 的 `execute()` 经 `toPiToolContent()` 返回新内容数组，不发送部分结果，也不原地修改已经交付的结果。继续保留现有预处理缓存的引用语义；宿主包装对象替换不会重新解析 JSON。部分结果到完成的覆盖位于原生宿主测试，不宣称 MCP 传输会产生部分工具结果。
- Red：新增未变化历史重绘测试在旧实现上失败，100 次重绘产生 1000 次 Unicode 分段调用。Green：新增缓存后通过，分段、测宽、截断和着色计数均不增加。50、500、2000 条历史记录的确定性测试通过；单组件失效、共享状态变更、单槽宽度缓存、显式失效、结果替换及主题回归通过。
- `pnpm run check` 通过，172 个测试文件通过、4 个按既有条件跳过；2606 个测试通过、13 个跳过。类型检查、构建和发布包检查通过。新增 TypeScript fixture、JavaScript 基准及 Python 驱动另行通过语法或类型检查。

可复跑命令：

```bash
# Compile and run the complete repository checks.
pnpm run check

# Component and native host benchmark, 500 synthetic MCP rows, 100 measured frames.
node extensions/mcp/__tests__/render-benchmark.mjs --check

# Optional read-only session input; no message content is logged.
node extensions/mcp/__tests__/render-benchmark.mjs --session <session.jsonl>

# Real PTY input and a real local stdio MCP call, using repository Pi dependencies.
conda run -n codex-py312 python extensions/mcp/__tests__/render-input-host.py --check

# Before/after CPU profiles in separate test hosts; no debugger TCP port is opened.
# --baseline reads HEAD's renderer, so retain the original baseline when comparing after commit.
conda run -n codex-py312 python extensions/mcp/__tests__/render-input-host.py --baseline --profile-dir .scratch/mcp-render-cache/host-profiles
conda run -n codex-py312 python extensions/mcp/__tests__/render-input-host.py --check --profile-dir .scratch/mcp-render-cache/host-profiles

# Native UI regression, including expansion, errors, theme changes and restored history.
conda run -n codex-py312 python prototypes/tool-status-prototype/smoke.py --production --mcp-only --restart
conda run -n codex-py312 python prototypes/tool-status-prototype/smoke.py --production --mcp-only --restart --fullscreen

# Real MCP transport and session restoration. Match the explicitly selected Pi version.
conda run -n codex-py312 python extensions/mcp/__tests__/resume-ui-host.py --pi-root node_modules/@earendil-works/pi-coding-agent --pi-version 0.87.0 --live
```

测量环境为 Node.js 22.22.2、pnpm 11.9.0、Python 3.12.13。组件基准使用仓库 Pi/pi-tui 0.87.0；PTY 性能与 profile 通过 `--pi-root` 指向已安装的 Pi 0.87.1，扩展依赖仍为 0.87.0，不修改依赖版本。

| 500 条合成历史的测量 | 修复前 | 修复后 |
| --- | ---: | ---: |
| MCP 组件热路径 p95，100 列 | 171.200 ms | 0.064 ms |
| MCP 组件热路径 p95，160 列 | 173.340 ms | 0.020 ms |
| 原生宿主重绘 p95，100 列，内存终端 | 148.188 ms | 0.922 ms |
| 原生宿主重绘 p95，160 列，内存终端 | 196.173 ms | 0.982 ms |
| 实际 PTY 输入回显 p95，等待时，120 列 | 318.268 ms | 4.228 ms |
| 实际 PTY 输入回显 p95，模型持续输出时，120 列 | 494.474 ms | 3.181 ms |
| 独立宿主 profile 中 MCP 占非空闲采样时间 | 95.99% | 0.04% |

- PTY 延迟测量从父进程写入固定短串开始，到从子进程终端输出读到完整短串结束，包含输入处理、调度等待和重绘，不等同于终端模拟器显示像素的延迟。每种状态测量 30 次，确认持续输出覆盖整个输入采样窗口。`--check` 要求 p95 小于 50 ms，为一帧级更新及本地 PTY 调度留出余量；不要求所有机器或实际会话都达到表内具体数字。没有单独分解事件循环等待时间。
- profile 独立采集，避免将采样开销混入上述未采样延迟；采样时修复后的等待/输出 p95 分别为 7.925/10.927 ms，仍通过 50 ms 验收。
- 首轮缩放测量有尾部波动，随后在同一进程交替测量旧版与新版的冷布局。100 列中位数为 154.059/153.459 ms，160 列为 180.847/181.210 ms，未发现冷布局成本转移。冷布局与缩放仍需排版全部相关内容，不宣称它们获得热缓存同等收益。
- 普通与全屏 PTY 状态回归通过，覆盖成功、失败、取消、超时、展开、缩放、主题切换、扩展重载和会话恢复。该状态脚本使用合成执行结果；真实 MCP 客户端到原生终端的路径由本地 stdio echo 与 `resume-ui-host.py --live` 补验，Pi 0.87.0 和 0.87.1 均通过。
- 本地会话输入选项使用独立生成的 JSONL 验证，未复制个人会话。基准与 profile 证据位于 `.scratch/mcp-render-cache/`，状态界面回归记录位于 `.tmp/tool-status-smoke-*.json`。
- 测试宿主及其 stdio MCP 子进程均已退出，没有新增监听端口。用户原会话仍使用旧的内存中代码，尚未做原进程更新后的体感复测；生效操作须由用户选择合适时机。

## Notes

- 本次修改实现和对应测试，`dist/` 仅由构建生成；未修改用户配置或操作正在运行的会话，未创建提交。
- 不以降低刷新率、减少预览行数、默认折叠更多内容、删除历史或强制压缩上下文替代缓存修复；不修改模型请求及工具执行逻辑。
- Pi 仍可能逐帧遍历历史组件。修复后的 profile 若显示这成为主要瓶颈，再单独讨论上游历史块缓存、增量布局或屏幕外延迟布局；这些变更不在本次实现范围内。
- 不顺带升级 Pi 或依赖。若核验发现版本兼容性影响缓存契约，先说明影响并确认范围。
