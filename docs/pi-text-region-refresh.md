# Pi text region refresh

## Scope

仓库为 Pi 1.4.0 提供可选的 `registerTextRegion` API。普通与全屏模式可复用上一帧的历史与输入内容，只计算请求更新的文本组件，然后沿用宿主的差异输出和光标处理。全屏同步布局叶节点文本及直接所属 ScrollView 的内容，选择、复制和搜索读取同一份最新文本。

补丁由 [pnpm-workspace.yaml](../pnpm-workspace.yaml)、[锁文件](../pnpm-lock.yaml) 和 [pi-tui patch](../patches/@earendil-works__pi-tui@1.4.0.patch) 固定。[coding-agent patch](../patches/@earendil-works__pi-coding-agent@1.4.0.patch) 保留会话摘要能力，并让稳定 TUI 引用在 renderer 切换后重新登记区域。仓库 bin 继续通过原有摘要补丁加载未打包 runtime，见 [宿主入口说明](pi-session-summary-patch.md)。

这项能力不采集 token，不改变 codex-ui 的默认 UI。示例中的速率是受控演示值。

## Contract

```ts
interface TextRegionHandle {
  requestRender(): void;
  dispose(): void;
}

interface TUI {
  registerTextRegion?(component: Component): TextRegionHandle;
}
```

- 调用者注册通过 widget/footer factory 返回的同一个组件，并按原有方式挂载它。注册不挂载组件，不提供坐标，也不立即绘制。一个组件应只挂载一次。
- 首次正常渲染取得真实行范围。快路径支持未经变换的原生 Container 链及全宽文本组件；全屏使用真实布局叶节点及其 Container 几何，支持固定 dock 和直接由 ScrollView 持有的文本叶节点。横向布局、带动态 visible 回调的布局及复杂嵌套滚动布局回退正常渲染。组件可输出 SGR 样式和 OSC 8 链接。组件的 `render` 应遵循原有同步、可重复调用契约。
- `requestRender()` 只表示该组件的文本可能变化。多个区域、同一区域的重复请求按宿主原有 16ms 最小渲染间隔合并，不新增独立调度器。普通 `requestRender()`、`requestImmediateRender()` 和 `renderNow()` 优先，整帧包含所有目标的最新内容。
- 其他组件内容改变时仍调用普通刷新。`invalidate()`、窗口变化、Container 的 `addChild/removeChild/clear` 会使局部帧失效。直接修改 `children` 数组或修改任意未注册组件后，应照原有契约请求普通刷新。
- 目标行数变化、图片、光标标记、其他终端控制序列、overlay、不支持的容器或无有效几何时执行正常渲染。全屏有有效选区、拖选、搜索、滚动条拖动或组件鼠标捕获时也正常回退；普通点击结束后的空选区不阻止局部刷新。高度变化不会抛出新增的布局错误，也不会丢弃目标内容。原有 render 错误继续传播，失败帧不作为后续局部帧依据。
- `dispose()` 幂等，释放注册和待处理请求；随后请求不产生刷新。它不负责移除已挂载组件。组件的 `dispose()` 应释放句柄及自身定时器，再通过现有 UI API 移除组件。
- renderer 停止后，其直接注册句柄失效，重新启动该实例也不会复活旧句柄。widget/footer factory 接收的稳定 TUI 引用会在模式切换后将仍有效的句柄迁移到当前 renderer。已释放句柄不会迁移。会话切换和 reload 仍应通过组件销毁释放注册。
- 每个存活注册保留一条容器路径和固定大小的几何信息。普通 renderer 复用原有上一帧行数组，局部合成临时复制行数组。全屏保留最后成功帧，在局部请求时按需定位区域，同时更新叶节点、滚动内容和受影响的布局屏幕行。鼠标边界、裁剪和滚动位置在高度不变时保留；最终合成源行未变时复用 ANSI/宽度处理结果。正常帧不额外维护全树组件缓存，不保存逐帧历史。滚动文档内目标仍可能产生随文档长度增长的数组复制。

## Example

[可运行示例](../examples/text-region.ts) 通过真实 `setWidget` 和 `setFooter` factory 登记两个区域。它每 80ms 更新演示动画和速率，正常宿主关闭或会话重载时释放 timer 和 handle。

