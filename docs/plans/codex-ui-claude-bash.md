# Claude-style Bash implementation checklist

## Understanding

将用户选定的 Claude 原型接入正式 `codex-ui` 的 full-mode Bash 展示。以 `prototypes/codex-bash-ui-prototype/src/cli-renderers.ts` 的 Claude 变体为视觉基准，重新接入真实状态和缓存，不直接搬运 fixture 渲染代码。用户审阅后已授权施工，正式实现与验收已完成。

## User Visible Changes

- 将分组统计标题、命令树和耗时列替换为逐条 `⏺ Bash(command)`，调用之间保留间距。沿用所选原型，尚未执行的调用暂不显示；开始执行后显示运行状态，成功与失败分别着色。不保留 Hybrid 标题、折叠箭头或右侧时间列。
- 输出从默认完全隐藏改为预览前三个终端显示行，超过时显示 `… +N lines` 和实际展开快捷键。正常输出、错误输出与灰色前缀分别着色；运行中无输出、空结果、失败、取消、超时和捕获截断都有对应提示，不编造退出码。
- `Ctrl+O` 继续使用 Pi 的全局原位展开，显示完整命令及全部已捕获输出。长命令默认单行省略，展开后保留换行；完成执行不改变用户的展开选择。不新增独立 transcript 页面，low-power、其他工具和用户 `!` Bash 保持原样。

## Todo

### 1. Locate

- [x] 核验真实 Bash 的错误、取消、超时和截断结果经过工具组件及历史恢复后的数据形态，确定诊断提取与无法识别时的回退规则。原型的 `exitCode`、`status` 等 fixture 字段不能当成生产接口。

### 2. Implement

- [x] 在 `extensions/codex-ui/src/` 实现 Claude 样式布局，覆盖标题、三行预览、余量提示、完整展开和异常提示；保持英文界面、Unicode 安全、窄屏不越界，以及命令只显示一次。
- [x] 在 `tools.ts` 接入真实调用、流式参数和结果更新。优先复用 `bash-groups.ts` 的调用归属与每调用状态，使每条命令按源顺序展示一次；其他工具、文本分隔、缺失组件和重复 ID 不造成漏项、串结果或空卡片。保留官方执行代理及原始结果，不改变参数、cwd、权限或取消语义。
- [x] 为命令预览、输出前三行和精确余量计数建立按内容版本、宽度及必要样式维度失效的缓存。仅处理变化的调用；合并同一帧前被覆盖的快照；支持追加、前缀替换、末尾替换和最终清空。折叠时不构造完整的已着色输出，维持现有共享缓存预算与超大条目绕过规则。
- [x] 接通启动、恢复、fork、树导航、压缩和 reload 的重建与失效清理。历史展示不重跑命令、不补造数据；旧回调不能污染新会话。取消新布局不再需要的 full-mode 耗时刷新，不增加仅为装饰动画而重绘历史的计时器，保留 low-power 的既有行为。

### 3. Deliver

- [x] 清理被替换的 full-mode 布局及确实失去用途的分支，不删除其他模式仍使用的逻辑。保留三个原型供设计对照，不把实验切换命令、假 provider 或 fixture controller 带入生产。
- [x] 更新根 `README.md` 的 Bash 行为与升级说明，并记录本轮验收结果。`dist/` 仅由构建生成；正式升级需重启 Pi 后恢复会话验证，不能只以 `/reload` 成功作为依据。

## How To Test

