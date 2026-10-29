# Scoped refresh feasibility

## Decision supported

在 Pi 1.4.0 的普通与全屏渲染器上，可通过显式局部刷新请求，复用无关组件的上一帧结果。当前实验支持继续设计这种机制，不等于已完成可用补丁，也不证明完全跳过全局布局或所有逐行处理。

实验与用户目标对应：单个动态组件同时显示 Working 动画和 token 速率示例值。示例值由夹具提供，不连接模型，不是 token 采集实现。

## Sources and reproduction

- 代码基线：`31a7061ce853233bdeb8686487a35d03fb4c1e5a`。
- Node v22.22.2，pnpm 11.9.0，实际安装的 `@earendil-works/pi-tui@1.4.0`。
- [实验代码](../experiments/scoped-refresh.mjs)，[本次原始结果](scoped-refresh.json)。
- 在本场 worktree 运行 `node adventure/54/experiments/scoped-refresh.mjs`。
- 安装遵循冻结锁文件及忽略脚本。pnpm 11.9.0 的 strictDepBuilds 因被忽略的依赖脚本返回错误，最终仅对本次命令增加 `--config.strict-dep-builds=false`，仍使用 `--frozen-lockfile --ignore-scripts`。未执行这些依赖脚本，未修改全局配置或锁文件，自动写入的 allowBuilds 占位项已移除。hooks install/check 通过。

源码核验包括实际安装包的 `dist/tui.js`、`dist/tui-main-screen.js`、`dist/tui-alt-screen.js`、`dist/layout.js`、`dist/components/loader.js`。仓库现有隔离机制见 [宿主补丁说明](../../../docs/pi-session-summary-patch.md)。

## Experiment construction

使用真实 TuiMainScreen、TuiAltScreen、Container、VStack、ScrollView、Markdown 和宿主调度器。终端替换为收集输出字符串的内存对象，未启动真实 PTY。全屏通过夹具设置激活标志以直接驱动渲染器，不执行终端初始化。

夹具包含 200 个历史消息组件、嵌套在 widget Container 中的动态组件、带原生 CURSOR_MARKER 的输入行和 footer。对已知夹具组件的 render 方法进行内存包装，记录依赖和不同宽度的渲染结果；没有修改 node_modules 或产品源码。

普通请求重建缓存。局部请求只计算目标和已记录的父组件；其余命中缓存。目标行数改变、窗口宽高变化、目标不在缓存时回到正常渲染。覆盖层存在时也设计为回退，但本次未建立覆盖层案例，不列为通过。

第二组实验在真实 nextTick/timer 调度上合并请求。普通请求优先于局部请求，多个局部目标保留到下一帧。包装只存在于本次夹具实例，不是可供扩展调用的正式 API。

## Observed results

连续 60 个动态帧的确定性计数：

| Mode | Baseline history render calls | Candidate history render calls | Candidate dynamic render calls | Extra full terminal redraws |
| --- | ---: | ---: | ---: | ---: |
| regular | 12000 | 0 | 60 | 0 |
| fullscreen | 24000 | 0 | 60 | 0 |

输入行和 footer 在基线各调用 60 次 render，在候选各为 0 次。每帧最终行数组、终端输出与基线严格一致。普通模式共 4020 字节，全屏模式共 4440 字节，两条路径字节数和字节内容均相同。基线额外完整终端重绘也是 0；收益来自减少组件计算，不是减少此前已为差异输出的终端字节。

下列操作逐个与正常渲染基线比较画面和完整输出，普通和全屏均通过：

- 动态组件从一行增为两行，再缩回一行。
- 窗口宽度和高度分别变化。
- 正常请求更新输入、footer 和历史内容。
- 正常请求后继续局部动画。
- 正常移除动态组件后，旧目标请求不会使其重新出现。
- 一批 20 个局部请求合并为一帧。
- 同一帧更新两个不同局部目标。
- 普通请求先于或后于局部请求，都不会丢失普通更新。

结果包含一次 120 帧短耗时采样，仅为观察数据。Markdown 本身已有缓存，短运行、JIT 和系统噪声会影响结果，不能据此承诺 CPU 降幅或帧率提升。正式性能验收应使用代表性真实会话与重复测量。

## Boundaries and remaining work

已证明的是实际宿主渲染和调度上的一种可行算法。尚未实现或验证：

- 正式宿主 API、类型声明、扩展 factory 接入和能力检测。
- 如何在宿主边界建立可靠的组件依赖追踪，覆盖无法自动枚举子组件的自定义容器。夹具显式包装了已知组件，不能推导任意第三方组件都可自动缓存。
- 覆盖层、主题变化、滚动与选择、搜索、图片、会话切换、reload、异常以及销毁后的迟到请求。
- 真实 PTY 和完整 Pi InteractiveMode 的组合行为；当前不是用户界面端到端验收。
- 冻结安装 TUI 补丁、打包入口、全局宿主不受影响和原版能力降级。

候选仍运行原生最终组帧、光标、差异比较和全屏布局；不声称每帧成本只与刷新点大小有关。若用户要求严格局部布局和局部合成，则必须研究更深入的行区间或布局盒更新，当前证据不足。

## Candidate for user review

建议第一版提供显式注册的动态文本组件，用于状态行、widget 或 footer 的内容更新，普通和全屏都支持。尺寸保持稳定时复用无关组件结果；内容或窗口改变布局、普通消息或输入更新时允许正常渲染。扩展主动使用新能力，未接入的已有动画行为不变；原版宿主走原来的 requestRender。

这份建议尚未由用户确认。具体 API 名称、是否只允许固定高度、覆盖层等边界仍需设计，不将实验中的内存包装方式直接作为生产实现。

## Repository verification

2026-10-29 在本场 worktree 执行 `pnpm run check`，退出码 0。196 个测试文件、2913 个测试全部通过；构建、类型、仓库规则、秘密扫描、发布包检查及 8 个扩展的 source/dist 宿主加载通过。已有 MCP 命令替换提示仍存在，没有加载错误。

本次全量检查验证未破坏仓库基线，不代替上述尚未完成的正式补丁或真实终端验收。实验没有启动服务、真实终端或模型请求；检查进程已退出，未留下本任务运行的后台进程。
