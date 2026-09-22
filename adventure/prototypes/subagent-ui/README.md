# Subagent UI comparison

## Question

保留六类工具消息的信息结构后，统一状态符号、文字层级和结果缩进，是否让 subagent 与周围的 codex-ui 更协调？请在同一终端对照原版与候选版，并查看展开与窄屏。

本原型属于 [Planning #27](https://github.com/wangxuyang1221/pi-ext/issues/27)。用户已确认制作范围，尚未确认视觉方案。

## Run

在本冒险 worktree 中运行：

```sh
cd /Users/wangxuyang/Code/t3code/pi-ext/.scratch/u
pnpm exec node adventure/prototypes/subagent-ui/demo.mjs
```

启动默认展示用户选回的 /after 布局，成功文字绿色从 #4dff88 小幅调暗为 #40d672，并保留真实 codex-ui Read、Bash 作为参照。

- `/quiet`：历史暗灰方案，成功状态文字使用 dim #77777d，与后续元信息同色。
- `/neutral`：选项 1，成功状态文字使用正文色 #d6d6d6。
- `/soft`：选项 2，成功状态文字使用灰绿 #8fb89b。
- `/before`：追加原版六类消息。
- `/after`：当前方案，沿用原候选布局，成功文字绿色微调为 #40d672。
- `Ctrl+O`：使用 Pi 原生折叠/展开。
- `/demo all hold`：观察六类工具进行中，再输入 `/finish success` 或 `/finish error`。
- `/demo all error`：观察六类失败消息。
- `/demo wait timeout` 与 `/demo wait interrupted`：观察等待超时和中断。
- `/demo spawn success after long`：观察长名称。缩小窗口到 40 或 80 列检查截断。
- `/quit`：退出并清理隔离运行目录。

`--after` 为当前默认方案；`--quiet` 可指定历史暗灰方案；`--neutral` 和 `--soft` 可指定之前的两个方案，`--before` 可从原版开始，`--expanded` 可从展开状态开始，`--fullscreen` 使用 Pi 全屏模式。每次调用的样式固定，切换不会改写上方已有消息。`/before` 和 `/after` 只是追加显示对照，不执行真实子代理。

## Landing Map

- Target：Pi 主对话的 subagent 工具调用与结果行，覆盖 spawn、prompt、list、read、wait、close。
- Context：真实 Pi 0.86.0 InteractiveMode，加上当前生产 codex-ui 的编辑器、页脚、Read 和 Bash 渲染。
- Contract：Pi registerTool 的 renderShell self、renderCall、renderResult、行内共享 state、isPartial、isError 与原生展开状态。fixture 替换 execute 返回的数据，不替换 Pi 的布局与工具生命周期渲染。

## Candidate

- 复用 codex-ui 的状态圆点与主题色。调用进行中为黄色，成功为绿色，失败为红色；wait 超时和中断为黄色。
- 标题仍强调动作，目标名称使用 accent 色但不额外加粗。
- 任务和回复用正文色，活动统计等辅助信息弱化。
- 多行结果使用竖线连接，末行用转角结束；单行结果保持原有缩进。
- 保留所有原有文案、字段、顺序及默认/展开信息归属。窄屏仍按现有规则截断。

圆点描述工具调用，不把成功创建或发送消息解释为子代理任务已经完成。展开状态中仍可看到 Running。此语义已用原型覆盖，是否采用这套视觉方案由用户审阅决定。

## Success text variants

用户认为 Settled 的绿色过亮，已要求把两个替代方案都做出来。当前仅限 subagent 结果区的成功状态文字：Settled、Process stopped、列表中 settled 的数量/状态等。选项 1 使用主题 text，选项 2 在原型中使用固定灰绿 #8fb89b。两者的标题圆点、warning、error、正文、信息顺序和布局相同。没有修改全局主题，因此周围 Read/Bash 与 diff 颜色保持原样。

styles.mjs 通过结果区专用 theme 代理实现；灰绿是原型固定色，尚不是正式主题 API 设计。用户已否定正文色与灰绿两版。最新 quiet 方案经用户要求制作，将同一范围的成功文字映射到主题 dim，使 Settled 与其后整行元信息一致；标题圆点、警告/错误、任务与回复正文保持原样。用户随后选择回到 /after，要求绿色仅调暗一点。当前 /after 成功文字为 #40d672，保留鲜绿色调；标题圆点继续使用主题 success #4dff88。neutral、soft、quiet 保留作历史比较。新色值仍是待审阅的试调值。

## Real and fixture

真实部分：当前仓库的 codex-ui 源码与主题、subagent 原版 renderer、Pi 会话、流式工具参数、工具组件、编辑器、页脚、快捷键和窗口尺寸变化。

fixture：模型由 Pi 官方 fauxProvider 提供固定响应；六类子代理结果及周围 Read/Bash 的执行结果由固定数据提供。Bash 中显示的命令只是上下文样例，不执行 shell。未加载真实 subagent manager，不创建子代理或 tmux。网络、真实凭证和用户配置不参与原型运行。

approximation：原型展示的是设计状态样例，不能验证真实任务耗时、子代理认证、资源调度或恢复行为。PNG 是从真实 PTY 终端单元格重绘的预览，颜色与内容来自捕获，字体回退和行高不等同于用户的终端。

## Implementation and cleanup

所有原型文件集中在本目录。prepare.mjs 将生产源码转译到临时目录，并且只对候选版 renderer 应用锚点检查的局部补丁；不修改 extensions/src 或 dist。候选不另造业务数据模型，正式实施应将已批准的规则重新实现到生产源码和测试中，不直接引入运行时源码补丁。

启动脚本在仓库 .tmp 中创建隔离运行目录并在退出时删除。smoke.py 的测试截图和终端捕获留在 .tmp/subagent-ui-* 下供调试。无需启动后台服务或监听端口。

## Verification

```sh
pnpm exec node adventure/prototypes/subagent-ui/check.mjs
conda run -n codex-py312 python adventure/prototypes/subagent-ui/smoke.py
conda run -n codex-py312 python adventure/prototypes/subagent-ui/smoke.py --before
conda run -n codex-py312 python adventure/prototypes/subagent-ui/smoke.py --quiet
conda run -n codex-py312 python adventure/prototypes/subagent-ui/smoke.py --quiet --fullscreen
conda run -n codex-py312 python adventure/prototypes/subagent-ui/smoke.py --neutral
conda run -n codex-py312 python adventure/prototypes/subagent-ui/smoke.py --soft
conda run -n codex-py312 python adventure/prototypes/subagent-ui/smoke.py --soft --fullscreen
```

check.mjs 对照 160 组渲染状态，验证前后文字信息不变，并检查 0、1、2、12、40、80、120 列不越界。PTY smoke 覆盖六类消息、成功/进行中/失败、wait 超时/中断、展开折叠、长名称、80/40/120 列切换、退出与网络零调用断言。

验证结果与截图见 [review.md](review.md)。视觉是否达到目标尚待用户审阅，技术验证通过不代替用户确认。

## API sources

版本来自已安装的 @earendil-works/pi-coding-agent 与 pi-ai 0.86.0。Context7 查询只提供 main 版本文档，因此实际调用已对照本地同版本 dist/core/extensions/types.d.ts、SDK 声明、pi-ai/dist/providers/faux.d.ts 以及现有 tool-status-prototype/runtime.mjs 核验。

官方参考：[SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[extension rendering](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。
