# Bash CLI style prototypes

## Current production boundary

用户最终选择 Claude，正式接入与验收记录见 [Claude-style Bash implementation checklist](../../docs/plans/codex-ui-claude-bash.md)。下文保留试验过程与原有视觉对照。Hybrid 不跟随正式布局切换，改为依赖原型内的 `src/frozen-bash-group-layout.ts`；该副本保留原统计、命令树、耗时和默认隐藏输出的行为，生产不会导入它。

## Question

第三个变体要回答：把 Claude 的紧凑入口与现有 Bash 命令树结合，是否能去掉统计标题而不损失运行状态和长命令的可读性？在真实 Pi 中切换三个变体，重播运行状态，并展开长命令判断。

用户更喜欢 Claude 的方向，也希望保留现有主体。Hybrid 将 `▸ / ▾ Bash` 合入首条命令，单命令去掉分支，多命令保留树线；状态图标和耗时仍属于各条命令。默认不预览输出，展开复用生产命令换行与输出正文。运行时保留排队行，展开后的计时继续放在组尾，避免长命令换行随计时跳动。小于 32 列时允许标题独占一行，优先给命令留宽度。

## Landing Map

- `Target`：`extensions/codex-ui/src/tools.ts` 的 Bash `renderCall` / `renderResult`，最终生产修改候选为 `bash-group-layout.ts`。本次只在 `prototypes/codex-bash-ui-prototype/` 下增加隔离入口与 renderer，不修改生产默认效果。
- `Context`：仓库锁定的 Pi 0.84.3 CLI、生产 Codex UI 的编辑器、页脚、消息布局和主题；上方真实 Read/Edited renderer 渲染参考 fixture。
- `Contract`：真实 `ToolExecutionComponent`、`renderShell: "self"`、`context.expanded`、`context.invalidate()`、终端宽度。Bash 结果和运行帧使用具名 fixture，执行和模型请求禁止。Hybrid 通过适配冻结的 `renderBashGroup` 标题和边距接入，不重写正文渲染。

## Reference evidence