在仓库根目录安装依赖后运行：

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec pi --tui-mode regular -e ./examples/text-region.ts
```

输入 `/region-demo pause` 保留当前内容并暂停自动推进；随后使用 `animation`、`footer`、`both` 单独或同时更新。`height` 在一行和两行间切换，`stop` 移除演示，`start` 重新挂载并开始自动推进。

扩展应按示例能力检测，不要求用户替换全局 Pi：

```ts
const handle = tui.registerTextRegion?.(component);
const refresh = () => {
  if (handle) handle.requestRender();
  else tui.requestRender();
};
const dispose = () => handle?.dispose();
```

未补丁宿主执行普通刷新，保留显示和交互，缺少的仅是 CPU 优化。发布 pi-ext 包不会把本仓库 `patchedDependencies` 传播给消费项目；需要补丁的外部项目须显式配置这两个固定版本的 patch。示例、测试和本次证据不进入现有发布包。

## Verification

[契约测试](../test-support/__tests__/local-refresh.test.ts) 使用真实 renderer，比较终端输出、保留行和光标。运行：

```bash
pnpm test test-support/__tests__/local-refresh.test.ts
```

[安装驱动](../scripts/local-refresh-install.mjs) 在仓库 `.tmp` 内创建补丁版和原版消费目录。两者使用仓库锁定的相同依赖版本，原版只移除 patch 映射；安装使用 `--frozen-lockfile --ignore-scripts --offline`，校验锁文件未变化及能力探测结果。pnpm 11 因忽略构建脚本产生的占位配置只存在于临时消费目录，不执行依赖脚本。驱动打印目录及 CLI 路径，保留日志用于后续 PTY 和 CPU 验证。

```bash
pnpm exec node scripts/local-refresh-install.mjs
```

[PTY 驱动](../scripts/local-refresh-pty.py) 启动指定的真实 CLI bin，加载示例与[离线 provider](../test-support/fixtures/local-refresh/provider.ts)。用户输入、设置页、会话、扩展加载与两个 renderer 都使用生产路径；只有外部模型服务由宿主 faux provider 替代。每次使用新的证据目录：

```bash
conda run -n codex-py312 python scripts/local-refresh-pty.py .tmp/local-refresh-regular --cli node_modules/.bin/pi
conda run -n codex-py312 python scripts/local-refresh-pty.py .tmp/local-refresh-fullscreen --cli node_modules/.bin/pi --mode fullscreen
conda run -n codex-py312 python scripts/local-refresh-pty.py .tmp/local-refresh-kitty --cli node_modules/.bin/pi --mode fullscreen --kitty
```

将 `--cli` 换成安装驱动返回的补丁版或原版 bin 即可检查实际消费入口；原版另加 `--original`。驱动通过键盘修改设置页，读取落盘设置核实模式切换；pyte 扩展模拟主屏与备用屏保存恢复。退出后检查本次进程组已空、删除本次运行配置，保留 ANSI、screen、操作和生命周期日志。它不启动网络服务。

普通模式使用终端自身的滚动及选择/复制。全屏 PTY 通过键盘滚动、SGR 鼠标滚轮/拖选和原生搜索，检查动态文本共存及反色单元格。真实 Image widget 验证文本降级；`--kitty` 只声明协议能力并检查实际图片传输字节，pyte 不绘制图片像素。PTY 设置 `fullscreenCopyOnSelect=false`，不修改系统剪贴板；契约测试另验证鼠标选区经过宿主复制回调时的文本。物理终端像素、拖选手感和系统剪贴板仍须独立人工验收。

## CPU budget

[CPU 驱动](../scripts/local-refresh-cpu.mjs) 对比干净原版与当前补丁版的真实消息组件，使用 120×40、dark 主题、0/200/1000 对历史、相同动态文本与 CodexFooter。每路径先预热并核对 50 帧，默认 7 批、每批 320 帧轮换顺序；逐批报告 user/system CPU、总 CPU 每帧中位数、字节数，并断言画面及光标相同。`--mode=fullscreen` 使用宿主 `createChatViewport` 的真实 transcript/dock 布局，额外比较每个布局节点的边界、裁剪、文本及滚动内容。

CPU 夹具读取构建后的 CodexFooter，先运行 `pnpm run build:codex-ui`。将安装驱动返回的原版 pi-tui 目录传入：

```bash
pnpm exec node --expose-gc scripts/local-refresh-cpu.mjs --baseline=.tmp/INSTALL_ROOT/original/node_modules/@earendil-works/pi-tui
pnpm exec node --expose-gc scripts/local-refresh-cpu.mjs --mode=fullscreen --baseline=.tmp/INSTALL_ROOT/original/node_modules/@earendil-works/pi-tui
```

默认同步执行已排队的帧，用于隔离 renderer CPU；不把 `renderNow()` 冒充局部刷新。加入 `--interval=80 --pairs=200,1000 --workloads=animation-and-rate --frames=40 --samples=3` 可复验真实调度器的 80ms 节奏。两条路径的内容、帧数、节奏和主题相同；本工具不测终端模拟器自身 CPU，也不调用外部模型。

200/1000 对历史动态帧中位数须至少下降 30%。0/200/1000 的正常更新和未注册 API 路径，额外中位数须不超过 `max(原版 10%, 0.1ms/帧)`。超出预算时进程退出码为 1。应单独运行 CPU 测量，保留所有批次，报告噪声及绝对值，不只选择最佳批次。

## Maintenance

修改 patch 时使用 pnpm 的提取和提交流程，随后重新执行冻结安装、契约测试、两种模式及原版 PTY 和 CPU 测量。保留 coding-agent 的摘要补丁及 bin 转发；只修改已安装 node_modules 不能形成交付。升级 Pi 时单独验证接口、调度、Container 的实际布局记录及模式切换。上游有等价能力后，再移除本补丁和相应降级适配。

已验收的普通模式结果见 [普通模式证据](../adventure/54/evidence/regular-local-refresh.md)。全屏实现及普通模式复验见 [全屏证据](../adventure/54/evidence/fullscreen-local-refresh.md)。
