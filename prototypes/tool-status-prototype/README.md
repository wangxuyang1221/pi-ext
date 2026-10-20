# Tool status prototype

## Question

将 Bash、Read、Edit、Write 和 MCP 的左侧标记统一为静态大圆点 `⏺` 后，用户是否更容易辨认执行状态，同时仍能快速阅读各工具原有的内容布局？通过同屏比较五种工具、自动播放状态变化，以及检查批量调用的混合状态来判断。

## Landing map

- **Target**：Pi 对话历史中的工具调用标题行、流式结果和原生批量分组。正式落点是 codex-ui 的 Bash/Read/文件修改 renderer 和 MCP 的调用 renderer。
- **Context**：真实 `InteractiveMode`、codex-ui editor/footer、原有 Read 行号预览、Bash 输出、Edit/Write diff 和 MCP 结果摘要。没有重画独立的仿真终端。
- **Contract**：沿用 Pi 0.84.3 的工具注册、`renderCall`、`renderResult`、`ToolRenderContext` 和原生工具执行事件。默认参考原型的取消/超时分类由具名 fixture outcome 提供，不能用于证明生产识别规则。`--production` 改为加载当前正式构建，由正式 renderer 自行分类。

## Run

```sh
# Proposed style
pnpm run prototype:tool-status

# Pre-change baseline with the same fixtures
pnpm run prototype:tool-status --before

# Fullscreen
pnpm run prototype:tool-status --fullscreen

# Reference prototype unit tests and PTY checks
pnpm run prototype:tool-status:check

# Current built renderers, without prototype source patches
pnpm run build
pnpm run prototype:tool-status --production

# Production PTY matrix, including restart and persisted history
pnpm run tool-status:check
```

启动后自动展示五种工具的成功状态。界面文案沿用英文，Read 使用中文文件名检验对齐。常用操作：

| Command | Behavior |
| --- | --- |
| `/play` | 自动播放五种工具，Bash 分段输出，各工具错开结束，最终全部成功 |
| `/play mixed` | 自动播放五种工具，最终混合成功、失败、中断和超时 |
| `/play batch` | 依次播放 Read、Bash、Edit、Write、MCP 的三调用批量场景，每组包含不同结果状态 |
| `/play stop` | 停止播放，取消当前 fixture 与后续自动场景 |
| `/batch read` | 静态查看三个 Read 的真实分组；也支持 bash、edit、write、mcp |
| `/batch read mixed` | 查看同组成功、失败、中断；MCP 的第三项为超时 |
| `/batch read hold` | 批量停在执行中，随后用 `/finish` 手动结束 |
| `/demo all hold` | 五种工具并行停在执行中，等待手动结束 |
| `/finish success` | 执行成功，标记变绿 |
| `/finish error` | 执行失败，标记变红 |
| `/finish interrupted` | 中断 fixture，标记变黄并显示中断文字 |
| `/finish timeout` | 超时 fixture，标记变黄并显示超时文字 |
| `/demo all success` | 再展示一组成功结果 |
| `/demo all error` | 直接展示一组失败结果 |
| `/demo read hold` | 单独查看 Read；也支持 bash、edit、write、mcp |
| `/guide` | 查看操作提示 |
| `/quit` | 退出并清理临时 workspace |

Ctrl+O 使用原生工具展开/折叠。参数 `--before` 切换到改动前的基线，两种参考方案的 fixture 和宿主相同。原型不修改日常 Pi 配置；正式样式现已接入，构建后重启 Pi 加载。

`--production` 还可搭配 `--lowpower`、`--fullscreen` 或 `--mcp-only`。`--restart` 用于自动验收，第一次 `/quit` 后启动新进程恢复同一份隔离历史，第二次退出才清理。独立 MCP 模式不导入 codex-ui。

## Playback and batch behavior

