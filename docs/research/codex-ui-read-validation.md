# Read UI validation

## Scope

2026-09-08 正式接入用户选定的「变体 6 + cyan」。生产入口是 `extensions/codex-ui/src/tools.ts`，分组与布局分别位于 `read-groups.ts`、`read-group-layout.ts`，不依赖原型入口。

- 同一 assistant 消息内相邻 Read 按源调用顺序分组。text、thinking、其他工具、消息边界或未绑定行断组，不按完成顺序排序。
- 第一条已绑定工具行承载整组，其余成员返回空组件。重复 ID 的额外行独立显示。
- 图片结果保留独立行并断组。宿主在自定义组件之外绘制图片，不能把图片行隐藏在另一成员后面，否则附件会脱离文件名。此规则与图片显示开关无关，切换开关不会改变归属。
- 文件名使用 `theme.fg("accent", filename)`，不加粗。目录、返回行数与范围使用 `dim`。
- 收起时每文件最多三屏幕行预览，每个源码行最多提取 512 个 UTF-16 代码单元，再按显示宽度裁剪。另有余量及续读提示。展开显示完整输入路径和最多 40 行源码，不使用原型的 80 行上限。
- 限行结果的官方续读尾注不计入源码行；截断结果使用匹配正文的 `ReadToolDetails.truncation` 还原返回行数。首行超过工具输出上限时显示零行源码及原有警告。
- 使用宿主 `app.tools.expand`，不新增快捷键、配色配置或逐文件展开。不引入 `/read-style`、`/read-color`、`/read-replay` 或原型执行禁用逻辑。
- 执行仍委托当前 `ctx.cwd` 的官方 Read definition，参数、signal、onUpdate、权限及持久化结果不改动。

## Tests

`extensions/codex-ui/__tests__/grouped-read.test.ts` 新增 10 项测试。以下行为有先失败、后通过的记录：

1. 三个真实宿主 Read 行分组，乱序结束仍按调用顺序显示，部分失败不隐藏错误。
2. 正式 Read 执行带 offset/limit 的读取，不把续读尾注算成源码。
3. 正式 Read 执行 2000 行截断和超大首行读取，显示真实返回数与警告。
4. 图片成员退出文本组，文件名与宿主附件保留在同一行组件。
5. 限行读取保留实际选中的空行，不生成虚假的剩余行数。

另验证了分组边界、流式新增和改参、同文件不同范围、未知/重复 ID、参数未完成、空文件、取消、reload 首次绑定、tree、compaction、旧回调失效、会话清理、Unicode/ANSI、1–160 列与展开/收起。

缓存测试按实际 compute 次数断言：两个成员首次各执行一次 source、count、prefix 计算；重复失效、resize 和主题变化不重复执行这些计算；替换一个成员只新增该成员的三次计算；收起不构造 40 行详情。正文和派生数组均使用现有 `ToolRenderCache` 预算，没有新增无界文本缓存。内容版本沿用宿主不可变 content/details 快照的身份语义。

原有 `tools.test.ts` 的四项 Read 布局断言改为新契约，仍覆盖 success/error、图片、截断、40 行上限、宽度与执行委托。原型测试只更新方案 0 的生产基线断言，实验 renderer 保留。

验证命令：

```sh
pnpm exec vitest run extensions/codex-ui
pnpm run prototype:read-ui:check
pnpm --dir prototypes/codex-ui-performance test
pnpm run check
```

仓库完整检查通过，770 tests passed、1 skipped，类型检查、构建和发布包检查通过。原型五项测试和性能设施三项测试通过。被跳过的是仓库原有 subagent integration test，不是本轮 Read 测试。

## Runtime Verification

仓库依赖为 Pi 0.84.3；额外运行本机 Pi 0.85.1。两套 agent、ai、tui 的实际版本均分别匹配，Node 为 22.22.2，pnpm 为 11.9.0。

每个版本都运行普通/fullscreen × 默认 Ctrl+O/自定义 Ctrl+G，共八个真实 CLI 场景。使用脚本化本地 provider 产生真实 Read 调用，正式工具读取隔离文件及不存在的路径。验证参数流、成功/失败、短预览、真实范围、展开、收起、resize、reload 和新进程恢复。通过 xterm cell 检查产品主题文件名为 `#5EFCFF` 且非粗体，生产代码没有写死该色值。

证据目录位于 `prototypes/codex-ui-performance/results/`：

- `read-ui-cli-final-0843/`、`read-ui-cli-custom-0843/`
- `read-ui-cli-0851/`、`read-ui-cli-custom-0851/`
- `read-ui-verify-0843/`、`read-ui-verify-0851/`

每个版本另通过 2443 项 frame/fit 比较，以及现有 Bash 终端回归的 56 帧逐 cell 比较。Read 改版不与旧摘要逐字相等，而是比较热状态与相同输入的新建生产行，并检查预览行数、宽度和唯一承载组件。

所有 CLI 测试的 HOME、session、cache、fixture 文件均限制在仓库临时目录。测试进程已退出，临时目录已清理，没有启动网络服务。未停止用户自行运行的进程。

## Performance Setup