- 实施顺序：每个行为先写失败测试，再实现并回归。旧测试中“统计标题、命令树、默认不读取输出”的断言改为新契约；保留调用归属、执行代理、生命周期与其他工具的保护测试，不能靠删除测试消除失败。
- 目标行为：用 0、1、3、4、25 行输出验证预览与余量；覆盖成功、失败、运行中无输出、流式替换、取消、超时、截断及空结果。测试单条和多条调用、50 KiB 长命令、多行命令、中文/emoji/ANSI、极窄窗口、实际快捷键与取消绑定。展开恢复完整捕获，不把截断捕获误称为完整日志，不读取 `fullOutputPath` 补齐预览。
- 真实接入：复用真实 `ToolExecutionComponent`、TUI 管线和隔离 CLI fixture。用本地脚本化 provider 驱动真实 Bash 的 `printf`、`sleep`、非零退出、超时与取消，无需生产网络或个人凭据；普通和 fullscreen 均验证展开、流式更新、resize、reload、新进程恢复与退出清理。核对原始持久化结果、low-power、其他工具及用户 `!` Bash 不变。
- 性能验收：使用 1/3/10 个调用、1,800 行日志、50 KiB 长 token，以及 0/20 组展开历史。以读取、清理、计数、换行、缓存计费和终端写入次数断言：稳定帧不重扫会话或捕获；只更新一个调用时不重新处理其他调用；同内容/宽度的精确计数在缓存有效期间只计算一次；渲染层无仅因时间推进而产生的刷新。新快照为精确计数允许一次随捕获长度增长的扫描，不能每帧重建完整输出。缓存继续受布局 16 MiB、计数 2 MiB 的计费预算约束。稳态可见尾部追加不得因离屏历史增加而重放整段历史；真实前缀变化、结束着色和用户展开导致的必要重绘单独验证，不能通过冻结状态来规避。
- 最终验证：运行 `pnpm run prototype:bash-cli:check`、`pnpm run prototype:bash-ui:check`、更新后的真实 CLI 普通/fullscreen 验收，以及 `pnpm run check`。记录通过、失败、跳过和未验证项，停止本任务启动的进程并清理临时 workspace。

## Notes

- 当前生产从 `tools.ts` 接入 `BashGroups`，由首个已绑定组件绘制整组；内部是否合并承载不等于必须保留可见的统计标题或命令树。本轮优先复用已验证的归属逻辑，避免同时重做会话模型。
- 当前锁定的 Pi 0.84.3 `BashToolDetails` 只有截断信息和完整输出路径，没有结构化退出码或结束原因。仅从已核验的宿主诊断提取可确认的数据；无法确认时保留真实错误，不硬填 `Error: Exit code 1`，也不根据日志中的 `Error` 单词判断失败。
- 所选范围是原型中的 Claude 普通视图及 Pi 原位展开，不是 Claude Code 全产品复刻。新增计时、动画、逐条展开、生产样式切换或统一 low-power 外观均不在本次范围。
- 施工前 `pnpm run check` 基线为 1115 项测试通过、2 项原有跳过。下文记录本轮独立验收，不复用原型或历史分组报告作为生产通过证据。

## Results

### Implementation

正式代码只修改 `bash-group-layout.ts`、`bash-groups.ts` 和 `tools.ts`。布局改成逐调用 Claude 标题、前三行输出、精确余量和原位展开。正常正文使用 `text`，错误正文使用 `error`，取消和超时使用 `warning`，前缀使用 `dim`。超过可用宽度的命令使用单字符 `…`，不再保留旧的 120 列上限。极窄窗口缩减前缀，避免命令正文被全部遮住。

归属与 generation 沿用原有机制。另修复源消息自身含重复 ID 时，第一条绑定结果被重复加入组的问题；额外重复 ID 组件独立显示，并形成边界。移除 full-mode 状态统计、起止时间、计时器 key 和已失去调用方的 `BashRefreshScheduler`。旧 scheduler 的单个内部测试随被移除的类退休，此前该测试通过；新的真实组件和 TUI 管线测试验证零计时器和零时钟写入，不通过删失败测试规避问题。low-power 的状态、耗时快照和输出边界保持原样，执行代理未改。

原型隔离在 `prototypes/codex-bash-ui-prototype/src/frozen-bash-group-layout.ts` 与 `frozen-bash-types.ts`。前者来自施工前生产源码，仅调整 import 和说明；polish 与 Hybrid 改用冻结版本，原版对照保持自己的旧副本。原型断言仍验证原统计、命令树、耗时、隐藏输出及三种 CLI 变体，生产没有导入原型。

### Host evidence

Node v22.22.2、pnpm 11.9.0、Pi 0.84.3。先用真实官方 Bash definition 执行空结果、退出码 7、超时、取消与截断，结果在 `.scratch/claude-bash/host-shapes.json`。随后以真实生产 CLI 和保存的 session JSONL 复核：

