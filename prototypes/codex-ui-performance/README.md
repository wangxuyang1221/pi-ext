# Codex UI rendering benchmarks

本目录比较不可变的 `before`、待交付生产源码 `after` 和原生 Pi。它不注册为 extension，不修改上游或生产源码，不进入发布包。结果与限制见[研究报告](../../docs/research/codex-ui-performance.md)。

## Setup

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --dir prototypes/codex-ui-performance install --frozen-lockfile --ignore-scripts
pnpm --dir prototypes/codex-ui-performance test
pnpm --dir prototypes/codex-ui-performance run build
pnpm --dir prototypes/codex-ui-performance run verify
pnpm --dir prototypes/codex-ui-performance run bench
pnpm --dir prototypes/codex-ui-performance run memory
```

默认使用仓库依赖 Pi 0.84.3。`PI_PERF_AGENT_ROOT` 可指向另一已安装的 `pi-coding-agent` 包，其相邻目录须有对应的 `pi-tui` 和 `pi-ai`。不需要模型凭据。不要并行运行性能基准。

```sh
PI_PERF_AGENT_ROOT="/absolute/path/to/node_modules/@earendil-works/pi-coding-agent" \
  PI_PERF_RUN_ID=my-production-comparison \
  pnpm --dir prototypes/codex-ui-performance run bench

# Reverse the order in a fresh process to check order and GC effects
PI_PERF_VARIANTS=after,before,native PI_PERF_RUN_ID=my-reverse-comparison \
  pnpm --dir prototypes/codex-ui-performance run bench
```

每次运行新建 `results/<run-id>/`。默认 ID 是时间戳，也可显式指定 `PI_PERF_RUN_ID`。已有 ID 会报错，不覆盖历史文件。一次运行内部可以保存检查点，但不会拼接其他运行的数据。源码改变后必须重新 `build`；结果中的 `build.after` 哈希对应实际转译的输入。

## Grouped Bash revision

用户确认新版原型后再次要求生产接入：标题与 Read/Edited 对齐，命令常显，结果默认折叠。当前测试与基准使用这一契约；第一次实现及回退记录保留，不能与本轮结果混用。当前契约与验收见[施工计划](../../docs/plans/codex-ui-grouped-bash.md#current-revision)。

本轮保存的 `baselines/grouped-12158a9.json.gz` 是改动前生产快照，`baselines/grouped-withdrawn-12158a9.json.gz` 是撤销前的分组源码存档。两者均不可覆盖。`snapshot.mjs`、独立基线选择及可行性探针保留；未指定 `PI_PERF_BASELINE` 时仍使用旧 `before.json.gz`。

```sh
# Compare current production sources with the pre-grouping production snapshot.
PI_PERF_BASELINE=baselines/grouped-12158a9.json.gz \
  pnpm --dir prototypes/codex-ui-performance run build
pnpm --dir prototypes/codex-ui-performance run verify

