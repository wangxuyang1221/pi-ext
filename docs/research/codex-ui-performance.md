# Codex UI performance research

## Production delivery

2026-09-05，已将七类优化落到生产 `src/`，并按批准计划把展开 Bash 的耗时和视觉行数移到正文、warning 之后。没有修改上游 Pi、工具执行语义、折叠展示或每秒计时频率。`dist/` 由正常构建生成。

**目标历史重放瓶颈已消除，但不是所有场景都优于原生，也不是零内存代价。** 产品配色的两次独立正反顺序运行中，20 个展开历史加 50 KiB 长行 Bash 的稳定尾部更新，渲染与终端解析合计 CPU 低于原生。冷小结果、巨大冷 diff 和少数交互尖峰仍有单独的限制。

以下为真实 `before / after / native` 数据；后面的历史研究章节保留实施前 `current / optimized` 实验，不可混用。

### Production evidence

- 不可变 `before` 来自改源码前保存的 `baselines/before.json.gz`，基线提交 `23315d1`。`after` 直接转译待交付源码，没有字符串转换优化。
- 环境仍为 Apple M5、Node 22.22.2、120×40、xterm 5.5.0。Pi 0.84.3 与 0.85.0 均跑了完整矩阵，不再仅以 0.84.3 冷绘制作交叉验证。
- 每次结果记录生产输入 SHA-256、实际 Pi/AI/TUI 路径、版本和整个 dist 的 JS/JSON 哈希。相同版本号不足以证明加载的是相同源码。
- 正反顺序的同配色主矩阵见 [`production-0.85.0`](../../prototypes/codex-ui-performance/results/production-0.85.0/results-0.85.0.json) 和 [`production-reverse-0.85.0`](../../prototypes/codex-ui-performance/results/production-reverse-0.85.0/results-0.85.0.json)；另一版本见 [`production-0.84.3`](../../prototypes/codex-ui-performance/results/production-0.84.3/results-0.84.3.json)。原始每轮采样和 p95 均保留。

### Regular-mode result

产品配色为原生 dark、插件 codex-pi。下表范围是两次独立运行的中位数，不是置信区间；单位为每次更新的合计 CPU ms。

| Scenario | Native | Before | After |
| --- | ---: | ---: | ---: |
| 1800 短行，无历史，替换末行 | 128.34–134.72 | 71.89–72.96 | 14.91–15.54 |
| 50 KiB 长行、20 个展开历史，纯计时 | 30.74–31.24 | 57.26–59.46 | 6.56–7.24 |
| 同上，替换末行 | 30.43–31.12 | 87.73–90.24 | 25.38–26.96 |
| 同上，真正追加新行 | 30.12–31.58 | 88.06–91.73 | 25.54–26.89 |

来源：[产品正序](../../prototypes/codex-ui-performance/results/production-product-0.85.0/results-product-0.85.0.json)、[产品逆序](../../prototypes/codex-ui-performance/results/production-product-reverse-0.85.0/results-product-0.85.0.json)。三类长行尾部更新的同步墙钟耗时也低于对应原生样本，没有仅靠转移到解析阶段取得 CPU 优势。

按每轮配对，末行替换比改前减少约 70%–71% CPU，比原生少约 13%–17%；纯计时比改前少约 87%–89%。这是指定负载，不是整个 Pi 进程或整机 CPU 的预测。

最关键的确定性变化：

| Long-history update | Before bytes | After bytes | Native bytes | Before → after full redraws |
| --- | ---: | ---: | ---: | ---: |
| 计时 | 5,693,791 | 127 | 196 | 1 → 0 |
| 替换末行 | 5,693,946 | 306 | 538 | 1 → 0 |
| 追加 | 5,695,350 | 1,135 | 1,890 | 1 → 0 |

0/20 历史的确定性测试确认，静态离屏历史不再进入这些稳定尾部更新的数据。不是因为跳过 tick 或冻结计数。两个运行工具中若一个底部也在视口外，它仍正常刷新，并可能触发原生全量重放。

同配色主矩阵的一次追加测量出现 `after 37.99 ms > native 33.21 ms`，逆序运行则为 `27.79 < 32.35 ms`。两次产品配色比较方向一致，但这次波动必须保留，不能写成任何机器、任何长行追加都必然更快。

### Cold rendering and reuse

以下取同配色 0.85.0 主运行的同步工具行渲染中位数，单位 ms，不包含终端解析。

