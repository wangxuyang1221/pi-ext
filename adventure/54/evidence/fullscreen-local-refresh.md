# Fullscreen text region refresh

## Scope

Implementation #62，基于 `71d0e0588c319e10c5298d61b50643966a87678c`，沿用 #61 的 `registerTextRegion(component)`、`requestRender()`、`dispose()` 和稳定 TUI Proxy。正式 Working/token 采样仍由 #63 实现。

## Implementation

- `patches/@earendil-works__pi-tui@1.4.0.patch` 中的全屏 renderer 保留最后成功的真实 layout。区域路径按需从 layout 叶节点及原生 Container.mouseLayout 取得，正常帧不额外扫描历史或维护全树组件缓存。
- 同帧所有目标完成资格检查后，一并更新布局叶节点的 `lines`。直接所属 ScrollView 的 `scrollContentLines` 同步更新；宿主选择、复制和搜索读取更新后的文本。高度不变时保留已验证的 `rect`、`clip`、`lineOffset`、Container 鼠标边界及 ScrollView 状态。
- 根据实际叶节点位置、源行偏移及裁剪计算受影响屏幕行，通过原有 `paintBox`/`paintScrollbar` 合成。光标、搜索、选择、overlay、flash、图片和终端差异输出继续执行宿主流程；合成源行未变时复用其 ANSI/宽度处理结果。
- 宽高、目标高度、Container 修订、正常请求或失效帧触发正常渲染。图片、非文本控制序列、光标目标、横向布局、动态 visible 回调、复杂滚动祖先、变换容器及缺失几何回退。有效选择、搜索、overlay、滚动条拖动和鼠标捕获活跃时回退；空选区不阻止局部刷新。
- 已释放句柄、停止 renderer 和迟到请求保持 #61 契约。全屏 stop/reset 释放保留帧；正常帧替换局部路径缓存，组件索引使用 WeakMap，不积累逐帧记录。coding-agent patch 未修改，保留其会话摘要和 bin 转发。

API 与使用边界见 [正式文档](../../../docs/pi-text-region-refresh.md)。新增驱动在已有 `scripts/local-refresh-cpu.mjs`、`scripts/local-refresh-pty.py` 和 `test-support/fixtures/local-refresh/provider.ts` 上扩展，没有引入实验坐标或第二套公共接口。

## Contract and integration results

[正式契约测试](../../../test-support/__tests__/local-refresh.test.ts) 共 20 项通过。最初新增 dock/scroll 两个场景因仍 render 历史而失败，见 `.tmp/fullscreen-local-refresh/red.log`。后续动态 visible 场景先用独立复现器确认隐藏后仍留下旧区域，增加回退后复现器和正式测试通过。

| Behavior | Evidence and observed result |
| --- | --- |
| 独立与同帧目标 | widget/footer 分别请求或共同请求，输出、光标和布局快照与正常帧一致；局部帧历史和输入 render 为 0。覆盖固定 dock、滚动文档内目标及隐式全屏 root。 |
| 正常优先与原子更新 | 正常请求在局部请求之前/之后都包含最新草稿与目标；重叠父子注册正常回退；目标渲染期间 invalidate 回退；第二个目标抛错时不提交第一个目标的局部修改。恢复后读取新草稿和速率。 |
| 几何与资格 | 行数、宽高、主题、树挂载/卸载、变换容器、光标、图片、overlay、动态 visible、Unicode/OSC 8 均覆盖。通过真实边界与裁剪计算位置，无调用方坐标。 |
| 选择与复制文本 | 终端输入回调接收 SGR press/move/release，选区复制回调先得到 `Working 1`，文本更新后得到 `Working 2`。这是宿主复制数据证据，回调使用测试收集器，不是系统剪贴板证据。 |
| 搜索、滚动与鼠标命中 | 原生搜索输入 `Working 2` 得到一个结果，更新后零结果；鼠标滚轮保持非跟随位置，返回底部显示最新目标；dock 高度变化后点击的本地 x/y/height 正确。空选区恢复局部路径。 |
| 所有权与切换 | 旧句柄释放/停止后请求无输出，重启也不恢复注册。稳定 Proxy 双向迁移，首次建立几何后局部帧跳过历史。重复替换不会积累注册。真实会话、reload 和退出另外通过下述 CLI 路径。 |

完整最终检查为 `pnpm run check`：197 个文件、2918 项测试通过，包含构建、全部类型检查、仓库和密钥检查、发布排除边界、8 个扩展的源码及 dist 实际加载。日志 `.tmp/fullscreen-local-refresh/check-final.log`。单独的最终契约日志为 `contracts-visibility.log`。hook 检查通过，提交仍运行仓库门禁。

## Real CLI and PTY

输入由真实 PTY 发送，示例通过正式 widget/footer factory、稳定 TUI Proxy 和当前 renderer 更新；外部模型只在生产 faux provider 边界隔离。没有用内部 setter 代替这些用户旅程。内存契约和同步 benchmark 的内部帧读取/排队执行属于补充证据。

