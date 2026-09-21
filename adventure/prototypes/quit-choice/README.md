# Quit choice prototype

## Question

在真实 Pi 0.86.0 中，通过公开编辑器接口接入 `/quit` 选择，是否能与现有输入框共存，并按用户意图查询、保留或回收所属 subagent？

## Landing map

- Target：用户从主输入框提交 `/quit` 的路径。
- Context：真实 Pi TUI、原生命令补全、现有 Codex UI 与 skill 标签扩展、生产 subagent 插件及隔离 tmux server。
- Contract：`getEditorComponent`、`setEditorComponent`、编辑器 `onSubmit`、`ui.select`、`ctx.abort` 和 `ctx.shutdown`，以及现有插件注册的 list/close/spawn 工具。后端 adapter 只捕获并调用真实工具注册，不修改生产 manager 或宿主方法。

## Run

在本冒险 worktree 根目录执行：

```sh
node adventure/prototypes/quit-choice/run.mjs native regular
node adventure/prototypes/quit-choice/run.mjs combined regular real
conda run -n codex-py312 python adventure/prototypes/quit-choice/smoke.py
conda run -n codex-py312 python adventure/prototypes/quit-choice/backend-smoke.py
```

第一条命令只验证选择入口，每次 `/quit` 询问；第二条接入真实 subagent 后端。真实后端中先输入 `/probe-spawn fast work` 创建测试代理，或 `/probe-spawn hold:work` 创建保持执行中的代理，然后 `/quit`。默认 End session，另一项 Leave temporarily，Escape 取消退出。未创建代理时直接退出。

真实后端需要 tmux。`run.mjs` 的第三参数 `resume` 会在暂时离开后用同一隔离配置再启动一次 Pi `--continue`，用于验证恢复；这是原型测试入口，不是产品自动重启功能。

## Isolation and fixtures

宿主、原生选择界面、编辑器、退出、subagent manager、状态存储和 tmux 进程均使用真实实现。主 agent 与子代理的模型使用仓库现有离线 fixture，没有模型网络请求。所有配置、socket 和状态位于本 worktree `.tmp/quit-choice-*`；不加载日常配置或操作用户已有 tmux server。

无 real 参数时不加载生产 subagent 扩展，两项选择仅记录意图并退出。real 模式使用生产扩展及其现有工具，模型仍为 fixture；故障通过隔离 tmux wrapper 的 marker 文件注入，查询和 kill-window 仅在指定场景返回错误。

临时离开场景会先核验子代理在主 Pi 退出后仍存活，再由测试 launcher 清理隔离 server；这次测试清理不属于产品“暂时离开”行为。launcher 同时保留一个无关 keeper window，用于核验退出流程没有关闭整台 tmux server。

## Results

- 入口矩阵 12 组通过：原生 regular/fullscreen、Codex regular、Codex + skill regular/fullscreen、反向扩展加载顺序 regular，各覆盖两种退出选择、取消后正常 prompt、记录的意图和退出事件。默认 End session 已补验。[数据](../../evidence/subagent-quit-prototype-results.json)
- 真实后端 9 场景通过：无代理直接退出、暂时离开保留代理、结束运行中代理、查询失败后重试、部分关闭失败后重试、取消选择、主 agent 工作中退出、reload 后退出、暂时离开后 resume 并回收原代理。[数据](../../evidence/subagent-quit-backend-results.json)
- 原型 TypeScript 检查及 launcher 语法检查通过。
- 每个后端场景在 launcher 清理之前核验 keeper 仍存活；之后核验测试进程退出、隔离 socket 不再可用、临时目录移除。

## Decisions and limitations

已确认：用户日常入口为 `/quit`；仅有存活 subagent 时询问；默认 End session；暂时离开保留后台代理；结束会话回收所属全部代理；查询或清理失败保留主 Pi、显示错误并允许重试。

候选：Escape 取消退出，返回原会话并保留子代理；尚待用户决定。正在启动的代理作为未完成检查报告并保留主 Pi，最终文案和等待策略属于实施局部问题。选择结束会话后若主 agent 仍在工作，先中止其当前轮，再调用所属代理清理；失败时不会恢复已中止的任务。

这是一次性规划原型，不是生产实现。真实后端矩阵使用 combined regular；入口矩阵另覆盖其他编辑器与 fullscreen。未穷举并发 spawn/prompt/quit、所有 session replacement、其他扩展后续替换编辑器、恶意修改状态、外部命令启动的任意脱离进程；生产实施需按当前 manager 的所有权和操作截止时间补回归，不因原型通过而删除现有保护。

生产实现应把入口与 manager 的调用接入正式 subagent 扩展，重新设计状态机和生命周期，不能保留 `/probe-spawn`、测试 wrapper 或离线模型配置。未经用户要求不以复用原型代码为目标。
