# Goal tool UI prototype

## Question

Goal 工具与真实 Bash、Write、Edit 同屏时，带用量的摘要与更简短的摘要，哪种更协调、便于阅读？通过同一批调用切换显示密度、展开详情和调整窗口宽度判断。

本原型属于 [Planning #42](https://github.com/wangxuyang1221/pi-ext/issues/42)。用户审阅后已选择 summary 并要求收敛，完整规则见 [Spec #40](https://github.com/wangxuyang1221/pi-ext/issues/40)。以下双变体入口保留用于追溯对照，不会在正式产品中提供密度切换。

## Run

在另一个终端运行，本机依赖已安装：

```bash
cd /Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/goal-tool-ui
node adventure/39/prototypes/goal-tool-ui/demo.mjs
```

启动后自动执行固定的 Bash → create_goal → Write → get_goal → Edit → update_goal，展示真实工具渲染。Write 修改已有文件，因此标题按现有 codex-ui 规则显示 Edited；这是原有行为。

全屏模式：

```bash
node adventure/39/prototypes/goal-tool-ui/demo.mjs --fullscreen
```

其他工作区需要先用 Node.js 22.19+、pnpm 11.9.0 执行 `pnpm install --frozen-lockfile --ignore-scripts`，然后运行相对路径命令。

## Review

1. 初始为 summary，默认显示目标预览、用量和耗时。输入 `/variant minimal`，同一批已显示的 Goal 行隐藏用量行，方便对照，不重复执行工具。
2. 输入 `/variant summary` 切回。按 `Ctrl+O` 使用 Pi 原生展开/收起，查看完整目标与精确统计。快捷键沿用隔离运行时的 Pi 默认配置。
3. 输入 `/demo long`，然后缩窄窗口并展开，观察长目标、中文与 emoji 的显示。
4. 输入 `/demo error`，查看失败标题、原因摘要及展开后的完整原因。
5. 输入 `/quit` 退出，自动删除隔离 workspace、会话与临时转译文件。

其他可重复场景：

| Command | Observation |
| --- | --- |
| `/demo compare` | 再次显示三个 Goal 工具与真实 Bash、Write、Edit |
| `/demo empty` | 没有 Goal，成功调用显示 No goal |
| `/demo paused` | 成功更新目标为 Paused，圆点仍表示调用成功 |
| `/demo blocked` | 成功更新目标为 Blocked，不当作工具失败 |
| `/demo unbounded` | 没有 token budget |
| `/demo incomplete` | 统计不完整，在两种密度下均保留警告 |
| `/demo running` | 保持运行中，用 `/finish` 完成 |
| `/fixture-theme light` | 检查浅色主题，`/fixture-theme codex-pi` 恢复 |
| `/guide` | 再次显示操作提示 |

本轮审阅已回答默认信息密度问题，采用保留用量行的 summary，其他展示沿该原型基线收敛。正式实现的异常数据回退与兼容性仍按 Spec 验收，不因用户接受原型而省略。

## Landing Map

- Target：Pi 0.87.0 的真实 InteractiveMode 对话工具区域。
- Context：原有 codex-ui 的 editor、footer、主题和 Bash、Write、Edit 渲染，保留原样。
- Contract：原 Goal 工具注册函数与 content/details，增加实验性的 renderShell/renderCall/renderResult；使用真实 ToolExecutionComponent 的生命周期和展开操作。

## Real system and fixtures

真实部分：

- 启动时将当前 worktree 的 codex-ui 源码、Goal 的 tools/upstream/renderers 源码转译到临时目录，没有源代码补丁，不编辑 dist。
- 真实 Pi 的模型事件、工具执行、历史行渲染、主题与展开行为。
- 原 Goal 的参数 schema、execute 内校验和 response 序列化。
- Bash 执行固定 printf 命令，Write/Edit 操作固定临时文件，均由原有工具执行。

Fixture 与 approximation：

- 模型使用 Pi faux provider，仅触发脚本中的调用，无模型网络和真实凭证。
- 只替换 Goal 的持久化访问边界，返回内存 fixture。用量与耗时是固定数据，不代表真实消耗。
- 用 fixture 的等待与错误演示展示状态，不验证 Goal 调度、存储、预算规则或异常恢复。
- 工具执行外层检查调用 ID、参数和 cwd，只允许固定脚本操作。自由输入不触发模型，用户 Bash 快捷入口被禁用。
- 所有 HOME、TMPDIR、agent 与 session 路径位于本 worktree 的 `.tmp/goal-tool-ui-*` 内。启动入口不加载个人扩展、技能、凭证或项目上下文。
- 只替换三个 Goal 工具的展示，正式 Goal extension 的 scheduler、命令和 footer 数据发布未加载。不对 footer、`/goal` 做改动，也不以原型验证这些功能。

## Verification

已通过：

- `node --test adventure/39/prototypes/goal-tool-ui/prepare.test.mjs adventure/39/prototypes/goal-tool-ui/renderers.test.mjs`，1 个转译后实际导入检查、4 个真实 ToolExecutionComponent 回归测试。
- `conda run --no-capture-output -n codex-py312 python adventure/39/prototypes/goal-tool-ui/smoke.py`。
- 同一 smoke 加 `--fullscreen`，验证另一种真实交互模式。
- smoke 覆盖启动、三个工具与现有工具同屏、实时切换变体、原生展开、长目标、40/80/120 列窗口、错误、无目标、paused/blocked、无预算、计量不完整、运行到完成、主题切换、运行中退出与临时目录清理。
- 原型启动修复后重新运行 `pnpm run check`：类型检查、2604 个测试通过、13 个既有测试跳过、构建和发布包检查通过。原型测试另行运行，不把仓库 check 代替原型验证。
- 启动回归曾报 `ERR_MODULE_NOT_FOUND`：生产 tools 新增 renderers 依赖后，原型未转译该文件。已补齐清单，并由新增导入测试和两个真实 PTY 模式验证。详见 [启动修复记录](../../evidence/prototype-startup-repair.md)。

详细记录见 [prototype-validation.md](../../evidence/prototype-validation.md)，终端文本与日志见 [evidence/prototype](../../evidence/prototype/)。

尚未验证或不由原型证明：真实 Goal 存储和调度集成、历史 session 重启、reload、所有异常数据回退及生产性能。用户已确认 summary 展示基线；上述生产路径已在[正式实施验收](../../evidence/implementation-verification.md)中单独验证，不由本原型证明。

## Reuse and cleanup

- `demo.mjs`：创建隔离目录、转译、启动子进程、退出清理。
- `prepare.mjs`：转译原有源码，不修改源码内容。
- `runtime.mjs`：真实 SDK 启动、fixture 访问、固定脚本和对照命令。
- `renderers.mjs`：两个候选布局，仅挂载在原型入口。
- `prepare.test.mjs`、`renderers.test.mjs`、`smoke.py`：启动依赖、组件测试与真实 PTY 检查。

可直接复用场景清单、fixture 和 smoke 方法。默认不把实验 renderer 迁移到生产，正式实现应按用户确认的规则重新落实类型、兼容、性能及回归覆盖。

本次检查启动的所有进程已退出，未保留后台服务或监听端口。用户体验产生的临时目录在 `/quit` 或常规终止信号后自动清理。强制 SIGKILL 无法保证 finally 执行，若遇此情况，确认该实例进程已退出后，再删除对应 `.tmp/goal-tool-ui-*` 目录。

整个原型可通过删除本目录移除，不涉及任何正式产品入口。