`/play` 的变化来自 faux provider 的原生参数流、工具 `onUpdate` 和真实完成事件，不是通过循环重画图标实现。`playback.mjs` 每次只预约下一个脚本事件，停止和完成时清理定时器。Read、Edit、Write 仍实际操作隔离文件；Bash 和 MCP 的分段输出是有固定时间点的 fixture。

`/play batch` 一次播放一个工具类别，避免十五个调用同时挤在屏幕上。每轮使用同一 assistant message 中的三个相邻调用，完成后再播放下一类：

- Read 使用现有 `▸ Read 3 files` 分组，Ctrl+O 展开；每个文件保留独立状态、预览和错误信息。
- Bash 使用现有调用组，仍逐条显示命令与输出，不添加虚构的折叠标题。
- Edit、Write、MCP 当前没有同类折叠分组，显示三条相邻的原生调用；这不是新增 batch 卡片设计。

批量分类按每个 member 的 fixture outcome 取色，不能继承组内第一项的成功或取消状态。播放中的 `/demo`、`/batch` 和重复 `/play` 会提示先停止；`/play stop` 取消后可以重新播放。初始启动仍展示静态成功样例，在输入框执行 `/play` 开始。

## Proposed rules

- 所有工具使用同一个静态大圆点 `⏺`。标记占一列，后接一个空格，标题加粗。
- 参数生成、等待执行与执行中统一使用 warning，不再显示灰色等待圆点；成功使用 success，失败使用 error，中断和超时为 warning，并保留说明文字。内部状态及原有隐藏行不变，`--before` 仍保留改动前的样式。
- Bash、Read、MCP 的成功结果正文统一使用 `toolOutput`，原型中跟随原 Bash 使用的 `text` 亮灰，当前主题为 `#d6d6d6`。标题保持明亮，行号、连接线和截断提示继续弱化；不全局提亮 `dim`。错误、警告和 diff 增删配色不变。MCP 展开后的成功结果使用同一正文色。
- 状态标记不增加旋转、闪烁或秒级轮询。播放只有预定进度、完成事件和场景切换；Bash 输出里的测试勾号、Read 分组展开箭头、diff 增删标记不是左侧工具状态，不替换它们。
- 原型不重排各工具正文，也不把所有结果改成统一卡片。低功耗 Bash 仍保留原有分支缩进，仅替换状态标记。

## Real and fixture parts

默认参考原型从 Git 基线 `a5d430d3e586e5212606724332b1d7741869fc1d` 读取源文件，在仓库 `.tmp/` 中编译临时副本。需要本地 Git 对象包含此提交，浅克隆若缺少它需先获取对应历史。统一样式只替换标记、配色和标题，`--before` 原样编译；固定基线避免正式实现变化破坏已认可的视觉对照。替换锚点不匹配时直接报错。主题仅在参考新版的副本中将 `toolOutput` 改为 `text` 的颜色。

`--production` 不读取基线、不替换源码，直接复制当前 codex-ui/MCP 的 `dist/*.js` 和未改写的主题。正式实现让目标工具的正文使用 `text`，而不是全局改变 `toolOutput`，避免影响其他卡片。两种模式都不写入正式 `src/`、`dist/` 或主题文件，`pnpm run tool-status:check` 会先单独调用正式构建。

真实部分包括 Pi 的会话、工具生命周期、组件渲染、布局与主题，以及隔离目录中的 Read、Edit、Write 执行。Edit/Write 的 diff 来自真实文件修改。

模型由 Pi 的 faux provider 替代，只发送预定工具调用。Bash 输出和 MCP 服务响应是可分段投递的 fixture，不执行 shell、不建立 MCP 连接。fixture 将工具设置为 parallel，仅用于让五种执行中状态同屏出现，不改变正式执行策略。手动结束注入 success、error、interrupted 或 timeout，错误仍经过原生工具结果路径。默认参考原型补充 fixture outcome 来演示取消分类；正式模式禁用该主题代理，文件工具的取消使用真实预取消异常，Bash/MCP 使用已核验的宿主诊断句式。文件工具的模拟 timeout 没有原生契约，正式模式保留红色失败。实际 Bash 超时和本地 HTTP MCP 取消/超时另有生产执行测试。

