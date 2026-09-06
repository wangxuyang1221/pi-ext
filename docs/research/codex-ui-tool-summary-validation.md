# Tool summary production validation

## Status

方案 4 的生产渲染已实现，功能与性能验证结果如下。最终验收未关闭：真实 CLI 的历史 MCP 行在 `/reload` 后回退到宿主默认渲染，变更前快照也能复现。没有为绕过此问题修改上游私有组件或 MCP 连接逻辑。

本报告对应[实施计划](../plans/codex-ui-tool-summary.md)，不替代原计划或新增设计方案。

## Baseline and scope

- Node `v22.22.2`，pnpm `11.9.0`，仓库依赖 Pi `0.84.3`。本机全局 CLI 为 `0.85.1`，没有升级仓库依赖。
- 不可变快照：`prototypes/codex-ui-performance/baselines/tool-summary-20260906.json.gz`，生成于 `2026-09-05T15:51:58.345Z`，早于本轮生产改动。快照包括当时未提交的 Bash 改动及两个扩展全部源码。
- 快照 SHA-256：`1fce6cc621ee7e9ed2e0e88444dce0e60eab6467937e14fa39fd601e6308518b`。
- 相对该快照，生产源码只改变 `extensions/codex-ui/src/tools.ts` 与 `extensions/mcp/src/renderers.ts`。工具执行、MCP 注册、传输、重试、权限、取消与持久化没有改变。
- 测量时 `tools.ts` SHA-256：`36b61fcfa05ea3cf6475d70d7c479dbc30b2486b80a621678b8d36214a494848`。收尾仅删除 EOF 多余空行，最终源码 SHA-256 为 `0f9146aa064049698f369f15d77deef3c3ac17fadb37fb0c07ffa749afa2aba4`；重新执行 `pnpm run check` 后，生成的 `dist/tools.js` 与测量版本完全一致，SHA-256 均为 `57424111a5dea4ae26777c1f9a6965573e56b84e578b6dfa18c8cb053bdd4eef`。保留报告原始哈希，不覆盖测量记录。
- 最终 `renderers.ts` SHA-256：`e98aefb1ee4958165e9cb5d8f6c1c294c8d3f74d901ca8d90ef7e7e4f8330376`。
- Context7 `/earendil-works/pi` 仅返回主分支参考。实现依据是仓库实际安装的 `0.84.3` 类型、宿主源码及完整 extensions/TUI/theme/keybindings 文档，未照搬新版本接口。

## Locate findings

宿主先调用 call slot，再调用 result slot，最后绘制组件。`context.state` 属于单个工具行；最终结果恢复时 `argsComplete` 仍可能为 false。Write 在 result slot 写入状态和最终 metrics，只使本行 call component 的缓存失效，不递归调用宿主 `context.invalidate()`。MCP 标题绘制时读取共享结果状态，兼容宿主错误标志和 `details.isError`。

Write 的 full/low-power 保留首次渲染时的模式锁定。进行中不读取内容来计数；成功后按有效字符串计数一次，重复绘制、展开和 resize 复用计数。失败不读取正文参数，不显示成功行数。full 模式的非法完成参数仍在 slot callback 内进入宿主 fallback，不把异常推迟到实际绘制。

MCP 在结果组件中只保留一份规范化结果，按 content 与 structuredContent 身份复用；宿主每次创建的新外层 wrapper 不触发重复解析。detail、preview、expandedDetail 分别受 50 KiB 清理上限约束，展开仍保留 2000 个视觉行及截断说明。预览按 grapheme 读取到第五行及超限判定为止，不创建完整展开布局。缓存不带主题颜色、不保存多宽度历史，也不进入全局 Map；替换结果覆盖旧值，宿主释放行时一起回收。

## Red and Green evidence

每轮运行针对性测试并观察失败后再实现，未一次铺开全部新测试。

| Test | Observed Red | Green behavior |
| --- | --- | --- |
| Write stream and restore | 进行中显示 `(0 lines)` | 0/3/10/20 行参数快照只显示标题，最终结果直接显示 20 行 |
| MCP compact preview | 返回 Completed/JSON/字节摘要 | 返回灰色紧凑 JSON，不带成功摘要 |
| Shared MCP status | 无结果时显示 Called | 无结果保持 Calling，成功/失败首帧圆点状态正确 |
| Prepared JSON reuse | 反复绘制和 wrapper 替换解析 16 次 | 同一内容只解析 1 次 |
| Preview cost | 对完整长 token 调用 wrap | 只布局可见预览，最多五行并标注溢出 |
| Escaped JSON strings | 字符串中的逗号/冒号被加空格 | 转义引号、反斜杠与 Unicode 原样保留 |
| Image and dim detail | 纯图像无可用提示 | 保留 Image 提示，成功详情为 dim，不输出编码数据 |
| Empty result | 展开多出空白结果行 | 两种视图均无额外空行 |
| Deep JSON | 格式化抛出 RangeError | 回退到有界原始内容 |
| Missing result | 无结果被当成成功 | 保持 pending |
| Malformed Write | 完成的非法参数不进入宿主 fallback | 异常保留在宿主 slot 边界，错误正文仍可见 |
| Snapshot/build infrastructure | 快照和 build 缺少 MCP | 两个扩展均有源码与哈希，快照拒绝覆盖 |