| Scenario | Native | Before | After |
| --- | ---: | ---: | ---: |
| Bash 1800 短行，冷展开 | 127.43 | 66.29 | 13.77 |
| Bash 50 KiB 长行，冷展开 | 22.04 | 36.70 | 20.43 |
| Bash 约 50 KiB 中文，冷展开 | 5.10 | 9.97 | 6.14 |
| Bash 3 行，冷展开 | 0.203 | 0.398 | 0.309 |
| edit 10000 新行，冷展开 | 767.73 | 421.71 | 289.11 |
| 同一 edit，折叠后重展开 | 761.98 | 420.48 | 0.044 |
| 同一 edit，回到缓存宽度 | 762.80 | 362.62 | 0.064 |

Bash 1800 短行首次展开比改前减少约 79%；巨大 edit 冷展开减少约 31%，但仍约 289 ms。重展开的微秒级结果依赖缓存命中，不代表整个终端帧只需这么久，淘汰后也不能沿用此数字。

全折叠的优势没有变成普遍更快的保证：1800 短行首次计数约 1.4–1.5 ms，原生约 26 ms；50 KiB 无空格长行第一次仍需约 22 ms 的精确 wrapping，与原生接近。后续未改变的物理行可以复用计数。在 20 个全折叠历史、长行追加的两次主矩阵中，`after` 合计约 0.57 ms，改前约 21.6–21.9 ms，原生约 22–23 ms。

小结果仍存在额外固定成本；中文冷展开本次也没有达到原生。保留这些反例，不用有利大结果的平均值掩盖。

### Streaming and small-interaction limits

增加到 10 轮、丢弃首轮后的 0.85.0 参数流比较如下，单位为整个 trace 的合计 CPU ms，见[重复数据](../../prototypes/codex-ui-performance/results/streams-repeat-0.85.0/results-0.85.0.json)。

| Trace | Native | Before | After |
| --- | ---: | ---: | ---: |
| write 256 KiB，不含累计 JSON | 660.48 | 188.56 | 41.91 |
| write，含累计 JSON | 2613.00 | 2024.42 | 1923.07 |
| edit old/new 各约 128 KiB，不含累计 JSON | 256.07 | 3.09 | 3.66 |
| edit，含累计 JSON | 2209.15 | 2074.69 | 2032.41 |

write 不含 JSON 时比改前减少约 78%，包含 JSON 后仅约 5%。edit 参数流没有新的稳定收益：其更新与绘制阶段的墙钟中位数几乎相同，微小 CPU 差异受 GC 和阶段归属影响。不要把 JSON 解析耗时变化算成 renderer 的成果。

另外，7 轮初测的 edit 1000 行折叠出现 2.4 ms 中位数，比改前高。增至 27 轮、25 个有效样本后，[无 profiler 复测](../../prototypes/codex-ui-performance/results/collapse-repeat-0.85.0/results-0.85.0.json)为 `after 0.257 ms / before 0.380 ms`，但 after 的样本 p95 仍为 `2.521 ms`，before 为 `0.412 ms`。辅助 CPU profile 有 GC 成本，尚未把每个尖峰逐一归因。**这项尾延迟没有达到“全面不回退”的强验收目标，保留为已知限制**，不宣称所有交互指标都改善。

### Memory cost

固定 20 个工具行，连续 24 轮替换不同 Bash/edit 结果并往返多个宽度。布局与高亮共用 16 MiB、计数 2 MiB；每轮断言计费不超限，确实发生多次淘汰。0.84.3 与 0.85.0 均通过，见[前者](../../prototypes/codex-ui-performance/results/memory-0.84.3/memory-0.84.3.json)、[后者](../../prototypes/codex-ui-performance/results/memory-0.85.0/memory-0.85.0.json)。

0.85.0 最后一轮 GC 后的 heap：native 约 37.1 MiB，before 约 27.0 MiB，after 约 39.3 MiB。after 比 before 多约 12.2 MiB。第 6、12、18、24 轮维持在约 39.2–39.3 MiB，没有随结果版本持续增长；释放行与会话后回到约 15.5 MiB，接近该变体开始时的 15.6 MiB。

循环内 after 峰值 heap 约 109.7 MiB、RSS 约 271.4 MiB。这里三种变体在同一进程顺序运行，RSS 受分配器高水位影响，不能将它直接减去 before 当作插件的额外常驻量。18 MiB 只是缓存文本及条目估算计费上限，不是 RSS 上限，也不包括宿主当前帧和原始工具结果。

### Validation and remaining scope

