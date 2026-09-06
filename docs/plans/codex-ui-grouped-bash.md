# Grouped Bash implementation plan

## Current revision

用户确认新版原型效果并要求 `update`。本轮再次接入生产，当前契约以本节和 `Accepted behavior` 为准，不恢复此前“成功命令一起隐藏”的设计。

- `Bash` 标签右移两格，与实际 `Read`、`Edited` 标签对齐。
- 命令常显；收起时单行预览，正文按扣除前缀/耗时后的可用宽度截断，上限 120 个显示列，含末尾 `...`。展开后显示完整命令。结果默认折叠，错误及运行日志也不预览，截断警告仍保留。
- 沿用全局 `Ctrl+O`，切换捕获结果及完整命令。展开后的实时计时继续使用先前已确认的组底部位置，避免离屏历史重绘。
- 恢复已验证的分组、缓存及 reload 生命周期处理，不改变执行代理和 low-power；不把原型控制器迁入生产。
- 修改前已逐文件核对生产源码与 `grouped-12158a9.json.gz` 一致，复用这一不可变基线；旧报告不可作为本轮的最终验收结果。

本轮接入与验证已完成，见 `Current revision results`。

## Current revision results

### Long-command preview fix

用户确认长命令收起时使用单行预览，上限 120 个终端显示列，末尾预留 `...`；按 `Ctrl+O` 恢复完整命令及输出。生产与原型同步修改，命令缓存 key 加入展开状态，避免相同宽度下预览和完整布局互相复用。新增边界、Unicode、窄窗口、耗时预留、换行及反复展开回归。Codex UI 107 项、原型 16 项测试通过；`pnpm run check` 通过 652 项测试，1 项既有跳过，构建及发布包校验通过。

下方性能报告采集于此次预览修正之前，不作为快修后的重新测量结果。本次只做针对性测试和完整仓库检查，不重跑整套性能矩阵。

### Behavior and checks

- 生产 `bash-group-layout.ts` 已按确认的原型调整：标题缩进两格，所有命令完整换行显示，折叠时直接跳过捕获内容处理。移除旧错误/运行输出预览；保留真实截断警告。
- 沿用已验证的 `bash-groups.ts` 和 `tools.ts` 归属、状态及缓存机制，包括 reload 先创建组件再触发 `session_start` 的处理。没有引入原型控制器、固定调用数量或额外日志文件读取。
- 新契约测试先在旧生产上失败，再接入后通过。Codex UI 共 106 项测试通过；原型 16 项通过；`pnpm run check` 通过 651 项测试，1 项既有跳过，类型检查、构建及发布包校验通过。
- Pi 0.84.3 / 0.85.0 各通过 2,203 项帧/宽度比较及 56 个 xterm 终端帧。各 8 个真实 CLI 场景通过，覆盖 Read/Edited 对齐、每条命令常显、结果默认折叠、原生/自定义展开键、实际 Bash 生命周期、用户 `!` Bash、reload、resize 及新进程恢复。
- 未逐一操作 fork/树选择器/自动压缩的真实 CLI；这些路径沿用真实 SessionManager/工具组件和清理回归，不扩大已有验收声明。临时进程、会话及测试目录均已清理。

### Current performance

本轮报告前缀统一为 `prototypes/codex-ui-performance/results/grouped-commands-*`。复用经过逐文件核对的不可变 `grouped-12158a9.json.gz`，Node 22.22.2，Pi 0.84.3 / 0.85.0，120×40，产品配色，14 帧取后 10 帧。双版本正向及 0.84.3 反向共 576 个完整管线场景，另跑双版本 cold/stable/interactions 与固定 20 工具、24 轮内存循环。源码、宿主与基准脚本哈希及 CPU/墙钟原始样本保存在报告内。

以下为 20 个历史工具、三成员、1800 短行、普通 TUI 的每帧总 CPU 中位数，单位 ms：

| Scenario | 0.84.3 before → after | Reverse before → after | 0.85.0 before → after |
| --- | ---: | ---: | ---: |
| Collapsed / last append | 0.99 → 0.21 | 0.96 → 0.18 | 0.98 → 0.18 |
| Expanded / last tick | 8.14 → 8.65 | 8.18 → 8.40 | 8.18 → 8.37 |
| Expanded / last append | 23.11 → 10.17 | 22.56 → 10.26 | 24.00 → 9.61 |
| Expanded / all-running tick | 60.23 → 8.48 | 60.44 → 8.31 | 62.85 → 8.80 |
| Expanded / interleaved output | 73.65 → 47.88 | 73.83 → 48.78 | 74.33 → 50.07 |

