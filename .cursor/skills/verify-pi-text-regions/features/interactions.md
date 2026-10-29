# Interaction boundaries

动态文本更新时，编辑器和对话框仍可用，搜索/选择读取最新文本，复杂画面按正常路径刷新。自动单元格、协议证据与物理终端验证分别报告。

## Sub-features

- `interaction-focus`：输入、overlay、窗口和主题变化保持焦点与内容。
- `interaction-transcript`：全屏历史滚动、搜索、选择反色与动态区域共存。
- `interaction-image`：Image 文本降级及 Kitty 传输字节触发正确回退。
- `interaction-physical`：实际像素、拖选、系统复制粘贴及真实图片显示。
- `interaction-network`：真实远程 provider 的 Working/速率链路，独立于离线夹具。

## How to get to it (user POV)

示例自动运行时编辑草稿，F7 打开 overlay、q 关闭；生产 Working 旅程 F8 打开 input。全屏 Ctrl+Home/Ctrl+End 浏览历史、鼠标滚轮滚动、Ctrl+Shift+F 搜索、鼠标拖选。`/fixture-image` 挂载真实 Image，`/fixture-image off` 移除。物理终端使用自己的正常选择/复制操作；原版和补丁版都须可用。

## Driving it with local-refresh-pty

Preconditions:

- Launch/Doctor 通过。复用 [regions](regions.md) 与 [working](working.md) 的两个模式完整运行，不要删减旅程。
- 人工入口另外需要可操作的真实终端、其名称/版本与协议记录；剪贴板写入必须有当前会话授权，未授权时先报告缺项，不改全局设置或剪贴板。

- **Focus and fallback.** regions 两入口的 draft/overlay/theme/resize screens，以及 working 的 active input/permission frames，证明对话框拥有焦点、草稿和动态显示共存。overlay/搜索/有效选区不承诺局部快路径。
- **Scroll and search.** fullscreen 示例旅程增长七轮历史，Ctrl+Home 到 Response 0，SGR wheel 改变视口，Ctrl+End 回 Response 6；Ctrl+Shift+F 搜索 `Response 0` 得到 `1/1`。选择动态行产生反色单元格，更新仍推进。actions 保存实际转义输入；settings 设置 `fullscreenCopyOnSelect=false`，没有系统复制。
- **Image protocol.** `conda run -n codex-py312 python scripts/local-refresh-pty.py "$RUN/regions-kitty" --cli "$PWD/node_modules/.bin/pi" --mode fullscreen --kitty`。要求 ANSI 有 Kitty `a=T` 传输和推进的动态目标。未加 kitty 的两模式要求 `[Image: [image/png] 1x1]` 文本降级。原版独立运行同命令并换 CLI、加 `--original`。
- **Layout data.** `pnpm_config_verify_deps_before_run=false pnpm test test-support/__tests__/local-refresh.test.ts` 补证最新复制 callback 文本、搜索结果更新、鼠标命中、滚动、复杂容器/图片/异常帧正常回退。这些不是物理拖选或系统剪贴板的证明。
- **Physical terminal.** 执行 [manual terminal recipe](../references/manual-terminal.md)。两模式检查 spinner/文字、窄屏、输入插入点、滚动、遮挡及选择。获准后复制更新后的目标文字到本次 workspace 的文本文件，比对实际内容；兼容图片终端检查真实 1×1 图像及文本无错位，保存终端截图和版本。不可见的 1×1 像素需放大截图观察，不能把 ANSI 传输当作像素通过。
- **Remote provider.** 在已授权、隔离配置且有可用凭据的真实终端启动正式 codex-ui，不加载 faux provider；用正常 prompt 观察正文/thinking/tool 参数带来的 `≈` 速率、无输出过期、settled 隐藏。保存脱敏的事件/操作/终端证据、provider/model、网络成功与费用授权范围。缺凭据或外部授权时记录 `unverified`，不要把离线通过改称联网通过。

## Gotchas

pyte 只模拟文本单元格，不能画图片像素，也不能评价真实字体、拖选手感或系统剪贴板。宿主复制 callback 只是文本数据。图片协议支持、操作终端权限、剪贴板授权、远程凭据任一缺失，记录对应入口 `unverified`、缺项和续验步骤并交 #66 协调；不得自行豁免为完整通过。不要为了性能验收停止用户终端或原型。
