# Handoff

> 你是本次交接的 reader。请继承本文记录的目标、决定、事实和约束，从 Continuation Point 继续工作。按相关事项的读取条件恢复引用内容；沿用已有调查结论，发现反证或适用条件变化时再核验。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为仓库内 Pi 提供可复用的 TUI 局部刷新机制，降低动态 UI 额外引起的 CPU 渲染开销，并实际给 codex-ui 添加 Working 动画和 token 速率显示。统计口径、footer 右侧的位置 B，以及青色转圈加 Working 反光样式已获用户确认；UI 生命周期尚待确定。旧两关切片已暂停审核，当前在 Planning #59，原型审阅已完成，尚未派发 worker。

## Evolution

用户最初希望给 Pi 打仓库内补丁，并保证全局命令和升级不受影响。源码检查发现宿主已有终端差异输出，但 Loader 每 80ms 请求全局组件刷新。用户随后明确，需要的是供自定义动态内容使用的机制，不只是修改原生 Working。

用户补充图示动画行及 footer `102 t/s`，并明确最终目的是降 CPU。新增基准发现通用组件缓存会增加正常流式帧成本，因此转向显式预留区域、复用其余画面的方向。用户在范围选择中确认只消除动画与 footer 引起的额外开销，不扩展为正文渲染优化。

在两关草案审核前，用户又明确扩大范围：实际给 codex-ui 添加 Working 动画和 token 速率，尚未想好速率位置。因此原来不做真实 token 采集、不改默认 UI 的限制失效，旧草案不能直接执行。用户随后接受实时估算并使用 `≈` 标识。

## Agreed Decisions and Constraints

