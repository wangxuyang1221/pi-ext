# Codex UI reasoning implementation plan

- Status: `Implemented with validation limits`
- Scope: `extensions/codex-ui`
- Delivery method: `Red-Green-Refactor`
- Upstream Pi changes: `None`

## Understanding

将用户已确认的 [reasoning UI 原型](../../prototypes/codex-reasoning-ui-prototype/README.md) 落到正式 codex-ui。运行中在输入框上方显示静态状态，结束后显示多行思考历史；不改会话数据、模型请求或工具执行行为。

### Behavior contract

| Area | Required behavior |
| --- | --- |
| Running status | 静态弱化圆点、普通字重、非斜体标题；按可用宽度省略，始终只有一行文字 |
| Editor spacing | 状态下方保留一整行无背景样式的空白；字体及输入框内部 padding 不变；状态隐藏时空白一起移除 |
| Alignment | 状态圆点在第 1 列、正文在第 3 列，与工具图标和标题对齐；思考历史通过 Pi 的 `outputPad: 0` 对齐，普通消息也随共享设置左移一列 |
| Model-only status | 无完整模型标题时不显示；开始回复或调用工具时隐藏状态及其空白行。不显示通用固定状态；模型标题与正文保持原文 |
| Updates | 标题或工作阶段改变才请求状态刷新；没有扫光、秒表或状态动画，不恢复原生 working spinner |
| History | streaming 时不在历史中显示思考；assistant `message_end` 后自然换行、保留多段正文，不再取最后一段或强制单行 |
| History formatting | 有正文时去掉可识别的首标题；纯标题及连续的纯标题序列全部保留，每条摘要各加一个圆点。圆点不使用行内代码高亮，正文沿用 Pi 原生次要思考样式 |
| Interrupted content | 取消或失败后保留已有思考片段；只在显示端处理未闭合标题标记，不改原始内容 |
| Other UI | 保持 header、editor、footer、用户消息前缀、工具渲染、权限、取消和 `/lowpower` 行为 |

历史定稿边界是整个 assistant 消息结束，不是单独的 `thinking_end`。左对齐已获用户确认，后续修订按用户要求移除通用固定状态。Pi 0.84.3/0.85.1 没有公开的 extension 输出 padding setter；全局 `outputPad` 需通过 Pi 设置或独立配置变更启用，扩展不得绕过该限制修改私有组件。

## Todo

以下实现与对应验证已执行。勾选不代表所有负载都更快，也不代表已完成 Ghostty 人工验收；性能边界见末尾交付记录。

### 1. Locate

- [x] 对照 `src/index.ts` 与目标 Pi 的公开事件接口，确定状态、历史和清理的归属。
  - 明确 thinking/text/tool 阶段转换、新 thinking 块、取消、失败、重试及会话替换时的处理；核对原生 Markdown 容器的间距限制。
  - 标出需要替换的 `compactThinkingMarkdown`、标题动画和 working-row 接线，保留其他 UI 与工具注册职责。

- [x] 将现有 fixture 和终端验证入口接到真实生产 extension，支持固定旧版与新版对照。
  - 复用 `prototypes/codex-reasoning-ui-prototype/` 的本地 provider、真实工具白名单和 PTY 流程，以及既有 rendering-pipeline 捕获设施。
  - 正式验收直接加载生产注册，不用原型 Proxy 跳过事件或替换 transformer。分别构建冻结旧版与真实生产版，避免修改生产代码后 `--variant current` 也指向新版。
  - 补充同一事件轨迹下的标题变更、连续正文 delta 和长历史负载，保留可复现的输入及版本清单。

### 2. Implement

- [x] 在 `src/` 新增独立状态组件，通过公开 `setWidget` 放在输入框上方。
  - 实现一行内容加一行底部空白；宽度安全截断，主题和 resize 正确失效，相同状态与宽度复用结果。
  - 组件无刷新定时器，重复标题不请求绘制；隐藏后返回空行数组，不残留间距。