全部生产 tick 和最后成员追加场景均无历史全量重放。全运行 tick 从每帧 6,469,211 bytes / 1 次重放变为 111 bytes / 0 次；真实离屏交错输出仍可重放，保留这一宿主行为。单运行成员 tick 的 CPU 没有全面下降，不宣称每项指标都更快。

中文长输出的首次展开仍有已知回退：50 KiB 中文 fixture 的墙钟在 0.84.3 为 4.47 → 9.29 ms，0.85.0 为 4.62 → 9.86 ms。1800 短行首次展开分别为 14.51 → 1.42、14.42 → 1.44 ms。命令常显意味着超长命令本身也需要布局，不再有原先折叠命令只保留摘要前缀的成本上限；本轮不承诺任意超长命令或极窄窗口都不会触发宿主重绘。

两版内存预算、淘汰及清理检查通过。最终布局计费 16,777,140 bytes，小于 16 MiB；淘汰 2,822 项，计数桶为零，清理后两个桶均为零。0.84.3 after 的 GC heap 首轮/末轮为 33.05/33.11 MiB，peak heap/RSS 为 77.15/262.58 MiB；0.85.0 为 32.99/33.04 和 77.37/263.23 MiB。RSS 不是缓存预算，不能据此声明进程内存上限。

用户升级时应重启 Pi 并恢复会话，不把 `/reload` 当作旧进程已加载新 JS 的证据。以下首次实现与回退记录保留作历史参考。

## Rollback status

用户查看实际截图后反馈“不好看，还是恢复原来的样子吧”。已按要求撤销生产 Grouped Bash，恢复改动前 `12158a9` 的单条 Bash timeline、主副两行摘要及原生展开行为。对应生产测试和根 README 一并恢复，其他工具、low-power、执行逻辑不变。

原型、不可变基线与测量报告保留。撤销前生产源码归档为 `prototypes/codex-ui-performance/baselines/grouped-withdrawn-12158a9.json.gz`，不进入发布包。普通基准和 CLI smoke 恢复旧契约，分组专用生产测试及测试 provider 已移除。此节、旧勾选项及 `Delivery results` 保留第一次实现与回退的历史。本轮重新获批的契约见上方 `Current revision`，不能使用旧数据代替本轮验证。

### Rollback verification

- `extensions/codex-ui/` 的源码、测试及构建产物与 `12158a9` 一致，根 README 也已恢复。
- `pnpm run check` 通过：650 项测试通过，1 项既有跳过，类型检查、构建和发布包校验通过。
- Pi 0.84.3 / 0.85.0 各通过 2,203 项帧/宽度比较、28 个解析终端帧，以及旧样式的真实 CLI 展开/reload/resize/收起 smoke。报告在 `results/grouped-rollback-verified-*` 与 `grouped-rollback-cli-*`。
- 回退后须重启 Pi 并恢复会话，不能依赖仍加载分组代码的旧进程。临时 CLI 进程和会话目录已清理。

## Understanding

将已确认的方案 4 从[交互原型](../../prototypes/codex-bash-ui-prototype/README.md)迁入生产 `codex-ui`。交付紧凑的分组摘要和原生 `Ctrl+O` 两态展开，不增加 `/bash-logs`、日志弹层或第三层展开。

本方案曾完成生产实现与验收，随后按用户反馈回退，历史记录见 `Delivery results`。`Locate` 确认顶部运行计时会重新引入稳态历史全量重绘，用户以 `yep` 同意仅在展开时把实时耗时集中到整组底部一行。最终记录同时列出冷绘制回退和未测边界，不以功能通过代替性能结论。

### Accepted behavior

| State | Contract |
| --- | --- |
| Collapsed | 标题向右缩进两格，显示命令数、状态统计及展开提示。每条命令单行预览，正文最多 120 显示列，按可用宽度缩短并用 `...` 标示，展开后恢复完整多行命令；结果默认折叠，组内不加空行 |
| Exceptions | 失败、超时、取消、运行及 pending 均保留命令和可确认的状态，不在折叠时读取或显示日志。成功截断也不能隐藏警告，原始错误原因在展开结果后可见 |
| Expanded | 每条完整命令只出现一次，随后立即显示本次已捕获的全部输出。保留日志原有空行，相邻命令块之间只加一条空内容连接线。运行中的实时耗时按成员编号集中在整组底部一行，完成后的已知耗时显示在命令旁；不加重复的逐条元数据尾行 |
| Empty and truncated | 区分无输出成功、等待执行和等待输出。上游截断保留警告，有真实 `fullOutputPath` 时显示路径，不读取文件来补齐输出 |
| Toggle | 沿用 Pi 的全局 `app.tools.expand`，默认 `Ctrl+O`。再次按下收起；执行结束不覆盖用户的展开选择。提示使用宿主注入的真实绑定 |
| Outer spacing | 保留 Pi 自带的一行外部间距，隐藏的组成员不留下空卡片或额外空行 |

