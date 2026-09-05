# Codex UI rendering performance plan

- Status: `Implemented with validation limits`
- Scope: `extensions/codex-ui`
- Upstream Pi changes: `None`
- Delivery method: `Red-Green-Refactor`

## Understanding

实施前次调研中的七类渲染优化，并将展开 Bash 的实时耗时、输出视觉行数移到区块底部。保留 codex-ui 的折叠展示和 write/edit 摘要优势，重点消除普通模式下由顶部高频变化引起的全历史重放，再用完整渲染链路验证收益。

用户已批准本计划，现已按 Red-Green-Refactor 完成实现。勾选表示对应实现、功能/成本验证或文档交付已完成，不代表下文每项性能指标都改善。edit 折叠尾延迟及未做 Ghostty 人工观感验证的限制见交付记录。调研依据见 [性能报告](../research/codex-ui-performance.md)。

### Behavior contract

| Area | Required behavior |
| --- | --- |
| Expanded Bash | 仅将耗时、输出视觉行数移到底部；沿用现有字段文本、颜色、计数与计时语义 |
| Header | 状态、命令摘要、timeout、truncated 标记、展开/折叠快捷键提示保留在顶部，不随本次调整搬到底部 |
| Output | 展开命令、完整结果正文、截断说明、路径、空行与缩进保持原有规则；不新增截断或隐藏输出 |
| Collapsed Bash | 主副两行的字段、顺序、优先级、命令裁剪和刷新频率保持不变 |
| Write and edit | 可见内容、语法高亮、行号、背景色、错误展示及展开规则保持不变 |
| Refresh | 保持当前 Bash 每秒计时刷新及宿主输出更新节奏，不节流、不跳过不可见工具的更新 |
| Lifecycle | 执行结束后冻结最终耗时；恢复历史时不伪造开始时间；并发工具互不串状态 |
| Modes | 保持每个工具行锁定渲染模式的现有规则；不改变 low-power 行为，不自动切换 fullscreen |
| Execution | 继续代理官方工具定义的执行，不修改参数、结果、权限、取消及文件写入语义 |
| Integration | 只使用公开扩展接口，不改上游源码、依赖目录或私有方法，不做运行时 monkey patch |

展开后的动态元信息位于正文及现有 warning 之后，没有正文时位于展开命令之后。耗时和行数仍使用现有字段优先级与宽度适配规则，在各自所在行内排布；不新增产品文案。完成后仍在底部显示最终值，折叠时恢复原有摘要位置，避免完成瞬间再搬动一次。

顶部不是永远不变。执行状态转换、首次出现 truncated 标记、参数变化、主题或宽度变化仍可能改变顶部；本次针对的是稳定运行期间的计时和输出计数更新。

## Todo

按以下顺序执行。每项先用下文对应行为或成本约束写失败测试，最小实现转绿后再重构。只有实现及对应验收均完成，才勾选该项。

### 1. Prepare

- [x] 将 `prototypes/codex-ui-performance/` 改造为可比较真实生产源码的 `native / before / after` 基准入口。
  - 在第一次修改插件源码前保存不可变的 `before` 源码快照及清单；`after` 从待交付源码构建，不再靠字符串替换模拟生产优化。
  - 记录插件提交、工作树相关文件哈希、Node、Pi 包版本、实际加载模块的路径与哈希、主题、尺寸和负载配置。
  - 新运行结果按运行标识分别保存，禁止覆盖现有研究 JSON。保存足以重建旧基线的输入，而不只保存被忽略的临时构建目录。
  - 将旧 `append` 场景准确命名为末行替换，另加真正的末尾追加。补齐全折叠历史、展开长历史、缓存淘汰和持续结果更新场景。

- [x] 建立使用真实 `ToolExecutionComponent` 与普通模式 TUI 的确定性终端回归 fixture。
  - 复用现有捕获终端、确定性时钟和合成历史，纳入 `extensions/codex-ui/__tests__/`；不需要真实执行 shell 或修改用户文件。
  - 同时观察完整工具行、终端写入字节、清屏/清 scrollback 序列、全量刷新次数和工具计时回调。
  - 保留既有逐帧比较；仅展开 Bash 的已批准布局调整使用新预期，其余区域仍与 `before` 比较。