- [Map #54](https://github.com/wangxuyang1221/pi-ext/issues/54)、[Spec #55](https://github.com/wangxuyang1221/pi-ext/issues/55)；完整规格只维护在 Spec 正文。
- [方向 Planning #56](https://github.com/wangxuyang1221/pi-ext/issues/56) 已通关。其初始仅提供机制的范围后来被用户扩展，当前以 Spec 修订及 #58/#59 为准，实际 Working 和 token 速率已在范围内，样式和位置尚待确认。
- [可行性 Planning #57](https://github.com/wangxuyang1221/pi-ext/issues/57) 的有效规则已移交 Spec。采用显式文本区域与保留帧方向；无效几何、正常更新或其他复杂情况允许正确回退，不用全树通用缓存作为生产路线。CPU 预算和完整边界以 Spec 为准。
- [#58](https://github.com/wangxuyang1221/pi-ext/issues/58) 已通关，统计规则已移交 Spec：实时估算带 `≈`、最近约 2 秒窗口、计入正文/可见思考/工具调用参数，不计输入/工具结果/未传出的隐藏思考；运行中暂无可计数新输出时显示 `-- t/s`，保留位置，不显示 `0 t/s`。正文自身渲染优化仍不在范围。当前进入 [#59](https://github.com/wangxuyang1221/pi-ext/issues/59) 确定位置与 UI 生命周期。
- 独立分支为 `adventure/pi-animation`，worktree 为 `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/pi-animation`；资料位于本目录。
- 沿用 adventure 流程，规划取舍和实施切片均需用户确认，之后由主代理协调 worker 逐关实施。当前没有 worker，没有产品代码修改。
- 提交推送仅包含本场工作；不创建 PR、不合并、不部署，不修改全局 Pi。工作目录外未授权写入需先征得同意。

## Established Facts and Required Context

- 基线为 `31a7061ce853233bdeb8686487a35d03fb4c1e5a`，Node v22.22.2，pnpm 11.9.0；宿主依赖固定为 Pi 1.4.0。
- 仓库已有 `pnpm-workspace.yaml` 登记的 coding-agent 会话摘要补丁，仓库 `pnpm exec pi` 与全局命令分离。见 [已有说明](../../docs/pi-session-summary-patch.md)。新增 pi-tui 补丁仍需验证实际加载路径。
- 实际安装包 `pi-tui/dist/components/loader.js` 每 80ms 调用 requestRender；`tui.js` 的 Container.render 遍历子组件；`tui-main-screen.js` 先组装所有行再做差异输出；`tui-alt-screen.js` 调用 renderLayoutFrame 后比较屏幕行。全局组件计算不等于每帧整屏终端输出。
- 全屏 `layout.js` 的 renderCache 仅在单帧内复用，下一帧重新创建；组件和布局存在明确接入点。
- 自定义 widget 和 footer factory 收到 TUI 实例；widget 直接挂入原生 Container。codex-ui 当前隐藏原生 Working 行。
- 创建/更新 Issue 使用 GitHub connector；原生父子关系 connector 未提供，使用 gh api。#55、#56、#57 均为 Map 的原生子 Issue。
- 首次自动保存提交为 `c35d3c6aa156fc85824a13c07e97974c649d6cb8`，已推送。随后独立完成 [技术实验](experiments/scoped-refresh.mjs)，结论与边界见 [实验报告](evidence/scoped-refresh.md) 和 [原始结果](evidence/scoped-refresh.json)。没有修改产品源码或安装包。
- 实验在真实普通和全屏渲染器上通过。60 帧中，无关历史组件 render 从普通 12000 次、全屏 24000 次降为 0；画面和终端字节与基线一致。正常更新、尺寸变化、多个局部目标、真实调度请求合并及普通请求优先均有证据。当前是内存终端和已知夹具组件，未覆盖真实 PTY、任意容器或正式扩展接入。
- pnpm 安装会自动写入未批准构建脚本的占位配置，该改动已移除。本次使用 `--frozen-lockfile --ignore-scripts --config.strict-dep-builds=false` 安装，仍未执行依赖构建脚本，配置和锁文件保持原样。
- 移除占位项后，pnpm 11 的脚本前自动安装检查会再次触发安装并写回占位项。后续运行或提交时使用命令级 `pnpm_config_verify_deps_before_run=false`，避免重复自动安装；这不跳过仓库检查或提交 hook。`npm_config_` 前缀对此设置无效。最终提交 hook 已正常通过。
- 2026-10-29 `pnpm run check` 退出码 0，196 个测试文件、2913 个测试全部通过；构建、类型、仓库门禁、发布包和宿主 source/dist 加载通过。检查进程已退出，未留下本任务后台进程。这不替代正式补丁集成验收。
- 新增 [CPU 调查](evidence/render-cpu.md)、[可重复基准](experiments/render-cpu.mjs)、[区域实验](experiments/region-renderers.mjs) 和两次原始结果。1000 对历史的纯动态帧，区域方案普通模式 CPU 降低约 64%/70%，全屏约 82%/90%；通用缓存正常流式帧开销增大，不采用。短帧存在波动，不承诺所有场景同比降低。
- 区域实验仍使用夹具坐标，未实现自动几何、布局元数据同步或正式 API；仅证明收益空间。不能直接把实验包装当成正式宿主补丁。临时生成的 renderer 文件已清理。
- CPU 调查后的 `pnpm_config_verify_deps_before_run=false pnpm run check` 再次通过，2913 tests passed。没有产品代码变更或全局 Pi 变更。
- 新范围的源码证据见 [token-rate-sources.md](evidence/token-rate-sources.md)。OpenAI/Codex 的准确 usage 在响应结束时更新；delta 不是 token；最终 output 已含 reasoning；durationMs 是完成后的请求总时长。实时估算标识已获用户确认，算法未定。现有动画只作用于标题，TUI 内的 Working 被隐藏。
- [窗口实验](experiments/token-window.mjs) 与 [结果](evidence/token-window.json) 已通过真实 AssistantMessageEventStream 队列验证片段数量无关、共享 partial 不重复计数、过期、完整工具参数去重、响应隔离和固定桶存储。字符/3.5 仅为低成本实验，不代表精确 tokenizer；完整 provider 与生产生命周期未验。无后台进程或联网模型请求。

第一轮布局原型见 [证据摘要](evidence/status-placement-prototype.md)，34 项 PTY 检查通过。用户已选择 B「footer 右侧」，拒绝省略号动画。第二轮按 Codex rust-v0.97.0 制作两秒逐字明暗扫描，36 项 PTY 检查通过。用户随后认可反光，明确要求加入早期 codex-ui 的转圈，并指出 `/quit` 不能退出。

第三轮已在同一入口加入仓库既有十帧/80ms 转圈，替换前方小圆点，保留文字反光；共用原型 32ms 调度。`/quit` 先真实复现失败，再放行其 Enter 到宿主原生退出流程。最终普通/全屏 40 项 PTY 检查通过、模型调用为零；本轮完整 check 的 2913 tests passed。测试只清理自己启动的进程及目录，用户已打开的体验实例未动。详细历史与证据见 [新证据](evidence/old-codex-working-prototype.md) 的 Spinner and quit revision。

新入口为本 worktree 的 `adventure/54/prototypes/old-codex-working/README.md` 和 `launch.mjs`，原 `status-placement/` 保留。两者均因仓库规则只保留本地，未加入 Git；清理 worktree 前须处置。原型没有局部刷新补丁，不能证明 CPU 收益或作为生产实现。

用户随后指出转圈应有颜色。原型由 `muted` 改为主题 `accent`，codex-pi 为青色 `#5efcff`，文字反光不变。历史早期行内指示器含 accent 色，标题转圈本身仅为纯文本；不要声称已经证实旧版同一转圈有相同着色实现。当前采用主题强调色满足彩色图标要求，仍在同一原型入口体验。

## Current Assumptions

正式区域追踪、稳定 TUI Proxy 下的句柄、全屏 layout 更新及复杂交互回退仍需实施验证，义务保留，待修订切片重新分配。已有机制证据有效，无需重复调查；新增实际 UI 和统计需要独立规划，不能按旧草案补几个执行步骤就视作已审核。

CPU 预算为待审核切片的一部分：200/1000 对历史纯动态帧至少降低 30%；普通/未接入路径额外开销不超过 max(10%, 0.1ms/帧)。不能由 worker 自行放宽，失败须修复或重开规划。

## Continuation Point

继续 Planning #59。用户明确表示“looks great, 就这个样式”，已完成原型审阅：采用输入框上方的青色十帧转圈、Working 灰白反光和计时，速率放 footer 右侧。不要再询问位置、图标、配色或反光效果。用户确认的是样式，不代表正式功能或 CPU 优化已经交付。

用户已选择整个任务期间持续显示 Working，工具执行、重试和自动压缩期间也保留，直到任务真正结束。宿主 agent_settled 才代表任务真正结束，不能用 agent_end 或短暂无输出提前隐藏。运行中的速率无新数据时仍按已定规则显示 -- t/s。

用户已选择任务结束后隐藏速率，恢复 footer 空间，不保留最后有效值。下一步询问 /lowpower 是否关闭新增行内转圈与反光，但保留静态 Working、计时和实时速率；推荐该行为，尚未获确认。源码已核验现有 /lowpower 仅切换工具渲染等策略，不能把新增动画行为当成既有规则。该问题仅涉及新行内动画，不自动扩展到当前标题动画。

随后处理中断、等待用户输入、原版兼容及窄窗口必要规则，再修订切片。通用“正在等待用户操作”事件尚未在扩展 API 中查得，必要时先查证实际宿主 UI 状态，不承诺未经核实的检测能力。不要替用户终止其仍在体验的原型实例。

如需修改原型，沿用 `/Users/wangxuyang/.agents/skills/wangxuyang/make-a-prototype/SKILL.md`；修改后补验受影响场景，再交用户审阅。按 adventure 的原型流程，用户确认结论或明确跳过后才推进依赖该结论的工作。还要确定最终结束显示、Working 的启停/等待/中断、窄屏和低功耗/原版行为，再修订切片；已定统计口径不重复询问。

完成新增 Planning 后移交 Spec，重写 [已失效的切片草案](slices.md)，重新提交审核。当前没有 Implementation Issue 或 worker。用户接受修订后的完整切片后，按 adventure 创建实际需要的 Implementation Issues 与依赖，保存并派发首关。worker 必须完整读取 `/Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md` 及必要引用，在 Issue 正文维护计划；提供本 worktree、当时 HEAD 和操作限制，不继承整段对话、不再委派。委派工具遵守当前 orchestration 规则。

最终须验证两种模式、原版降级、实际打包安装入口、CPU 预算及交互正确性，运行 pnpm run check，清理本任务临时资源。所有 Implementation 通过后等待用户确认，不能自行合并、关闭 Map 或清理冒险分支。