以上新布局针对 full 渲染模式。low-power 本次保留现有轻量展示，不扩大预览或恢复实时日志刷新。

## Archived implementation checklist

### 1. Locate

- [x] 确定真实分组边界和事件时序，形成可实现的归属规则。以同一 assistant 消息中连续的 Bash 调用为候选组，按源调用顺序展示，不跨文本、thinking、其他工具或 assistant 消息合并；单条 Bash 作为单成员组。核对流式参数、组件创建和恢复顺序，确定组标识、承载组件及成员失效通知方式；不能确认归属时独立展示，不能吞掉调用。
- [x] 扩展现有真实 `ToolExecutionComponent` / TUI 测试设施，加入多调用、混合工具、乱序完成和会话恢复 fixture，并让性能基准支持本轮生产源码的独立不可变快照。先验证跨组件分组和展开后顶部动态字段的可行性，再接入完整布局；不覆盖旧性能项目的 `before` 快照或历史结果。

### 2. Implement

- [x] 实现会话内 Bash 分组状态与索引，用 `toolCallId` 关联参数、结果和所属组。增量维护成员顺序与状态统计，使用真实生命周期区分 pending、running 和完成；结果状态以宿主信号为准，不能因输出含有 `Error` 就判失败，也不能把失败组内所有成员判失败。缺失耗时、退出码或结束原因时不补造数据。
- [x] 将已确认的分组布局迁入 `extensions/codex-ui/src/`，拆开纯布局与宿主适配，在 `tools.ts` 接入。整组只由一个组件绘制，其他成员不重复显示；成员更新必须刷新整组，避免递归失效。落实上表的间距、错误摘要、完整捕获输出、截断提示及全局两态展开，不依赖原型 controller、fixture ID 或实验 widget。
- [x] 接入历史重建和生命周期清理。根据宿主实际展示的会话分支恢复分组，覆盖启动、恢复、fork、树导航、压缩和 reload；重建不得修改会话记录或重新执行 Bash。清理失效的组件回调、计时器与索引，阻止旧会话延迟事件污染新会话，避免给恢复的历史调用启动虚假计时。
- [x] 将分组派生布局纳入现有缓存和刷新机制。复用未变化成员的输出处理结果，状态统计与耗时变化不重新清理、拆行或 wrap 整组日志；每帧不扫描整个会话，不额外保存整组拼接后的原始日志。保留共享布局 16 MiB、计数 2 MiB 的计费预算、超大条目绕过缓存与 generation 失效机制，以及现有每秒计时节奏。low-power 继续走当前有界路径。

### 3. Deliver

- [x] 移除被替换的旧 full-mode 单条 Bash 布局及无用分支，保留官方 Bash definition 的执行代理、参数、cwd、权限、取消和原始结果语义。确认 read、write、edit、用户 `!` Bash、非 TUI 模式不受此次显示重构影响。
- [x] 更新根 `README.md` 的 Bash 展示与升级说明，并记录本轮功能、终端及性能验收结果。保留原型作为设计参考，不将实验命令、模拟 provider 或控制器带入发布包；`dist/` 仅通过构建生成。升级验证使用重启 Pi 后恢复会话，不把 `/reload` 通过当成旧进程已加载新版代码的证据。

## How to test

按 Red-Green-Refactor 推进，每个实现项先补能失败的目标用例，再实现并整理代码。下述测试与测量是对应 Todo 的完成条件，不是交付后的补做项。

### Behavior and integration

