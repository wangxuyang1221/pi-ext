# Read UI Prototype

## Question

同一组 Read 记录使用哪种布局，更容易扫读且不挤占对话空间？在真实 Pi 会话中切换布局、展开内容并缩窄终端来判断。

## Run

在仓库根目录运行：

```bash
pnpm run prototype:read-ui
```

打开即有三条连续读取记录，无需登录。默认显示方案 1。

- `/read-style 0` 到 `/read-style 6`，或 `Alt+0` 到 `Alt+6`，切换现有记录。
- `/read-color cyan|soft|blue` 切换文件名颜色，不改变布局、目录或预览颜色，方案 0 保持原样。
- `Ctrl+O` 使用宿主的全局展开/收起。
- `/read-replay` 模拟三秒读取中状态，不执行工具。
- `Ctrl+D` 在输入框为空时退出。

| Number | Layout |
| --- | --- |
| 0 | 当前仓库的真实 Read 渲染器 |
| 1 | 极简日志，一行摘要 |
| 2 | 文件卡片，文件名与目录分层 |
| 3 | 内容预览，默认前三行 |
| 4 | 合并读取，一行一个文件 |
| 5 | 活动时间线，节点与目录细线 |
| 6 | 合并读取与预览，每个文件最多三行预览，长行截断 |

直接对比方案 4 与 6：

```bash
pnpm run prototype:read-ui --scene batch --variant 6
```

在 TUI 中使用 `/read-style 4` 和 `/read-style 6` 来回切换。方案 6 缓存前三行文本前缀，每行最多提取 512 字符，按终端宽度截断而不换行；另有一行余量提示。展开沿用最多 80 行的详情。不代表整个原型已完成性能优化或基准测试。

其他场景与全屏模式：

```bash
pnpm run prototype:read-ui --scene single
pnpm run prototype:read-ui --scene long --variant 2
pnpm run prototype:read-ui --scene error --variant 4
pnpm run prototype:read-ui --fullscreen
```

终端不支持 Alt 数字键时使用斜杠命令。方案 4 和 6 只在多文件场景显示分组标题。切换场景需重新启动；`/reload` 回到启动时指定的方案。

## Filename Colors

默认 `soft`。在 TUI 中执行：

```text
/read-color cyan
/read-color soft
/read-color blue
```

- `cyan`：主题 `accent`，当前主题为 `#5EFCFF`。
- `soft`：柔和青色 `#8ABFC4`。
- `blue`：灰蓝色 `#9DB5CE`。

切换方案时保留颜色，`/reload` 和重启恢复 `soft`。仅对方案 1–6 的文件名生效，方案 0 始终保留生产样式。方案 6 不加粗文件名；方案 2 保留原有加粗。

两种新增颜色使用固定 truecolor ANSI 色值，仅用于视觉比较，不修改主题文件；不提供 256 色终端的专门降级。

## Landing Map

- **Target**：`extensions/codex-ui/src/tools.ts` 的 Read `renderCall` / `renderResult`。
- **Context**：真实 Pi 会话中的用户消息、助手文本、Read 记录及未修改的 Edit 渲染，沿用 codex-ui 的输入框、页脚与 `themes/codex-pi.json`。
- **Contract**：保留 `read` 工具定义和 `renderShell: "self"`；接受真实宿主传入的参数、结果、错误标志、展开状态与行级失效回调。方案 0 直接调用生产渲染器。

## Isolation

`src/composed.ts` 加载生产 codex-ui，只拦截 Read 注册。`demo.mjs` 启动仓库锁定的 Pi 0.84.3 CLI，并在本目录 `.tmp/` 下生成会话、HOME、配置、缓存和构建结果。正常退出与信号退出后删除本次目录。

模型、工具、用户 Shell 执行均被阻止。启动环境不继承用户认证与 Pi 配置，启用 offline，fixture provider 的请求方法直接抛错。不启动服务器或监听端口，不修改正式默认样式。

## Fixtures And Limits

- 文件路径、31 行策略文本、局部读取结果、截断标记和错误来自 `src/fixtures.ts`，不代表本地文件当前内容。
- 用户消息、助手文本和 Edit 结果也是 fixture；它们使用真实生产渲染器。
- 方案 4 和 6 的连续关系由当前场景明确给出，是 approximation。没有实现跨消息发现、流式分组或混合工具拆组。
- `/read-replay` 是显示状态模拟，不验证真实 Read 的执行时序。
- 方案 3 收起时显示前三行，展开最多显示 80 行并标明余量；完整路径在展开后可见。
- 所有方案使用宿主的全局展开，没有实现逐文件独立展开。
- 长路径的摘要按终端宽度裁剪，展开后换行显示完整路径。极窄终端会省略元数据，以避免越界。
- 截图中的圆角灰色外框不是本原型的基准实现；方案 0 严格使用仓库当前渲染路径，不另外仿造外框。
- 运行版本为仓库锁定的 Pi 0.84.3。当前主会话的 Pi 0.85.1 尚未运行此原型。

## Verification

```bash
pnpm run prototype:read-ui:check
pnpm run prototype:read-ui --pty-smoke
pnpm run check
```

布局测试使用真实 `ToolExecutionComponent`。已按 Red → Green 验证单行切换、卡片/预览/分组/时间线差异、分组四行摘要；同时检查错误、读取范围、截断、pending 与 1–160 列的宽度约束。

PTY smoke 使用 macOS `/usr/bin/expect` 启动真实 CLI，验证七种布局、三种文件名配色、分组预览展开/收起、模拟读取、缩窄、重新加载与正常退出。

已验证布局可以接入现有工具行且支持切换。哪一种最易读，仍需用户在自己的终端中判断，测试不替代视觉选择。

## Reuse

可直接复用 fixture、测试和隔离启动入口继续做设计比较。正式实现应按最终选择把排版移入生产 Read 渲染器；分组、逐文件交互、图片及完整流式状态需要在目标系统中重新设计和验证。不要把原型的固定分组或执行禁用逻辑移入生产。

## API Evidence

Context7 返回的是 [Pi 主分支文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)，没有提供 0.84.3 专用版本。实际接口按安装版本的 `dist/core/extensions/types.d.ts`、`dist/modes/interactive/components/tool-execution.js` 及随包文档核验，并通过该版本的真实 CLI 测试。