- [x] 将状态接入真实消息、工具和 agent 生命周期，替换窗口标题动画。
  - 按当前消息及 content block 跟踪标题，只在闭合标题或阶段改变时更新；未取得标题时使用已确认的回退提示。
  - 避免逐 delta 扫描累计正文；标题确定后不因正文增长重复提取。不另存完整思考历史，当前解析状态随消息和会话清理。
  - 正确区分思考、正文输出与工具执行；并发工具和迟到事件不串状态，重试或压缩期间不保留误导性的旧标题。
  - `agent_settled`、会话替换、reload 和 shutdown 清理状态及空白；移除旧 500 ms 窗口标题动画，保留静态窗口标题，不改工具计时器。
  - 只在 TUI 模式安装组件，避免重复显示原生 working row；`/lowpower` 不改变这套静态状态策略。

- [x] 用纯显示转换替换 `compactThinkingMarkdown`，按原型规则展示完成历史。
  - 分开 streaming 与 final 路径，保留多段正文、后续标题和 Markdown 结构；覆盖空内容、无标题、纯标题及中断片段。
  - 不修改 session、模型上下文或原生思考可见性快捷键；恢复旧会话时直接按新规则显示。
  - 优先复用原生 Markdown 缓存，不新增无界历史缓存，也不在普通状态刷新时重新处理全部思考历史。

### 3. Deliver

- [x] 删除被替代的压缩 helper、动画状态和失效测试预期，完成正式注册接线。
  - 新模块放在 `extensions/codex-ui/src/`，对应测试放在 `__tests__/`；生产代码不导入 prototype、fixture 或局部 API Proxy。
  - 不新增生产依赖，不改上游或其他 extension；`dist/` 只由构建生成。

- [x] 更新根 `README.md`、原型交接说明及本计划的验收记录。
  - 写明新默认布局、历史定稿时机、公开 API 的间距限制和实际升级加载方式。
  - 记录功能、真实 PTY、性能测量的各自结果和未验证项；保留旧基线及其他既有工作树变更。

## How to test

### Workflow and baseline

1. 第一次修改生产源码前保存不可变的旧版源码、构建清单及固定事件轨迹，运行现有定向测试和 `pnpm run check`，采集下述同条件基线。不能把过去的工具性能数据当成本次 UI 的基线。
2. 按 Red-Green-Refactor 推进。先用目标行为或确定性成本写出失败测试，最小实现转绿后再重构。耗时和 RSS 用重复测量，不写成易波动的单测门槛。
3. 主验证使用仓库锁定的 Pi 0.84.3，兼容验证使用当前本机 Pi 0.85.1。执行时重新记录 Node、Pi/AI/TUI 实际版本与加载路径、源码哈希、主题和终端尺寸，避免宿主与运行库混用。

### Behavior and deterministic costs

| Target | Test and expected result |
| --- | --- |
| Status layout | 检查真实 ANSI，而不只 strip 后比较文字；正文无粗体、斜体或代码高亮。正常宽度恰好两行，第二行为无样式空串；隐藏或零宽度返回零行 |
| Width and theme | 覆盖窄宽度、中文、emoji、组合字符、长标题、`120 → 60 → 120` 列及主题切换；不越界、不显示旧颜色，不增加输入框内部 padding |
| Title extraction | 标题标记跨 delta、无标题、新消息、新 thinking 块和快照替换均正确；已确认标题后的正文 delta 不触发额外状态刷新 |
| Cost invariants | 相同标题不重复 `setWidget` 或请求 render；无 reasoning/title 动画 interval；同宽度重复 render 命中状态缓存。增长的无标题流不逐次扫描全部累计文本 |
| History | 用真实 `AssistantMessageComponent` 检查 streaming 隐藏、message_end 后多段保留；首标题、纯标题、空内容、后续标题及取消片段符合契约。稳定历史重复绘制不重新解析 Markdown |
| Lifecycle | 完成、报错、Esc、重试、工具阶段、并发工具、new/resume/fork、reload 和 shutdown 不串状态；结束后无圆点或空白残留，旧事件不能恢复旧标题 |
| Data and regressions | 会话中的原始 thinking 与输入 fixture 一致；普通回复、工具结果、编辑器、页脚、展开快捷键、原生思考显隐和 low-power 保持原行为；非 TUI 模式不调用 widget API |