| Coverage | Expected result |
| --- | --- |
| Group boundaries | 同一消息内连续三个 Bash 合并；Bash/read/Bash、文本或 thinking 分隔、不同消息及不同分支不误合并。流式追加成员不丢调用、不重复绘制、不改变源顺序 |
| Real updates | pending → running → 成功或失败、多个调用交错更新及乱序结束都只更新正确成员。覆盖参数未完成、空输出、异常和取消；无法可靠区分超时与其他失败时保留原始原因，不猜测状态 |
| Collapsed spacing | 全成功组仍显示所有命令；失败/运行日志默认隐藏，不读取捕获内容。截断警告可见，Bash 与真实 Read/Edited 的文字列一致。组内无空行，隐藏组件无额外外框间距 |
| Expanded content | 长捕获输出无二次截断；命令只出现一次；命令与输出之间无新增空行，块间只有一条连接线，原始空行保留；截断警告及真实文件路径可见 |
| Native toggle | 用真实工具组件反复全局展开与收起，多组和混合工具一致响应；完成不自动收起；自定义绑定提示正确，不新增按键处理器抢占其他工具行为 |
| Recovery | 同一会话实时执行后的分组与重启恢复后的分组一致。缺少结果的历史调用不冒充成功或正在本机运行；缺少时间元数据不显示虚构耗时。切换分支、reload、shutdown 后旧回调不能复活旧组 |
| Output changes | 覆盖累计追加、末行替换、整段前缀变化及 partial → final，不假设日志永远只追加。结果展开后显示原文，不生成诊断 |
| Width and safety | 复用现有宽度集 1、2、4、9、10、30、71、72、119、120、121、300 及零值、非法宽度；覆盖中文、emoji、组合字符、长 token、ANSI/OSC、回车、制表符与主题切换，无越界或控制序列注入 |
| Compatibility | low-power 保持命令 256 字符、输出 4 KiB / 3 行等现有边界，不展示实时 partial 输出或注册实时计时刷新；保留当前按工具行锁定模式的行为。其他工具及执行代理的既有测试继续通过 |

断言必须经过真实宿主组件组合，不能只测纯 `renderGroup` 字符串。PTY smoke 验证真实 CLI 的按键和恢复；终端内容正确性用现有终端解析后的 cell 比较补足，不能仅凭输出中出现几个标记判断布局无误。

### Performance

在首次修改生产源码前保存当前生产快照和基线结果，记录源码哈希、Node、Pi 版本、主题与运行参数。先以仓库锁定的 Pi 0.84.3 验证，再对用户本机已安装的 0.85.0 做兼容检查；不升级依赖来绕过问题。

- 复用[已有基准](../../prototypes/codex-ui-performance/README.md)的 `120 × 40` 终端、0/20 个静态展开历史工具、1800 短行或 50 KiB 长 token、100 ms 输出更新和 1 s 计时刷新。加入单成员组与原型的三成员组，覆盖一个运行成员及交错运行成员；分别测收起和展开、普通 TUI 和 fullscreen。
- 确定性断言覆盖纯计时 tick 不重新处理日志、单成员变化不重新处理无变化成员、稳定渲染不重扫会话、完成与清理后没有悬挂 timer。组索引按调用数增长，不按历史更新次数增长。
- 记录完整链路的宿主与终端解析 CPU、墙钟、输出字节数及历史全量重放次数。与本轮变更前基线在同条件下重复比较，区分预热、运行顺序和噪声，不使用旧优化前版本充当当前生产基线，也不自行设定百分比阈值。
- 重点检查展开组的计时与统计位于可视区上方时是否让原本稳定的尾部更新退回历史全量重放。真实状态变化、多处离屏并发更新与稳态 tick 分开记录，不承诺消除宿主本身的所有重放。
- 复用固定 20 个工具、24 轮结果替换与宽度往返的内存检查，验证计费预算和清理；同时记录 GC 后 heap 及峰值 RSS。缓存计费预算不是进程内存上限，不重复持有整份输出作为绕过预算的缓存。

已有性能优化将展开 Bash 的动态耗时移到底部，原型又把它放回命令旁。这是本次实现前必须验证的冲突。若保持已确认布局会重新引入明显的稳态历史重放，应先展示测量结果并请用户确认最小的动态字段位置调整，不能擅自冻结计时、丢日志、跳过离屏更新或强制 fullscreen。

### Commands and final checks

功能与完整检查：

```sh
pnpm exec vitest run extensions/codex-ui/__tests__
pnpm run prototype:bash-ui:check

mkdir -p .tmp
check_tmp="$(mktemp -d "$PWD/.tmp/codex-ui-grouped-check.XXXXXX")"
TMPDIR="$check_tmp" pnpm run check
result=$?
rm -rf -- "$check_tmp"
exit "$result"
```

扩展基准 fixture 后，沿用现有入口，每轮使用新的 `PI_PERF_RUN_ID`，不要并行跑性能测试。比较结果必须指向本轮保存的生产基线：