- 空成功保存为 `(no output)`，界面显示选定的 `(No content)`。
- 非零退出、超时与取消保存 `isError: true`，正文末尾分别为 `Command exited with code N`、`Command timed out after N seconds`、`Command aborted`，失败的 `details` 为 `{}`。
- 仅在 `isError` 且匹配完整宿主尾部诊断时，把可确认的诊断放到折叠预览首行。展开保留错误捕获原文。未知错误直接显示，成功日志中出现 `Error` 不改变状态。
- 成功截断有结构化 details；失败截断只剩原文中的 `[Showing ... Full output: ...]` footer。界面额外显示截断警告，不从文件读取内容。
- 每个持久化 tool result 与 `tool_execution_end.result` 比较 content、details、isError；每次模型后续请求中的 tool result 与持久化 content 比较，均保持一致。权限拒绝走宿主 blocked 路径，不会发出 `tool_result` 事件，仍有 execution-end 和保存的错误结果。

真实 CLI fixture 为 `extensions/codex-ui/__tests__/fixtures/bash-cli-fixture.mjs`，仅 provider 与压缩摘要为离线 fixture。Bash 的 `printf`、`sleep`、非零退出、取消、超时和截断，以及 Read/Write/Edit、用户 `!` Bash 均使用正式实现。没有模型网络服务或个人凭据。

### Red and green

日志统一在 `.scratch/claude-bash/`，每轮为 `red-NN.log` 和 `green-NN.log`。Red 均确认行为断言失败后再实现，不把运行环境故障算作 Red。

| Round | Behavior |
| --- | --- |
| 01 | 一条括号命令、正文颜色和灰色输出前缀替换统计标题与命令树 |
| 02 | 前三视觉行、精确余量、实际展开绑定与全部展开 |
| 03 | pending 不显示，运行中、空成功、空错误各有状态文本 |
| 04 | 窄窗口展开保留 50 KiB 命令，不因前缀丢失字符 |
| 05 | 已核验的失败、超时和取消诊断置前，展开保留原文 |
| 06 | structured details 或宿主失败 footer 的截断警告常显 |
| 07 | 宿主空成功 sentinel 使用选定文案 |
| 08 | full-mode 不再创建每秒刷新计时器 |
| 09 | 1,800 行展开输出缓存已着色布局，不给稳定成员重复着色 |
| 10 | 十调用精确计数不因逐物理行 key 挤占 2 MiB 桶而反复失效 |
| 11 | 源消息自身含重复 ID 时，每条实际结果只显示一次且顺序正确 |
| 12 | 同捕获从 running 变 completed、切换主题后仍复用精确计数 |

归属、执行代理、恢复、低功耗、主题和其他工具的旧保护测试继续保留。旧视觉断言改为新契约。新增快照与性能矩阵直接通过的检查只记为回归保护，不虚构 Red。

### Performance and lifecycle

性能日志为 `green-12.log`、`pipeline-performance.log`，完整最终结果也在 `check.log`。测试使用 spy 计数和真实 `TuiMainScreen`，不是只比较输出截图。

- 覆盖 1、3、10 调用，1,800 行和 50 KiB 单 token，折叠与展开。预热后的十帧均为零原始 text 读取、零清理、零 wrap、零正文着色和零额外精确计数。只更新最后一个成员时，不重新读取、wrap 或着色其他成员。
- 逐物理行计数缓存最初在十调用场景发生抖动，十帧重复 wrap 180,000 行。改为每捕获版本、宽度和展示变体缓存一个总数后，十调用计数桶只计费 2,160 bytes，稳定帧不再重新计算。
- 十调用短行样本的布局计费约 5.54 MB，十调用长 token 样本约 3.87 MB，均受共享 16 MiB 限制。小预算循环、超大条目绕过、生命周期归零继续通过。预算不等于进程 RSS 上限。
- 真实普通 TUI 的 1、3、10 调用 × 两种日志 × 追加或末尾替换，共十二组对照。0 与 20 个展开历史工具的终端写入逐字节相等，各为 96 个 ASCII 字节，无全量重绘或离屏历史重放。单纯时间推进没有工具计时器或终端写入。
- 真正的离屏前缀变化、完成标记改色分别验证必要的历史重绘，未冻结状态来回避。主题、resize、原位展开导致的正常重排仍允许。
- reload 先绑定新组件再触发 session_start 的顺序、旧回调失效、宿主压缩投影与相同 ID 重用由真实组件测试覆盖。真实 CLI 还完成 tree 截短与恢复、fork、手动压缩以及压缩后 reload；截去的 Bash 不复活，执行事件不增加。

日志中的 wall time 带有 spy 与测试进程开销，只作复查样本，不宣称比旧布局全面更快。新捕获的精确计数允许一次随输入长度增长的扫描；50 KiB 单 token 的冷路径明显比短行贵，稳定帧不重复该计算。

