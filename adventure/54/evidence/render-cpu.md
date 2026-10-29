# Render CPU investigation

## Goal and scope

用户确认最终目标为降低动画和 footer 更新额外引起的 CPU 渲染开销。Working 动画、计时和 footer 中 `102 t/s` 是代表场景。本次不优化正文持续输出本身的渲染机制，不新增真实 token 采集或改变默认 UI。

## Method

- [基准程序](../experiments/render-cpu.mjs) 使用真实 Pi 1.4.0 的 UserMessageComponent、AssistantMessageComponent、Markdown、两种 TUI 渲染器及本仓库 CodexFooter。
- 120 列、40 行；0、200、1000 对历史问答；分别测量只有动画与速率更新，以及正文流式更新与动画同时发生。
- 对比原路径、[通用组件缓存](../experiments/scoped-refresh.mjs) 和 [预留区域实验](../experiments/region-renderers.mjs)。动态文本和 footer 的每帧内容相同，不降帧、不减少工作量。
- 通过 process.cpuUsage 测量进程 user+system CPU，分批轮换执行顺序，报告批次中位数。首轮每批 80 帧、5 批；复测每批 320 帧、7 批，测量前每条路径预热并逐帧核对 50 帧画面与终端输出。首轮较早版本预热 12 帧，后续增加预热以减少短批次波动。
- [首轮数据](render-cpu.json)、[复测数据](render-cpu-repeat.json)。单位为每帧 CPU 毫秒，不能换算为整个应用 CPU 降幅承诺。
- 复测命令：`node --expose-gc adventure/54/experiments/render-cpu.mjs --frames=320 --samples=7`。

## Results

复测中位数，数值四舍五入：

| Mode | History pairs | Workload | Baseline CPU ms/frame | Component cache | Reserved region |
| --- | ---: | --- | ---: | ---: | ---: |
| regular | 0 | animation + rate | 0.051 | 0.059 | 0.063 |
| regular | 200 | animation + rate | 0.543 | 0.499 | 0.241 |
| regular | 1000 | animation + rate | 2.889 | 2.215 | 0.863 |
| fullscreen | 0 | animation + rate | 0.093 | 0.069 | 0.053 |
| fullscreen | 200 | animation + rate | 0.209 | 0.107 | 0.056 |
| fullscreen | 1000 | animation + rate | 0.759 | 0.123 | 0.079 |
| regular | 0 | streaming + animation | 0.072 | 0.076 | 0.066 |
| regular | 200 | streaming + animation | 0.561 | 0.614 | 0.564 |
| regular | 1000 | streaming + animation | 2.864 | 3.633 | 2.844 |
| fullscreen | 0 | streaming + animation | 0.068 | 0.058 | 0.088 |
| fullscreen | 200 | streaming + animation | 0.222 | 0.301 | 0.215 |
| fullscreen | 1000 | streaming + animation | 0.868 | 1.579 | 0.909 |

关键结论：

- 通用组件缓存虽可将局部帧的无关 render 调用降为零，但维护缓存会增加正常帧成本。1000 对历史、流式输出时，复测中普通模式增加约 27%，全屏约 82%。因此不采用其全树缓存策略作为当前实施方向。
- 预留区域在 200/1000 对历史、仅动态更新时，首轮与复测均降低 CPU。1000 对历史普通模式降低约 64%/70%，全屏约 82%/90%。
- 预留区域的长会话正常输出样本没有出现通用缓存那样的大幅退化；但短会话和少量数据存在波动及局部退化，不能宣称所有场景都更快。例如复测普通模式无历史动态帧增加约 0.012ms，全屏无历史流式帧增加约 0.020ms。
- 原实验新增 footer-only 检查：从 `101 t/s` 到 `102 t/s`，只调用 footer render 一次，不调用历史、输入和动画 render，真实宿主调度输出与基线一致。

## Candidate mechanism

扩展显式声明一个动态文本组件，并请求该组件刷新。正常渲染时记录该组件当前占用的行范围；仅动态内容变化且几何位置有效时，复用其余画面，重新计算局部文本，经过宿主原有差异输出和光标处理写入终端。

普通请求优先于局部请求，多个局部请求合并。尺寸变化、布局无效、组件卸载、需要重新合成或其他不满足优化条件的情况采用正常路径。补丁提供可选能力，原版宿主使用原有 requestRender，保留正确显示但没有 CPU 优化。

不同于通用缓存，这条路径不在每个正常帧维护所有消息组件的依赖与结果缓存。普通模式仍可能复制和比较行数组；不要求第一版复杂度完全不随历史长度增长，也不将实验中的跳过逻辑直接用于产品。

## Evidence boundaries

预留区域实验通过在工作区临时生成两份实际 renderer 模块，插入实验入口并复用原生差异写入器。原安装包和全局 Pi 未修改，临时模块目录由 finally 清理。

目前区域行号由夹具提供，未实现正式注册、自动几何追踪、布局元数据同步或失效机制。全屏局部帧复用旧 layout，尚不适用于选择、复制等交互；正式实现必须更新相关元数据或在这些路径进入前刷新，不能仅复用屏幕字符串。此次实验只证明收益空间，不证明可直接发布。

终端为内存输出对象。未测真实终端程序的 CPU、真实 PTY、任意工具/图片历史、overlay、主题变化、会话切换、销毁、reload 或正式扩展/发布包集成。正文流式内容为受控夹具，没有模型联网请求。

宿主源码另已确认：普通模式的组件由原生 Container 挂载；全屏使用 createChatViewport 中的输入区 VStack，widget/status/footer 都有布局边界；setFooter/widget factory 接收稳定的 TUI Proxy，方法会随 renderer 切换转发。正式接入须利用这些真实边界，不沿用夹具硬编码行号，也不能把 handle 永久绑定到旧 renderer。

## Proposed acceptance budgets

以下用于实施切片审核，不是已通过的产品指标：

- 200 和 1000 对历史问答、尺寸稳定、正文不变、动画与 footer 更新的场景，在普通和全屏中均要求每帧 CPU 中位数至少下降 30%。重复实验在这些场景的收益高于此值，预留余量给正式注册与正确性处理。
- 0/200/1000 对历史的普通更新及不使用局部能力的场景，CPU 中位数额外开销不超过 `max(基线的 10%, 0.1ms/帧)`。绝对容差用于避免把短帧的计时波动变成很大的百分比；它在每秒 10 帧下相当于单核 0.1% 的开销上限。
- 用固定相同帧数、内容、尺寸及主题对比，预热、轮换顺序、多批采样；记录绝对 CPU 时间和降幅，不只报告百分比。不得通过减少刷新频率、漏更或改变显示达标。
- 所有动态帧正确性、正常更新优先、原版降级、生命周期和真实 PTY 验收同时通过才能交付。失败不得放宽阈值后宣称完成，应修复或回到 Planning。

## Verification ownership

普通模式切片承担正式 API、几何与失效、干净补丁安装和普通模式 CPU 验收；全屏切片承担布局元数据、模式切换、全屏 CPU 及组合验收。真实 token 采集和正文渲染优化不属于这些延期验证。