```sh
pnpm --dir prototypes/codex-ui-performance test
pnpm --dir prototypes/codex-ui-performance run build
pnpm --dir prototypes/codex-ui-performance run verify
pnpm --dir prototypes/codex-ui-performance run bench
pnpm --dir prototypes/codex-ui-performance run memory
pnpm --dir prototypes/codex-ui-performance run smoke
```

最后在隔离的真实 CLI 中检查 mixed、全成功、长输出及截断场景，覆盖普通和 fullscreen 模式、resize、自定义展开键和重启恢复。临时 HOME、会话、输出文件置于仓库内，结束时清理进程与临时目录。任何未测项在交付记录中写明，不用功能测试通过代替性能达标。

## Locate findings

### Baseline and scope

本轮在任何生产修改前保存了 `baselines/grouped-12158a9.json.gz`，位于 `prototypes/codex-ui-performance/`。快照包含全部生产 TypeScript、逐文件 SHA-256、主题与锁文件内容、Node/Pi 版本及相对 HEAD 的源码差异。保存时生产源码差异为空，HEAD 为 `12158a900eafcbcb67c3f5cdbb00f19e1573ed27`。旧 `baselines/before.json.gz` 未改动。

基准构建新增 `PI_PERF_BASELINE`，可以把选定快照作为 `before`，仍将当前生产源码作为 `after`。本轮报告的 `build.baselineSnapshot` 和 `build.before` 标明实际输入，不能只看变体名判断基线版本。

### Host ordering

以下为本地 Pi 0.84.3 的初始源码定位。后续真实 CLI 录制及 reload 时序修正见 `Delivery results`：

- `core/agent-session.js` 的 `_handleAgentEvent` 先等待扩展事件，再通知 UI listener，最后持久化 `message_end`。因此归属发现应直接读事件中的 assistant 内容，不等待该消息出现在 session entries。
- `interactive-mode.js` 的 `message_update` 按 assistant 源顺序创建工具组件，也会再次更新已存在组件的参数。`tool_execution_start` 只在缺失时补建，并标记执行开始；update/end 根据 `toolCallId` 更新。
- assistant 的 text/thinking 统一在 assistant 组件中显示，工具组件随后按源顺序排列。继续采用源内容中连续 Bash 的保守边界，即便文本在屏幕上不直接夹在两个工具组件之间，也不跨它合并。
- 恢复入口使用 `sessionManager.buildContextEntries()`，再用公开导出的 `sessionEntryToContextMessages()` 展开消息。实际锁定的 0.84.3 helper 不投影 `retainedTail`，与较新文档有差异；不能自行补出宿主没有展示的调用，也不能使用全量 `getEntries()` 代替展示列表。
- `ToolExecutionComponent` 构造时立即调用 renderer。`context.invalidate()` 同步进入该组件的 `invalidate()` 和 `updateDisplay()`。跨成员通知必须防止递归；不能等到首次 `render(width)` 才登记成员。
- self-shell 的空 call/result 组件确实返回零行，连外部 spacer 一起隐藏。本轮探针再次通过真实多组件组合断言，但成员列表仍为固定 fixture，不等同于完成动态归属。

生产实现用首个源调用 ID 索引候选归属，由首个已确认绑定的 full-mode 组件承载；调度器另用会话内唯一 key。无法确认归属、重复 ID、缺失组件及 low-power 成员均保持保守边界。动态追加、模式锁定和 generation 清理已加入真实工具组件测试。

### Timer replay evidence

新增 `prototypes/codex-ui-performance/grouped-probe.mjs`，用已确认的原型 `renderGroup`、真实 `ToolExecutionComponent`、生产 editor/footer、普通及 fullscreen TUI 和等待解析完成的 xterm 做对照。仅通过 fixture 更新渲染状态，不执行 Bash，也不改生产布局。实验的底部版本只移动运行耗时，保留组标题统计与命令。

每轮 144 个场景，覆盖 1/3 个成员、最后一个或全部成员运行、0/20 个静态历史工具、1800 短行/50 KiB 长 token、收起/展开、普通/fullscreen。每场景 14 个一秒 tick，前 4 帧预热；每帧断言重绘次数，并在最终帧将解析后的文字、宽度、颜色、样式 cell 与新绘制的 viewport 比较。

原始报告均在 `prototypes/codex-ui-performance/results/`：

