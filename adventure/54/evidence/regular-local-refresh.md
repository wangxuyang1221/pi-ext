# Regular text region refresh

## Scope and implementation

本记录对应 [Implementation #61](https://github.com/wangxuyang1221/pi-ext/issues/61)，规格为 [#55](https://github.com/wangxuyang1221/pi-ext/issues/55)。实施基准 `3a19dfd39e067ac595d4a56717fc3a6bba9ab10b`，worktree 为 `pi-animation`，分支 `adventure/pi-animation`。Node v22.22.2、pnpm 11.9.0、Pi 1.4.0。

正式接口和可运行示例见 [API 说明](../../../docs/pi-text-region-refresh.md) 与 [text-region.ts](../../../examples/text-region.ts)。本关交付可选的 `registerTextRegion(component)`、合并请求及显式释放。普通正常帧通过已有 Container.mouseLayout 取得实际几何，稳定局部帧只调用目标 render，再复用宿主原有差异输出及光标处理。正常帧不维护全树组件缓存。

coding-agent 的稳定 Proxy 在 renderer 替换后重新登记有效句柄；停止的 renderer 释放自己的注册，已经 dispose 的句柄不会迁移。摘要补丁与实际 bin 到未打包 runtime 的转发保留。全屏本关正常回退，正式 Working 和 token 采样没有提前实施。

## Evidence sources

| Input | Production path | Expected result and boundary |
| --- | --- | --- |
| 明确文本、草稿、窗口尺寸与主题变化 | 真实 TuiMainScreen、Container、宿主 scheduler 和终端 writer | 局部与正常路径逐帧输出、保留行、光标一致；纯局部帧不 render 历史/输入。内存终端不证明终端模拟器像素。 |
| 实际键盘输入与扩展命令 | 真实 CLI bin、扩展加载器、widget/footer factory、当前 renderer、OS PTY | 单独及同帧目标更新、草稿/光标、overlay、行数、尺寸、主题、设置页模式切换、new/reload/quit。外部模型由生产 provider 边界的 faux provider 替代。 |
| 固定 0/200/1000 对消息 | 原版与补丁版真实 UserMessageComponent、AssistantMessageComponent、CodexFooter | CPU 预算与输出等价；受控正文不调用外部模型，不把 render 次数当 CPU。 |
| 仓库 manifest、锁文件及 patch | 空消费目录的冻结安装、真实 node_modules/.bin/pi | 锁文件字节不变、能力实际存在；原版仅去掉 patch 并保留相同锁定依赖，能力缺失且示例降级正常。 |

## Contract verification

[10 项契约测试](../../../test-support/__tests__/local-refresh.test.ts) 已通过。首轮在接口不存在时得到 3 个有效红灯，原因均为 `registerTextRegion` 缺失。实现后覆盖：

- animation-only、footer-only、同帧多目标的输出与光标等价，历史及输入 render 次数为零。
- 普通请求在局部请求之前或之后都优先；20 个局部请求合并为一帧。
- 一行/两行变化、宽高变化、主题 invalidate、树移除、图片、overlay 和变换容器的正常回退。
- 目标曾带光标标记时不保留旧光标；Unicode 与 OSC 8 链接保持正常输出。
- render 异常后重新正常渲染，不复用失败帧。
- 停止后的迟到请求无输出；100 次登记/释放后旧请求无输出，存活登记数不随已完成次数增长。
- 稳定 Proxy 在普通→全屏→普通切换后请求当前 renderer；全屏仍执行正常渲染。

原始日志位于 `.tmp/local-refresh/red.log`、`green.log`、`unit-2.log`、`unit-3.log` 和最终 `.tmp/local-refresh/check.log`。这组测试调用真实安装包，不通过实验入口或替换 renderer 源码实现被测行为。

## Installation and CLI verification

安装证据为 `.tmp/local-refresh/installation.json`，对应 `.tmp/local-refresh-install-CT3VmH/`。补丁版与原版均通过离线冻结安装，锁文件字节不变；补丁版能力探测为 true，原版为 false。首次原版使用重新解析的最小依赖清单，遇到 pnpm release-age 拒绝，因此改为从仓库锁文件去除 patch 映射，保留全部原有依赖版本；没有放宽该安全策略。

真实 CLI 旅程目前通过以下入口，每个入口 21 条检查：

- 仓库 bin，普通模式：`.tmp/local-refresh/pty-regular-5/`。
- 干净补丁版 bin，普通模式：`.tmp/local-refresh/pty-clean-regular/`。
- 干净补丁版 bin，全屏模式：`.tmp/local-refresh/pty-clean-fullscreen/`。
- 干净原版 bin，普通模式及双向模式切换：`.tmp/local-refresh/pty-original/`。

扩展后的 33 条检查版本另通过仓库普通模式 `.tmp/local-refresh/pty-expanded-regular-2/`、干净补丁全屏 `.tmp/local-refresh/final-clean-fullscreen/`、原版 `.tmp/local-refresh/final-original/`。它增加 6 轮真实 provider 响应，使历史超过视口，逐轮等待完整正文与 footer，另核对 dark→light 后目标单元格的实际颜色变化。

每次旅程包含输入中文草稿，在中间插入字符并通过公开 editor API 读回；动画继续推进时硬件光标不漂移。F7 打开真实 overlay 并保留草稿。窗口在 120×40、40×25、32×40 间改变。通过设置页切换 renderer 并读取实际保存的 `tuiMode`，随后检查重新挂载、`/new`、真实 reload 和 `/quit`。所有成功旅程退出码为 0，进程组已空，运行配置目录已删除，证据保留。

驱动早期失败来自两类观测问题，原始记录保留：启动项目信任提示尚未处理；PTY 的一次 read 只到达半帧。另发现 pyte 默认不模拟 1049 主屏/备用屏保存恢复，导致模式切回时显示伪残影。驱动补上实际终端的双屏状态后重跑通过，没有通过放宽产品断言规避。

## CPU verification

修改前已记录原路径 7×320 帧基线，见 `.tmp/local-refresh/baseline.json`。正式对比随后改用干净原版安装的完整消息组件链，并对两条路径执行相同的排队/刷新步骤。120×40、dark、50 帧预热与逐帧等价检查、每批 320 帧、7 批轮换。度量为进程 user+system CPU 毫秒/帧中位数。

最终一轮结果如下。正常内容更新这一轮还同帧发送两个局部请求，核验合并与正常优先的实际成本：

| History pairs | Workload | Baseline ms/frame | Patched ms/frame | Result |
| --- | --- | ---: | ---: | --- |
| 0 | animation + footer | 0.068444 | 0.075813 | passed |
| 200 | animation + footer | 0.593744 | 0.258188 | −56.5%, passed |
| 1000 | animation + footer | 3.081856 | 0.910431 | −70.5%, passed |
| 0 | normal + local requests | 0.119106 | 0.126666 | passed |
| 200 | normal + local requests | 0.602659 | 0.599012 | passed |
| 1000 | normal + local requests | 2.810928 | 2.743075 | passed |
| 0 | unused API | 0.068737 | 0.093831 | passed |
| 200 | unused API | 0.588900 | 0.585978 | passed |
| 1000 | unused API | 2.711719 | 2.842506 | passed |

[全部正式测量样本](regular-local-refresh-cpu.json) 保留三次同步测量及一次原生调度测量的每批 user/system CPU、墙钟时间、终端字节数和源文件哈希，未丢弃批次。工作目录原件为 `.tmp/local-refresh/cpu-final-{1,2,3}.json` 和 `cpu-paced.json`。三次同步动态帧的 200 对降幅为 55.4%/54.5%/56.5%，1000 对为 67.8%/68.2%/70.5%。前两次正常更新发送普通请求，第三次增加同帧局部请求。每一次的正常及未接入路径都满足原预算；三次中最大的中位数额外成本为 1000 对未接入路径的 0.205ms，低于该轮容差 0.271ms。

批间波动明确存在。最终一轮 200 对动态帧，原版范围 0.566–0.669ms，补丁版 0.248–0.311ms；1000 对分别为 2.716–3.511ms 与 0.866–1.001ms。零历史的单批值约 0.046–0.209ms，因此报告绝对值与原定 0.1ms 容差，不用短帧百分比宣称普遍提速。

80ms 补测用宿主原生 timer，每路径预热 50 帧，3 批×40 帧轮换，同内容/帧数/主题/频率。200 对的 CPU 中位数 7.756→2.670ms，下降 65.6%；1000 对 21.771→5.067ms，下降 76.7%。批次范围分别为 7.347–8.337/2.576–2.814ms、21.712–22.396/5.003–5.458ms。绝对值高于同步批次，保留两种方法的结果，不将事件循环下的进程 CPU 与同步渲染成本混为一谈。输出、光标与每批终端字节数均相同，未降频或减少绘制内容。

修改前基线和第一轮调优测量也保留在 `.tmp/local-refresh/baseline.json` 与 `cpu-first.json`。第一轮发现正常帧额外图片扫描接近预算后，将图片资格检查延至该保留帧首次局部使用，正式三轮采用的是最终 patch。

## Repository and regression verification

`pnpm run check` 已通过，197 文件、2908 测试；构建、全部类型检查、仓库文档/密钥检查、发布边界及 8 扩展 source/dist 加载通过，日志为 `.tmp/local-refresh/check.log`。既有 MCP 命令替换提示仍存在，没有加载错误。依现有 verify-pi-ext / verify-pi-codex-ui skill 运行受影响布局回归，未修改这些 skills：

- Doctor 确认独立 checkout、`sharedDependencies=false`、固定运行版本。tmux socket 长度超限提示仅针对未执行的 subagent 旅程，与本次 CLI/PTY 无关。
- codemode 真实 PTY：`.tmp/test-results/verify-codex-ui-IUS4zQ/`，passed，cleanup removed，process group stopped。
- 普通 CLI：`.tmp/test-results/codex-ui-cli-regular-1793243033755561000/`，124 项自动断言通过。
- 全屏 CLI：`.tmp/test-results/codex-ui-cli-fullscreen-1793243111227133000/`，124 项自动断言通过。

两种 CLI 均检查生产 composer/footer、主题落盘、resize、Markdown、真实工具文件结果及会话替换。`ui-header`、`ui-status`、`ui-theme`、`ui-resize` 的自动路径通过；`ui-composer` 的像素/拖选与 `ui-reply-markdown` 的系统剪贴板分支未执行，不能把自动检查记为整个行为索引全部通过。原有 Write/Edit 实际文件操作阶段的手动 Esc 边界也没有在本任务补证。这是本关回归，不能代替 #65 的完整维护和 #66 独立验收。

## Remaining boundaries

全屏局部优化、选择/复制与局部布局元数据由 #62 验证；正式 Working、真实 token 增量采样由 #63 实施。本关 PTY 与 ANSI 单元格检查不证明系统剪贴板、终端像素或真实鼠标拖选。没有修改全局 Pi，也没有运行外部模型服务。#64–#66 的验证 skill 建设、维护与独立验收尚未执行。

## Cleanup

全部已完成 PTY 的 summary 保存本次 PID、退出码、空进程组和运行目录删除结果。既有两个 CLI journey 各 5 个子进程也都记录 stopped/groupStopped，scratchRemoved=true。最终针对记录 PID 的进程及监听端口核验保存在 `.tmp/local-refresh/cleanup.json`。未启动监听服务。CPU 基准只有进程内内存终端，结束后释放注册与调度器。安装目录及原始日志位于本 worktree 的 `.tmp`，保留用于复核；用户的 `adventure/54/prototypes/` 文件和进程未操作。