另有回归断言覆盖正文扫描与字节统计归零、最终计数只执行一次、空字符串与尾随换行、模式锁定、错误与取消正文、宽度 0/1/2/24/60/120、中文/emoji、控制序列清理、structuredContent、并发独立行及主题切换。

批准的原型原先从生产渲染器取展开正文并跳过旧摘要行，生产迁移会使它少掉首行。启动器现从本轮不可变快照转译旧 MCP renderer 到临时 build，保留四版原型及原来的 13 项断言，没有把新生产行为改回原型假设。

## CLI evidence

报告根目录为 `prototypes/codex-ui-performance/results/`。

| Report directory | Coverage |
| --- | --- |
| `tool-summary-cli-baseline-reload` | 变更前快照，0.84.3 regular，复现历史 MCP reload 回退 |
| `tool-summary-final-cli` | 0.84.3 regular/fullscreen，默认 Ctrl+O |
| `tool-summary-final-cli-custom` | 0.84.3 regular/fullscreen，自定义 Ctrl+G |
| `tool-summary-final-cli-0851` | 本机 0.85.1 regular/fullscreen，默认 Ctrl+O |
| `tool-summary-final-cli-custom-0851` | 本机 0.85.1 regular/fullscreen，自定义 Ctrl+G |

每次调用真正的 Write 工具，在临时 workspace 写入并核对 20 行文件；对目录的真实写入失败用于验证错误状态。本地 stdio MCP echo server 走正式注册、调用和结果转换，非渲染 fixture 替代。观察参数流期间无行数、成功最终计数、失败正文、五行预览、展开、resize、收起和新进程恢复。日志按调用 ID 核对 3 次执行及 `[false, true, false]` 最终错误标志，不假定并发完成顺序。

报告中的 `reloadMcpRendererRetained: false` 明确表示未通过 reload 样式验收。Pi 的 reload 在 `beforeSessionStart` 中重建历史行，此时动态 MCP 工具尚未重新注册；随后注册不会替换已创建工具行持有的 definition。变更前快照同样失败，0.85.1 也复现。测试没有把 `/reload` 通知出现等同于样式恢复。重启进程后恢复会话则通过。

所有 HOME、配置、会话、文件写入和临时 build 均在仓库内；本轮启动的 CLI/expect/MCP 进程和临时目录已清理，没有终止用户原型。

## Performance evidence

全部基准串行执行，未和 CLI 或其他基准并行。before/after 使用同一源码快照、终端尺寸和主题。每份报告记录实际 Pi 模块路径、版本、dist 哈希、基准脚本哈希和两个扩展源码哈希。

### Write

`tool-summary-final-streams` 与 `tool-summary-final-streams-reverse` 各运行 5 轮，首轮预热。256 KiB 内容，每 256 字符更新一次，每 16 次更新绘制一帧。以下帧指标包含绘制和 xterm 解析，不含累计 JSON 参数解析；CPU 总量为整次负载。

| Order and input | CPU median before → after | Frame median before → after | Frame p95 before → after | Output bytes before → after |
| --- | --- | --- | --- | --- |
| Forward, no JSON | 38.17 → 15.26 ms | 1.534 → 0.103 ms | 2.197 → 0.175 ms | 11163 → 164 |
| Reverse, no JSON | 34.08 → 12.75 ms | 1.498 → 0.069 ms | 1.778 → 0.122 ms | 11163 → 164 |
| Forward, cumulative JSON | 1881.32 → 1880.62 ms | 1.489 → 0.086 ms | 1.689 → 0.116 ms | 11643 → 164 |
| Reverse, cumulative JSON | 1880.93 → 1866.23 ms | 1.492 → 0.082 ms | 1.650 → 0.105 ms | 11643 → 164 |

累计 JSON 解析仍占主要 CPU，本改动没有改变上游解析。输出字节下降来自进行中标题不再随累计行数变化，不是额外节流宿主更新。

### MCP

`tool-summary-final-mcp` 与 `tool-summary-final-mcp-reverse` 各包含 32 个场景，覆盖 4 种内容、0/20 历史、regular/fullscreen、两种源码。每场景 5 轮，前两轮预热；报告分别保存重复折叠、展开、60 列、恢复 120 列的中位数、p95 和原始采样。

