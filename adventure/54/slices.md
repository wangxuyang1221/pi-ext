# Implementation slices

Status：Superseded draft。用户新增 codex-ui 实际 Working 动画与 token 速率显示，旧草案中的“不采集真实 token、不改默认 UI”已失效。本文件仅保留此前切分供参考，暂停审核；完成 Planning #58/#59 后重写完整切片并重新审核，不创建 Implementation Issues 或派发 worker。

规格与共同预算见 [Spec #55](https://github.com/wangxuyang1221/pi-ext/issues/55)，设计依据见 [CPU 调查](evidence/render-cpu.md)。列表按依赖排序，当前两关共享补丁与接口，依次实施，不并行。

1. 普通模式可用的动画与 footer 局部刷新能力。
2. 同一能力在全屏模式可用，完成组合验收。

## Slice 1: Local refresh in regular mode

- goal: 扩展在仓库补丁版 Pi 的普通模式中，可分别更新 Working 类文本动画和 footer 速率，降低它们带来的额外 CPU；未补丁宿主仍可正常显示。
- in_scope: 正式可选宿主 API 与类型、区域注册/请求/释放契约、真实组件几何与失效、合并调度和正常请求优先、普通模式保留帧路径；pnpm 固定补丁与加载入口；通过真实 widget/footer factory 的可运行示例、CPU 基准和文档。必要时小范围调整 coding-agent，保持已有摘要补丁。全屏在本关可明确走正常回退。
- out_of_scope: 全屏局部优化、实际 token 采集、默认 UI 改造、正文增量渲染、任意复杂组件的自动优化、全局 Pi 改动。
- dependencies: none。
- acceptance: 普通模式真实扩展入口中，动画、footer-only 和多个局部目标输出正确；正常更新交错、尺寸/行数/主题变化、卸载、reload、停止、overlay 等安全回退与生命周期通过。200/1000 对真实消息组件的动态帧 CPU 中位数至少下降 30%；0/200/1000 对历史的正常路径及未接入路径额外 CPU 不超过 max(10%, 0.1ms/帧)。同帧数/内容、预热、多批轮换测量，保留输出等价和确定性局部计算断言。通过真实 PTY、干净冻结安装、仓库 bin 实际加载、原版能力降级及 pnpm run check。执行计划细化输入组合、噪声处理和几何测试，不放宽 Spec 预算。
- boundaries: API 不暴露私有坐标或实验字段；只缓存正式所需帧/区域，资源不随帧数无限增长；布局不可靠时正常渲染，不忽略更新。能力须能由稳定 TUI 引用调用，不永久绑定旧 renderer。保留原版功能及现有补丁；只在本冒险 worktree 施工。全屏正式增强与整体模式切换由 Slice 2 验收，但本关的回退必须可用。

## Slice 2: Local refresh in fullscreen mode

- goal: 同一个扩展调用方式在全屏也降低动画/footer 的额外 CPU，用户可在两种模式间切换且显示与交互保持正确；完成整场交付验收。
- in_scope: 全屏区域几何、保留帧与布局元数据同步、窗口变化、滚动/选择复制/搜索/overlay/图片等快路径资格和回退；模式切换后的当前 renderer 绑定、会话和 reload 隔离；全屏 CPU 与两模式组合验收、发布/安装与文档收尾。
- out_of_scope: 正文持续输出优化、真实 token 统计、动画设计、任意复杂交互组件的局部渲染承诺、PR/合并/部署。
- dependencies: Slice 1，沿用其公共契约；若必须改变对外行为或切片范围，回到 Planning 和用户审核。
- acceptance: 真实全屏 widget/footer 输入来源经过生产 API 与宿主路径，动态目标独立或同帧更新正确；保留帧不能造成旧选择/复制内容、错位点击、滚动或光标错误。全屏 200/1000 对历史动态帧 CPU 至少下降 30%，正常路径额外 CPU 不超过 max(10%, 0.1ms/帧)；复验普通模式预算与正确性。通过真实 PTY 的普通/全屏切换、输入草稿、历史增长、复杂视图回退、卸载/reload/会话切换/停止；原版降级和干净冻结安装仍成立，pnpm run check 通过。最后一个 worker 按 Spec 全部 Acceptance 完成整体验收和临时资源清理，协调者核对证据。
- boundaries: 不能仅更新屏幕字符串而留下过期布局元数据；不靠降帧或少显示内容取得性能收益。基准和用户交互都必须通过，不把区域实验的硬编码坐标视为正式能力。全局 Pi 不变，远端冒险分支保留。只有本关及整体证据充分后才提交用户确认完整交付。