- 最终 `pnpm run check` 通过：650 tests passed、1 skipped，typecheck、build 与发布包边界检查均通过；codex-ui 定向测试 105 项。
- 两版各通过 2203 项帧/宽度比较。除已批准的展开 Bash 两项元信息迁移外，命令、正文、warning、折叠路径、read/write/edit 和 low-power 保持比较结果一致，见 [`delivery-verify-0.84.3`](../../prototypes/codex-ui-performance/results/delivery-verify-0.84.3/verification-0.84.3.json)、[`delivery-verify-0.85.0`](../../prototypes/codex-ui-performance/results/delivery-verify-0.85.0/verification-0.85.0.json)。
- 两版各通过 28 个真实 TUI 输出的解析帧检查，逐 cell 校验文字、颜色和尾部位置。完成状态、前缀替换、resize、主题变化允许且记录宿主全量重绘。
- 单元测试覆盖惰性快照、write 最终字节计数、每帧单次正文处理、预算/LRU/超大绕过、冷折叠高亮、syntax-only 换色、会话清理及迟到旧行不复活 timer。
- 两版均通过真实 CLI + expect PTY 的产品主题 smoke，检查恢复 Bash、展开/折叠、`/reload`、120×40 → 60×24 resize 和退出。记录见 [`cli-product-smoke-0.84.3`](../../prototypes/codex-ui-performance/results/cli-product-smoke-0.84.3/smoke.json)、[`cli-product-smoke-0.85.0`](../../prototypes/codex-ui-performance/results/cli-product-smoke-0.85.0/smoke.json)。所有 HOME/配置/会话/缓存均隔离在仓库内，进程已回收。
- 上述 CLI smoke 启动时已加载新版，不能证明旧进程能够热更新。后续在本机 Pi 0.85.0 bundled CLI 中补测运行中替换本地 package 的 JS：`/reload` 提示成功，但历史 Bash 仍显示旧布局；重启并恢复同一合成会话后，底部行数才按新版显示。直接引用本仓库的安装不需要重装，但本次更新应重启 Pi。该结果没有验证其他 Pi 版本的热更新行为，也没有据此断言具体模块缓存根因。
- 没有在 Ghostty 窗口中做人工运行中工具观感检查，也没有测其 CPU/GPU、模型联网或其他扩展。真实 CLI smoke 使用已完成的合成历史；运行中的行为由工具组件及 TUI 回归验证。
- 累计 JSON 解析、普通 TUI 历史遍历/差分、巨大冷 diff 和离屏并发更新没有被改写。本次不自动切 fullscreen，不隐藏已展开输出，不触碰上游源码。

复现步骤见[基准说明](../../prototypes/codex-ui-performance/README.md)，逐项交付状态见[计划](../plans/codex-ui-rendering-performance.md)。下面全部为实施前的历史研究，涉及“尚未修改生产代码”“还需落地”的表述仅描述当时状态。

## Historical conclusion

**不能得出“codex-ui 总体优于 Pi 原生 TUI”的结论，也不能承诺 P1/P2 完成后只增加某个固定百分比的负担。** 这次补测覆盖了插件 renderer、真实 Pi 工具行与屏幕刷新，以及终端解析阶段。结论取决于输出形态、展开状态、历史长度和 TUI 模式。

1. 大量短行 Bash、write 摘要、edit 折叠和重复展开，codex-ui 有明确优势。P1/P2 还能继续减少计算。
2. 普通滚动模式下，展开的 Bash 顶部状态更新可能触发 Pi 重发全部历史。长会话中，即使插件生成行已接近或快于原生，终端解析成本仍可能让合计 CPU 高于原生。
3. 在本次长行 Bash、约 3.6 万行展开历史的固定负载中，实验优化版的渲染与终端解析合计 CPU 比原生高约 **140%～155%**。这足以否定“优化后整体一定更快”或“额外开销一定低于 5%”。这个范围是两个配色对照实验的结果，不是所有会话的预测区间。
4. write/edit 流式参数的累计 JSON 解析是共同上游成本。插件渲染减少九成，不代表整个参数流处理也减少九成。

因此，推荐实施 P1/P2，但验收目标应是减少已定位的重复计算，并测试长会话的终端输出量。不能把“插件函数更快”当作“整个应用更省 CPU”。正式插件和上游源码均未修改，实验代码位于 [`prototypes/codex-ui-performance/`](../../prototypes/codex-ui-performance/)。

## Scope and evidence

### Versions

- 调研日期：2026-09-05。
- 仓库基线：`23315d1`。
- 主测：本机 Pi 0.85.0；交叉验证：仓库依赖 Pi 0.84.3。
- Node.js 22.22.2、pnpm 11.9.0、Apple M5、macOS 26.4.1、arm64。
- 终端尺寸：120 列 × 40 行。
- 终端解析器：`@xterm/headless@5.5.0`，scrollback 为 10000 行。Pi TUI 0.85.0 自身也把这一版本列为开发依赖。[S1][S8]

