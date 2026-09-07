# Codex reasoning UI prototype

## Question

在真实 Pi 中，把运行中的思考移到输入框上方的静态单行，完成后保留多行次要文字，是否比原先青色圆点与单行截断更清晰？用户已确认该布局，并要求状态下方保留一行空白。正式实现现已接入 `extensions/codex-ui/src/`。

用户已确认 `proposed` 的英文状态文案和左对齐布局，本轮接入 `production`。正式演示直接加载生产 extension，并在隔离配置中启用 `outputPad: 0`；真实 Pi 的同名设置需要另行应用，扩展不会自动修改用户配置。

## Landing map

- Target：输入框上方的 reasoning widget，以及原生 assistant thinking 历史块。
- Context：实际 Pi CLI、生产 Codex 工具渲染、编辑器、页脚、主题和正常 assistant Markdown。
- Contract：本地 provider 产生真正的 thinking/text/toolcall 流事件；真实 agent loop 执行白名单工具。生产状态消费公开生命周期事件，Markdown transformer 只改变显示，不修改会话内容。

## Run

```sh
# 正式实现：英文状态文案与左对齐，默认入口
pnpm run prototype:reasoning-ui
pnpm run prototype:reasoning-ui --variant production

# 用户确认过的原型参考
pnpm run prototype:reasoning-ui --variant proposed

# 冻结的旧版样式
pnpm run prototype:reasoning-ui --variant current

# 长正文、长标题与仓库锁定的 Pi
pnpm run prototype:reasoning-ui --scene long
pnpm run prototype:reasoning-ui --runtime repository
```

`production` 是默认变体，不拦截生产注册，不替换 transformer。`current` 保留原参数名，实际指修改前的冻结旧版，使用旧的 `outputPad: 1`；`proposed` 在同一冻结旧版上应用已确认的原型 composition，不代表正式代码。`production` 与 `proposed` 的隔离配置均使用 `outputPad: 0`。

打开后自动播放。操作提示使用英文，思考示例仍中英混排，用来检查中文宽度和换行。正式版与原型的固定状态均为 `Thinking`、`Preparing response` 和 `Running <tool>`；provider 返回的标题、正文不翻译。演示中的思考和比值都是固定 fixture，不是真实模型输出或性能测量。

- `/demo` 重播标准流程，`/demo long` 重播长内容。
- `Esc` 使用 Pi 原生取消流程，`Ctrl+O` 使用原生工具展开交互。
- `Ctrl+D` 在空输入框时退出。

默认优先使用 PATH 中实际安装的 Pi CLI，跳过 pnpm 注入的仓库 `.bin`；找不到可解析入口时使用仓库版本。`--runtime repository` 固定到仓库依赖。启动时打印真实版本，构建为 Pi/AI/TUI 创建指向所选运行时的模块链接，避免宿主与 extension imports 混用版本。类型检查和构建使用仓库 TypeScript 与 pnpm，不下载依赖。

## Isolation

配置、HOME、缓存、会话和真实工具写入均位于本目录 `.tmp/run-*`，退出后回收。不会读取用户 Pi 认证、加载全局扩展或连接模型网络。用户 Bash 被禁用，工具只执行精确匹配的 fixture 参数。不要向演示注入真实任务或凭证。

普通演示只写本次隔离目录；`--upgrade-smoke` 也只覆盖该目录中的临时构建，不修改安装目录或生产源码。CLI/expect 进程组由入口清理，不启动监听服务。

## Approved alignment