### 2. Implement

- [x] 在 `tools.ts` 拆分 Bash 顶部摘要和底部动态元信息，解决 `renderCall` 与 `renderResult` 的显示归属。
  - 未产生结果时由 call 部分显示已有的耗时；出现结果后由 result 部分统一显示底部元信息，切换过程不重复、不缺失、不先画旧值。
  - 折叠路径继续使用原摘要逻辑；展开路径仅移走耗时与视觉行数，不移动快捷键提示、timeout 或 truncated 标记。
  - 让定时刷新读取共享的最新生命周期状态。耗时不进入正文布局缓存键，不能为更新一秒钟的数字重新处理全部输出。
  - 覆盖无输出、首个 partial、正常完成、失败、取消、超时、历史恢复和展开切换。

- [x] 将 Bash 结果快照登记与昂贵预处理分离，并拆开正文、warning 和动态元信息的失效依赖。
  - 更新回调只保留最新待绘制快照及必要状态，到实际绘制时才清理文本、拆行并建立布局。
  - 同一帧的 call/result 共用一次准备结果；被下一次更新覆盖且没有绘制的中间快照不做整段预处理。
  - 文本未变而 warning 或 partial 状态改变时，优先复用正文 geometry；不能因新的 details 对象就无条件废弃全部缓存。
  - `removeBashExecutionFooter` 依赖 details 和 partial 状态。只有最终显示正文相同才能复用，不能把这些状态简单从所有缓存键中删除。
  - 支持全文替换、末行替换、截断后前缀丢失及追加，不假设结果总是单调增长。

- [x] 去掉展开 Bash 正文的第二次 ANSI 截断与测宽。
  - 对已经按正文宽度完成 wrap、fit、pad 的行直接添加确定的缩进，保留最终宽度不变量。
  - 未经此流程处理的命令、warning、元信息继续走原有宽度安全路径，不全局删除 `renderBashDetailLine` 的保护。

- [x] 将 `layout.ts` 的 `fitToWidth` 合并为原生一次截断和补齐调用。
  - 使用已安装目标版本支持的 `truncateToWidth` pad 参数，去掉补齐前再次调用 `visibleWidth` 的路径。
  - 保持宽度归一化、ellipsis、ANSI reset、宽字符及背景填充结果一致；验证所有共用该 helper 的组件，而不只验证 Bash。

- [x] 将 write 的有效字符串 metrics 延迟到绘制阶段，并用无数组分配的换行计数替换逐字符 JavaScript 循环。
  - call/result 对同一内容共享行数；只有确实需要最终字节数时才计算并缓存 `Buffer.byteLength`。
  - 一帧前的多次参数更新只统计最后一次需要显示的内容，保留空串为零行、尾随换行为额外一行等现有语义。
  - 缺失或非字符串参数继续遵循原有渲染异常及 host fallback 路径，不能把原本在 `renderCall` 内被宿主捕获的错误延迟到 `Component.render` 才抛出。
  - 不引入 `startsWith(previous)` 式伪增量算法，不改上游累计 JSON 解析。

- [x] 新增共享、按文本计费的有界渲染缓存，并接入会话生命周期。
  - 在 `src/render-cache.ts` 实现简单的 LRU、计费、淘汰、超大条目绕过及清理接口，由当前 codex-ui 注册实例统一持有，所有工具行共享预算。
  - 以实验已有的布局/高亮 16 MiB、视觉计数 2 MiB 为初始文本计费预算。将保留的 key、字符串、数组项和条目开销纳入计费，避免每个工具行各获得一份预算。
  - 过大条目正常计算并返回，但不加入保留缓存；淘汰只能影响速度，不能影响显示结果。
  - 会话替换、reload、shutdown 清理旧缓存；旧行或迟到回调不能重新填充新会话的缓存。
  - 统计接口仅供内部测试及基准使用，不新增常驻计时器、用户设置、状态栏或日志。