Pi 0.85.0 的发布元数据给出的源码提交是 `107d79f11072bbc8a3a757ed7fd69596bee7d68c`。本文的上游链接固定到这个提交，不用不断变化的 `main` 代替版本依据。[S1]

Context7 使用 `/earendil-works/pi` 和 `/xtermjs/xterm.js` 查找接口文档。它们返回的内容未提供本次目标版本的固定索引，因此接口细节最终以已安装包的源码、声明和对应提交为准。xterm 5.5.0 是 CommonJS 包，实验使用默认导入后取得 `Terminal`，没有直接套用当前文档中的 ESM named import 示例。

### Compared implementations

| Variant | Meaning |
| --- | --- |
| Native | 指定版本的真实 Pi built-in renderers、ToolExecutionComponent 和 TUI，未修改算法 |
| Current | 从仓库当前 codex-ui 源码转译的实验副本 |
| Optimized | 在独立目录中覆盖 P1/P2 七类优化的实验副本，不是已经发布或合并的版本 |

codex-ui 会替换内建工具的展示实现，并通过 `renderShell: "self"` 自己提供外观。不是先完整执行原生 renderer，再额外画一层皮肤。因此，它的性能差异可以为正，也可以为负。[L1][S2]

### Measurement boundaries

本次测的是可控渲染链路，而非运行中 CLI 的完整端到端性能：

```text
partial JSON / tool result snapshot
  -> actual ToolExecutionComponent
  -> actual Pi TUI
  -> UTF-8 output
  -> xterm parser and terminal buffer
```

- 主矩阵对三组使用同一个 dark 配色，避免配色混入算法比较。另做原生 dark、插件 codex-pi 配色的产品交叉验证，反例仍成立。
- 使用实际 editor、footer 和固定 assistant message 组件。页脚采用固定 context usage 快照及 100 条合成 usage entries，不包含实际 SessionManager 查询成本。
- fullscreen 使用 Pi 的隐式滚动文档。没有复刻完整交互模式的固定编辑器区域布局。
- Bash 使用真实生命周期定时器回调，但在确定性时钟上驱动。`requestRender` 由明确帧边界替代，不测量 16 ms 调度等待。
- write/edit 每 256 字符产生一个累计参数快照，每 16 次更新绘制一帧。此节奏用于复现 coalescing，不声称它就是用户的模型输出节奏。
- Bash `append` 记录实际是每 100 ms 更换输出末行的快照，主体保持不变；不是无限增长日志。`tick` 只每秒更新耗时。
- 没有运行真实 write/edit/bash 执行器。edit 的参数完成预览会读取实验目录内的有效 fixture，但不修改它。
- 没有启动真实 Ghostty 窗口，未测 PTY、Ghostty CPU、GPU、窗口合成、模型联网、其他 extensions、标题动画及完整启动流程。

xterm 的 `write()` 返回只表示数据入队。实验等待 callback，才记录解析完成；官方文档明确指出，此时仍不能代表像素已经画到屏幕上。[S8]

冷渲染和交互各 7 轮，前 2 轮预热；终端链路各 14 轮，前 4 轮预热；参数流各 4 轮，前 1 轮预热。表格使用中位数，原始 JSON 保留每轮值及样本 p95。小样本 p95 不能代替真实会话的延迟分布。

CPU 时间使用 `process.cpuUsage()`；同步阻塞时间使用 `performance.now()`。xterm 和 Pi 在同一测试进程内分阶段运行，GC 或辅助线程会影响细分归属。合计按每轮阶段 CPU 求和后取中位数，不一定等于各阶段中位数之和。

## P1 and P2 implementation coverage

| Priority | Experimental implementation | Boundary |
| --- | --- | --- |
| P1.1 | Bash 已 wrap、fit、pad 的行直接加缩进，去掉第二次完整 ANSI 截断 | 保留窄宽度与宽字符处理；未改变输出行 |
| P1.2 | write 的 metrics 延迟到实际绘制，字符串换行计数使用 `indexOf` | 不完整或非字符串参数保持原有 host fallback；不采用 `startsWith(previous)` 冒充 O(delta) |
| P1.3 | 折叠 Bash 只统计视觉行数，不再生成 padding 和 tail；按物理行内容与宽度缓存 | 长 Unicode/无空格行仍交给原生 wrapper，保持精确换行语义 |
| P1.4 | `fitToWidth` 使用原生 `truncateToWidth` 的第四个 pad 参数 | 保留原有宽度归一化和 ellipsis |
| P2.5 | 全局有文本计费上限的布局缓存，保留多宽度和折叠前的完整 ANSI 行 | 包含已经生成的高亮；没有无界保存所有工具历史 |
| P2.6 | Bash 预处理惰性执行；文本 geometry 与 warning/partial 状态分离，文本相同则复用 | 没有假设每次更新一定只追加，替换输出也走正确路径 |
| P2.7 | 长命令摘要为可打印 ASCII 使用保守前缀路径，复杂文本回退原逻辑 | ASCII 验证仍扫描源串，不声称任意输入都达到 O(显示宽度) |

