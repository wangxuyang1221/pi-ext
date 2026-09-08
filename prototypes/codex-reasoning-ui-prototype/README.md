# Codex reasoning UI prototype

## Production

默认 `production` 已采用用户确认的原位单行摘要。它直接加载正式 codex-ui，不使用原型 Proxy、不替换生产 transformer。

```sh
pnpm run prototype:reasoning-ui
pnpm run prototype:reasoning-ui --scene long
pnpm run prototype:reasoning-ui --runtime repository
```

打开后自动播放约 35 秒。每段连续 thinking 的第一个完整标题立即出现在原生消息位置，后续完整标题原地替换。Write/Edit 前连续更新标题，工具参数分四段到达，完成后不再补入思考正文。输入框上方没有思考 widget 或为它预留的空白区。

- `/demo` 重播，`/demo long` 检查长标题，`Esc` 使用原生取消流程。
- `Ctrl+O` 展开工具；`Ctrl+T` 保留 Pi 原生思考显隐及隐藏占位。
- 空输入框下 `Ctrl+D` 退出。
- 标题截断为一行，未闭合的新标题不覆盖上一条，无标题正文不充当摘要。取消、失败与恢复 session 使用同一规则，完整 thinking 仍保存在原始会话中。

默认优先使用 PATH 中实际安装的 Pi，跳过 pnpm 注入的仓库 `.bin`；`--runtime repository` 使用仓库依赖。入口打印实际版本，并让 Pi/AI/TUI imports 与所选 CLI 一致。

## Landing map

- Target：Pi 原生 assistant thinking 位置，通常位于前后工具调用之间。
- Context：真实 Pi CLI、生产工具渲染、编辑器、页脚、主题和回复 Markdown。演示在隔离设置中使用 `outputPad: 0`，生产扩展不修改用户配置。
- Contract：公开 Markdown transformer，仅由当前连续 thinking 内容和可用宽度决定摘要，不依赖实时消息身份或事件配对。

普通标题沿用原生思考样式；括号、方括号和反斜杠标题使用代码样式保留字面量，避免 Pi 的 LaTeX 识别吞掉标点。原生 Spacer 不在扩展控制范围，无标题思考仍可能留下宿主空行。正常新增工具、回复、resize 和显隐切换仍会改变布局。

模型输出、比值和时间间隔均是 fixture。read/bash/write/edit 在隔离 workspace 中真实执行，工具 preflight 额外延迟 1 秒用于观察执行阶段，不代表实际性能。交互入口使用正常速度，PTY 使用加速 fixture。

## Comparison variants

```sh
pnpm run prototype:reasoning-ui --variant inline
pnpm run prototype:reasoning-ui --variant fixed
pnpm run prototype:reasoning-ui --variant proposed
pnpm run prototype:reasoning-ui --variant current
```

- `inline`：已确认方案的原型参考，使用小型 fixture 的全快照标题扫描。正式实现已改用有界缓存与增量解析，不迁移原型 Proxy。
- `fixed`：上一轮固定输入框状态行。标题在工具阶段保留，回复或结束时清空，但固定一行状态和一行间距不消失；历史不显示思考，隐藏占位也为空。此方案未进入生产。
- `proposed`：更早的输入框静态状态与完成后多行历史方案，保留英文通用状态，基于冻结工具源码。
- `current`：最早的冻结旧版，保留原参数名与 `outputPad: 1`。它不是本次单行迁移的变更前基线。

`inline`、`fixed` 与 `production` 共享连续标题、慢速 Write/Edit fixture。旧状态组件只留在原型的 `src/legacy-reasoning-status.ts`，不会进入发布包。`fixed` 和 `inline` 仅支持交互、smoke 和 PTY，不参与旧版 bench/probe/upgrade 入口。

## Isolation

配置、HOME、缓存、会话、构建及工具文件均位于本目录 `.tmp/run-*`，退出后回收。不读取用户 Pi 认证、不加载全局扩展、不连接模型网络。用户 Bash 被禁用，工具只执行精确匹配的 fixture 参数。不要注入真实任务或凭证。