通过已有隔离 CLI + PTY 入口执行标准流程、长文、窄屏、中断、重播、历史恢复和退出，验收对象必须是生产实现。另检查实际终端中状态与输入框之间的一行留白。运行中替换代码后的 `/reload` 与重启恢复分别验证，不能把“启动时已加载新版”当成热更新证据。

### Performance verification

复用既有 `120 × 40`、0/20 个历史工具及每个展开工具 1800 短行的负载。增加多段长思考和高频正文 delta，记录具体字符数与事件间隔。这些是合成压力输入，不冒充真实用户分布；无需组合所有最大值。

| Workload | Observe and expected result |
| --- | --- |
| 稳定等待，标题不变 | reasoning UI 不启动定时刷新或写入；和工具计时、宿主自身刷新分开计数 |
| 连续正文 delta，标题不变 | 不新增状态更新调用，不重复扫描累计正文；宿主仍可因 message_update 请求绘制 |
| 0/20 个静态历史，底部标题变更 | 稳定布局下不因状态更新重发离屏历史；检查输出字节、全量刷新次数及离屏唯一标记，不能只测状态组件耗时 |
| 长思考完成、历史恢复、resize、主题变化 | 单独测首次 Markdown 排版、行数变化和重绘成本；允许必要的宿主重排，不把它们混入稳定状态帧 |
| 固定历史下反复重播及会话切换 | 状态和解析器不持续保留旧消息或组件，不积累 timer；清理后保留内存不随重播轮数持续增长 |

同机、同版本、同主题和同轨迹交替运行 before/after，多轮记录 Node CPU、同步耗时、终端写入字节、全量刷新次数、终端解析 CPU，以及输入到可见更新的延迟。内存场景补充 heap/RSS 和清理后的保留量，保存逐轮结果，不只给平均数。

确定性成本约束必须通过。相同显示内容的稳定帧若出现超出重复测量波动的持续回退，定位并修复。多行历史比旧版单行包含更多内容，首次排版和历史遍历可能更贵，须单独报告增量，不能用其他场景收益抵消。未有预算或实测依据时，不承诺固定 CPU 百分比；发现明显影响输入响应的代价时，先提出调整，再决定是否交付。

### Final checks

```sh
pnpm exec vitest run extensions/codex-ui/__tests__
pnpm run prototype:reasoning-ui:check
pnpm run prototype:reasoning-ui --pty-smoke
```

先将上述原型验证入口接到生产版，再用它作为落地验收。两版 Pi 分别验证，并在交付记录中给出固定旧版、新版及性能场景的实际复现命令。

最终在仓库内隔离临时目录运行完整检查：

```sh
mkdir -p .tmp
check_tmp="$(mktemp -d "$PWD/.tmp/codex-reasoning-check.XXXXXX")"
TMPDIR="$check_tmp" pnpm run check
result=$?
rm -rf -- "$check_tmp"
exit "$result"
```

预期类型检查、测试、构建和发布包校验全部成功。回收本任务进程和临时目录，确认没有遗留监听端口；不删除他人的产物。工作目录外的写入或真实终端启动仍须先取得许可。

## Notes

- 本次采用 Codex 的信息分工，不追求逐像素复刻。依据见 [Codex CLI 源码研究](../research/codex-cli-reasoning-ui.md)。不新增 Ctrl+T transcript overlay、不修改 Pi 私有组件或上游。
- Pi 原生容器仍拥有历史 block 的 Spacer；本次不重建整条消息布局。底部状态稳定不代表整帧 O(1)，宿主仍可能遍历与比较历史行。
- 原型已证明公开接口下的布局和事件链可行，其一秒稳定窗口零输出字节不是完整性能验收，也不能推出 Ghostty CPU/GPU 结论。
- 既有工具性能工作保持不变。需要参考验证设施时使用 [已落地的工具性能计划](codex-ui-rendering-performance.md)，不扩大成本次全面渲染重构。

