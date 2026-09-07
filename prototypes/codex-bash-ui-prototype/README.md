# Grouped Bash Prototype

## Question

当前原型中，`Bash` 标题向右缩进两格，与生产 `Read`、`Edited` 标签对齐；命令始终可见，收起时单行预览，结果默认折叠；`Ctrl+O` 展开完整命令与结果。用户已确认这一效果并要求更新生产，本目录继续保留为 fixture 设计参考。

默认入口仍只保留已确认的分组样式。历史上的四种布局变体、`/bash-logs` 和日志弹层不恢复。新增 `--polish` 隔离试验只比较两个辅助信息区域，见下节。统计与快捷键沿用英文；本次新增方案名称与操作说明使用已获用户确认的中文。

## Metadata Polish Experiment

原型只回答一个问题：保留 Bash 主体和全部统计信息时，精细排印、仪表式排版、轻底色按键，哪一种能改善两个辅助信息区域的精致感？在同一工具行中切换，观察数字与标签对比、分组间距、右侧留白和展开后的稳定性。

```sh
pnpm run prototype:bash-ui --polish
```

用户已选择方案 3，正式 `codex-ui` 已接入轻底色按键与辅助信息排印。默认打开截图对应的一条长命令 fixture，耗时为 `0.1s`，初始方案为轻底色按键。切换不会改变内容或展开状态。

| 入口 | 方案 | 变化 |
| --- | --- | --- |
| `Alt+0` 或 `/bash-polish 0` | 原版对照 | 返回接入前的冻结渲染器结果，包括原有 `1 commands` 文案 |
| `Alt+1` 或 `/bash-polish 1` | 精细排印 | 数字和按键用 `muted`，标签与单位用 `dim`，分隔点用 `borderMuted`；统计分隔点两侧各两格 |
| `Alt+2` 或 `/bash-polish 2` | 仪表式排版 | 标签在前、数字在后，组内一格、组间三格，其余沿用方案一 |
| `Alt+3` 或 `/bash-polish 3` | 轻底色按键 | 左侧沿用方案一，快捷键采用 `selectedBg` 轻底色，左右各一格，无字符边框 |

三种试验都将右侧提示和耗时内收两格；空间不足时优先保留正式命令预览，不缩短或重新换行命令。失败耗时保持原有警告色。窄屏可能隐藏标题右侧提示，底部控制说明仍可用。终端是等宽字符网格，不模拟网页的小字号、圆角、亚像素间距或不同字体。

### Landing Map

- `Target`：`extensions/codex-ui/src/bash-group-layout.ts` 的标题统计及右侧提示、耗时。方案 3 已在此正式实现，`tools.ts` 传入真实绑定的原始按键文本。
- `Context`：真实 Pi 0.84.3 CLI、生产 Codex UI、主题、工具组件、命令分支、预览截断、展开输出、编辑器和页脚。无需独立网页或模拟卡片。
- `Contract`：fixture 转为生产 `BashGroup`。方案 3 直接调用正式 `renderBashGroup()`，不再执行原型的 ANSI 尾部替换。原版、方案 1 和方案 2 使用 `src/original-bash-group-layout.ts` 中接入前的冻结副本；它只用于对照，不发布。通过真实 `context.invalidate()` 刷新，展开状态继续由 Pi 管理。

### Fixtures and Limits

`single` 复现截图中的长命令形态，但不会创建 commit。`mixed`、`success`、`long`、`edge` 可用 `/bash-scene` 切换。数据、计时与动画均为 fixture；超时与取消映射为生产支持的 `failed` 状态，截断标志也是 fixture。场景变化不改写初始会话。

三种方案均保留生产 Bash 标题、状态标记、命令内容、预览长度和展开输出。测试验证这些不变量；不宣称验证了字体抗锯齿、特定终端的颜色矫正或截图像素一致性。不要将截图里的外部圆角背景重新做成工具边框。

Context7 的 `/earendil-works/pi` 文档未锁定 0.84.3，本次接口以仓库安装的 0.84.3 类型声明及真实 CLI smoke 为准。[上游扩展文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)仅作接口说明参考。

### Checks and Handoff

```sh
pnpm run prototype:bash-ui:check
pnpm run prototype:bash-ui --polish --pty-smoke
pnpm run prototype:bash-ui --polish --pty-smoke --fullscreen
pnpm run check
```

排印差异测试和实际工具行切换测试分别先失败，再实现通过。原型共 19 项测试通过；普通与 fullscreen 两种真实 CLI smoke 均通过，额外检查四种样式切换、展开、场景、重播、缩放、reload 和正常退出。正式接入后的 `pnpm run check` 通过：693 项测试通过、1 项原有集成测试跳过，类型检查、构建和发布包校验通过。正式测试新增元信息样式、主体宽度保护、主题与缓存、绑定与展开状态覆盖；排印和绑定两项均先失败后通过。原有 1,800 行历史输出渲染测试继续通过，计时刷新不触发全屏重绘或历史重放；本次未做独立耗时或峰值内存基准，不宣称性能提升。本次测试启动的进程与运行目录已清理，未启动监听服务；用户自行打开的原型实例不作清理。美观程度仍需用户在自己的终端中判断。