两版 Pi 各通过 **1854 项**当前版与实验版的帧字符串和宽度处理比较。覆盖两种主题、12 种宽度、展开切换、ANSI、OSC 8、Unicode、控制字符、结果替换、warning 变化和缺失 write 参数。

这些比较不是生产级的完整等价性证明。正式落地仍需补充缓存淘汰、session/reload 生命周期、仅修改语法颜色的 theme 更新等回归测试。实验实现不能直接当作待发布补丁。

## Tool rendering results

### Cold rendering

以下是 Pi 0.85.0，单位为毫秒。范围包含工具行创建、恢复结果、参数完成和首次 render，不包含终端解析。与前一轮只测 `updateResult + render` 的局部实验不同，不能把两轮数字直接拼接成提升百分比。

| Scenario | Native | Current | Optimized |
| --- | ---: | ---: | ---: |
| Bash 1800 短行，折叠 | 26.08 | 1.41 | 1.27 |
| Bash 1800 短行，展开 | 126.59 | 65.27 | 13.61 |
| Bash 50 KiB 无空格长行，折叠 | 22.47 | 21.18 | 22.05 |
| Bash 50 KiB 无空格长行，展开 | 23.22 | 37.51 | 20.71 |
| Bash 约 50 KiB 中文，展开 | 5.02 | 9.91 | 4.21 |
| Bash 3 短行，展开 | 0.109 | 0.350 | 0.241 |
| write 50 KiB TypeScript，折叠 | 21.02 | 0.233 | 0.214 |
| write 50 KiB TypeScript，展开 | 151.51 | 0.267 | 0.160 |
| edit 1000 新行及 1 删除行，折叠 | 75.51 | 0.647 | 0.627 |
| edit 1000 新行及 1 删除行，展开 | 75.57 | 43.42 | 27.93 |
| edit 10000 新行及 1 删除行，展开 | 763.71 | 428.23 | 288.78 |

数据来源：[`results-0.85.0.json`](../../prototypes/codex-ui-performance/results-0.85.0.json) 的 `cold`。

可以作出的判断：

- 短行 Bash 首次展开，实验版比当前版少约 79%，比原生少约 89%。去掉重复截断是主要收益之一。
- 无空格长行折叠时，仍需计算精确视觉行数，首次计算约 22 ms。P1/P2 没有消除原生 Unicode/word wrapping 的下限。
- 小结果的百分比容易误导。3 行 Bash 首次展开，实验版约为原生的 2.2 倍，但绝对差约 0.13 ms。这不能预测长结果，更不能预测整个会话的 CPU。
- 10000 行 edit 首次展开优化后仍约 289 ms，足以造成可感知阻塞。缓存主要帮助后续操作，不会让冷绘制自动落入一帧预算。

### Differences in displayed content

write 和折叠 edit 的优势不能全归功于算法更好。

- 50 KiB write 展开，原生输出约 1729 行，包括代码；codex-ui 仍只有约 3 行摘要。
- 1000 行 edit 折叠，原生仍输出约 1006 行；codex-ui 约 16 行，只展示前 12 行 diff。
- 1800 行 Bash 折叠，原生保留最后 5 个视觉行；codex-ui 不展示输出正文，只保留状态和行数。

这些本来就是两个产品的可见行为差异。本任务只要求 Current 与 Optimized 不变，并不是要求 codex-ui 与原生画出同一张图。[L1][S3][S4][S5]

### Warm interactions

以下仍只统计 Node 同步渲染阶段，单位为毫秒。

| Scenario | Native | Current | Optimized |
| --- | ---: | ---: | ---: |
| Bash 1800 行，折叠后重新展开 | 130.14 | 67.19 | 0.043 |
| Bash 1800 行，120 → 119 → 120，回到旧宽度 | 127.73 | 67.11 | 0.048 |
| edit 1000 行，折叠后重新展开 | 76.06 | 40.71 | 0.031 |
| edit 10000 行，折叠后重新展开 | 769.87 | 416.80 | 0.044 |
| edit 10000 行，120 → 119，首次遇到新宽度 | 764.04 | 362.03 | 284.85 |

缓存命中收益很大，但它不消除宿主后续比较、重发历史或终端解析成本。缓存淘汰后也不能沿用命中时的微秒数字。

## The counterexample in regular mode

### Mechanism