| Entry | Checks | Result | Local evidence directory |
| --- | ---: | --- | --- |
| 最终干净补丁 fullscreen | 40 | passed | `.tmp/fullscreen-local-refresh/pty-final-clean-fullscreen/` |
| 最终干净补丁 regular | 36 | passed | `.tmp/fullscreen-local-refresh/pty-final-clean-regular/` |
| 当前仓库 bin fullscreen，Kitty 声明 | 40 | passed | `.tmp/fullscreen-local-refresh/pty-kitty-complete/` |
| 干净原版 fullscreen，Kitty 声明 | 40 | passed | `.tmp/fullscreen-local-refresh/pty-original-kitty-complete/` |
| 干净原版 fullscreen，文本降级 | 40 | passed | `.tmp/fullscreen-local-refresh/pty-original-fullscreen/` |
| 干净原版 regular，文本降级 | 36 | passed | `.tmp/fullscreen-local-refresh/pty-original-regular/` |

各目录保存 `terminal.ansi`、`screens.json`、`actions.json`、生命周期事件和 `summary.json`。后两项原版文本旅程在最后的动态 visible 守卫之前执行；原版包和降级路径未改变，最终原版 Kitty 旅程再次覆盖双向切换及完整生命周期。

旅程覆盖 80ms 自动推进、动画/footer 独立与同帧值、中文草稿和硬件光标、保留焦点的 overlay、七次真实会话响应形成超过视口的历史、滚动到首尾及鼠标滚轮、原生搜索、拖选反色、真实 Image widget、行数变化、40/32/120 列、实际主题颜色、设置页双向模式切换、卸载后不复现、替换、new、reload 和 quit。退出通过进程正常结束验证演示 timer 已释放。

Kitty 路径保留真实 Image 组件输出的图片传输字节，pyte 只解析文本。最初补丁版和原版都在切回普通模式时误报 footer 缺失，原始 ANSI 中有 footer。驱动修正为等待 `2026` 同步帧结束后检查屏幕，保留原断言，两者全部通过。失败证据保存在 `pty-kitty-fullscreen/`、`pty-original-kitty/`，没有覆盖或删除。最终 `screens.json` 记录每次取样是否在完整同步帧之后及对应字节位置。

### Existing codex-ui regression

完整读取并使用已有 `verify-pi-codex-ui` skill 的受影响入口，doctor、共享 codemode smoke、普通和全屏正式 CLI 各 124 项断言通过。包含输入背景/主题/resize、footer、实际工具副作用、Thinking、inspect、历史恢复和配置行为；不代表所有人工分支已验证。

- `.tmp/test-results/verify-codex-ui-r2DtTn/`：真实 QuickJS、本地 MCP 与 codemode/inspect；wrapper 清理为 removed。
- `.tmp/test-results/codex-ui-cli-regular-1793244788295825000/`。
- `.tmp/test-results/codex-ui-cli-fullscreen-1793244865097510000/`。

这组回归在最后的动态 visible 守卫之前执行。该守卫仅影响显式局部请求的资格判断；当前 codex-ui 尚未接入本 API，正常路径未改变。最终完整 check、20 项契约、干净安装及上述最终 PTY 已在该修正后重验。没有提前执行 #64 的新 skill 创建、#65 维护或 #66 独立最终验收。

## Installation and reproducibility

Node v22.22.2、pnpm 11.9.0、Pi 1.4.0。通过 `pnpm patch` 提取、`pnpm patch-commit` 重建 patch 和锁文件，再运行冻结安装，未直接编辑安装目录作为交付。coding-agent patch 哈希仍为 `71d7f8b213a36b5bbd16941768f13e5bbbe7f712a52bcf0c878731f62588de57`。

最终干净消费目录为 `.tmp/local-refresh-install-2up97B/`，安装记录 `.tmp/fullscreen-local-refresh/installation-final.json`。补丁和原版均使用冻结、ignore-scripts、offline 安装，锁文件逐字节保持。补丁版探测 API 为 true，原版为 false；两个最终全屏文件与当前安装目录逐字节相同。真实 bin 已分别加载并执行上表旅程。

pnpm 11 的忽略构建脚本占位报错按已有规则用命令级 `strict-dep-builds=false` 处理，未执行依赖构建脚本；根 pnpm-workspace.yaml 未留下占位改动。锁文件只更新 pi-tui patch hash 及其引用。没有修改全局 Pi、配置、默认命令或升级入口。

## CPU results

原始数据见 [全部批次 JSON](fullscreen-local-refresh-cpu.json)。最终样本的 patch SHA-256 为 `e1cc02155684a3bd89a6e4fc1d3e1511fbf4adf8d72fbcd14c2a1513016bde14`。每个批次重新核对中位数、样本数、两条路径输出字节数和 patch 哈希，均一致。

### Synchronous batches