- `grouped-baseline-0843/`：修改生产前的普通 TUI 20 场景基线，包含 100 ms 追加/末行替换和 1 s tick。
- `grouped-locate-0843/`：Pi 0.84.3，production → grouped-top → grouped-bottom-probe。
- `grouped-locate-reverse-0843/`：Pi 0.84.3，反向顺序独立进程复测。
- `grouped-locate-0850/`：本机 Pi 0.85.0 兼容复测。

以下为 0.84.3 正向轮次、120 × 40、20 个展开静态历史工具、1800 短行、仅最后一条命令运行时的每帧中位数。CPU 与墙钟单位为 ms，字节为真实 ANSI 输出字节，不是原始日志大小。

| Members | Placement | Bytes | Full redraws | Host CPU | Parser CPU | Total CPU | Total wall |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Current production | 128 | 0 | 7.43 | 0.07 | 7.50 | 7.93 |
| 1 | Accepted prototype top | 5,791,435 | 1 | 31.19 | 43.15 | 74.54 | 65.37 |
| 1 | Bottom experiment | 71 | 0 | 23.66 | 0.81 | 24.52 | 24.28 |
| 3 | Current production | 128 | 0 | 8.06 | 0.48 | 9.58 | 8.25 |
| 3 | Accepted prototype top | 6,130,428 | 1 | 65.44 | 44.88 | 115.09 | 102.84 |
| 3 | Bottom experiment | 71 | 0 | 59.72 | 1.00 | 60.99 | 60.34 |

反向轮次与 0.85.0 的对应场景字节数和重绘次数完全一致。三成员长 token 场景顶部计时每帧写出 5,875,292 字节，基线为 127 字节，底部实验为 71 字节。收起和 fullscreen 的纯 tick 均没有历史全量重绘。多个生产工具同时运行且早先工具在屏幕外时，原生产基线本身也会重绘，探针保留此边界，没有跳过离屏更新。

宿主原因已定位到 `pi-tui/dist/tui-main-screen.js` 的 `firstChanged < prevViewportTop` 分支。展开组命令旁的耗时在视口上方改变，触发清空并重放完整历史。组内输出处理缓存不能消除这一位置导致的重绘。

注意：探针直接调用没有生产缓存的原型布局，每帧仍会 wrap 输出。表中的分组宿主 CPU 不能作为未来生产实现的性能分数，底部实验也尚未达到生产 CPU 验收要求。这里确认的是重绘触发、字节数和解析成本；生产缓存、100 ms 分组输出更新、真实状态变化及内存矩阵仍须后续测量。全部 432 个场景的最终 viewport 比较通过，不代表完整 CLI/PTY 或动态恢复已经验收。

### Checks completed before implementation

- 新增基线选择测试先失败，再实现后通过；基础设施测试共 3 项通过，包括快照哈希及拒绝覆盖检查。
- `pnpm run prototype:bash-ui:check`：原型 13 项通过。
- `pnpm run check`：类型检查、650 项测试、构建及发布包校验通过，1 项既有测试跳过。
- 生产 `extensions/codex-ui/src/` 与 `__tests__/` 未修改，既有 4 项真实 TUI 管线回归继续通过。没有更改 Bash 执行或会话记录。
- 探针清理 interval、screen、footer 和 xterm，检查使用的仓库内临时目录已删除。本轮没有启动真实 CLI/PTY smoke；没有执行生产分组内存验收或真实分组恢复验收。

### Confirmed decision

建议只在展开状态把运行中的实时耗时移到整组底部的一行，并按成员编号关联；组标题统计、命令顺序、日志、完成后的耗时和收起布局不变。多条运行耗时共用这一行，不恢复逐条元数据尾行。完成时的真实状态变化仍可触发重绘，不为此冻结状态。

用户已以 `yep` 确认这一处调整。实施按此契约继续，底部探针的缓存成本不作为生产验收结果。

## Delivery results

### Production changes

- `extensions/codex-ui/src/bash-groups.ts` 管理源调用归属、已绑定组件、增量状态统计、原始结果引用与组计时。`bash-group-layout.ts` 负责两态布局和有界派生缓存；`tools.ts` 只接入宿主生命周期与 renderer。
- 整组由首组件绘制，其他成员的 call/result 均返回零行。成员结果更新通知组首组件，递归通知有保护。低功耗成员和未绑定调用不被吞掉；未知调用独立展示。
- 已移除旧 full-mode 单条 Bash 布局。保留官方 definition、执行代理及 low-power 分支；没有新增产品命令、日志读取、provider 或执行控制器。`dist/` 由 `pnpm run check` 构建生成。
- 派生的清理、拆行、命令和输出布局使用原有共享缓存。组对象只保留宿主原始结果引用，不另存整组原始日志。计时不重新处理日志，单成员更新复用其他成员输出。文本先做宽度处理，再施加颜色，避免重新解析刚拼入的 ANSI。