入口使用隔离 HOME、agentDir、sessionDir、凭据存储和 workspace，不加载用户的扩展、skills 或上下文。网络 fetch 禁用，普通模型输入和用户 shell 输入被拦截。唯一文件操作限于 `.tmp/tool-status-*`，退出后清理。

## Verification and limits

已验证：

- 比较过 `⏺`、`•` 和 `●` 后，本版按用户要求换回最初的大圆点 `⏺`，搭配原 Bash 的亮灰正文。测试先确认旧 glyph 不符合预期，再修改实现；统一标记与单列宽度检查通过，状态配色和间距保持不变。
- 正文先试过 `#b8b8bd`，本版按用户要求统一为原 Bash 的亮灰 `#d6d6d6`。PTY 配色断言先失败再通过，覆盖 Bash、Read、MCP 正文；Read 行号和截断提示、MCP 连接线保持 dim，MCP 展开后正文色不变。
- 新版 regular/fullscreen 与旧版 regular 的真实 PTY smoke 通过。
- 新版同屏五种工具的成功标记均为绿色，执行中均为黄色，失败均为红色，中断和超时均为黄色。
- 手动 hold 场景等待 1.1 秒，屏幕内容保持不变；40/80/120 列缩放、Ctrl+O 与退出通过。后续按用户要求取消灰色等待态，并在每次 PTY 屏幕更新后检查圆点，覆盖参数生成阶段，不只检查 hold 画面。
- 新版 regular/fullscreen 的播放 smoke 通过，覆盖分段 Bash 输出、自动错开完成、五类批量场景、Read 批量展开和缩放、停止及退出。
- Read 混合分组首次 PTY 验证暴露了中断项错误继承红色的问题，改为逐 member 分类后通过。五类批量场景的三个最终标记分别为绿、红、黄。
- 离散事件播放与取消测试先失败再实现，验证进度顺序、结束后零计时器、取消后不再发事件，以及回调内取消。固定批量文件路径互不覆盖，拒绝未知场景。

正式实现及其独立验收已完成，见 [Tool status acceptance](../../docs/tool-status-acceptance.md)。正式矩阵补充了低功耗、独立 MCP、主题切换、reload 与新进程恢复历史，不依赖原型的颜色代理。

仍未验证真实远端 MCP、付费模型请求或任意第三方工具。状态标记没有新增计时器，但宿主既有的 terminal title spinner 仍运行，因此屏幕静止不等于终端完全没有 OSC 输出，也不是 CPU 性能基准。

使用 repo 固定的 Node.js 22.22.2、pnpm 11.9.0、Pi 0.84.3、TypeScript 5.9.3。Context7 未提供精确的 0.84.3 文档快照，API 以本地安装版本的声明和已有 SDK fixture 为准；参照 [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) 与 [extension rendering](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。

最新 `pnpm run prototype:tool-status:check` 的 5 个单元测试和五组 PTY 均通过。全仓检查的既有缺文件阻塞及最新测试数量统一记录在正式验收文档中。自动验收启动的原型进程及临时 workspace 已清理，没有启动监听服务；用户自行打开的原型窗口不在清理范围内。

## Handoff

这是一次性视觉决策工具。可直接采用的是状态映射、固定 glyph 和保留工具正文布局的决定。`status.mjs` 的纯渲染逻辑可作为正式 helper 的起点；临时源码替换、fixture outcome map、播放脚本、并行执行覆盖和 faux provider 不应迁入生产。

本目录默认仍重播原有圆点方案。正式 renderer 已更新为 `$` Bash、`@` Read、`~` Edit/Write 和 `⌁` MCP，成功前缀为 muted 灰色；`--production` 与 `pnpm run tool-status:check` 校验这一正式版本。各扩展仍可独立加载与构建。保留此目录用于历史视觉对照和隔离 PTY 验收，生产入口不得加载其中的播放脚本或执行覆盖。