- [x] 将 Bash 和 edit 的多宽度布局及已生成高亮纳入共享缓存，替换折叠即丢弃的策略。
  - 缓存未淘汰时，折叠后重展开、宽度 `120 → 119 → 120` 回到旧宽度直接复用结果；首次遇到新宽度仍按正常路径计算。
  - 区分正文 geometry、高亮和最终着色布局的依赖，覆盖结果版本、宽度、路径/语言、主题、错误/partial 状态及渲染模式。
  - 高亮失效必须跟踪高亮器实际使用的语法颜色，不能只比较 Theme 对象 identity 或普通前景色；同一主题代理仅改变 syntax 配色时也不得显示旧颜色。
  - 删除或迁移绕过预算的冗余缓存。行状态不能继续强引用已被淘汰的额外布局及隐藏高亮，使共享预算形同虚设。
  - 保留冷折叠 edit 只处理当前可见 diff 高亮的优势，不为未来可能展开的内容提前高亮。

- [x] 为折叠 Bash 增加精确的 count-only 路径，复用有界的物理行计数缓存。
  - 摘要只需要视觉行数时，不再生成完整 padding、着色输出或保留一个无用的 visual tail。
  - 以清理后的物理行内容和正文宽度复用计数；新快照中未变化的行不重复 wrap，缓存 key 的文本也计入预算。
  - 复杂 Unicode、长词、空白及 tab 继续按原生 wrapping 规则计数，禁止用字符串长度除以列宽近似。
  - 展开状态直接复用正文布局已有的视觉行数，不能为底部计数再单独扫描一次。

- [x] 为长 Bash 命令摘要增加保守的可打印 ASCII 前缀快路径。
  - 根据现有摘要宽度上限保留足够前缀，避免构造完整清理后的超长摘要，同时保留原有 trim、空命令回退和 `...` 裁剪结果。
  - 含控制序列、Unicode、tab 或其他不满足条件的内容走现有完整路径；展开后的命令仍完整显示。
  - 不复用此路径替代输出正文清理，也不把仍需扫描整串的 ASCII 判断描述为常数成本。

### 3. Deliver

- [x] 清理被替代的重复缓存、旧失效分支和实验转换依赖，保留可复现的历史基线。
  - 生产插件只依赖 `src/` 中的实现，不导入 prototype，也不添加新的生产依赖。
  - 将旧的“折叠立即释放隐藏高亮”和固定单宽度缓存测试更新为有界保留、正确淘汰的契约，不通过删除断言掩盖内存回退。
  - 保持改动范围在相关源码、测试、基准及文档；`dist/` 仅由构建生成，不修改上游或顺带优化其他 extension。

- [x] 更新根 `README.md` 的 Bash 布局说明、研究报告、基准复现说明和本计划的交付记录。
  - 记录真实 `before / after / native` 结果、环境、源码哈希、缓存命中与冷启动差异，以及仍未达到原生水平的场景。
  - 逐项标明自动验证、真实 TUI 验证和未验证的边界，不把 headless 结果写成 Ghostty 实测。
  - 仅在实现和下列验证完成后更新 checkbox 与状态；保留现有研究产物和其他工作树变更。

## How to test

### Workflow and baseline

1. 在第一次修改 `extensions/codex-ui/src/` 前固定基线、运行现有定向测试与 `pnpm run check`，采集同机 `before / native` 数据。
2. 每项实现先加入可稳定失败的行为或成本测试，再实现，再重构。毫秒耗时和 RSS 不作为易波动的普通单元测试断言。
3. 依赖以仓库锁定的 Pi 0.84.3 为主，另在本机实际使用的 Pi 0.85.0 验证。若版本或所加载源码哈希变化，重新采集对应原生基线，不拼接旧数值。
4. 同一轮比较固定终端尺寸、主题、输入、刷新节奏及测量范围，交替运行变体以减少运行顺序和 GC 偏差。

### Visual and lifecycle regression