元信息格式与间距规则已直接实现到正式 `bash-group-layout.ts`。正式实现只使用现有空白内收耗时，不改变命令可用宽度，也不增加输出扫描、计时器或整组二次渲染。未将原型的 ANSI 尾部替换、fixture adapter、控制区或离线入口迁入生产。按键提示跟随实际绑定，显式取消绑定时不显示虚构的按键；其余工具及 low-power 模式保持原样。以下章节保留默认分组原型的行为说明，不代表 `--polish` 的实现。

## Run

在仓库根目录运行：

```sh
pnpm run prototype:bash-ui
```

默认显示 mixed 场景，命令可见、结果收起。上方加入使用生产 renderer 的 `Read` 和 `Edited` fixture，便于直接比较标题对齐。入口使用仓库锁定的真实 Pi CLI，目前为 0.84.3，复用生产 Codex 主题、编辑器、页脚和对话布局，不使用网页模拟。

```sh
pnpm run prototype:bash-ui --scene success
pnpm run prototype:bash-ui --scene long --fullscreen
```

需要 Node.js 22.19+ 和仓库 `packageManager` 指定的 pnpm。依赖未安装时运行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
```

不需要认证或模型服务。命令和日志均为 fixture，不会真的执行。清空输入框后按 `Ctrl+D` 退出，入口自动清理本次临时目录。旧的 `--variant` 参数不再接受。

## Expansion and Spacing

### Collapsed

- 一行组标题，包含命令数量、状态统计和展开提示。`Bash` 从第 3 列开始，与 `Read`、`Edited` 的文字对齐。
- 所有命令始终显示，包括成功、失败、超时、取消、运行中和 pending。收起时按可用宽度单行显示，正文最多 120 个显示列，超出以 `...` 结尾，省略号计入宽度；多行命令在预览中将换行替换为空格。
- 结果默认全部折叠，包括错误摘要及运行中的最新输出；状态标记和耗时仍在命令旁显示。
- 截断警告属于捕获状态，折叠时仍保留，不隐藏或声称日志完整。
- 组内摘要连续排列，不添加空行。组与上方对话之间保留 Pi 自带的一行间距。

示意：

```text
✓ Read README.md
• Edited fixture.ts

  Bash · 3 commands · 2 succeeded · 1 failed     ctrl+o expand
  ├ ✓ $ git status --short                             0.2s
  ├ ✓ $ pnpm run check                                4.2s
  ╰ × $ pnpm test                               1.8s exit 1
```

### Expanded

按一次 `Ctrl+O`，在各命令后展开本次已捕获的全部输出；再按一次，收起结果，命令回到单行预览。不增加第三层展开，也不增加逐条快捷键。

- 完整命令只显示一次。多行或过长命令正常换行，不在输出前重复打印 `$ command`。
- 命令后立即接输出，不添加空行；原始日志自身的空行照常保留。
- 相邻命令块之间只加一条空内容连接线。
- 不逐条增加行数、超时配置等元数据尾行。执行状态与耗时保留在命令行旁。
- 无输出成功明确显示 `(no output)`；pending 和运行中无输出分别显示 `Queued` 与 `Waiting for output…`。
- 不对捕获输出进行第二次预览截断。长日志沿用终端滚动，fullscreen 模式使用 Pi 自带的对话滚动区域。
- 如果上游捕获已截断，仍明确显示 `Truncated capture`，不宣称完整日志可用。

以下示意省略了日志内容；原型展开时不省略已捕获的日志：

```text
  Bash · 3 commands · 2 succeeded · 1 failed   ctrl+o collapse
  ├ ✓ $ git status --short                             0.2s
  │      M extensions/codex-ui/src/tools.ts
  │     ?? prototypes/codex-bash-ui-prototype/
  │
  ├ ✓ $ pnpm run check                                4.2s
  │     Build completed
  │
  ╰ × $ pnpm test                               1.8s exit 1
        AssertionError: expected 80, received 81