- 本机 `codex --version` 为 `codex-cli 0.154.0`。依据[同版本官方 renderer](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/tui/src/exec_cell/render.rs)核验普通命令路径：`Running` / `Ran`，成功绿点、失败红点，输出前缀 `  └ `，默认至多五个输出显示行，长输出保留头尾，中间显示 transcript 提示。详细 transcript 使用 `$ command` 和退出状态、耗时。搜索和读文件会走独立 `Exploring` 路径，不属于本次普通命令试验。
- 本机 `claude --version` 为 `2.1.236 (Claude Code)`。使用独立 HOME、CLAUDE_CONFIG_DIR、临时 workspace 和合成会话，配合 `--bare --resume` 只加载已结束的 fixture，未发送提示或执行命令。实际普通终端视图为 `⏺ Bash(command)`、`  ⎿` 输出、长输出前三行及 `… +N lines (ctrl+o to expand)`；错误结果显示 `Error: Exit code 1`；Ctrl+O 进入详细 transcript，显示全部 fixture 输出。日志保存在本任务 `.scratch/bash-cli-reference/`。
- [Claude Code 官方交互文档](https://code.claude.com/docs/en/interactive-mode#transcript-viewer)说明 Ctrl+O transcript、Ctrl+E show all，并区分普通与 fullscreen renderer。[官方仓库用户报告](https://github.com/anthropics/claude-code/issues/61118)中的 `Ran N shell commands` 合并摘要是另一种呈现条件；本次原型不声称覆盖全部 renderer、配置、实验开关或 live-session 分组行为。
- Context7 `/earendil-works/pi` 未提供 0.84.3 锁定文档；API 以仓库实际安装类型和真实 CLI smoke 为验收依据，0.85.1 官方扩展/TUI 文档作补充。

## Run

在仓库根目录、真实终端中选择一个入口运行，不需要认证、API key 或模型服务：

```sh
pnpm run prototype:bash-codex
pnpm run prototype:bash-claude
pnpm run prototype:bash-hybrid
```

三个入口进入同一个离线实验，初始风格不同。默认使用截图形态的单条长 worktree 命令。多命令可以启动时指定，也可以进入后切换：

```sh
pnpm run prototype:bash-codex --scene mixed
pnpm run prototype:bash-claude --scene long --fullscreen
pnpm run prototype:bash-hybrid --scene long
```

`--fullscreen` 是 Pi 宿主的全屏模式，不是 Claude Code fullscreen 样式的复刻。

| 操作 | 入口 |
| --- | --- |
| 切换 Codex / Claude / Hybrid | `Alt+1` / `Alt+2` / `Alt+3`，或 `/bash-style codex` / `claude` / `hybrid` |
| 折叠与全量输出切换 | `Ctrl+O` |
| 选择场景 | `/bash-scene single`、`mixed`、`success`、`long`、`edge`，或不带参数打开选择器 |
| 重播约六秒状态变化 | `Alt+R` 或 `/bash-replay` |
| 暂停 / 继续 | `Alt+P` 或 `/bash-pause` |
| 单步观察运行中 | `/bash-step` |
| 回到最终结果 | `/bash-settle` |
| 退出 | 清空输入框后 `Ctrl+D` |

如果 macOS 的 Option 不透传，使用斜杠命令，不需要更改终端设置。展开状态在切换风格和场景时保留；`/reload` 恢复启动参数指定的风格与场景。已经打开的旧版原型使用启动时的编译快照，需要退出后重新启动，才能看到新增变体。

## Hybrid behavior

单命令不再有独立统计行或多余树枝；多命令沿用现有树状主体：

```text
▸ Bash  ✓ $ git status --short                          0.2s

▸ Bash  ┬ ✓ $ git status --short                        0.2s
        ├ ◌ $ pnpm run check                            2.1s
        ╰ ○ $ pnpm test                               queued
```

- `▸ / ▾` 只表示折叠状态。`○ / ◌ / ✓ / ×` 分别表示排队、执行中、成功、失败；不会把折叠箭头当作运行指示。
- 默认隐藏输出，包括执行中的输出。`Ctrl+O` 展开完整命令和已捕获的输出，没有第二层预览。无输出时显示生产的 `Queued`、`Waiting for output…` 或 `(no output)`。
- 长命令默认占一行，超过当前宽度或 120 个命令显示列时省略；展开保留逻辑换行并自动折行，只在第一行显示 Bash 标题。不同状态不会自动收起已展开内容。
- 耗时的 `s` 统一右对齐，固定保留两列右边距，不再随命令长度取消内收。排队文本也使用同一右边界。渲染前预留边距，长命令折叠时提前省略，展开时完整换行；扣除边距后的正文区域不足 64 列时隐藏行内耗时。
- 执行中展开时将实时计时放在组尾，`9.9s → 10.0s` 不会改变命令换行。小于 32 列时标题单列一行，避免标题挤掉命令。
- 截断警告在折叠时也保留。超时、取消沿用生产的失败标记，展开读取 fixture 原文；不额外加入新的状态摘要。

重点观察长命令时，先进入 `/bash-scene long`。该场景包含超过 300 字符的单行命令、多行命令和长日志。`Alt+R` 重播，`Alt+P` 暂停，`Ctrl+O` 比较折叠与展开。若要固定观察运行中，从最终状态连续执行两次 `/bash-step`，停在第一条命令执行、后两条排队的帧；再次单步可观察输出陆续出现。

## Scope and approximations

原型界面沿用英文，启动和操作说明使用中文，用户已确认。原型不执行 fixture 命令，不读取个人会话或凭据，不调用模型，不改变全局配置。

真实部分是 Pi CLI、生产 Codex UI 周边、工具组件、键盘事件、宽度处理、刷新和退出流程。每次运行的 HOME、配置、缓存、会话和 workspace 均在原型 `.tmp/run-*` 中；退出自动删除。不启动监听服务。`dist/` 不是原型输入，也未手动编辑。

以下内容是 fixture 或 approximation：

- 命令、输出、状态、退出码、计时均为 fixture。重播不代表原生 CLI 的进程事件时序或动画；Codex、Claude 对照不显示待运行调用，Hybrid 保留排队行。`long` 的命令 fixture 在三个变体间共享，不改变原有分组原型的场景。
- 默认都没有独立 Bash 统计标题。Codex 默认展示命令及头尾输出；Claude 普通视图展示括号命令、前三行输出、错误红色文本。Hybrid 是本仓库的新设计，不是 Claude 的第三种原生视图。颜色映射沿用 Pi 主题，而非复制原生 CLI 的整个调色板；语法着色不在本次对照范围。
- 两种原生产品的 transcript 都是独立视图。本次为便于比较，使用 Pi 的全局 `Ctrl+O` 原位展开。Codex 原生 `Ctrl+T` transcript 快捷键没有移植，输出中的提示使用 Pi 实际绑定。未声称复刻原生 transcript 导航、时间戳或鼠标行为。
- Codex 全量模式使用 `$ command`、完整输出及退出状态/耗时；Claude 保留 `Bash(command)` 外形展开输出。长内容按 Pi 字符宽度计算预览，极窄窗口可能截短提示；不承诺与原生实现逐像素或逐行相同。
- 超时、取消、上游截断标记是 Pi 侧补充，避免把异常画成成功；不是全部原生状态的实机复刻。
- 仅首个 Bash 组件绘制本组 fixture，其余组件隐藏。这不是生产批次归属策略；切换场景只更新展示，不改写初始化会话。

## Checks

```sh
pnpm run prototype:bash-cli:check
pnpm run prototype:bash-ui:check
pnpm run prototype:bash-codex --pty-smoke
pnpm run prototype:bash-claude --pty-smoke
pnpm run prototype:bash-hybrid --pty-smoke
pnpm run prototype:bash-hybrid --pty-smoke --fullscreen
pnpm run check
```

CLI 原型独立检查包含类型检查和 13 项测试。Hybrid 合并标题、长命令场景、真实工具行的第三变体切换分别先失败，再实现通过。耗时固定对齐回归测试先复现长命令取消内收的问题，再修复通过，覆盖单条与多条、折叠与展开、长短命令、成功与失败、计时位数变化及不同宽度；同时确认形似耗时的输出原文不受影响。执行中计时稳定、排队行常显、流式输出、折叠不读取捕获、Unicode/窄屏和异常状态直接复用生产行为，新增回归测试通过。原有两个变体、实际快捷键和禁用模型/Shell 的检查继续通过；原有分组原型的 20 项检查也通过。

真实 CLI PTY smoke 验证三个启动入口、Alt+1/2/3 切换、展开状态、长命令折叠与完整恢复、排队/执行/结束、重播、窄屏、reload 和退出。Hybrid 在普通与 Pi fullscreen 均通过。仓库 `pnpm run check` 包含生产类型检查、1115 项通过测试、2 项原有跳过测试、构建和发布边界校验。独立原型测试不计入该生产测试数。本轮日志在 `.scratch/bash-hybrid/`，本轮测试进程和对应 `.tmp/run-*` 已清理，未启动监听服务。用户先前打开的原型实例保留，未作清理。

耗时对齐修复的日志在 `.scratch/bash-hybrid-alignment/`。本轮重新通过 13 项 CLI 原型测试、20 项原有原型测试、Hybrid 普通/fullscreen PTY smoke，以及完整 `pnpm run check`，生产测试数保持 1115 项通过、2 项原有跳过。修复仅涉及 Hybrid 原型，不改变正式 UI 或另两个变体。

## Handoff

用户选择继续试验 Claude 紧凑入口与现有主体的组合，第三变体已可在真实终端比较，但尚未设为正式默认。运行状态和长命令的展示检查通过，美观程度仍需用户判断。

可复用的是现有生产 `renderBashGroup` 正文、`ResponsiveLinesComponent`、真实工具 renderer 接口和隔离 launcher。`cli-hybrid.ts` 只在原型中移除统计标题、替换首个树枝并调整边距；生产接入时应直接实现确认后的布局规则，不迁移这层 ANSI 适配。固定调用、fixture controller、禁用执行的 provider 和实验控制区也不应迁入生产。真实事件驱动、分组归属、流式缓存、长期滚动性能应在正式实现中重新接线并验证。
