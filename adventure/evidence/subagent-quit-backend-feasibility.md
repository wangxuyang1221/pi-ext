# Quit backend feasibility

## Result

真实 Pi 0.86.0 加当前生产 subagent 插件可以执行当前正常退出候选流程。9 场景通过，证据入口为 [原型 README](../prototypes/quit-choice/README.md) 和 [结果数据](subagent-quit-backend-results.json)。本报告仅支持 Planning #20 的技术可行性，不表示正式功能已交付。

## Scenarios

| Scenario | Observation |
| --- | --- |
| empty | 查询确认无活跃或待启动代理，不显示选择，主 Pi 正常退出。 |
| leave | 选择 Leave temporarily 后主 Pi 退出，原代理 PID 在测试清理前仍存活。 |
| end-running | 子代理离线模型处于受控执行中，End session 关闭代理，确认 PID 消失后退出。 |
| query-retry | 注入 tmux 查询失败，界面报告错误，不显示意图选择、不退出；移除故障后重试成功。 |
| partial-close-retry | 两个实际代理，第一个关闭成功、第二个被注入关闭失败。主 Pi 保持存活；失败解除后再次 /quit 关闭剩余代理。 |
| cancel | Escape 取消选择，主 Pi 和代理保持存活，再次 /quit 可以结束。该交互已由用户确认。 |
| main-busy | 主 agent 正在受控模型请求中，选择结束后通过公开 abort 中止当前轮，再完成回收和退出。 |
| reload | /reload 重建扩展后，/quit 选择和实际回收仍可执行。 |
| resume | 暂时离开后以同一 session 文件启动新主进程，接管原代理；再次 /quit 结束，原代理 PID 消失。 |

## Integration boundary

复用生产 subagent 扩展和工具注册，未替换 manager、状态存储或 tmux runtime。主输入框及选择界面均来自真实 Pi，组合了仓库 Codex UI 和 skill 标签扩展。只替换模型响应并注入指定 tmux 故障，所有状态和进程隔离在本 worktree。

Pi context shutdown 是优雅退出请求；为避免主 agent 当前轮阻止退出，成功选择后先通过公开 abort 中止主 agent，再执行后续退出流程。取消或状态查询失败不触发中止。结束会话后若回收失败，主 Pi 留下，已中止的主任务和已关闭的代理不回滚。

本原型沿用 manager 已有的关闭保护：按 namespace 和 process identity 回收，等待关闭确认，失败保留足够状态重试。未采用 kill 用户 tmux server 的方式；所有场景的无关 keeper window 在产品流程后仍存活。

## Cleanup

每个场景记录 server、keeper、代理 PID；launcher 清理前记录所需存活/停止状态，之后终止本次隔离 server，并确认所有记录的测试 PID 不存在、socket 不再可用、临时目录移除。未启动 TCP 服务。没有修改用户的 Pi 配置或触碰已有 tmux 会话。

## Deferred verification

进入实施时保留现有 manager 测试，增加正式退出入口的回归：并发启动与退出时不得漏回收，清理与重试有截止时间，生命周期变化后不得使用 stale context，编辑器组合不丢失草稿与标签，未加载或非交互上下文不会误触发。正式集成验收须重跑真实后端和入口矩阵；当前报告不能替代实施验收。

直接关闭终端等无选择退出归 #21；用户暂时离开后长期遗忘归 #22，本关未决定这两者的默认策略。