codex-ui 将运行状态、耗时和输出行数放在 Bash 卡片顶部。输出展开且超过一个视口后，顶部会滚出视口。[L1]

Pi 普通模式先渲染完整组件树，然后寻找首个变化行。若该行位于此前视口之上，进入：

```ts
if (firstChanged < prevViewportTop) {
  fullRender(true);
  return;
}
```

`fullRender(true)` 写入清屏、清 scrollback 序列，再发出整个新文档。[S6]

原生 Bash 把 `Elapsed` 放在输出底部。在本次卡片位于会话尾部的场景中，它可以只更新视口中的底部区域。[S3] 原生并非永远不会全量刷新，其他上方内容变化同样可以触发此分支。

### Measured cost

使用原生 dark、插件 codex-pi 配色，每次按实际回调更新。CPU 包括 Node 渲染阶段和 xterm 解析阶段。

| Scenario | Native | Current | Optimized | Optimized vs native |
| --- | ---: | ---: | ---: | ---: |
| 1800 短行，无既有工具历史，更新输出快照 | 127.54 ms | 69.81 ms | 18.31 ms | -85.6% |
| 50 KiB 长行，20 个已展开历史 Bash，只更新耗时 | 30.98 ms | 64.62 ms | 55.70 ms | +79.8% |
| 50 KiB 长行，20 个已展开历史 Bash，更新输出快照 | 31.30 ms | 88.72 ms | 79.59 ms | +154.3% |

20 个历史 Bash 各有 1800 个短行，合计约 3.6 万行。最后一项的输出量：

- 原生每次约 **538 B**。
- 当前和实验 codex-ui 每次约 **5,693,946 B**，约 5.7 MB。
- codex-ui 每次触发 1 次全量刷新，原生为 0 次。

来源：[`results-product-0.85.0.json`](../../prototypes/codex-ui-performance/results-product-0.85.0.json)。同配色主矩阵得到约 33.03 ms 对 79.37 ms，即 +140.3%，方向一致。

这个场景中，原生和实验版的 Node 渲染阶段 CPU 都约 31 ms。差距主要出在历史输出的重新解析，实验版该阶段约 43 ms，而原生约 0.13 ms。各项中位数不能直接相加代替逐轮合计中位数。

如果按测试的 10 次/秒持续发生，79.6 CPU ms/次相当于约 0.80 个 CPU 核心的计算量；31.3 ms/次约为 0.31 个核心。它只是该确定性负载的换算，不是对用户 Ghostty 或整机 CPU 读数的预测。输出字节倍率也不能当作 CPU 倍率。

### Why P1/P2 does not fix it

P1/P2 减少组件生成相同字符串的成本，没有改变状态行位置，也没有改变 Pi 的屏幕差分策略。因此输出序列和全量重放仍会发生。

在保持普通模式现有展示语义、只使用当前公开扩展接口的前提下，插件不能可靠替换这个宿主分支。减少计时刷新、隐藏或移动状态、限制展开历史、切换 fullscreen 都可能缓解，但会改变用户可见行为，不能混入本次“无行为变化”的优化验收。

这不推翻“原 11 项都可在插件侧实现”。它说明那 11 项没有覆盖整个性能问题。若目标还包括消除这类全历史重放，需要另外讨论宿主优化或产品行为取舍。

## Fullscreen comparison

fullscreen 将终端输出限制在应用拥有的视口，避免普通模式为上方摘要变化重发整个 scrollback。本次在 20 个历史工具、50 KiB 长行、只更新耗时的实验中：

- 原生渲染与解析合计约 22.74 ms。
- 实验版约 0.44 ms。
- 输出分别约 208 B 和 22 B，没有全历史重放。

该实验只有运行时长变化，不能把约 98% 的降幅套用到有新输出、主题切换或窗口缩放的场景。fullscreen 仍会调用组件布局，长内容的冷绘制成本没有消失。

Pi 0.85.0 官方设置将 `tuiMode` 默认定义为 `regular`，并将 `fullscreen` 标为 experimental。[S9] 模式切换不是本任务允许的无行为变化优化。这里用它证明宿主刷新模式能够改变结果，不建议自动替用户切换。

## Streaming write and edit

### Write

256 KiB TypeScript 内容，每 256 字符更新一次，每 16 次更新画一帧。以下为整个固定 trace 的渲染与 xterm 解析合计 CPU。

| Trace | Native | Current | Optimized |
| --- | ---: | ---: | ---: |
| 参数对象已经解析，不计累计 JSON 解析 | 635.57 ms | 219.47 ms | 29.57 ms |
| 包含真实 Pi 累计 JSON 解析 | 2630.51 ms | 2058.52 ms | 1930.39 ms |