```

展开状态归 Pi 管理。重播结束或切换场景不会自动收起用户已经展开的内容。`Ctrl+O` 沿用 Pi 的全局工具展开行为，不是针对当前光标所在的某条命令。快捷键提示读取宿主注入的真实绑定，不依赖扩展模块的全局默认值。窄窗口放不下组标题右侧提示时，底部仍保留操作说明。

## Controls

| 操作 | 入口 |
| --- | --- |
| 展开、收起全部工具详情 | Pi 当前绑定，隔离环境默认为 `Ctrl+O` |
| 切换测试场景 | `/bash-scene`，或 `/bash-scene single`、`mixed`、`success`、`long`、`edge` |
| 从头重播六秒进度 | `/bash-replay`，或 `Alt+R` |
| 暂停、继续重播 | `/bash-pause`，或 `Alt+P` |
| 暂停并推进一帧 | `/bash-step` |
| 直接显示最终结果 | `/bash-settle` |

底部实验控制区由原来的四行缩为两行，明确标注 `Scene` 与 `Playback`。这些只是测试数据和播放状态，不是新的 UI 变体。macOS Option 组合键如果不透传，使用斜杠命令即可，不需要修改用户终端设置。

## Scenarios

- `single`：截图形态的一条中文长命令与 `0.1s` 耗时，用于辅助信息细节比较。
- `mixed`：短输出、成功检查、失败测试。收起时为标题加三条命令，展开后才显示错误日志。
- `success`：三条命令全部成功。验证命令不会随结果一起隐藏，以及执行结束不会覆盖用户的展开选择。
- `long`：无输出成功、243 行构建日志、较长失败日志。用于验证全量展开与反复收起，观察长日志占据对话空间的代价。
- `edge`：多行命令、中文、组合字符、emoji、ANSI 输入、长 token、超时、取消及截断捕获。

`/bash-step` 从最终状态回到第 0 帧，随后逐帧观察 pending、running 和最终状态。场景切换停止重播；`/reload` 重新加载原型并恢复启动参数指定的场景。

## Landing Map

- **Target**：生产 `extensions/codex-ui/src/tools.ts` 的 Bash 工具区域，当前试验代码位于本目录 `src/renderers.ts`。
- **Context**：`src/composed.ts` 先运行生产 `codex-ui` 工厂，再只替换 Bash 注册，真实 Pi 继续负责外围消息、编辑器、页脚与终端布局。
- **Contract**：使用真实 `ToolExecutionComponent`、`renderShell: "self"`、展开参数、宽度参数及 `context.invalidate()`。固定的三个 fixture 调用在首个工具组件中绘制整组，其余组件返回空内容，真实 self-shell 路径不会留下空卡片。

## Real and Approximate

真实部分包括 Pi CLI、会话恢复、工具行组合、全局展开行为、键盘事件与终端刷新；还复用了生产 `ResponsiveLinesComponent`、宽度适配、主题及 Pi 的 Unicode 宽度计算和换行。

Fixture / approximation 部分：

- 命令、耗时、退出码、输出和六秒动画均为 fixture，不验证真实 Bash 进程或流式事件时序。
- 场景切换只更新显示层，不改写初始会话的工具结果，不能用导出的会话验证日志持久化。
- 分组只处理固定的三个调用，没有实现生产批次发现、跨轮次归属或恢复策略。
- 折叠时不读取或显示错误日志，展开后直接显示捕获原文；状态来自 fixture，不根据日志词汇推断。
- 截断场景没有完整日志文件，不提供假的文件链接。
- 尚未验证真实大流量输出的缓存表现、Ghostty/GPU 开销或全部终端兼容性。

## Isolation

每次启动都在本目录 `.tmp/run-*` 中创建独立 workspace、HOME、Pi 配置、会话、缓存和编译目录。只编译原型及其引用的生产源码，不读取或修改生产 `dist/`。

CLI 子进程不继承 API key、代理、用户 Pi 配置或父会话标识。启动禁用网络更新、telemetry、全局扩展、skills、prompt templates 和 context files，显式加载本地主题与扩展。仅对本次临时 workspace 使用 `--approve`，不会把信任写入用户配置。

隔离扩展注册 `bash-ui-fixture/fixture` 模型占位，避免无认证警告占据对话空间；其 `streamSimple` 直接拒绝调用，不访问网络。原型还拦截普通提示，阻止工具执行和用户 Bash 执行，不修改生产权限逻辑。

重播结束、场景切换及 session shutdown 会清理定时器。CLI 退出后删除本次临时目录，不修改用户全局扩展。

## Checks

```sh
pnpm run prototype:bash-ui:check
pnpm run prototype:bash-ui --pty-smoke
pnpm run prototype:bash-ui --pty-smoke --fullscreen
pnpm run check
```

原型检查包含类型检查、与真实生产 Read/Edited 的标题列对齐、结果折叠时不读取日志、所有状态命令常显、长命令单行预览与展开恢复全文、真实工具组件两态切换、长捕获输出完整性、窄窗口行宽和展开状态保持。

16 项原型测试、普通/fullscreen 两种真实 CLI PTY smoke 均通过。生产接入的独立验证见[当前施工记录](../../docs/plans/codex-ui-grouped-bash.md#current-revision-results)，不要将原型测试当作生产事件与缓存验证。

可选 PTY smoke 需要 `/usr/bin/expect`。它运行真实 CLI，验证收起、展开、重播、场景切换、resize、reload 和退出；检查终端输出标记与异常，不做像素截图比较。

## Handoff

此前生产分组曾按用户反馈回退。本轮标题右移、命令常显和结果默认折叠已获用户确认，并已要求接入生产。原型中的固定调用、耗时与退出码不是生产数据源；不要把 fixture controller 或隔离启动入口直接迁入生产。

生产继续采用先前确认的展开组底部实时计时，以避免离屏命令每秒变化造成历史重绘。原型用于样式交互参考，生产的分组归属、缓存、恢复及性能需要单独验证。