### Host lifecycle and CLI

真实 CLI 揭示了单元 fixture 最初遗漏的 reload 顺序：新扩展 instance 的历史组件先创建，随后才触发它的第一次 `session_start`。若这时直接清空 scope，已创建的历史组会退回独立项。修复后，第一次启动保留本 instance 刚绑定的组件，再发现历史归属；后续生命周期仍清除旧 generation。新增针对这一真实顺序的回归测试，未通过宿主私有 API 重建 UI。

- 两版各 8 个 CLI 场景全部通过。普通/fullscreen × mixed/全成功/长输出/live，检查默认 Ctrl+O、自定义 Ctrl+G、reload、resize、收起、正常退出和新进程恢复同一会话。
- live 通过本地脚本化 provider 输出连续三条调用，官方 Bash 实际执行固定的 `printf`、`sleep`、`exit 1`。公开事件证实参数流先于执行，三条结果分别为两成功一失败。实际完成顺序会变化，断言按 `toolCallId` 关联，不把失败归到相邻成员。
- 恢复的历史没有计时器或虚构耗时，不重新执行命令。success 场景还执行独立的用户 `!` Bash，检查其持久化 `bashExecution.output` 和退出码，不将它并入 assistant 工具组。
- 真正的 SessionManager 分支/压缩入口、宿主投影、重复调用 ID、旧回调、树导航/关停清理通过真实组件测试；fork/树选择器/自动压缩没有逐一走交互 CLI，不能将这些测试描述为完整的人工导航验收。非 TUI gating 和其他工具继续由既有测试覆盖。

最终 CLI 报告为 `results/grouped-delivery-cli-0843/smoke.json` 与 `grouped-delivery-cli-0850/smoke.json`，路径均相对 `prototypes/codex-ui-performance/`。测试 provider 仅位于该目录，发布包校验确认它未被打包。所有 CLI 进程、interval 和仓库内临时 HOME/会话已清理。

### Verification

- `pnpm run check`：类型检查、648 项测试通过，1 项既有 integration 测试跳过；构建及发布边界检查通过。Codex UI 自身 103 项测试通过。
- `pnpm run prototype:bash-ui:check`：13 项通过。原型保留为设计参考，未成为生产依赖。
- 性能基础设施 3 项测试通过，选定的本轮 baseline 与旧 `before.json.gz` 均未覆盖。
- 两版各 2,203 项帧/宽度比较与 56 个 xterm 终端帧通过，包含 1/3 成员、追加、末行替换、前缀替换、完成、resize 和主题变化。稳态 tick/尾部更新没有历史重放。未更改布局的其他工具与 low-power 仍做 before/after 逐行一致检查；新 Bash 契约以目标断言及缓存帧/fresh frame 一致性检查。
- 错误、超时和取消摘录原始结果，成功输出中的 `Error` 不改变状态。覆盖 Unicode/ANSI/OSC、极窄宽度、50 KiB 命令及输出、原始空行、截断路径、状态与计时缓存。

### Performance results

最终比较使用 `grouped-12158a9.json.gz`，Node 22.22.2，产品主题，120×40。每场景 14 帧，前 4 帧预热。每轮 96 个组合 × before/after，两版正向加 0.84.3 反向共 576 个场景，不并行运行。最终报告是 `grouped-delivery-0843`、`grouped-delivery-reverse-0843`、`grouped-delivery-0850`，各记录实际源码与宿主哈希；更早的 `grouped-final-*` 是优化前过程记录。

以下是 0.84.3 正向、20 个展开历史、1800 短行、展开组的每帧中位数。CPU 与墙钟单位为 ms，总 CPU 先逐帧相加再取中位数，不能直接相加表内两个中位数。

| Members / event | Version | Host CPU | Parser CPU | Total CPU | Total wall | Bytes | Full redraws |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 / tick | Before | 7.29 | 0.06 | 7.35 | 7.88 | 128 | 0 |
| 1 / tick | After | 8.49 | 0.77 | 9.19 | 8.08 | 71 | 0 |
| 3 / last-member append | Before | 22.73 | 0.50 | 24.01 | 22.54 | 1,136 | 0 |
| 3 / last-member append | After | 9.82 | 0.09 | 9.91 | 9.94 | 986 | 0 |
| 3 / all-running tick | Before | 12.92 | 46.74 | 60.61 | 54.31 | 6,469,211 | 1 |
| 3 / all-running tick | After | 7.39 | 1.08 | 8.47 | 8.43 | 111 | 0 |
| 3 / interleaved output | Before | 24.16 | 46.95 | 74.16 | 66.09 | 6,469,676 | 1 |
| 3 / interleaved output | After | 12.26 | 33.13 | 45.55 | 41.64 | 3,825,456 | 1 |