# Historical feasibility probe only; not the production renderer.
pnpm --dir prototypes/codex-ui-performance run grouped
```

基础设施测试会重建默认 baseline，测试之后须重新执行选定基线的 build。使用 `PI_PERF_VARIANTS=before,after PI_PERF_ONLY=groups PI_PERF_PROFILE=product` 运行生产分组矩阵，每个变体 96 个组合，覆盖 1/3 成员、最后一个/全部运行、tick/追加/交错更新、收起/展开、短行/长 token、0/20 历史及普通/fullscreen。探针 `grouped` 仍只用于原型位置实验，不是生产性能分数。

## MCP and Write summary revision

本轮基线是 `baselines/tool-summary-20260906.json.gz`，包含用户已接受的 Bash 工作树以及 MCP 全部源码，不能使用 HEAD 或旧 grouped 快照替代。`build.json` 的 `before` / `after` 保存 Codex UI 源码哈希，`mcp.before` / `mcp.after` 保存 MCP 源码哈希。旧快照没有 MCP 时，不允许运行 MCP 对比。

```sh
PI_PERF_BASELINE=baselines/tool-summary-20260906.json.gz pnpm --dir prototypes/codex-ui-performance run build
PI_PERF_VARIANTS=before,after PI_PERF_ONLY=streams PI_PERF_STREAM_ROUNDS=5 PI_PERF_RUN_ID=my-summary-streams pnpm --dir prototypes/codex-ui-performance run bench
PI_PERF_VARIANTS=before,after PI_PERF_ONLY=mcp PI_PERF_RUN_ID=my-summary-mcp pnpm --dir prototypes/codex-ui-performance run bench
PI_PERF_VARIANTS=before,after PI_PERF_ONLY=mcp PI_PERF_RUN_ID=my-summary-memory pnpm --dir prototypes/codex-ui-performance run memory
PI_SMOKE_SCENE=summary PI_PERF_RUN_ID=my-summary-cli pnpm --dir prototypes/codex-ui-performance run smoke
PI_SMOKE_SCENE=summary-custom PI_PERF_RUN_ID=my-summary-custom-cli pnpm --dir prototypes/codex-ui-performance run smoke
```

反向运行使用 `PI_PERF_VARIANTS=after,before` 与新 run ID。Write 报告增加 `frameWallMs` / `frameCpuMs`，只统计流式绘制和终端解析，不把累计 JSON 解析混入帧指标。MCP 矩阵包含短文本、长 Unicode token、近上限 JSON、多块文本，以及 0/20 个历史工具、普通/fullscreen、重复折叠、展开、窄屏和恢复宽屏。`phases` 分别记录各阶段，避免把新增预览与旧元数据摘要当作等量工作。

`summary` / `summary-custom` 使用正式 Write 执行和本地 stdio MCP echo server，验证真实参数流、成功/失败、新进程恢复及默认/自定义展开键。进程和写入均限制在仓库临时目录。报告中的 `reloadMcpRendererRetained: false` 是已复现的宿主限制，不是 reload 样式验收通过；`PI_SMOKE_BASELINE=1` 可用本轮变更前源码重现。详细结果见[生产验收报告](../../docs/research/codex-ui-tool-summary-validation.md)。

## Inputs and tools

| File | Responsibility |
| --- | --- |
| `baselines/before.json.gz` | 首次改生产源码前保存的全部 8 个 TypeScript 文件及基线提交 `23315d1`，不从当前 `src/` 重建旧版 |
| `build.mjs` | 将快照和当前生产源码分别转译到 `.generated/before`、`.generated/after`，记录每个源文件 SHA-256 |
| `run.mjs` | 导入指定版本的真实 Pi 模块；记录实际包路径、版本、整个 `dist` JS/JSON 哈希及基准脚本哈希 |
| `verify.mjs` | 两种主题、12 种宽度、ANSI/Unicode、状态变化、write 非法参数、low-power 和实际高亮器的 syntax-only 主题变化 |
| `verify-terminal.mjs` | 普通 TUI 的稳定尾部更新及完成、前缀替换、resize、主题变化；等待 xterm 解析后逐 cell 比较文字与颜色 |
| `bench.mjs` | 冷绘制、折叠/重展开、宽度往返、稳定输入、普通/全屏终端链路、write/edit 参数流 |
| `memory.mjs` | 固定 20 个活动工具行，24 轮不同结果和宽度往返，验证预算、淘汰、清理及 GC 后内存 |
| `cli-smoke.mjs` | 可选的本地真实 CLI + PTY 检查，不属于普通 CI 测试依赖 |
| `historical/` | 实施前字符串转换实验的算法存档，路径保留原运行位置语义，仅供查阅，不再作为构建或验收入口 |

生产共享缓存位于 `extensions/codex-ui/src/render-cache.ts`，布局与已生成高亮共用 16 MiB 文本计费预算，计数共用 2 MiB。key、UTF-16 字符、数组项和条目开销纳入计费。超大条目正常计算但不保留；会话清理使旧 scope 失效。预算不是 V8 heap 或 RSS 上限，宿主当前帧和原始结果仍有自己的保留开销。

## Workloads

```sh
# Cold rendering or interactions, optionally one fixture
PI_PERF_ONLY=cold PI_PERF_FIXTURE=bash-token-50k \
  pnpm --dir prototypes/codex-ui-performance run bench
PI_PERF_ONLY=interactions PI_PERF_FIXTURE=edit-1000 PI_PERF_ROUNDS=27 \
  pnpm --dir prototypes/codex-ui-performance run bench

# Native dark versus codex-pi palettes, four pipeline cases
PI_PERF_ONLY=product PI_PERF_PROFILE=product \
  pnpm --dir prototypes/codex-ui-performance run bench

# More independent traces for noisy small differences
PI_PERF_ONLY=streams PI_PERF_STREAM_ROUNDS=10 \
  pnpm --dir prototypes/codex-ui-performance run bench