| Target | Test and expected result |
| --- | --- |
| Unchanged regions | 折叠 Bash、write/edit/read 及 low-power 按旧版逐帧字符串、ANSI 和宽度比较；共用 width helper 不改变其他组件结果 |
| Expanded Bash | 更新已批准的布局预期；命令/正文/warning 的内容、颜色、顺序不变，只有两项动态元信息改变位置 |
| Footer ownership | 用真实宿主串起 call/result；无结果、首个结果、空结果及恢复历史时，行数/耗时分别恰好出现一次或按原规则不出现 |
| Ticks and completion | fake timers 验证仍每秒更新，结束后冻结，失败/取消/超时正确停止，恢复历史不启动虚假计时 |
| Width and text | 复用已有 12 种宽度 `1, 2, 4, 9, 10, 30, 71, 72, 119, 120, 121, 300`，另测零/非法宽度；覆盖中文、组合字符、emoji、OSC 8、ANSI、CR、tab、控制字符和尾随空白 |
| Metadata | 覆盖行数与耗时位数增长、truncated 首次出现、warning 更新、动态快捷键、长 timeout；顶部静态字段不意外搬到底部 |
| Invalid write args | 缺失、null、非字符串、不完整参数沿用旧版结果或 host fallback；真实 `Component.render` 不出现新增未捕获异常 |
| Cache invalidation | 新结果、同文本新对象、全文替换、partial 转 final、文件扩展名变化、主题切换及仅 syntax 颜色变化均显示最新结果 |
| Lifecycle isolation | 两个并发 Bash 不串耗时；工具结束、会话替换、reload、shutdown 后缓存和 timer 正确清理，旧回调不污染新实例 |

新缓存不可把用户已展开的正文隐藏掉。低预算、超大条目和淘汰后重新展开必须与无缓存计算的显示结果一致。

### Deterministic cost checks

以下成本可以作为失败测试，不依赖机器快慢。

- 同一已绘制 Bash 的纯计时 tick 不重新清理、拆分、wrap 或着色正文，不重新扫描输出计算视觉行数。
- 多个结果更新在一帧前合并时，只对最终需要显示的快照执行昂贵预处理；call/result 不各做一次。
- warning-only 更新若不改变最终显示正文，只更新 warning；若 partial/details 改变了执行 footer 的移除结果，则必须使正文失效。
- write 在一帧前连续接收 16 次不同字符串，只统计该帧最终显示的内容。最终相同内容在 call/result 间不重复统计，字节数只按实际需要计算一次。
- 展开 Bash 的已适配正文行不再经过第二次通用截断；折叠计数不产生 padded/tail 结果。
- 预算内的重展开和回到已缓存宽度不重复做正文 wrap 或 diff 高亮；冷折叠 edit 不预先高亮隐藏行。
- 注入小预算并持续插入不同条目，计费始终不超过上限；覆盖替换同 key、LRU 淘汰、超大条目、清理和旧 generation。检查额外派生数据没有在行状态中绕过淘汰保留。

### Regular-mode terminal regression

沿用研究负载：`120 × 40` 终端，0 或 20 个已展开历史 Bash，每个历史工具 1800 个短行，当前展开工具使用 1800 短行或 50 KiB 无空格长行。

先完成初始绘制，使当前工具底部元信息位于可见区域，随后分别驱动：

- 每秒一次纯耗时 tick。
- 每 100 ms 替换可见末行，且此前已排版行不变。
- 每 100 ms 追加新行，且既有正文及其已排版前缀不变。

通过条件：

1. 稳定运行期间，上述事件不因顶部耗时/行数变化触发全历史重放；每帧全量刷新增量为零，不发送清屏及清 scrollback 序列。
2. 终端数据不包含离屏历史的唯一标记；在相同可见尾部下，从 0 增至 20 个静态历史工具不会使每次写入按历史总量增长。
3. 元信息显示的是最新值，输出没有遗漏或重复；不能靠跳过 tick 或冻结行数让测试通过。
4. 用 headless terminal 消费真实输出并等待解析 callback，校验最终 buffer 的文字、颜色和尾部位置。

另设边界用例：执行结束的标题变化、改变已排版前缀的结果替换、截断后前缀丢失、resize、主题切换，以及两个运行工具中有一个位于视口外。这些事件可能仍触发宿主全量刷新，要检查正确性并记录输出成本，不能把“不发生任何全量刷新”作为全生命周期承诺。

### Performance matrix

规模和节奏沿用已有研究，仅增加暴露新布局与缓存风险的用例，不组合所有最大值。