### Verification commands

全部通过：

```sh
TMPDIR="$PWD/.scratch/claude-bash/tmp" env \
  -u PI_SUBAGENT_PARENT -u PI_SUBAGENT -u PI_SUBAGENT_ID \
  -u PI_SUBAGENT_LAUNCH -u PI_SUBAGENT_STATE_ROOT pnpm run check
pnpm run prototype:bash-cli:check
pnpm run prototype:bash-ui:check
node extensions/codex-ui/__tests__/fixtures/bash-cli-smoke.mjs
```

- `check.log`：87 个测试文件通过、2 个原有文件跳过；1130 项通过、2 项原有跳过；类型检查、构建及发布包边界通过。`dist/` 全部来自构建。
- `prototype-cli.log`：13 项通过。`prototype-ui.log`：20 项通过。没有删改原型的视觉要求来迁就生产变化。
- `cli.log`、`cli/evidence.json`、`cli/regular-*.ansi`、`cli/fullscreen-*.ansi`：普通与 fullscreen 各 26 阶段。各执行 12 次实际工具调用，覆盖参数等待、流式输出、展开与顶部导航、resize、reload、新进程恢复、取消、用户 Bash、low-power、tree、fork、compaction 和退出。
- 每个 CLI 样本有完整事件、原会话 entries、fork entries、解析后的终端文本与状态颜色；`verified`、`driverExited` 与 `workspaceRemoved` 均为 true。恢复、tree、fork 和压缩没有增加执行次数。

首次 `check-first.log` 中的 goal 失败来自继承的 `PI_SUBAGENT_PARENT`，不是本轮 UI 行为；只在检查子进程中移除 subagent 环境变量后通过，未修改 goal。该首次检查未覆盖 TMPDIR，后续完整检查显式隔离到仓库；没有遍历或清理工作目录外的文件，首轮测试临时文件的外部残留未单独核验。

### Independent review

主代理审查通过，未发现阻塞交付的问题。审查覆盖生产 diff、诊断识别、缓存键、调用归属、生命周期及原型冻结边界。此前指出的原型耦合与展开输出重复着色均已修正；聚合计数缓存和重复 ID 的补充修复有回归保护。

主代理在最终构建上独立重跑以下检查，日志保留于 `.scratch/claude-bash-review/`：

- `check.log`：类型检查、1130 项测试通过、2 项原有跳过、构建及发布包校验通过。
- `invariants-final.log`：另写的 5 项真实组件回归全部通过，覆盖三行预览与实际快捷键、pending 与乱序完成、稳定捕获缓存、50 KiB 窄屏命令、控制序列与截断警告。相同测试在旧实现上为 3 项失败、2 项通过，见 `invariants-before.log`。
- `prototype-cli.log` 与 `prototype-ui.log`：原型 13 项和 20 项检查通过。
- `cli.log`：独立重跑生产 CLI，普通与 fullscreen 各 26 阶段、12 次真实工具调用通过。最新解析证据在 `.scratch/claude-bash/cli/evidence.json`；worker 的原证据另存为 `worker-cli-evidence.json`。已检查运行中和完成后的终端文本；两模式 driver 均退出，临时 workspace 均已删除。

审查结论仍限于下述 Pi 0.84.3 与离线 fixture 范围，不代表已验证所有宿主版本或真实模型服务。

### Cleanup and limits

保留全部验证日志和解析证据；CLI launcher 已删除本任务的临时 HOME、session 和 workspace。最终清理记录见 `.scratch/claude-bash/cleanup.json`。用户原型 `prototypes/codex-bash-ui-prototype/.tmp/run-QRdQ97` 未动。没有 commit，没有再委派，也没有更改依赖或用户全局配置。

本轮锁定 Pi 0.84.3，未声明较新 Pi 的兼容性验收。CLI 的 fork 和 tree 通过公开 extension command API 驱动，没有逐键操作其选择器；手动压缩采用 fixture 摘要，未调用真实摘要模型或验证自动阈值触发。未测 Ghostty GPU、整机耗电、RSS 峰值或任意模型网络。极窄屏幕可能省略标题和提示；超过共享预算的布局允许绕过缓存，不能据稳态样本推导无限内容的性能上限。正式升级仍需重启 Pi 并恢复会话。