两种模式各三轮，每轮每场景 50 帧预热及 7×320 帧交替顺序。120×40、dark、相同真实 UserMessageComponent/AssistantMessageComponent、CodexFooter、内容和帧数。全屏使用宿主 createChatViewport。预热帧逐帧、正式批次末帧比较输出与光标；全屏还比较每个布局节点的 rect/clip/lines/lineOffset/scrollContentLines。

| Mode | History pairs | Baseline median range (ms/frame) | Region median range (ms/frame) | CPU reduction range |
| --- | ---: | ---: | ---: | ---: |
| fullscreen | 200 | 0.1513–0.1537 | 0.0856–0.0898 | 41.2–44.3% |
| fullscreen | 1000 | 0.3984–0.4017 | 0.0732–0.0949 | 76.3–81.6% |
| regular | 200 | 0.5699–0.5852 | 0.2517–0.2594 | 55.1–55.8% |
| regular | 1000 | 2.6994–3.2964 | 0.8738–0.9090 | 67.0–72.7% |

200/1000 对历史的全部动态场景满足至少下降 30%。下面按三轮中的最大额外中位数列出正常路径预算，预算值取该轮对应原版基线，负数表示改善。

| Mode | History pairs | Workload | Maximum extra median (ms/frame) | Allowed extra for that run |
| --- | ---: | --- | ---: | ---: |
| fullscreen | 0 | streaming-and-animation | 0.0083 | 0.1000 |
| fullscreen | 0 | unused-api | 0.0188 | 0.1000 |
| fullscreen | 200 | streaming-and-animation | 0.0120 | 0.1000 |
| fullscreen | 200 | unused-api | 0.0354 | 0.1000 |
| fullscreen | 1000 | streaming-and-animation | 0.0193 | 0.1000 |
| fullscreen | 1000 | unused-api | 0.0291 | 0.1000 |
| regular | 0 | streaming-and-animation | 0.0092 | 0.1000 |
| regular | 0 | unused-api | 0.0087 | 0.1000 |
| regular | 200 | streaming-and-animation | -0.0121 | 0.1000 |
| regular | 200 | unused-api | 0.0036 | 0.1000 |
| regular | 1000 | streaming-and-animation | 0.0721 | 0.2741 |
| regular | 1000 | unused-api | 0.1067 | 0.2657 |

### Native scheduler

80ms 节奏，每场景预热 50 帧，3×40 帧交替顺序。使用同一 API 排队及宿主 timer，不以 renderNow 代替局部帧。

| Mode | History pairs | Baseline (ms/frame) | Region (ms/frame) | Reduction |
| --- | ---: | ---: | ---: | ---: |
| fullscreen | 200 | 5.0812 | 1.2927 | 74.6% |
| fullscreen | 1000 | 12.1659 | 1.4549 | 88.0% |
| regular | 200 | 7.4813 | 2.1502 | 71.3% |
| regular | 1000 | 19.6812 | 3.9592 | 79.9% |

### Variance and development evidence

同步与 timer 样本的绝对 CPU 不可混用。timer 样本包含实际 timer 调度和运行时成本；JSON 保留每批 user/system、CPU 与 wall time、字节数，可检查批间波动。最终三轮全部场景通过，没有仅选最佳轮。进程 CPU 不包括终端模拟器或模型服务。

最初扩展基准时，Conda 的 stdin 捕获使一次脚本修改未执行，该次 baseline.json 实际仍为普通模式，已排除为全屏证据。随后修正正式 --mode 入口，单独测量固定的干净原版全屏基线。初版全屏对照在 200 对历史只下降 23.1%，未通过。复用未变行的 ANSI/宽度处理后通过一次；继续按真实 dirty rows 复用宿主绘制，避免重绘未变滚动条行。所有开发批次及被排除的普通模式原始样本均保留在 JSON，后续复现动态 visible 回调隐藏组件时的旧显示，增加正常回退并再次完整测量。修正前的三轮和 timer 数据保存在 priorFinalBeforeVisibilityFix；最终三轮和原生调度器全部使用最终 patch。

## Cleanup and boundaries

最终 `.tmp/fullscreen-local-refresh/cleanup.json` 核对 23 个记录 PID，均不存活，监听查询为空；所有 PTY 进程组及 codex-ui 旅程子进程均报告停止，各运行时配置/scratch 已移除。CPU 和检查命令均结束。保留 `.tmp/fullscreen-local-refresh/`、安装消费目录和 test-results 中的原始证据，不清理其他任务目录或用户 prototypes。

仍未验证的物理边界交给 #66：真实终端像素、实际鼠标拖选手感、系统剪贴板粘贴内容，以及 Kitty/iTerm2 等真实终端图片像素和协议实现。PTY 主动关闭 copy-on-select，没有修改系统剪贴板；ANSI 单元格和宿主复制回调的通过不能替代这些检查。当前图片路径证明的是资格回退、协议输出和文本共存。

本关没有实现正式 Working 或真实 token 统计，也没有对复杂交互组件承诺局部优化。#63 继续正式接入并重验组合成本；#64/#65/#66 可直接复用上述正式脚本及 API 文档。Implementation #62 的 Acceptance 和关闭由主代理处理。
