# Handoff

> 你是本次交接的 reader。继承本文件及链接中的目标、共识和验证边界，从 Continuation Point 继续。先核对工作区和 Issue 状态，不重做已完成的调查，不重复询问已确认选择。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为仓库内 Pi 提供可复用的文本区域刷新能力，降低动画和 footer 更新带来的额外 CPU，并给 codex-ui 实际加入 Working 动画及实时估算 token 速率。全局 Pi 的启动、安装及升级保持独立。

[Planning #59](https://github.com/wangxuyang1221/pi-ext/issues/59) 已通关，样式、位置与生命周期已确认。[正式实施切片](slices.md) 已获认可，用户另追加验证系统创建、维护、独立验收和修复重验闭环。#61–#66 已建立；#61 普通模式和 #62 全屏局部刷新均已通过主代理验收，正式 Working/速率 #63 也已验收，新能力验证系统 #64 也已验收，旧skill维护 #65 也已验收，当前 #66 的输入框对比度及复制尾部换行修复已独立复验通过，累计54 passed、4 unverified；动态选区实机复制已有18字节完全一致证据；共享验证驱动的启动回显已修复并完成自动检查，接着独立复验及补齐剩余物理组合。用户另行明确要求立即移除 lowpower，独立 [Implementation #60](https://github.com/wangxuyang1221/pi-ext/issues/60) 已完成并通过验收；该清理已结束；当前继续已获授权的正式开发。

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

### Independent final verification

- #66独立gpt-6.1-sol/high已完成，证据提交d8813effe03332b6779d23af5b74d3a69c20ab75，仅报告和JSON，无产品或驱动修改。[报告](evidence/final-verification.md)与[索引](evidence/final-verification.json)记录58个ID中53通过、0失败、5未验证，整体unverified。不要重新派发同样的完整自动轮次。
- 全新安装.tmp/local-refresh-install-eoWVvw，原始根.tmp/final-verification-66-20261029。14个新skill旅程，六个Working各54项；旧CLI两模式各124项、headless12、其余完整入口通过。八份新CPU三轮同步及原生32ms补测全部58项预算通过，无挑选重跑。完整check204文件/2951测试，source/dist加载通过；安装冻结、发布字节及全局Pi隔离通过。
- 主代理已重新校验73份来源/879份artifact哈希、逐批重算全部58项CPU、核对14份summary和六份完整finished帧、读回686个记录PID无存活。子代理最终清理记录119组无监听，runtime/CPU scratch/锁清理，旧证据及用户原型保留。原始报告精确区分ANSI、远程及物理证据。
- #66第一次验收仅自动范围通过，整体未通过，Issue保持open。5个未验证ID为interaction-physical、interaction-network、ui-composer、ui-reply-markdown、ui-interrupted，实质边界为物理像素/拖选/图片/系统复制，真实远程provider，及Write/Edit精确await键盘落点。已知Ghostty工具拒绝不能绕过；无当前剪贴板写入/远程请求授权条件；后者没有可观察可控制阶段。未发现产品错误，不把这些改写成已通过。

### Termius supplemental verification

- 用户指定Termius替代终端，主代理实际成功访问com.termius-dmg.mac及Local Terminal。用户明确同意用隔离会话样本文本覆盖系统剪贴板并粘贴到本工作目录比对；不读原剪贴板、不向远程粘贴。此授权持续有效，不能再将系统复制写成缺授权。
- 新独立gpt-6.1-sol/high任务已完成，证据a593b9df618622df559fdf6b1a7bbe3ae4798929，见[Termius报告](evidence/termius-verification.md)及[索引](evidence/termius-verification.json)。实际版本9.41.1，10.2.1只是待更新提示，未更新。应用/菜单/标签可控，没有安全拒绝；键盘与粘贴未进入shell，Pi未启动，截图与AX存在不同步，实机新增通过0，仍53/0/5。不要把应用可访问当作实机已通过。
- 已备12组隔离入口与Markdown样本，均未运行，runtime已清理；原始脚本/doctor/截图在.tmp/termius-verification-66-20261029，复用安装eoWVvw，73份来源及14份发布JS哈希相同。主代理重新核验77份artifact哈希。未执行生产/copy，没有实际粘贴文件。
- 主代理随后只做控制诊断，重建cua_repl连接未解决观察异常，可选cua.computer.launch_app在runtime不是函数。经切换到原本本地标签，AX显示本轮新建Local Terminal (1)，再用其close-tab控件关闭，AX确认移除；原本本地和远程标签保留。未输入Pi启动命令，未创建测试进程。没有重新委派相同失败尝试。
- 下一步等待用户手动检查：Termius置前，在本机Local Terminal空闲提示符输入T66_INPUT，不回车，确认可见后Ctrl+U清空。区分Termius本身输入与自动控制通道故障；不是再次授权。用户尚未接受验证豁免，实机、远程provider、精确Write/Edit await仍未验证。

### Prototypes

- [布局原型证据](evidence/status-placement-prototype.md)：34 项真实 PTY 检查；用户选择 B。旧省略号动画被否决。
- [最终样式证据](evidence/old-codex-working-prototype.md)：真实 Pi CLI/生产 codex-ui，最终普通/全屏 42 项 PTY 检查，涵盖青色单元格、转圈/反光、速率无数据/四位数、32/40/100 列、零模型调用及 /quit。原型 /quit 先真实复现失败，再修复。
- 最终入口在本 worktree 的 `adventure/54/prototypes/old-codex-working/launch.mjs`；运行 `node adventure/54/prototypes/old-codex-working/launch.mjs`，全屏加 `fullscreen`。F2 重启模拟、F3 数据、F4 暂停，Esc 停模拟，F10/Ctrl+C 或 /quit 退出。不是正式功能或 CPU 优化。
- 原 `status-placement/` 及新 `old-codex-working/` 均被仓库忽略，不可强行加入 Git。原型无局部刷新补丁；详细历史、脚本入口和验证目录见证据。移除 worktree 前必须处置这些仅本地文件。
- 用户已打开旧原型实例，不能按全目录或全进程名清理。只停止本任务 PID/进程组，验证自身 scratch 目录移除。已有 launcher 会打印自身 cleanup 路径，不能把用户实例误判残留。

## Current Assumptions

产品和宿主补丁本轮未变，既有完整自动矩阵、CPU和205文件/2958测试保留。真实联网验证已完成，不能再以缺模型、凭据或费用范围描述为阻塞。最近独立计数54 passed、0 failed、4 unverified；本轮新增interaction-network通过，同时将旧/copy原始LF/CR字节结论更正为未验证。

## Execution and Verification

独立gpt-6.1-sol/high在c7fc3e087f4f77c8b3c666279e4d815bcb6f312e串行完成本轮，无委派，只更新证据和progress。见[本轮报告](evidence/network-and-multiline-verification.md)及[58ID和原始哈希索引](evidence/network-and-multiline-verification.json)。49份继承来源、399份artifact核对，仅两份已知Paste transport文档发生变化。CzIw6h两消费者各32个JS与dist相同，tarball SHA256仍03058ebfa8f11a6f2f554cf93c61919eb40bcc6544382cd8b70305daefdedd0d。未重跑build、pack、CPU、完整check或旧完整CLI。

Termius9.41.1真实生产Pi的普通/全屏均使用openai-codex/gpt-6-luna、thinking medium。沿用户无费用上限授权，两个用户任务合计四次模型响应，只执行两次sleep 5，无其他provider或文件读取。公开事件、usage、工具结果、真实Working/≈速率、无输出-- t/s和settled后隐藏留证。后续自己的历史恢复两次，无新增请求。临时认证只复制指定记录到0600文件，无凭据输出、归档或hash，退出删除全部runtime。

本轮同通道独立校准LF预期拒绝，预定义CR预期24/24字节通过并恢复termios。此前文字22字节是记录误差，实际文件及JSON为24字节。固定85字节三行源草稿的全屏宿主选区反色、Copied和真实系统粘贴通过，实际CR传输SHA256为18bdb00960c7aa8c58abf456bc79560601019c4ee1088e9371354c81c5c4eedc。普通native在共享实例和新生产实例各一次REJECTED，无actual或未知内容留存；不以全屏通过推断普通通过。

普通Termius scrollback及生产全屏鼠标历史滚动均有真实前后视口，CUA此通道down到旧历史、up到新历史。默认Ctrl+Shift+F仍无overlay；真实Pi纯观察器未收到该键字节，随后完整ASCII探针和Ctrl+C字节均到达，未改键位或把旧Ctrl+F替代绑定算默认键。旧/copy的canonical stdin缺少排除ICRNL的历史termios证据，185/191字节文件、首尾空白和尾LF文本证据保留，但原始剪贴板LF/CR结论不足，ui-reply-markdown整体更正为unverified。

31个记录PID已退出、无监听；四个生产runtime、临时认证和两个shared scratch清理，锁不存在，ttys003为空。自己的标签关闭，完整AX最终确认原标签保留；Window Zoom恢复2764×1724。未启动tmux或监听服务。原始RUN为.tmp/network-multiline-66-DtvbtG，两份共享证据为verify-codex-ui-01AnKo和verify-codex-ui-8wNTM0。初始认证路径、按键合并、恢复ready前动作及最终AX滞后均如实留在报告。

## Continuation Point

#60–#65已验收，#66仍open。最新独立计数54/0/4的四个unverified是interaction-physical、ui-composer、ui-reply-markdown、ui-interrupted。interaction-network已在用户授权的实际Pi目标通过；不能再安排相同联网补验或重问费用/模型选择。

剩余条件分别续验，不能豁免或扩张标准：

- 普通native完整三行选择实际内容尚未匹配。两次新尝试均严格REJECTED，未保存未知内容。全屏85字节已匹配；需先区分Termius多行选择提取与复制/焦点链，不盲目重试或补空格改expected。当前没有足以确认产品故障的actual证据；如需改产品/驱动，交Astra high。
- 默认Ctrl+Shift+F在真实Pi中没有输入字节。需要能可靠送达该默认键的获准输入通道；替代Ctrl+F和键盘Home/End已有证据不再重跑。两模式鼠标滚动已补齐。
- 旧/copy原始字节要求需要能证明不转换LF/CR的独立观察链；本轮校准后的内容一致不能替代，也不改旧原始文件或接收器。不得把canonical文件相等重新写成原始剪贴板字节已证。
- 图片像素仍需实际支持协议的获准终端，不伪造TERM_PROGRAM，不访问被拒绝Ghostty。Write/Edit精确await需要可观察、可控制阶段，不用抢时序或Bash取消代替。

本轮仅提交报告、JSON和progress，不push、不PR/merge/deploy；Issue66只更新Execution/Delivery/Verification，Acceptance、Map54、Spec55及关闭由主代理处理。当前无本轮验证进程、监听、runtime、临时认证或shared锁，消费安装与所有旧证据保留。

## Manual acceptance and PR delivery

用户在获知四项未验证边界后明确表示其不阻塞当前交付，随后使用仓库补丁版及全部八个插件进行手动验收，反馈“没什么问题”，并授权创建 PR。该反馈作为本次交付的人工接受结论，不转换独立验证的统计：仍为54 passed、0 failed、4 unverified。上节剩余补验暂停，后续按具体问题另行安排。

PR 前主代理核对7065d9f的最新联网证据，57份来源与404份artifact全部SHA-256匹配。随后更正termius-paste-transport.md中的样本长度笔误22→24字节；不改原始采样数据及历史索引。最近完整check为205文件、2958测试通过，后续仅文档和证据变更，本次执行文档及凭据检查。

保留边界为默认搜索键/图片物理像素、普通模式三行复制、/copy原始LF/CR字节及Write/Edit精确await取消。两个验证skill的自动入口使用PTY和脚本；CUA不是固定步骤或依赖。用户要求后续不采用CUA作为固定验证手段，物理显示和复制保留人工验收。创建PR不代表已合并，也不将这些边界记作通过。