新增预览有实际成本，不能直接视为旧摘要的等量替换。以无历史 regular 的重复折叠帧为例，长 Unicode token 的 CPU 中位数正向从 0.163 增至 0.495 ms，反向从 0.166 增至 0.516 ms；短文本则从 0.164 降至 0.089 ms。长 token 的对应墙钟增量约 0.33 ms，两种顺序一致。大 JSON CPU 有 GC 波动，报告保留原始数据，不据此宣称普遍加速。展开文本仍受原生产展示上限约束。

`tool-summary-final-mcp-memory` 和反向报告固定 20 个活动行，24 轮不同结果与宽度往返。正向第 6/12/18/24 轮 GC 后 heap：before 为 24.95/24.96/24.97/25.06 MiB，after 为 27.06/27.08/27.08/27.13 MiB。反向 after 为 26.74/26.77/26.78/26.85 MiB。新增规范化结果保留约 1.5 至 2.2 MiB；释放行后均回到约 24.2 至 24.5 MiB。后半程增量与 before 的缓慢基准开销接近，未观察到按结果或宽度累计保留内容。

没有用户批准的绝对耗时或内存预算。这里报告预览增量和缓存占用，不虚构性能阈值。

### Unchanged paths

`tool-summary-final-stable` 与反向报告验证 editor/footer 稳态输入及 0/20 历史，输出字节一致，耗时先后顺序效应会反转，未观察到同方向的稳定退化。`tool-summary-final-verify` 通过 2203 项帧/宽度比较与 56 个解析终端帧；未变路径比较 before/after，Write 使用新契约和同一宿主冷恢复结果校验，不再要求等于旧 Written 摘要。

较早的 `tool-summary-memory-complete` 保留 Bash/Edit 共享预算淘汰和会话清理结果，属于收尾前辅助证据，不冒充最终 MCP 内存报告。

## Reproduction

在仓库根目录执行，每次使用新的 run ID，反向比较换成 `PI_PERF_VARIANTS=after,before`：

```sh
PI_PERF_BASELINE=baselines/tool-summary-20260906.json.gz pnpm --dir prototypes/codex-ui-performance run build
PI_PERF_VARIANTS=before,after PI_PERF_ONLY=streams PI_PERF_STREAM_ROUNDS=5 PI_PERF_RUN_ID=my-streams pnpm --dir prototypes/codex-ui-performance run bench
PI_PERF_VARIANTS=before,after PI_PERF_ONLY=mcp PI_PERF_RUN_ID=my-mcp pnpm --dir prototypes/codex-ui-performance run bench
PI_PERF_VARIANTS=before,after PI_PERF_ONLY=mcp PI_PERF_RUN_ID=my-memory pnpm --dir prototypes/codex-ui-performance run memory
PI_PERF_VARIANTS=before,after PI_PERF_ONLY=stable PI_PERF_RUN_ID=my-stable pnpm --dir prototypes/codex-ui-performance run bench
PI_PERF_RUN_ID=my-verify pnpm --dir prototypes/codex-ui-performance run verify
PI_SMOKE_SCENE=summary PI_PERF_RUN_ID=my-cli pnpm --dir prototypes/codex-ui-performance run smoke
PI_SMOKE_SCENE=summary-custom PI_PERF_RUN_ID=my-cli-custom pnpm --dir prototypes/codex-ui-performance run smoke
PI_SMOKE_BASELINE=1 PI_SMOKE_SCENE=summary PI_SMOKE_MODE=regular PI_PERF_RUN_ID=my-baseline-reload pnpm --dir prototypes/codex-ui-performance run smoke
```

本机另一 CLI 的命令额外设置 `PI_PERF_AGENT_ROOT=/Users/wangxuyang/Library/pnpm/global/v11/8ff3-1a0720ca373/node_modules/@earendil-works/pi-coding-agent`。性能数据只测仓库 Pi 0.84.3，0.85.1 只做上述真实 CLI 验证，不推断其性能。

## Final checks and limits

- `pnpm run check`：666 项测试通过、1 项跳过；52 个测试文件通过、1 个跳过。类型检查、构建和发布包校验通过。
- `pnpm run prototype:tool-summary:check`：13 项通过。
- `pnpm --dir prototypes/codex-ui-performance test`：3 项基础设施测试通过；运行后重新选择本轮基线 build。
- JSON/RPC/print 隔离测试仍通过；没有把 TUI 文案加入工具结果或协议输出。
- `dist/` 仅由构建生成，未手工修改。未提交 commit。
- 未通过项是上述历史 MCP reload 样式。真实 CLI 的会话切换、图像终端协议显示及中途取消没有独立端到端证据，不能用单元测试的状态投影冒充。low-power 通过生产组件测试，未新增人工视觉确认。
- 未测模型服务、外部 MCP 服务、Ghostty/GPU、整机 CPU 或其他扩展组合。