只看不含 JSON 的链路，实验版相对原生减少约 95%，相对当前版减少约 87%。加上共同解析后，相对原生减少约 27%，相对当前版只减少约 6%。不能把前一行当作整个流式处理的预期收益。

实验版的累计 JSON 解析本身约 1903 ms，同步工具更新与绘制合计只有约 8 ms。进一步打磨这个 renderer 已不可能解决剩余的大头。

Pi 的 Responses 处理在每次参数 delta 后追加到 `partialJson`，再调用 `parseStreamingJson` 处理累计内容。parse fallback 会尝试补全或修复不完整 JSON。这条链路在 codex-ui renderer 之外。[S7]

### Edit

oldText 与 newText 各约 128 KiB，使用有效编辑参数并等待原生文件预览完成：

| Trace stage | Native | Current | Optimized |
| --- | ---: | ---: | ---: |
| 累计 JSON 解析 | 1952.86 ms | 1973.92 ms | 1974.29 ms |
| 工具参数更新 | 196.72 ms | 1.87 ms | 1.89 ms |
| 过程帧绘制 | 1.28 ms | 1.89 ms | 1.82 ms |
| 参数完成预览及该帧 | 2.67 ms | 0.021 ms | 0.020 ms |
| 整个 trace 同步与预览耗时 | 2152.22 ms | 1977.26 ms | 1978.07 ms |

这里是各阶段墙钟耗时，不是与上一表相同的 CPU 口径。编辑器最终大 diff 的冷绘制另见前表。

当前 codex-ui 在 edit 参数流阶段已经很轻，P1/P2 对这部分几乎没有进一步收益。原生会为预览构造完整参数 key，参数完成后读取文件计算预览；当前插件在参数流阶段主要画标题。[S5][L1]

三组使用相同 JSON 解析实现。表中的小幅解析差异属于运行顺序、分配和测量波动，不能归因于插件优化。若用户看到 edit 参数输入期间 CPU 高，应先区分上游解析和最终 diff 绘制，不应直接认定都来自插件高亮。

## History and small-frame overhead

包含实际 editor/footer、固定 assistant 组件，但不改变工具结果的输入帧：

| Scenario | Native | Current | Optimized |
| --- | ---: | ---: | ---: |
| 普通模式，无工具历史 | 0.061 ms | 0.119 ms | 0.051 ms |
| 普通模式，20 个已展开历史 Bash | 10.67 ms | 5.67 ms | 5.73 ms |
| fullscreen，20 个已展开历史 Bash | 2.23 ms | 0.36 ms | 0.33 ms |

这些是同步绘制阶段，不含终端解析。没有包含完整启动 header、动态 thinking、working loader、标题动画、其他 extensions 或真实上下文用量查询。

所以，本实验可以确认 codex-ui 在已测试的长历史稳定帧中更便宜，不能据此给整个插件下一个“固定额外负担 0% / 5% / 10%”的结论。小于一毫秒的差异也不宜作跨机器排序。

## Cross-version results

Pi 0.84.3 的冷渲染交叉验证与 0.85.0 方向一致。例如展开状态：

| Scenario | 0.84.3 native | 0.84.3 current | 0.84.3 optimized |
| --- | ---: | ---: | ---: |
| Bash 1800 短行 | 124.87 ms | 65.56 ms | 13.72 ms |
| Bash 50 KiB 无空格长行 | 22.96 ms | 36.26 ms | 20.09 ms |
| edit 1000 行 | 73.62 ms | 43.07 ms | 28.61 ms |
| edit 10000 行 | 749.62 ms | 421.58 ms | 289.14 ms |

0.84.3 没有重跑完整终端链路矩阵，不能把主矩阵每一个百分比标成已在两版验证。完整数据见 [`results-0.84.3.json`](../../prototypes/codex-ui-performance/results-0.84.3.json)。

## Optimization priorities after research

1. **先把终端输出量加入验收。** 普通模式长历史加展开 Bash 是必须覆盖的回归场景。它不是靠增加几层布局缓存就能解决的问题。
2. 实施 P1.1、P1.2、P1.4。短行 Bash 的重复截断、write 未绘制快照计数、pad 重复测宽有明确且相对直接的收益。
3. 实施 P1.3，同时保留复杂 Unicode 和长词的精确 fallback。不要用字符数除以宽度近似视觉行数。
4. 实施 P2.5，使用明确的全局或 session 级内存预算。最适合解决折叠重展开和反复宽度切换，但首次巨大 diff 仍需单独评估。
5. 实施 P2.6、P2.7，重点减少没有被画出的预处理与长命令摘要扫描；不要假设工具结果始终单调追加。
6. 原 P3 的稳定 cache key、thinking 转换、footer 上下文用量缓存和其他小型快路径可继续做，但不能把它们当作普通模式历史重放或上游累计 JSON 解析的解决方案。