```

`PI_PERF_ONLY` 还支持 `stable`、`pipeline`、`fullscreen`。默认完整运行包含前三类、普通模式矩阵、fullscreen 和参数流；产品配色与内存另跑。`PI_PERF_VARIANTS` 默认 `native,before,after`，可缩小为单个变体。

- 冷绘制与交互默认 7 轮，前 2 轮预热，`PI_PERF_ROUNDS` 可覆盖。
- 终端链路每场景 14 帧，前 4 帧预热；稳定输入 40 帧，前 10 帧预热。
- 参数流默认 4 轮，前 1 轮预热，`PI_PERF_STREAM_ROUNDS` 可覆盖。write 内容 256 KiB，edit old/new 各约 128 KiB，每 256 字符更新一次、每 16 次更新画一帧。无 JSON 与有 JSON 的 chunk 总数会因转义和参数结构不同而不同，报告保留实际 updates/frames。
- `replace-tail` 是替换末行，`append` 才是真正累积追加。旧研究顶层 JSON 中的 `append` 实际对应 `replace-tail`，不能与新追加测试混用。
- 普通模式同时测全折叠与展开的 0/20 个历史工具；当前结果为 1800 短行或 50 KiB 无空格长行。

## CLI smoke

仅在本地安装了 `/usr/bin/expect` 时运行。先构建发布代码，再运行：

```sh
pnpm run build
pnpm --dir prototypes/codex-ui-performance run smoke
```

脚本将合成会话、HOME、Pi 配置、缓存和临时目录限制在仓库 `.tmp/` 下，禁用联网与自动扩展加载。`cli-fixture.mjs` 导入真实 `dist/index.js`，只注册本地脚本化 provider，不替换 Bash 执行。普通/fullscreen 各检查 mixed、success、long、live，覆盖 Ctrl+O、自定义 Ctrl+G、reload、resize、收起、退出及新进程恢复同一会话。

恢复场景加入真实 Read/Edited renderer 作为对齐参照，并断言命令在初始、收起和重启后始终可见，结果仍被折叠。live 只执行三条固定的 `printf`/`sleep`/`exit 1` 命令，工具门禁拒绝其他调用；按调用 ID 校验公开生命周期事件，不假定完成顺序。success 另检查用户 `!` Bash 的独立持久化结果。`PI_SMOKE_SCENE`、`PI_SMOKE_MODE` 可筛选场景。测试 provider 不进入发布包。

脚本保存解析后的可见文字、事件及 CLI 哈希，结束后清理进程和临时目录。`/reload` 只验证生命周期，不代替加载新代码的进程重启。实际升级应重启 Pi；直接引用仓库的安装无需重装。没有测量真实模型服务、任意 shell 命令性能或 Ghostty GPU。

## Results

本轮命令常显版本的报告统一使用 `results/grouped-commands-*`，包括双版本矩阵、反向顺序、cold/stable/interactions、memory、verify 和 CLI。`grouped-delivery-*` 是第一次实现，`grouped-rollback-*` 是回退检查，均保留为历史记录，不代表当前契约。

更早的单工具渲染优化结果也保留在 `results/`：

- `baseline-0.85.0`、`baseline-0.84.3`：改生产源码前的新基线。
- `production-0.85.0`、`production-reverse-0.85.0`：同配色完整正反顺序比较。
- `production-0.84.3`：另一版本的完整矩阵。
- `production-product-0.85.0`、`production-product-reverse-0.85.0`：产品配色关键场景。
- `streams-repeat-0.85.0`、`collapse-repeat-0.85.0`：增加轮数的重复检查；`collapse-diagnostic-0.85.0` 是带 CPU profiler 的辅助结果，不代替无 profiler 计时。
- `memory-0.84.3`、`memory-0.85.0`：固定历史的预算淘汰与内存记录。
- `delivery-verify-*`：各 2203 项帧/宽度比较及 28 个解析终端帧，含 read 与参数已完成时的非法 write fallback。`final-verify-*` 保留较早的 2023 项比较记录。
- `cli-product-smoke-*`：真实 CLI + PTY 产品主题 smoke。更早的 `cli-smoke-*` 是未加载产品主题的隔离回放。

目录顶层原有 `results-*.json`、`verification-*.json` 保留为历史实验结果，含义仍是旧 `current / optimized`，没有被新生产数据覆盖。

## Measurement boundaries

完整基准链路是参数/结果快照 → 真实 ToolExecutionComponent → Pi TUI → UTF-8 → xterm。实际 editor、footer、assistant 组件参与测量，但 context usage 是固定快照。fullscreen 没有复刻 CLI 固定编辑器区域的全部布局。

时钟驱动真实 interval 回调；TUI `requestRender` 由明确帧边界替代，不测 16 ms 调度等待。xterm 使用 `write(data, callback)` 等待解析完成，而不是只测入队。Node 与解析阶段分别记录墙钟和 `process.cpuUsage()`，合计 CPU 先逐帧相加再取中位数；报告保留所有采样及样本 p95。

冷绘制和交互没有终端输出，不能与包含终端解析的 CPU 表混用。参数流同时给出包含/不包含累计 JSON 的口径。内存循环记录 GC 后 heap、循环内 heap/RSS 峰值、预算计费和清理结果；同进程依次运行的 RSS 受分配器高水位影响，不宜直接换算成额外内存百分比。

性能矩阵没有测量模型联网、真实工具执行耗时、其他 extensions、Ghostty CPU/GPU 或整机 CPU。CLI smoke 单独执行固定本地命令及用户 `!` Bash，只验证行为。缓存不会消除巨大冷 diff 的首次高亮，也不会改变上游 JSON 解析或普通 TUI 对离屏变化的全量重放规则。