任何生产修改前保存不可变快照 `prototypes/codex-ui-performance/baselines/read-ui-20260908.json.gz`，随后采集 `read-ui-baseline-{cold,interactions,token}-0843/`。该快照包含当时实际工作树，不使用旧 grouped/tool-summary 或 HEAD 冒充基线。

原性能 runner 缺少生产已依赖的 `keyText` facade export，首次基线启动失败，补齐导出后重跑。原矩阵没有 Read fixture，本轮新增相应负载；一次未匹配 fixture 的空报告已删除，不作为测量证据。

最终矩阵为三个连续 Read，覆盖：

- 接近 50 KiB 的多行文本、50 KiB 无空格单行。
- 0/20 条 Read 历史、普通/fullscreen。
- pending、完成、20 次稳定失效、单成员替换、展开、收起、120→30→120 列。

每组合七轮、前两轮预热，两个版本各做正反顺序复测，全部串行。计时包括工具组件、真实 TUI、UTF-8 输出和等待完成的 xterm 解析；周边仅固定文字，不包含真实 editor/footer、模型网络或文件 I/O。原始样本、wall/CPU、字节数、源码和上游哈希保存在：

- `read-ui-final-0843/`、`read-ui-final-reverse-0843/`
- `read-ui-final-0851/`、`read-ui-final-reverse-0851/`

`read-ui-matrix-0843/` 是早期实现测量，不替代最终结果。

## Performance Results

下表为正向运行中「20 条历史 + 普通模式」的中位数，单位 ms，均为旧版 → 新版。不是服务端延迟或 Ghostty GPU 耗时。

| Version / Load | Complete | Stable redraw | Expand | Resize to 30 |
| --- | --- | --- | --- | --- |
| 0.84.3 / multiline | 1.378 → 1.560 | 0.121 → 0.034 | 2.888 → 2.864 | 2.235 → 2.794 |
| 0.84.3 / long token | 1.342 → 1.556 | 0.069 → 0.025 | 3.107 → 3.395 | 1.876 → 2.215 |
| 0.85.1 / multiline | 1.374 → 1.571 | 0.117 → 0.036 | 2.911 → 2.912 | 2.174 → 2.809 |
| 0.85.1 / long token | 1.341 → 1.486 | 0.071 → 0.025 | 3.101 → 2.780 | 1.904 → 2.157 |

稳定重绘不增加输出，普通模式保持 0 bytes，fullscreen 保持宿主原有的 22 bytes。缓存减少了重复扫描，但新增预览不是免费：上表多行完成输出从 875 增至 2052 bytes，缩窄时从 4465 增至 13882 bytes。展开增加行号、路径和连接线，多行输出从 9040 增至 16167 bytes。

0.84.3 反向复测中，上表多行稳定重绘为 0.099 → 0.036 ms，缩窄为 2.046 → 2.863 ms。展开的小差异受顺序与采样波动影响，不能据单次结果宣称展开提速。两个版本的完整正反向结果均保留，不筛掉慢样本。

验收依据是确定性计算次数、既有缓存预算，以及相同条件下的前后测量。没有预先给定毫秒 SLA，因此这里只报告新增成本和观测结果，不另造一个事后通过阈值，也不承诺任意历史长度下无卡顿。

## Memory Results

`read-ui-memory-0843/`、`read-ui-memory-0851/` 固定 20 条行组件，24 轮替换结果与宽度/展开往返。两版均在布局/文本 16 MiB、计数 2 MiB 预算内，清理后两类计费均归零。

0.84.3 多行负载在第 0/8/16/23 轮 GC 后 heap 为 19.48/28.33/28.39/28.42 MiB，布局计费最终约 16 MiB，发生 2339 次淘汰，dispose 后 heap 为 18.04 MiB。旧版同期约 18.64–18.71 MiB。缓存确实增加保留内存；进入预算淘汰阶段后，24 轮观测没有持续线性增长。0.85.1 同负载为 19.25/28.09/28.17/28.20 MiB，dispose 后 17.82 MiB。

该预算只计费缓存中的文本和条目，不限制 V8 heap、RSS、宿主当前帧或原始结果。RSS 保留分配器高水位，不能直接换算成新增缓存的内存百分比。

## Evidence and Limits

Context7 定位到 [Pi 主分支文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)，未提供已确认的 0.84.3 专门版本。实际 API、空 self-shell 行行为和 Read 尾注格式以安装版本的以下源码及双版本运行结果核验：

- `dist/core/extensions/types.d.ts`
- `dist/core/tools/read.js`
- `dist/modes/interactive/components/tool-execution.js`
- 随包 `docs/extensions.md`、`tui.md`、`session-format.md`、`themes.md`、`keybindings.md`

未覆盖跨 assistant 消息合并、逐文件展开、真实模型服务、任意第三方修改器原地修改同一 content 对象、Ghostty CPU/GPU，以及 Kitty/iTerm 原生图片协议的端到端显示。图片行归属有宿主组件测试，图片执行与附件绘制仍由 Pi 负责。tree/compaction 用真实 SessionManager 和事件测试，CLI smoke 未调用真实模型生成压缩摘要。

更新后应重启 Pi 并恢复会话以加载生成代码。reload 测试证明恢复契约，不证明任意旧进程自动替换已缓存模块。