实验缓存的文本计费上限为布局 16 MiB、计数 2 MiB。实际内存还包含原有行状态、对象、字符串与宿主组件，不能据此承诺“RSS 只增加 18 MiB”。CPU 与保留内存是需要共同验收的指标。

若严格坚持不改用户可见行为、不触及上游、不使用内部 monkey patch，实际可交付目标应表述为：**降低 codex-ui 自身的重复渲染计算，保留明确记录的宿主刷新与参数解析限制。** 不应表述为“所有 write/edit/bash 场景都比原生更快”。

## Reproduction and validation

复现入口见实验目录 [`README.md`](../../prototypes/codex-ui-performance/README.md)。结果文件包含合成数据，没有用户会话内容。

- Pi 0.84.3、0.85.0 各通过 1854 项帧及 width helper 对比。
- 实验只生成独立 `.generated/`，没有手动修改正式 `dist/` 或 Pi 上游。
- `pnpm run check` 已通过：类型检查、627 项测试通过及 1 项跳过、构建与发布包边界检查。测试临时目录限制在仓库内并已清理。
- 实验通过 fake terminal 和确定性 interval 驱动，没有常驻服务或监听端口。

## Sources

### Local sources

- [L1] [`extensions/codex-ui/src/tools.ts`](../../extensions/codex-ui/src/tools.ts)：write metrics 400、421、1905–1933；Bash 摘要 1157–1246、视觉计数 1308–1339、准备与布局 1536–1684；edit 缓存和隐藏高亮清理 820–912。
- [L2] [`extensions/codex-ui/src/layout.ts`](../../extensions/codex-ui/src/layout.ts)：`fitToWidth` 与 `paintBackground`。
- [L3] [`extensions/codex-ui/src/exact-visual-tail.ts`](../../extensions/codex-ui/src/exact-visual-tail.ts)：完整 wrapping、padding 和 visual tail。
- [L4] [`extensions/codex-ui/src/footer.ts`](../../extensions/codex-ui/src/footer.ts)：缓存检查之前取得 context usage；[`components.ts`](../../extensions/codex-ui/src/components.ts)：editor 背景与 header 生成。
- [L5] [`historical/build-experiment.mjs`](../../prototypes/codex-ui-performance/historical/build-experiment.mjs)：七类历史实验优化的算法存档；[`bench.mjs`](../../prototypes/codex-ui-performance/bench.mjs)：测量方法；[`verify.mjs`](../../prototypes/codex-ui-performance/verify.mjs)：等价比较。

### First-party upstream sources

- [S1] [Pi TUI 0.85.0 发布元数据](https://registry.npmjs.org/@earendil-works/pi-tui/0.85.0)：版本、gitHead、依赖与 headless 测试依赖。
- [S2] [ToolExecutionComponent](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/coding-agent/src/modes/interactive/components/tool-execution.ts)；[extension rendering 文档](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/coding-agent/docs/extensions.md)。
- [S3] [原生 Bash renderer](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/coding-agent/src/core/tools/renderers/bash.ts)：5 行预览、100 ms 输出节流常量、1000 ms invalidate、底部耗时行。
- [S4] [原生 write renderer](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/coding-agent/src/core/tools/renderers/write.ts)：流式高亮和代码预览。
- [S5] [原生 edit renderer](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/coding-agent/src/core/tools/renderers/edit.ts)：参数 key、异步预览及最终 diff。
- [S6] [普通屏幕 renderer](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/tui/src/tui-main-screen.ts)；[fullscreen renderer](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/tui/src/tui-alt-screen.ts)；[TUI utilities](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/tui/src/utils.ts)。
- [S7] [Responses 参数流](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/ai/src/api/openai-responses-shared.ts)；[streaming JSON parser](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/ai/src/utils/json-parse.ts)。
- [S8] [xterm 5.5.0 发布元数据](https://registry.npmjs.org/@xterm/headless/5.5.0)；[对应提交的 headless 类型声明](https://github.com/xtermjs/xterm.js/blob/9ba6c00a195c95fcf8292a2b9084d91450e5daae/typings/xterm-headless.d.ts)；[官方 parser lifecycle 说明](https://xtermjs.org/docs/guides/hooks/)。
- [S9] [Pi 0.85.0 settings 文档](https://github.com/earendil-works/pi/blob/107d79f11072bbc8a3a757ed7fd69596bee7d68c/packages/coding-agent/docs/settings.md)：`tuiMode` 与 fullscreen 的实验状态。