| Workload | Purpose |
| --- | --- |
| 全折叠历史，0/20 个工具；短行和长行 Bash 更新 | 确认折叠优势不回退，区分真实折叠负载与展开历史反例 |
| 20 个展开历史加当前长 Bash，tick/末行替换/追加 | 验证历史重放消失后，渲染及终端解析合计 CPU 与原生的差距 |
| Bash 3 短行、1800 短行、50 KiB 长行与中文输出 | 同时观察小结果固定开销和大结果冷绘制，不只选择有利样本 |
| edit 1000/10000 行，首次展开、重展开、宽度往返 | 分开衡量首次高亮、新宽度和缓存命中，不把热命中数字冒充冷绘制收益 |
| write 50 KiB 摘要、256 KiB 累计参数流 | 验证摘要及惰性 metrics；参数每 256 字符更新、每 16 次更新绘制一帧 |
| edit old/new 各约 128 KiB 累计参数流 | 确认本来已轻量的参数渲染没有回退，单列共同 JSON 解析成本 |
| 多个不同大 diff/Bash 结果、连续宽度切换，直至多次触发预算淘汰 | 验证内存不随额外缓存版本无限增长，并记录淘汰后的重算代价 |
| regular 稳定输入帧及 fullscreen 小范围回归 | 确认没有把计时优化转化为输入阻塞或破坏现有 fullscreen 行为 |

每组同时报告 Node 同步墙钟时间、`process.cpuUsage()`、终端字节数、全量刷新次数、终端解析 CPU。内存场景补充缓存计费、条目数、峰值 heap/RSS，以及清理并完成 GC 后的保留量。

- 冷绘制和交互沿用至少 7 轮、前 2 轮预热；终端链路至少 14 轮、前 4 轮预热；参数流至少 4 轮、前 1 轮预热。出现方向不稳定的差异时增加独立重复，而不挑选最快的一轮。
- 保存每轮值，报告中位数及样本 p95。小样本 p95 只辅助观察，不能代替真实用户延迟分布。
- 先用统一配色比较算法，再用原生 dark 与 codex-pi 配色复核关键长历史场景。
- write/edit 参数流分别给出含累计 JSON 解析和不含解析的结果，避免把共同上游成本归因于 renderer。
- 初始 18 MiB 是额外保留缓存的文本计费预算，不是 RSS 上限。内存验收既检查确定的计费上限，也比较同一历史长度下的 heap/RSS；发现未计费保留或持续增长必须修复。

### Acceptance and reporting

- 不变区域的行为比较和全部确定性成本约束通过，才说明实现正确。
- 长历史稳定尾部更新不再重放历史，才说明本次针对的终端瓶颈已消除。仅 renderer 函数更快不算通过这一项。
- 在已有优势场景中，`after` 相对 `before` 不应出现超出重复测量波动的稳定回退；若发生，先定位修复，不以其他场景的平均收益抵消。
- “达到原生级别”按具体负载判断。只有渲染与终端解析合计 CPU 的重复结果与原生相当或更低，且没有换来更差的阻塞时间或无界内存，才对该负载使用这一表述。
- 若修复历史重放后仍高于原生，报告剩余差值、主要成本和未达目标的场景。不承诺统一的额外开销百分比，不把减少的终端字节倍率换算成 CPU 倍率。

### Commands and final checks

定向验证：

```sh
pnpm exec vitest run extensions/codex-ui/__tests__
```

基准设施改造后，在其 README 中记录 `before / after` 选择及独立结果目录的实际命令，再执行完整比较。不要直接运行旧 `build.mjs` 的转换逻辑来验收新生产代码，也不要覆盖旧结果。

最终仓库验证使用仓库内独立临时目录：

```sh
mkdir -p .tmp
check_tmp="$(mktemp -d "$PWD/.tmp/codex-ui-check.XXXXXX")"
TMPDIR="$check_tmp" pnpm run check
result=$?
rm -rf -- "$check_tmp"
exit "$result"
```

预期 typecheck、tests、build 和 package check 全部成功。检查构建 diff、发布排除边界及本次资源清理，不手动编辑 `dist/`，不删除其他既有临时产物。

交付前以隔离的本地合成会话做真实 Pi TUI smoke，人工检查展开布局、运行中折叠切换、窄宽度、停止和 reload；所有 fixture 与临时文件留在仓库，退出并回收本次进程。若需要在当前工作目录之外写入配置、会话或启动真实终端窗口，先说明范围并取得同意；未取得实际终端验证证据时，在报告中注明。