`--upgrade-smoke` 只覆盖本次隔离目录的 JS，不修改安装目录或生产源码。入口负责清理自己启动的 CLI/expect 进程组，不启动监听服务。不会停止用户先前打开的演示。

启动器每次重新编译。退出旧演示后运行默认命令即可查看新实现；旧进程中的 `/reload` 不会重新构建仓库源文件。生产更新也建议重启 Pi 并恢复会话，不只依赖 `/reload` 更新模块。

## Validation

```sh
pnpm exec node --test prototypes/codex-reasoning-ui-prototype/infrastructure.test.mjs
pnpm run prototype:reasoning-ui:check
pnpm run prototype:reasoning-ui --smoke
pnpm run prototype:reasoning-ui --pty-smoke
pnpm run prototype:reasoning-ui --runtime repository --smoke
pnpm run prototype:reasoning-ui --runtime repository --pty-smoke
pnpm run prototype:reasoning-ui --upgrade-smoke
pnpm run prototype:reasoning-ui --runtime repository --upgrade-smoke
# 对照入口同样支持 --smoke / --pty-smoke
pnpm run prototype:reasoning-ui --variant fixed --smoke
pnpm run prototype:reasoning-ui --variant inline --smoke
pnpm run prototype:reasoning-ui --variant proposed --smoke
```

生产单元和集成测试位于 `extensions/codex-ui/__tests__/reasoning*.test.ts`。使用真实 assistant/tool/editor 检查标题替换、工具参数更新、消息结束及工具完成时的行号；覆盖文字字面量、窄宽度、连续 thinking 块、取消/失败、树导航、缓存容量及稳定输入不再调用摘要转换。

生产 CLI/PTY 使用 headless terminal 解析 ANSI，检查真实工具、标准及长标题场景、resize、Ctrl+O、Ctrl+T、重播、取消、reload 和恢复 session。升级检查从本次迁移前的冻结生产源码启动，覆盖临时构建后 reload，再重启恢复并断言单行历史。证据保存到 `.tmp/latest-smoke-<version>-<variant>.json` 和 `.tmp/latest-upgrade-<version>-<variant>.json`。

没有进行本轮 Ghostty 窗口人工验收或 GPU 测量。用户已确认原型视觉方案，自动 PTY 不冒充人工体验。

## Performance

```sh
# 本次迁移前的生产快照与当前实现，保持相同负载
pnpm run prototype:reasoning-ui --bench --bench-baseline
pnpm run prototype:reasoning-ui --bench
pnpm run prototype:reasoning-ui --runtime repository --bench --bench-baseline
pnpm run prototype:reasoning-ui --runtime repository --bench

# 标题更新分阶段时间与 V8 CPU profile
pnpm run prototype:reasoning-ui --probe
```

基准复用 `../codex-ui-performance/` 的 headless terminal，真实生产注册、工具、Markdown、编辑器和 TUI 参与绘制。每场景 7 轮，前 2 轮预热；0 条历史与 20 条折叠/展开工具历史，各测正文追加、纯标题、长正文标题替换、同块追加标题、完成帧及稳定输入，共 126 样本，另做 30 次固定历史回放后 GC 内存采样。固定 `outputPad: 1`、120×40，用于与迁移前同条件比较，不代表全部显示设置。

结果独立写入 `results/`，含实际版本、源码及 fixture 哈希、CPU、同步耗时、最大帧耗时、ANSI 字节、全量重绘和内存。输入测量是同步 `handleInput → renderNow`，不包含真实按键调度或 GPU。

本次变更前源码为 `../codex-ui-performance/baselines/inline-reasoning-before.json.gz`，与更早的 `reasoning-before.json.gz` 区分。84/105 样本的旧报告不可混入本轮 126 样本比较。实现、原始文件与性能差异见 [Inline reasoning results](../../docs/plans/codex-ui-inline-reasoning.md#results)。

## Handoff

正式接线位于 `extensions/codex-ui/src/index.ts`，摘要与扫描器分别是 `reasoning-summary.ts`、`reasoning-summary-scan.ts`。旧 widget、生命周期状态和多行历史 helper 已移出生产。原型包装、fixture、快照及报告不进入发布包。