## Model-only status revision

用户要求移除 `Thinking`、`Preparing response`、`Running <tool>`，只保留模型思考标题。以下修订覆盖先前的固定状态文案契约。

- 正式 `reasoning-status.ts` 不再生成通用状态，也不再维护仅服务于工具状态的待执行/运行中工具映射。
- 没有完整标题时返回空行数组。文本开始、文本 delta 或工具调用开始时清空标题显示，状态下方空白行同时移除；已有消息标识与 content index 检查继续拦截迟到事件。
- 标题提取、原文、左对齐、历史 Markdown、输入框内部 padding 和全局配置均不改。原生隐藏思考时的占位提示不是此状态栏，本轮不修改。
- 更新测试先复现意外显示 `Thinking` 和空白行，随后转绿；覆盖无标题、未闭合标题、回复、工具调用、并发工具、完成和迟到事件。正式 demo 使用新行为，`proposed` 保留上一轮含固定文案的参考。

验证完成：三个 reasoning 测试文件共 14 项通过；两版 Pi 的正式本地检查各 12 项通过，实际 CLI + PTY 均通过静止、长文、缩窄、取消、重播、恢复会话及无通用状态文案断言。`pnpm run check` 通过，679 项测试通过、1 项跳过，构建与发布包校验成功。此次未重测 CPU/GPU 性能矩阵，也未修改全局配置。

## Alignment and copy revision

### Delivery scope

- `reasoning-status.ts` 的固定文案改为英文，移除状态行的一个前导空格；增量标题解析、生命周期、宽度缓存和底部空白行保持原逻辑。
- 正式本地演示使用生产注册和隔离的 `outputPad: 0`，不再只验证原型 Proxy。冻结旧版仍使用 `1`，已确认原型继续作为参考。
- README 补充 `/settings` → `Output padding` → `0` 的正式启用方法、共享影响和回滚方式。初次核验时用户全局配置尚未设置该字段，默认值为 `1`。用户明确回复“同意”后，已在 `~/.pi/agent/settings.json` 增加 `outputPad: 0`；项目没有 `.pi/settings.json` 覆盖。

### Red-green evidence

- 英文固定状态测试先收到 `正在思考`，更换正式文案后通过；并发工具及中文模型标题的原文断言继续通过。
- 真实工具对齐测试先复现状态圆点位于索引 `1`、工具图标位于 `0`，移除前导空格后通过。宽度 30/60/120 列及底部空白同步验证。
- 正式 profile 的历史测试先复现原生 `outputPad: 1` 导致的列偏移；演示采用与正式启用说明一致的 `outputPad: 0` 后通过。
- 离屏历史不重发的既有测试扩展到 `outputPad: 0` 和 `1`；缓存、无定时器、异常和会话清理仍使用生产测试覆盖。

### Validation

- `pnpm run check` 通过，679 项测试通过、1 项跳过；类型检查、构建及发布包校验成功。生产 `dist/` 由构建生成。
- 三个 reasoning 测试文件共 14 项通过，包含固定文案、真实工具列对齐、宽度、原文不变、缓存、无定时器及两种 padding 下的离屏历史保护。
- `production --smoke` 在 Pi 0.84.3/0.85.1 各通过 12 项；当前原型和冻结旧版的本地检查也各通过 12 项，基础设施检查 2 项通过。
- 两版实际 CLI 的 `production --pty-smoke` 均通过，验证标准/长文、真实工具、120→60 列缩窄、展开、取消、重播、reload，以及持久化会话重启后的思考和工具列对齐。静止窗口仍为零输出，状态下方空行仍无编辑器背景。
- 本轮没有再次运行升级替换 smoke，也未做 Ghostty 人工或 CPU/GPU 性能矩阵测量；下方首次交付数字保留为原始记录，其历史 padding 为 `1`，不能直接视为新配置的测量结果。所有本轮 CLI/expect 已退出，用户原先打开的原型不受影响。
- 已获仓库外修改授权并写入全局 `outputPad: 0`。重新解析确认数值为 `0`，移除新增行后的 SHA-256 与修改前完全一致，其他配置内容未变。需要重启 Pi 并恢复会话，尚未替用户重启当前进程；删除新增字段即可回滚。