## Notes

- 本次包括研究中的七类渲染优化，以及用户新批准的展开 Bash 元信息迁移。原列表其余四类通用 cache key、Thinking、footer 上下文统计及零散快路径不顺带实施。
- 当前计划不修改累计 JSON 解析、Pi 普通模式差分算法、scrollback 管理，也不通过虚拟化或隐藏展开历史规避成本。
- 底部更新避免的是离屏首个脏行引起的终端重发。宿主仍可能遍历、拼接或比较历史行，不能据此宣称整帧成本变成 O(1)。
- 高亮缓存主要加速重展开和宽度往返。此前 10000 行 edit 首次展开实验优化后仍约 289 ms，本计划不承诺让巨大冷 diff 一帧完成。
- 旧研究的约 5.7 MB/次和增加约 140%～155% CPU 是特定版本、布局与展开历史负载的证据，不是实施后的预测。本次必须重新建立同条件基线。
- 不预设“最多增加 5% CPU”或任意延迟阈值。若缓存实测需要调整初始预算，记录计费、峰值内存和命中率依据；不能靠无限加大缓存换取漂亮数字。
- 基准没有模型联网、真实工具执行、其他 extensions 或 Ghostty/GPU 的全部成本。headless 数据不能推出整机 CPU 或“全折叠会话整体一定优于原生”。

## Expected file map

| Path | Responsibility |
| --- | --- |
| `extensions/codex-ui/src/tools.ts` | Bash 元信息布局、快照/正文失效、write metrics、Bash 计数/摘要及 edit 缓存接入 |
| `extensions/codex-ui/src/layout.ts` | 一次完成截断与补齐，保留共享宽度语义 |
| `extensions/codex-ui/src/render-cache.ts` | 新增有界共享缓存、计费、淘汰与生命周期接口 |
| `extensions/codex-ui/src/exact-visual-tail.ts` | 按需放置精确计数 helper，既有 tail 使用者保持兼容 |
| `extensions/codex-ui/src/responsive-lines.ts` | 仅在工具缓存接入确有需要时调整，保持公开 invalidate 语义 |
| `extensions/codex-ui/src/bash-refresh-scheduler.ts` / `src/index.ts` | 仅处理必要的生命周期接线，不调整刷新频率或全局 UI 策略 |
| `extensions/codex-ui/__tests__/tools.test.ts` 等对应测试 | 行为保护、成本约束、缓存淘汰和 theme/lifecycle 回归 |
| `extensions/codex-ui/__tests__/render-cache.test.ts` | 新增缓存预算和隔离测试 |
| `extensions/codex-ui/__tests__/rendering-pipeline.test.ts` | 新增真实工具组件与普通 TUI 终端差分回归 |
| `prototypes/codex-ui-performance/` | 不可变基线、生产版对照、负载、独立结果与复现入口 |
| `README.md` | 仅更新受本次影响的 Bash 展开布局说明 |
| `docs/research/codex-ui-performance.md` | 保留历史数据，追加实施后结果与结论边界 |

## Implementation evidence

- 基准入口首先由 `infrastructure.test.mjs` 复现缺失不可变快照/构建清单，再改为读取 `baselines/before.json.gz` 与真实生产源码，测试转绿。
- 修改插件源码前的 `pnpm run check` 通过，627 tests passed、1 skipped。Pi 0.85.0 完整新基线保存在 `results/baseline-0.85.0/`，0.84.3 冷渲染基线保存在 `results/baseline-0.84.3/`；均记录实际加载源码哈希，没有覆盖旧研究数据。

### Red-green record