三轮生产分组的全部 tick 和最后成员追加场景均为零历史重放，包含长 token、收起和 fullscreen。三成员短行追加的总 CPU，反向轮为 23.44 → 10.53，0.85.0 为 23.18 → 9.99。全运行 tick 的总 CPU 分别为 60.27 → 8.44、63.02 → 8.38。离屏成员实际输出交错变化仍会触发普通 TUI 重放，没有隐藏更新来规避。

单成员 tick 不应宣称 CPU 全面下降，0.84.3 两轮总 CPU 为 7.35 → 9.19、7.36 → 10.24，0.85.0 为 7.43 → 8.53；对应墙钟变化较小，原始样本保留了解析调度与 CPU 波动。未设百分比阈值，也不将功能通过等同于所有性能指标改善。

cold、stable、interactions 的双版本报告分别位于 `grouped-delivery-cold-*`、`grouped-delivery-stable-*`、`grouped-delivery-interactions-*`。0.84.3 的 1800 短行首次展开墙钟为 14.56 → 1.45，首次新宽度 13.78 → 0.89，重展开约 0.05，回到已有宽度约 0.05。50 KiB ASCII token 的首次展开为 20.52 → 20.99；0.85.0 为 20.36 → 21.63。

已知回退：50 KiB 中文 fixture 首次展开墙钟在 0.84.3 为 4.64 → 8.79，在 0.85.0 为 4.59 → 9.03。它只说明该冷路径仍多约 4 ms，不能称为全面无回退；不通过删日志、冻结状态或另加无预算缓存换取分数。

### Memory and limits

固定 20 个工具、24 轮不同结果和宽度往返，两版预算/淘汰/清理检查通过。最终布局计费 16,628,094 bytes，小于 16 MiB，淘汰 2,824 项；计数桶为零，因为新的折叠摘要不再统计输出视觉行。清理后两个桶均为零。

| Pi / version | GC heap first → last, MiB | Peak heap, MiB | Peak RSS, MiB | Heap after clear / release, MiB |
| --- | ---: | ---: | ---: | ---: |
| 0.84.3 before | 42.44 → 41.43 | 111.90 | 271.17 | 30.99 / 17.70 |
| 0.84.3 after | 33.06 → 33.07 | 77.15 | 271.41 | 26.98 / 18.58 |
| 0.85.0 before | 42.36 → 41.39 | 112.89 | 270.78 | 30.94 / 17.66 |
| 0.85.0 after | 33.00 → 33.03 | 77.83 | 272.41 | 26.94 / 18.53 |

报告位于 `grouped-delivery-memory-*`。RSS 受同进程分配器高水位影响，缓存预算不是进程内存上限。生产避免对大数组使用参数展开，但极端的十几万条视觉行仍可能碰到宿主 `ToolExecutionComponent` 自身的参数展开上限；未修改上游。未测 Ghostty GPU、整机耗电、真实模型网络或任意用户命令的执行性能。

## Notes

- 只做显示层分组，不把多条调用变成一次 shell 执行，不更改模型上下文、执行顺序或持久化结果。分组依据必须可从真实会话重建，不能沿用原型固定三个调用的假设。
- 本地 0.84.3 的 `BashToolDetails` 只有可选的 `truncation` 和 `fullOutputPath`，没有结构化退出码、起止时间或结束原因。原型中的精确数值不能直接照搬到历史记录。
- low-power 暂不统一为新分组外观。它原本就限制展开预览，若后续要统一，应另行确认展示与功耗取舍，不在本次顺带改变契约。
- 仅使用公开扩展 API。若分组承载或事件时序无法满足不漏调用、不乱序的要求，先报告限制，不改上游、`node_modules` 或宿主私有组件。
- Context7 的 `/earendil-works/pi` 提供主分支文档，未提供锁定的 0.84.3 文档版本。具体签名以本地依赖的 `core/extensions/types.d.ts`、`core/tools/bash.d.ts` 和真实运行结果为准。相关公开资料见 [extension docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。
