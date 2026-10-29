# Handoff

> 你是本次交接的 reader。继承本文件及链接中的目标、共识和验证边界，从 Continuation Point 继续。先核对工作区和 Issue 状态，不重做已完成的调查，不重复询问已确认选择。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为仓库内 Pi 提供可复用的文本区域刷新能力，降低动画和 footer 更新带来的额外 CPU，并给 codex-ui 实际加入 Working 动画及实时估算 token 速率。全局 Pi 的启动、安装及升级保持独立。

[Planning #59](https://github.com/wangxuyang1221/pi-ext/issues/59) 已通关，样式、位置与生命周期已确认。[正式实施切片](slices.md) 已获认可，用户另追加验证系统创建、维护、独立验收和修复重验闭环。#61–#66 已建立；#61 普通模式和 #62 全屏局部刷新均已通过主代理验收，正式 Working/速率 #63 也已验收，新能力验证系统 #64 也已验收，旧skill维护 #65 也已验收，当前进入 #66 独立最终验证。用户另行明确要求立即移除 lowpower，独立 [Implementation #60](https://github.com/wangxuyang1221/pi-ext/issues/60) 已完成并通过验收；该清理已结束；当前继续已获授权的正式开发。

## Evolution

最初检查发现 Pi 已有终端差异输出，但动画请求仍触发全局组件及帧计算。用户明确最终目标是 CPU，而不是单纯减少 render 次数；本次只处理动画和 footer 引起的额外开销，不扩展为正文增量渲染。

通用组件树缓存实验增加正常流式帧成本，因此转向显式文本区域及保留帧。真实渲染器实验支持收益空间，但仍用夹具坐标，不能当作正式补丁。

用户随后扩展为正式 Working 和真实速率功能，旧两关草案失效。统计在 #58 确定；#59 通过真实原型确定 footer 右侧 B 布局、青色转圈和文字反光，修复原型 /quit，并逐项确认任务启停规则。用户要求移除 lowpower 后，创建独立 #60 直接实施，保留默认完整工具显示。

## Agreed Decisions and Constraints

- [Map #54](https://github.com/wangxuyang1221/pi-ext/issues/54)、[Spec #55](https://github.com/wangxuyang1221/pi-ext/issues/55)。完整规格仅维护在 Spec 正文。#56、#57、#58、#59 均通关；原型样式已审阅，不再问位置、颜色或图标。
- Working 位于输入框上方，主题 accent 青色十帧转圈每 80ms 一帧，文字采用约两秒灰白反光，附计时。沿用已确认原型，不显示跳动省略号。现有标题动画不变。
- Working 在整项任务期间保持，包括工具执行、重试、自动压缩和等待用户确认/输入；真正结束后隐藏。宿主 `agent_settled` 是结束边界，`agent_end` 或按下取消键不是。取消保留宿主行为，完成停止后清理。
- 速率放 footer 右侧，带 `≈`，表示最近约两秒的接收速率。统计正文、可见思考及工具参数，不计输入、工具结果和未传出的隐藏思考。不按片段数计 token，不用最终 usage 替换短窗口。
- 运行中无新数据时显示 `-- t/s`；任务结束后隐藏速率，释放空间。采样按每次响应重置，不能因此停止整项任务的 Working。
- 沿用原型窄屏布局，32/40/100 列已测，窄于 40 列省略中断提示，更极端宽度安全截断。对话框保留焦点与遮挡优先级，局部刷新不安全时回退。
- 用户直接授权删除 lowpower 命令、补全、状态及专用简化渲染分支，完整模式的缓存、输出边界、diff、展开与执行正确性保留。不是把开关隐藏起来。
- 分支 `adventure/pi-animation`，worktree `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/pi-animation`；资料 `adventure/54/`。仅在该 worktree 开发，提交并推送本场成果；不创建 PR、不合并、不部署、不修改全局 Pi。
- 用户已认可正式开发切片并直接追加最终验证要求。按 adventure 由主代理协调独立 worker 依次执行。编码 worker 固定 gpt-6-astra / high，验证及维护源码审查 subagent 固定 gpt-6.1-sol / high，不自行换模型。使用 T3 delegate_task 承载用户指定配置；本线程已查询 orchestrator_capabilities，providerInstanceId=codex，options.reasoningEffort=high。后续无错误或用户指定 provider 变化无需再查询。
- 用户最新AGENTS要求编码、测试修改、修复和重构使用 /Users/wangxuyang/.agents/skills/ub-mode/SKILL.md，完整执行先行为红灯、质量工具和动作记录；不使用skill-creator。后续派发须明确交接这项更新。
- Python 使用 conda 的 `codex-py312`；pnpm 脚本及提交使用命令级 `pnpm_config_verify_deps_before_run=false`，避免 pnpm 11 自动安装写回占位配置，不跳过门禁。`npm_config_` 前缀无效。

## Established Facts and Required Context

### Repository and implementation

- 初始基线 `31a7061ce853233bdeb8686487a35d03fb4c1e5a`，Node v22.22.2，pnpm 11.9.0，Pi 固定 1.4.0；#60 实施基准 `01be7d6`。
- 已有 coding-agent 会话摘要补丁及仓库 `pnpm exec pi`，见 [说明](../../docs/pi-session-summary-patch.md)。新增 pi-tui 补丁已由 #61 实现并验证干净冻结安装、仓库 bin 加载和原版回退；全屏局部优化已由 #62 实现并验收。原版正常 requestRender 保留功能，缺失的仅是 CPU 优化。
- #60 已交付，提交 `7480598722ed333db5948e67b11e94384c37bc04`。codex-ui 269 项定向测试、普通/全屏真实 CLI 各 124 项检查、codemode 两入口、tool-status 三旅程及 headless 12 场景通过；最终 check 为 196 文件/2898 测试。主代理核对代码、实际输入/工具路径、日志和清理结果。详细证据及未验证边界见 [移除记录](evidence/remove-lowpower.md)，原始运行资料仅保留在本 worktree 的 .tmp。
- 主仓库 main 未修改。原型位于忽略目录，只保留本地；产品清理不删除原型或用户启动的实例。

### CPU and rendering

- 普通 renderer 先组装所有行再做差异输出；全屏每帧重建 layout 的 renderCache。Loader 每 80ms 请求刷新。全局组件计算不等于每帧整屏终端输出。
- [组件实验](experiments/scoped-refresh.mjs) 及 [报告](evidence/scoped-refresh.md) 在真实普通/全屏 renderer、内存终端上证明 60 帧无关 render 从 12000/24000 次降至 0，画面与终端字节等价。不是任意组件或真实 PTY 正式接入的证明。
- [CPU 调查](evidence/render-cpu.md)、[基准](experiments/render-cpu.mjs)、[区域实验](experiments/region-renderers.mjs) 记录通用缓存被否决的原因。1000 对历史的纯动态帧，区域方案两次普通 CPU 下降约 64%/70%，全屏约 82%/90%。不承诺所有短帧相同降幅。
- 正式预算不变：200/1000 对真实消息组件，120×40、同内容/帧数/频率、多批轮换，纯动态帧 CPU 中位数至少下降 30%；0/200/1000 对历史正常更新及未接入路径额外 CPU 不超过 max(基线 10%, 0.1ms/帧)。不能降低频率、隐藏内容或只选最好一次。
- 正式 API 仍需真实几何、失效规则、全屏 layout 元数据同步、稳定 TUI 引用与 renderer 切换语义。不能把实验硬编码坐标暴露给调用者。

### Regular region implementation

- #61 提交 d3599d7 新增可选 registerTextRegion(component) → requestRender()/dispose()，见 [API 说明](../../docs/pi-text-region-refresh.md) 及 [正式示例](../../examples/text-region.ts)。普通模式利用实际 Container.mouseLayout 获取几何，原有 Container 链以外安全回退；多目标合并、正常请求优先、同宽高保留帧、释放和稳定 Proxy 模式迁移已实现。全屏暂走正常渲染。
- [本关证据](evidence/regular-local-refresh.md) 及 [CPU 原始批次](evidence/regular-local-refresh-cpu.json)。主代理重新核算三轮同步及一轮原生调度样本，全部预算通过，样本数/终端字节等价和 patch 哈希匹配。纯局部帧仍可能随历史长度复制/扫描行数组，未承诺 O(1)。
- 完整 check 197 文件/2908 测试，10 项真实 renderer 契约；干净安装、原版/补丁实际 CLI、扩展真实 factory 与 PTY、既有 codex-ui 两模式各124项回归通过。23个记录PID均退出，无监听，用户原型未动。没有执行物理终端像素/拖选/系统剪贴板，不将自动测试当作 #65/#66 全部通过。
- 安装夹具和原始日志位于本 worktree .tmp/local-refresh/、.tmp/local-refresh-install-CT3VmH/。CPU脚本 scripts/local-refresh-cpu.mjs、安装脚本 local-refresh-install.mjs、PTY脚本 local-refresh-pty.py 已成为正式仓库入口；后续扩展这些入口，不复制临时实验作为生产能力。

### Fullscreen region implementation

- #62 提交 c835fb2，沿用正式 API，同步真实 layout 叶节点 lines、直接所属 ScrollView 的 scrollContentLines 和受影响屏幕行；同高时保留真实几何。有效选区、搜索、overlay、图片、横向/复杂嵌套布局及动态 visible 回调正常回退，不能把旧屏幕字符串当作唯一缓存。
- [本关证据](evidence/fullscreen-local-refresh.md) 和 [全部 CPU 批次](evidence/fullscreen-local-refresh-cpu.json)。主代理核对最终 8 轮样本的中位数、预算、样本数量、终端字节和 patch 哈希，全部一致；早期失败与排除样本另保留，不能混为最终结论。
- 完整 check 为197文件/2918测试、正式契约20项；最终干净补丁普通/全屏PTY、原版兼容、Kitty协议及既有codex-ui两模式各124项回归通过。宿主复制回调得到最新文本，鼠标命中和搜索读取更新后的布局内容。物理终端像素、系统剪贴板和图片像素仍不是这些证据覆盖的范围。
- 23个记录PID和进程组已退出，无监听，运行目录删除而证据保留。原始结果在 .tmp/fullscreen-local-refresh/；最终干净安装在 .tmp/local-refresh-install-2up97B/。动态visible守卫后已经重验最终patch；既有未接入API的codex-ui回归版本边界见证据。

### Rate and lifecycle

- [统计来源](evidence/token-rate-sources.md) 说明准确 usage 常在响应结束更新，delta 不是 token，最终 output 可能含 reasoning。字符/3.5 只用于低成本实验，不代表用户指定的估算算法。
- [窗口实验](experiments/token-window.mjs) 和 [结果](evidence/token-window.json) 经真实 AssistantMessageEventStream 验证片段数量无关、共享 partial 去重、过期、工具参数完整补齐去重、响应隔离和固定桶存储。此项是历史实验，正式链路验证见下方 #63 记录。
- [生命周期证据](evidence/working-lifecycle.md) 记录任务结束、取消和等待边界。Pi 1.4.0 实际已有 `ui_prompt_start/end`，此前未找到属于检索未完成，不要再声称无此能力。用户选择等待时不暂停，故不必新增等待接口。现有 terminal-title 使用 agent_settled，提供可复用依据；正式行内组件现已由 #63 完成。

### Production Working and rate

- #63 提交554e6fa，WorkingSession将整项任务与逐响应速率分开，共享32ms调度，agent_settled结束；footer保留goal后续行。增量UTF-16/4估算、20个100ms桶、固定两秒分母，方法边界见[说明](../../docs/codex-working-rate.md)。
- [详细证据](evidence/working-token-rate.md)、[CPU全部批次](evidence/working-token-rate-cpu.json)、[安装与交互索引](evidence/working-token-rate-verification.json)、[质量工具](evidence/working-token-rate-quality.json)。主代理重算最终8轮58项预算并核对全部源码/补丁哈希与字节等价，全部通过。早期失败阶段保留，不能混为最终数据。
- 最终check203文件/2941测试，四个实际发布入口各53项PTY；真实权限批准、bash副作用/取消、retry、overflow压缩、dialog/overlay、窄屏、模式/session/reload/quit。原版正常回退。旧CLI两模式各124项、goal-footer四入口、codemode两模式通过。物理像素、系统剪贴板和远程联网未验，#66须按Spec处理边界。
- 生产CPU增加真实上下文投影成本后暴露全屏失败，最终按分支/模型缓存上下文、独立缓存goal行、减少重复裁剪及同宽字符串校验修复；原版和补丁对比使用相同生产组件。虚拟模型仍实时读上下文，补丁公共契约不变。
- 本地原始记录在.tmp/working-token-rate/，最终发布安装.tmp/local-refresh-install-4tyVm9。67个记录PID退出、无监听，证据保留。质量结果区分等价变异与既有高复杂度/未覆盖分支，不冒称全仓库零问题。

### Text region verification skill

- #64提交173e57c，新增[verify-pi-text-regions](../../.cursor/skills/verify-pi-text-regions/SKILL.md)，五组feature覆盖示例、生产Working、交互、性能及安装。只读doctor检查实际包/CLI/版本/API/hash；复用已有驱动，PTY保留instance、动作字节位置及真实workspace/agent副本。
- [本关证据](evidence/create-text-region-verification.md)与[索引](evidence/create-text-region-verification.json)。从空目录自证补丁普通与原版发布包全屏Working各53项，首次清理后工具文件丢失已修复并保留红灯。无效CLI失败也留证清理。主代理重跑doctor并核对hash、实际tool-proof、取消文件缺失及cleanup。
- 完整check204文件/2951测试；doctor最高CRAP3、11/11变异killed，dryer无0.8重复。新skill/helpers可执行、命令与入口可恢复，不依赖旧安装目录。完整CPU及物理/联网边界没有在本关自证，后续不能误作已通过。
- 原始自证.tmp/verify-text-regions-bukMuU/、质量与日志.tmp/create-text-region-verification/，本次安装.tmp/local-refresh-install-VfmMYy。记录进程均退出，无监听，证据保留，全局Pi哈希未变。不要清理旧证据或用户原型。

### Codex-ui verification maintenance

- #65提交5e275638，仅修改目标skill十个文件。完整使用maintain-verification-skill，五组feature各由独立gpt-6.1-sol/high只读审查，维护协调者串行live。新增Working/速率路由、逐进程doctor及6项拒绝/留证测试。主代理已核对diff、源审查、36个ID覆盖表和原始最终帧，验收关闭#65。
- 旧CLI两模式各124项、headless12场景、codemode两模式、Thinking、goal四入口、tool-status三入口通过。Working仓库补丁两模式与新安装原版发布包两模式各54项通过，最终完整帧均无Working/rate且Goal保留；主代理另测已安装补丁两模式，不将两类四入口混称。
- 两处共享驱动漂移由主代理Astra high修复后，维护协调者独立复验：1e91275分别验证静态工具卡和Working动画，0333f31等待settled后的实际隐藏帧再capture。原失败保留，详见[工具卡修复](evidence/tool-status-working-fix.md)和[最终帧修复](evidence/working-final-capture-fix.md)。无产品改动。
- 完整check204文件/2951测试；新doctor函数CRAP3、函数行覆盖100%、9/9变异killed，dryer无0.8重复。48个记录PID/组无存活或监听，runtime/锁/worker清理，全局Pi入口哈希未变。维护scratch按skill要求不提交。
- 本地原始证据在.tmp/maintain-codex-ui-65/{coverage.md,coverage.json,source-wave.md,run-notes.md,cleanup-final.json}，包含所有入口和失败/恢复时序；当前安装.tmp/local-refresh-install-ZQW7Cw。#66必须新跑，不以这些历史结果代替独立验证。
- 物理终端尝试cua.getApp("com.mitchellh.ghostty")被工具拒绝：Computer Use is not allowed to use the app 'com.mitchellh.ghostty' for safety reasons. 不绕过拒绝控制同一应用。物理像素/实际拖选/图片像素未验；系统剪贴板无当前写入授权未写；远程凭据仅存在性检查为false，未读取用户auth或发付费请求；Write/Edit精确await按键落点无可观察阶段仍未验。这些边界与完整CPU矩阵交#66按Spec处理，不算通过或自动豁免。

### Prototypes

- [布局原型证据](evidence/status-placement-prototype.md)：34 项真实 PTY 检查；用户选择 B。旧省略号动画被否决。
- [最终样式证据](evidence/old-codex-working-prototype.md)：真实 Pi CLI/生产 codex-ui，最终普通/全屏 42 项 PTY 检查，涵盖青色单元格、转圈/反光、速率无数据/四位数、32/40/100 列、零模型调用及 /quit。原型 /quit 先真实复现失败，再修复。
- 最终入口在本 worktree 的 `adventure/54/prototypes/old-codex-working/launch.mjs`；运行 `node adventure/54/prototypes/old-codex-working/launch.mjs`，全屏加 `fullscreen`。F2 重启模拟、F3 数据、F4 暂停，Esc 停模拟，F10/Ctrl+C 或 /quit 退出。不是正式功能或 CPU 优化。
- 原 `status-placement/` 及新 `old-codex-working/` 均被仓库忽略，不可强行加入 Git。原型无局部刷新补丁；详细历史、脚本入口和验证目录见证据。移除 worktree 前必须处置这些仅本地文件。
- 用户已打开旧原型实例，不能按全目录或全进程名清理。只停止本任务 PID/进程组，验证自身 scratch 目录移除。已有 launcher 会打印自身 cleanup 路径，不能把用户实例误判残留。

## Current Assumptions

普通模式和全屏正式机制均已实现并验收。实际 Working/速率及采样组合已由 #63 开发验证；新增验证系统已由#64创建并自证；旧skill已由#65维护并验收；最终独立验收仍待#66。已有实验足以确定路线，不能推导最终 CPU 和正确性已经通过；失败须修复或重开规划，不由 worker 放宽预算。

估算算法是内部实施选择，须说明精度、有界内存和开销。组合 CPU 已按生产组件验证，#66 仍须独立复验，不能仅引用此前通过结论。

## Continuation Point

独立 #60 已通过验收，命令、状态及专用分支已删除，默认完整工具显示和执行边界保留。提交 `7480598`；主代理随后提交本存档、生命周期证据和三关草案，并推送冒险分支。无待返工项、无继续运行的 worker 任务，不要重新委派移除工作。

用户已认可三关并增加验证交付条件，不要再请求同一范围审核。[#61](https://github.com/wangxuyang1221/pi-ext/issues/61) 已完成，提交 d3599d77fb96d3964208f6f0b745185223bae0a9，主代理已审阅源码/测试与 CPU 样本并验收关闭。随后 #62 也已通过验收，提交 c835fb27d95fec9b420332a847efe6d2f80f931b。随后 #63 已验收，提交 554e6fa48cf6ffcdd340a44b5554733a04d773c0。#64也已验收，提交173e57c7cc935fc2cbf5fcee6f5ba1f9b78f948d。随后#65已验收，提交5e275638130373a726dbb29c84bda3ebd5d5c003。当前进入#66独立最终验收。原生父子和阻塞依赖已建立。不要重新派发已完成的两种模式机制实现。

#65已完整执行maintain-verification-skill并验收，不重新派发维护或源码reader。当前无运行中的维护worker。#64新skill无需重新生成。下一步派发全新gpt-6.1-sol/high最终验证代理，显式使用本worktree，shared child默认项目根目录不是任务目录。最新已保存HEAD从git读取，任务ID和线程入口写入Map，遵循delegate返回next，完成自动唤醒，不轮询。

#66代理必须完整读取并实际调用本worktree的.cursor/skills/verify-pi-text-regions/SKILL.md及.cursor/skills/verify-pi-codex-ui/SKILL.md，包括全部feature和必要引用。交接给出绝对路径。计划用/Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md写在Issue#66。新建证据，独立执行全部适用入口、完整CPU矩阵、干净发布安装、补丁和原版两模式及完整check，不只阅读旧报告。无进一步委派；不修改产品或驱动掩盖问题，报告最小复现，由Astra high修复后新建独立验证任务重验。

产品问题交gpt-6-astra/high修复，所有编码及测试修改用ub-mode；最终验证代理只提交本关证据，不push或关闭Issue，Acceptance由主代理填写。发现真实外部阻塞前先完成全部安全可执行项，准确报告未验证范围和前置条件，不绕过Ghostty工具拒绝，不自行写系统剪贴板或读取用户凭据。维护scratch不提交；最终验收摘要和原始数据索引放adventure/54/evidence/。

最终必须验证两种 renderer、原版降级、实际补丁安装/发布入口、CPU 预算、真实交互及清理。所有 Implementation 通过后提交用户确认；不能自行合并、关闭 Map/Spec 或移除尚未处置原型的 worktree。