- 展开 Bash 的纯计时回归先复现每次 tick 全量刷新 `1`，移动底部字段后为 `0`；仍检查 1.0s 的实际变化和顶部静态字段。
- 16 个未绘制 Bash 快照先出现 32 次文本 getter 读取，惰性准备后中间快照不读取；warning-only 的正文重复读取/wrap 也由失败测试转绿。
- 200 行已适配 Bash 正文的二次截断先为 200 次，去重后为 0 次；超预算时仍只 wrap 一遍，显示与保留缓存相同。
- `fitToWidth` padding 的额外 exported `visibleWidth` 调用由 1 次变为 0 次，并由 frozen-before 帧比较保护 ANSI 和宽度行为。
- write 的中间快照扫描、逐字符计数、call 阶段不必要的最终 bytes 读取分别先失败后转绿；最终结果重复绘制只计算一次 bytes。
- 回到旧宽度/重展开的 200 行 Bash 重排、逐快照 201 行计数均先复现重复成本，再变为零次重排或只 wrap 新增一行。
- syntax-only 主题变化先复现旧颜色，再通过同一主题代理与真实上游 highlighter 的 fresh/hot 比较；冷折叠仍只处理前 12 行。
- 共享 LRU、超大条目绕过、非法预算拒绝、会话清理后不重新填充、迟到旧 call 不复活 timer、不取消新会话同 ID timer 均有对应保护。
- 长 ASCII 摘要先保留完整 100000 字符，之后最多保留 111 字符摘要前缀；展开命令末尾仍完整显示。

### Delivery validation

- `pnpm run check` 通过：650 tests passed、1 skipped，49 test files passed、1 skipped；typecheck、build、发布包边界全部通过。codex-ui 定向测试为 105 项。
- 基准设施测试通过；两版 Pi 各通过 2203 项帧/宽度比较、28 个逐 cell 终端解析帧，以及完整性能矩阵和 24 轮固定历史内存 churn。
- 0/20 静态历史的稳定尾部输出相同，没有清屏/清 scrollback 或全历史重放；离屏并发工具仍更新，并保留会触发宿主全量重放的边界测试。
- 两版真实 CLI + expect PTY 在 `codex-pi` 主题下通过恢复历史、展开/折叠、`/reload`、resize 和退出。没有执行真实工具或模型请求；所有合成配置和会话位于仓库内，子进程和临时目录已清理。
- 上述 smoke 从启动时就加载新版，没有验证运行中替换代码。后续使用本机 Pi 0.85.0 bundled CLI 和隔离的本地 package 配置补测，旧进程替换为新版 JS 后，`/reload` 提示成功但历史 Bash 仍呈现旧布局；重启并恢复同一合成会话后才出现新版底部行数。本次更新应重启 Pi，不能仅凭 smoke 宣称 `/reload` 足够。
- 构建只更新 codex-ui 的生成产物，没有手改 dist、修改上游源码或增加生产依赖。

### Acceptance limits

主要历史重放目标达到。产品配色下，长历史末行替换的合计 CPU 比改前少约 70%–71%，比原生少约 13%–17%。详细环境、原始数据和反例见研究报告的 Production delivery 节。

以下目标不能标成无条件通过：

1. edit 1000 行折叠在 25 个有效样本中的中位数改善，但 after 样本 p95 为 2.521 ms，before 为 0.412 ms。尚未把每个尖峰定位到确定原因，因此“已有优势场景各项指标均不回退”的强目标没有全面达到，不能以重展开收益抵消或隐去这条结果。
2. 同配色追加存在一次方向反转。独立产品配色正反顺序复测均优于原生，但不承诺任意会话或机器上都如此。
3. 缓存有内存代价。0.85.0 固定历史 GC 后 heap 比 before 多约 12.2 MiB，已观察到平台而非持续增长。18 MiB 不是 heap/RSS 上限。
4. 没有 Ghostty 窗口中的人工运行观感、GPU 或完整模型会话证据。CLI PTY 与 headless 回归不可冒充该项验证。

## Sources

- [既有性能报告](../research/codex-ui-performance.md) 与 [实验说明](../../prototypes/codex-ui-performance/README.md)。
- 本仓库 `tools.ts`、`layout.ts`、`responsive-lines.ts`、`bash-refresh-scheduler.ts` 及对应测试。
- 已安装 Pi 0.84.3/0.85.0 的 `ToolRenderContext`、`ToolExecutionComponent`、Bash renderer、普通模式 TUI 与 width utilities；执行时以实际加载文件哈希固定版本依据。
- Context7 library ID: `/earendil-works/pi`。选用官方 Pi 项目文档核对公开工具渲染接口；索引返回的是 `main`，不能替代本地目标版本源码和声明。
