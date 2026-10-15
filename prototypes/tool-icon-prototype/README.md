# Tool Icon Prototype

## Question

在真实 Pi 工具记录中，Bash 使用 `⌘`，Read、Edit、Write 和 MCP 使用 `⚙︎`，配合状态变色，是否比圆点更易辨认且耐看？通过自动播放和重复播放观察，不改正式 UI。

## Landing Map

- Target：`extensions/codex-ui/src/tool-status.ts`、`bash-group-layout.ts`、`tools.ts`，以及 `extensions/mcp/src/renderers.ts` 中的工具前缀。
- Context：真实 Pi InteractiveMode、codex-ui 的工具分组、结果预览、编辑器和主题。
- Contract：沿用原有 pending、running、completed、failed、interrupted、timed_out 状态，以及原有工具 renderCall/renderResult 生命周期。

## Run

```bash
node prototypes/tool-icon-prototype/demo.mjs
```

打开后自动播放成功场景。`/play mixed` 播放混合结果，`/play batch` 播放各工具的分组场景；`/play stop` 停止，`/play` 重播，`/quit` 退出。支持 `--fullscreen`。`--before` 显示原有圆点和颜色，用于对照。

## Status Symbol Variant

```bash
node prototypes/tool-icon-prototype/demo.mjs --symbols
```

独立选择 `$` Bash、`@` Read、`~` Edit/Write、`⌕` MCP 搜索的前缀方案。保留工具名和真实结果布局。成功前缀为 muted 灰色 `#85858a`，等待和运行黄色，失败红色，中断和超时黄色；失败文字和 diff 等正文仍按原有方式显示。播放命令与默认原型相同，包括 `/demo all error`。不传 `--symbols` 仍是原有 `⌘ / ⚙︎` 方案。

本场景只有搜索类 MCP fixture，所以使用 `⌕`；不据此决定所有 MCP 工具的正式分类。

## Subagent Variant

```bash
node prototypes/tool-icon-prototype/demo.mjs --symbols --subagent
```

打开后自动播放六类调用：spawn、prompt、list、read、wait、close。调用前缀为 `󱙺`，即 Nerd Font 的 `nf-md-robot_outline`，码点 `U+F167A`。终端需配置包含该字形的 Nerd Font；缺字时可能显示方框，PTY 检查不能验证实际字体外观。等待/运行黄色，成功灰色，失败红色，wait 超时保持黄色。agent 自身的 running、settled、closed 等状态颜色不变。

- `/agents mixed`：重播混合状态，包含失败和 wait 超时。
- `/agents success`、`/agents error`：全部成功或全部失败。
- `/play`：切回原有工具演示；`Ctrl+O` 展开详情；`/quit` 退出。
- `--before --subagent` 可对照原有圆点；支持 `--fullscreen`。

Landing Map：目标为 `extensions/subagent/src/renderers.ts` 的调用标题。默认复用评审基线的 subagent renderer 与 layout、Pi 原生工具生命周期及周边界面，在临时编译副本中替换标题图标和成功颜色。正式源码现已适配机器人图标。增加 `--production` 时直接加载当前 subagent 源码，不做图标补丁；其他工具仍采用原型基线。六类操作的输入、结果和延迟由 `subagent-demo.mjs` 提供，未加载 subagent runtime，不启动子代理、tmux 或外部服务。

验证：`conda run --no-capture-output -n codex-py312 python prototypes/tool-icon-prototype/subagent-smoke.py` 检查自动播放、六类调用、运行/成功/失败/超时颜色、展开、重播和退出。增加 `--production --restart` 验证正式 subagent renderer 的主题切换、reload 和持久化历史恢复；可再加 `--fullscreen`。该验收只验证展示及恢复，不验证真实子代理派发和通信。

## Implementation

从提交 `9be165c2cb38862e1d3eb6729724ba1af9b7c272` 加载原型评审时的源码，在仓库 `.tmp/` 内生成隔离模块，替换图标，并将成功图标改为主题的 muted 中性灰，其他状态色不变。复用 `../tool-status-prototype/runtime.mjs`、`scenarios.mjs`、`playback.mjs` 的真实宿主和播放流程。不会修改 `src/` 或手工修改 `dist/`。

模型响应、Bash 输出和 MCP 结果为 fixture，不连接网络，不执行 Shell。文件操作只作用于隔离 workspace。退出后删除临时目录。动画是原生工具状态转换及流式结果播放，图标本身不旋转、不闪烁。

成功图标使用 muted 中性灰，当前主题为 `#85858a`。其他状态沿用现有实现：等待和运行黄色，失败红色，中断和超时黄色。仅修改工具前缀，不覆盖主题的 success 色，因此 diff 新增行等绿色内容不变。不改生产状态模型。

## Verification

已通过：

- `node --test prototypes/tool-icon-prototype/prepare.test.mjs`，状态图标和颜色断言。先确认旧圆点导致失败，再实现替换后通过。
- `conda run --no-capture-output -n codex-py312 python prototypes/tool-icon-prototype/smoke.py`，真实 PTY 中检查自动播放、图标及颜色、五类工具分组、重播、停止和退出；`--fullscreen` 和 `--before` 也通过。
- `pnpm run check`，2652 个测试通过、13 个跳过，类型检查、构建、发布包及宿主检查通过。

已确认两类图标可在真实渲染路径中随状态变色，生产布局和分组无需重写。审美选择仍需用户实际观察；PTY 检查不验证字体的像素外观。`⚙︎` 使用 U+FE0E 请求文本显示，但不同终端可能仍有字体回退差异。没有测试 subagent、goal 等非工具状态 UI。

当前依赖为 Pi 0.99.1。Context7 仅提供邻近的 0.99.0 文档，具体 SDK 接口以本地 0.99.1 文档、示例和已运行的现有原型为准。测试进程已退出，临时 workspace 已清理；原型不监听端口。

## Reuse and Cleanup

可复用图标分类和颜色决定。正式实现已在源码中按工具类别传入符号，不使用原型的源码替换。对照原型固定到评审时的提交，因此不用于验证当前生产源码；正式验收使用 `pnpm run tool-status:check` 和 `pnpm run web-search:check`。删除本目录即可移除原型，无配置安装和外部服务。