工具采用 `renderShell: "self"`，图标在第 1 列，标题在第 3 列。原生思考的 `outputPad: 1` 和原状态行的一个前导空格，让圆点、正文各向右错了一列。正式版已移除状态行前导空格，演示同时在隔离的 `agent/settings.json` 写入 `outputPad: 0`。实际会话的配置方法见 [Output alignment](../../README.md#output-alignment)。

```text
✓ Read metrics.json
  133 lines

• 我核对资料文件

• Thinking

[editor]
```

`outputPad` 是 Pi 的公共共享设置，同时影响用户消息、普通回复和思考，所以新布局中的普通消息也会左移一列，左右都不再保留原生的一列 padding。工具、编辑器内部 padding 和状态下方的空白行不变。不使用 ANSI 光标回退，也不修改宿主组件或全局设置。

退出之前打开的演示，再运行默认命令即可验证正式实现。启动器每次重新编译，旧进程的 `/reload` 不会重新构建本次源文件。

## Behavior and limits

生产状态使用公开 `setWidget`，按真实可用宽度截断。相同标题不请求刷新，同宽度结果缓存，主题变化正确失效，没有刷新定时器。状态下方保留一行无背景空白，隐藏时一起移除，不改变编辑器内部 padding。

历史仍由 Pi 原生 assistant thinking Markdown 渲染。流式时隐藏正文，assistant `message_end` 后显示多段内容；有正文时移除可识别的首标题，纯标题保留。生产版还保护代码围栏、列表等 Markdown 块的起始位置。取消后保留已有片段，原始 thinking 完整保存在会话中。

- 历史圆点和正文继承 Pi 的 `thinkingText` 与斜体，不是 Codex ratatui 的逐 span `dim` 复刻。
- Pi 原生容器仍拥有 block 顺序和 Spacer。空 Markdown 不会移除父容器空行；原生思考显隐快捷键及隐藏占位保留。
- 不重建 Codex 的 Ctrl+T transcript overlay，不修改上游、私有方法或模型请求。
- 静态状态不等于整帧 O(1)。宿主 message_update、工具计时、主题和 resize 仍可能请求绘制，长历史仍有遍历与排版成本。

## Validation

```sh
pnpm exec node --test prototypes/codex-reasoning-ui-prototype/infrastructure.test.mjs
pnpm run prototype:reasoning-ui:check
pnpm run prototype:reasoning-ui --variant proposed --smoke
pnpm run prototype:reasoning-ui --variant proposed --pty-smoke
pnpm run prototype:reasoning-ui --variant proposed --runtime repository --pty-smoke
pnpm run prototype:reasoning-ui --pty-smoke
pnpm run prototype:reasoning-ui --runtime repository --pty-smoke
pnpm run prototype:reasoning-ui --upgrade-smoke
pnpm run prototype:reasoning-ui --runtime repository --upgrade-smoke
```

- 原型与本轮正式落地均按 Red → Green 验证状态行错位、历史配置错位与中文固定状态。正式测试使用真实 `ToolExecutionComponent` 和 `AssistantMessageComponent` 比较图标及文本所在列，并断言原始中文 thinking 不变；PTY 对 `production` 和 `proposed` 都检查完成、缩窄和恢复会话后的对齐。
- 本轮仅复测确定性渲染约束，不重跑 CPU/GPU 性能矩阵。已有性能报告及 `--bench` / `--probe` 使用固定 `outputPad: 1`，不代表新配置下的完整性能测量。
- 本地检查覆盖原型 helper、真实 `AssistantMessageComponent`、所选生产注册、工具白名单、provider 流、取消和重播归属。生产状态的完整生命周期、样式与成本断言位于 `extensions/codex-ui/__tests__/reasoning*.test.ts`。
- Pi 0.84.3 与 0.85.1 的生产 CLI + expect PTY 验证均通过。覆盖真实 read/bash/write/edit、完整会话保存、长文、120→60 列 resize、Ctrl+O、Esc、重播、reload，以及退出后从同一持久化会话重新启动。
- PTY 用 headless terminal 解析实际 ANSI，验证静态标题没有粗体或斜体、状态下方空行没有编辑器背景。静止采样先等待真实标题，避免把启动或首标题延迟误判为动画。
- 升级验证先启动冻结旧版，在进程运行时覆盖临时 JS，再分别测试 `/reload` 与重启恢复。两版 Pi 都在 reload 后沿用旧模块，重启后才加载生产样式。因此升级应重启，不只执行 `/reload`。
- `.tmp/latest-smoke-<version>-<variant>.json` 和 `.tmp/latest-upgrade-<version>-<variant>.json` 保存最近的合成 ANSI 与模块清单，运行目录仍会回收。
- 未进行 Ghostty 窗口人工验收或 GPU 测量。已确认的视觉方案来自前期用户反馈，自动 PTY 验证不冒充人工体验。

## Performance

```sh
# 按相同条件分别运行，交替顺序复测
pnpm run prototype:reasoning-ui --variant current --bench
pnpm run prototype:reasoning-ui --variant production --bench
pnpm run prototype:reasoning-ui --runtime repository --variant current --bench
pnpm run prototype:reasoning-ui --runtime repository --variant production --bench

# 单独剖析长历史中的标题更新，不混入长正文完成阶段
pnpm run prototype:reasoning-ui --variant current --probe
pnpm run prototype:reasoning-ui --variant production --probe
```

基准复用已安装的 `prototypes/codex-ui-performance/` headless terminal。真实生产注册、工具行、Markdown、编辑器和普通模式 TUI 参与绘制；事件与帧边界由 fixture 明确驱动，不模拟模型网络延迟。

`--bench` 将每次结果独立写入 `results/`，记录版本、源码与 fixture 哈希、逐轮 CPU、同步耗时、终端解析 CPU、输出字节、全量刷新次数和固定历史重播的内存。每个场景 7 轮、前 2 轮预热；每次运行 105 个原始样本。输入测试测量同步 `handleInput → renderNow`，不是包含宿主调度等待的真实按键延迟。

`--probe` 将分阶段时间和 V8 CPU profile 写入 `.tmp/latest-probe-<version>-<variant>.json`。它用于定位宿主遍历与渲染成本，不代替非剖析基准。

冻结源码位于 `../codex-ui-performance/baselines/reasoning-before.json.gz`。最早的 84 样本报告用于探索，后续 105 样本报告补充了逐次变化的正文与双方均可见的纯标题场景，不能混合比较。实测结论、数据文件和未达成的强保证见 [施工计划的交付记录](../../docs/plans/codex-ui-reasoning.md#implementation-results)。

## Handoff

生产组件、增量标题提取和历史转换分别位于 `reasoning-status.ts`、`reasoning-title.ts`、`reasoning-history.ts`，由生产 `index.ts` 正常接线。本目录的 Proxy 仅用于已确认的 `proposed` 参考，它基于冻结的旧版工具源码，不进入发布包；fixture 和性能报告也不进入发布包。