## Implementation results

### Delivery

- `src/index.ts` 正常注册新逻辑，移除旧思考压缩和窗口标题动画。`reasoning-status.ts` 负责静态组件及生命周期，`reasoning-title.ts` 增量提取标题，`reasoning-history.ts` 只处理历史显示。
- 状态保留已确认的一行底部留白，没有新增 UI 定时器；首个标题闭合后不再扫描后续正文。只保留当前消息的标识字段、解析位置和待执行/执行中的工具 ID，不复制历史正文。
- 生产代码不依赖原型。原型入口默认 `production`，`current/proposed` 使用修改前冻结源码；原型、测试 fixture、基准和报告均排除在发布包外。
- 公开接口由 Context7 `/earendil-works/pi` 核对，其索引为 `main`；具体行为以本机 Pi 0.84.3/0.85.1 的类型及源码为准。没有修改上游、依赖目录、工具执行或原始会话内容。

### Red-green evidence

- 流式思考测试先得到旧版的青色代码圆点与末段文字，随后变为空显示；完成态保留多段内容。
- 生产 widget 测试先因未安装组件失败，随后通过单行内容、无背景空白、无定时器和缓存断言。
- 长无标题流先复现对累计正文反复执行正则匹配，改为增量偏移后转绿。另用字符扫描次数验证闭合前线性扫描、闭合后停止扫描正文。
- 工具阶段先仍显示回复提示，接入待执行及并发工具生命周期后转绿；旧 thinking part 覆盖新标题的失败用例也已修复。
- Markdown 块与缩进代码先被圆点前缀和 trim 破坏，改为保留块起始位置及首行缩进后转绿。
- 其他边界验证覆盖样式 ANSI、中文/emoji、主题、宽度、失败、重试、压缩、会话替换、非 TUI 模式、历史缓存与原生思考显隐控制。

### Validation

- 修改生产代码前 `pnpm run check` 通过，666 项测试通过、1 项跳过；旧版源码、包配置和哈希保存在 `prototypes/codex-ui-performance/baselines/reasoning-before.json.gz`。
- 最终 `pnpm run check` 通过，55 个测试文件通过、1 个跳过；678 项测试通过、1 项跳过。类型检查、构建和发布包校验全部成功，`dist/` 由构建生成。
- fixture 基础设施检查 2 项通过；生产本地检查在两版 Pi 各通过 10 项，冻结的 current/proposed 对照也通过各自检查。仓库的 reasoning 测试共 13 项。
- 两版实际 CLI + PTY 均通过标准流程、真实工具、长文、resize、Ctrl+O、Esc、重播、reload 和持久化会话重启。解析真实 ANSI，验证了状态字重、斜体关闭与无背景留白。
- 运行中覆盖隔离构建后，两版 `/reload` 都仍使用旧模块，静止窗口继续输出旧窗口标题 OSC；重启同一会话后采用新代码，同一采样窗口为 0 字节。升级必须重启 Pi。早期升级 smoke 曾把首标题延迟落入静止采样，现与正常 smoke 一样先等待真实标题，不将启动时序误判为动画。
- CLI/expect 与临时构建已回收。本任务没有启动监听服务；未关闭用户此前自行运行的原型。

### Performance results

环境为 Node 22.22.2、pnpm 11.9.0、Pi 0.84.3/0.85.1，`codex-pi` 真彩主题、120×40 普通模式及 `@xterm/headless@5.5.0`。0/20 个历史工具分别测试折叠与展开，展开时每个工具 1800 行。每个场景 7 轮、前 2 轮预热；按 current → production → production → current 顺序独立复测，每个组合保留 10 个有效样本。

下表为 Node 渲染与终端解析合计 CPU 的每帧中位数，单位 ms。每格顺序为 Pi 0.84.3 / 0.85.1。同步墙钟、逐轮结果及峰值帧也保存在原始 JSON；CPU 时间不等于用户按键延迟。

| Workload | Before | After |
| --- | --- | --- |
| 无历史，连续变化的正文 delta | 0.416 / 0.389 | 0.259 / 0.184 |
| 无历史，双方均可见的纯标题更新 | 0.523 / 0.401 | 0.358 / 0.320 |
| 20 个展开历史，连续正文 delta | 8.623 / 8.719 | 4.030 / 4.060 |
| 20 个展开历史，纯标题更新 | 8.438 / 8.471 | 9.472 / 9.358 |
| 20 个展开历史，固定长正文上方的标题变化 | 5.204 / 5.329 | 8.784 / 8.688 |
| 20 个展开历史，长思考完成 | 4.097 / 4.805 | 24.387 / 23.487 |
| 20 个展开历史，长思考完成后的输入 | 8.453 / 8.458 | 8.668 / 8.537 |

结论与限制：

- 固定标题下的 64 次正文更新共输入 66614 字符，新版状态输出为 0 字节；宿主仍处理流式事件和绘制请求。底部标题更新没有重发离屏历史，各稳定场景的全量刷新计数均为 0。纯标题更新的平均输出约从 259 降至 92 字节，但这不等于 CPU 按同一比例下降。
- 固定长正文上的标题变化在旧版不可见，因为旧版只显示最后一段。因此该场景新增了实际屏幕变化，20 个展开历史下 CPU 确实增加。状态只随标题改变更新，不以动画或正文 token 的频率重复这项成本。
- 矩阵中长历史纯标题更新的 CPU 略高。Pi 0.85.1 单独进行 20×64 帧的 V8 剖析，前 5 轮预热后方向反转，旧/新合计 CPU 中位数约为 8.312/8.056 ms。新增事件处理约从 0.0073 增至 0.0121 ms，主要成本仍在宿主历史行的 Kitty image 扫描、差分、行规范化和 GC。不同前置负载会影响结果，因此不宣称所有标题更新都更快，也没有把一个方向的数字藏掉。
- 最终思考为 67514 字符。新版首次排版的同步墙钟中位数随场景约为 22–34 ms，输出约 90 KB；旧版继续显示原先单行。完成后缓存可避免重复 Markdown 解析，但更多历史行仍增加宿主遍历成本。无历史及折叠历史下的输入同步成本约增加 0.15–0.20 ms；不能承诺全文历史没有代价。
- 固定历史下重播 30 次，GC 后 heap 和 RSS 未随轮数持续增长。该实验不证明实际会话历史无限增长时内存恒定，也不把 RSS 当作新增状态组件的单独预算。
- 输入测量是同步 `handleInput → renderNow`，不包含真实宿主调度等待。没有 Ghostty 人工观感、GPU 或完整模型网络会话证据；“所有负载无性能回退”的强保证未成立。

有效矩阵数据在 [原型 results 目录](../../prototypes/codex-reasoning-ui-prototype/results/)：Pi 0.85.1 使用 `2026-09-06T07-35-11-304Z` 至 `07-36-15-917Z` 的四份结果，Pi 0.84.3 使用 `07-36-37-592Z` 至 `07-37-43-238Z` 的四份结果。每份为 105 个原始样本，包含生产/旧版及 fixture 哈希。此前 84 样本报告属于探索负载，不混入上表。复现命令见 [原型说明](../../prototypes/codex-reasoning-ui-prototype/README.md#performance)。

V8 剖析原始记录位于原型 `.tmp/latest-probe-0.85.1-{current,production}.json`，可通过 `--probe` 重建；它与不启用 profiler 的矩阵分开解释。
