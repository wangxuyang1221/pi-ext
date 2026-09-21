# Unselected exit feasibility

## Decision

用户已确认：没有经过退出选择便离开时保留 subagent，不把主进程消失解释为“结束会话”。完整规则在 Planning #21 通关后移交 Spec Behavior。长期遗忘的发现和处置归 #22，本关不批准任何自动超时回收。

## Verification

使用现有 quit-choice 原型、生产 subagent 插件、Pi 0.86.0、tmux 3.6b 和离线模型 fixture。每组先持久化主会话、创建真实子代理，然后在不经过 /quit 选择的情况下结束主 Pi，再启动新主 Pi 并 resume 同一 session 文件。

| Scenario | Evidence |
| --- | --- |
| SIGHUP | 主进程退出并产生一次 quit 清理事件；子代理仍存活，恢复后可回收。 |
| SIGTERM | 主进程退出并产生一次 quit 清理事件；子代理仍存活，恢复后可回收。 |
| SIGKILL | 直接终止主进程，首次退出无 session_shutdown；子代理仍存活，恢复后重新获得控制并可回收。 |
| Ctrl+D | 绕过 /quit 选择的原生退出保留代理；恢复后可回收。 |

四组均核验首次退出没有选择记录或代理清理记录，新旧主 Pi PID 不同但 session 文件相同，原代理 PID 在 resume 后仍存活，之后主动 /quit 并选 End session 才关闭代理。无关 keeper window 在产品流程后仍存活。

[结果数据](subagent-quit-backend-results.json)中的 sighup-resume、sigterm-resume、sigkill-resume 和 ctrld-resume 保存退出事件、主进程 PID 和清理结果。前三种信号只发送给已记录的隔离主 Pi PID，不发送给用户进程。

## Reproduce

```sh
conda run -n codex-py312 python adventure/prototypes/quit-choice/backend-smoke.py sighup-resume sigterm-resume sigkill-resume ctrld-resume
```

launcher 的 unselected-resume 模式允许第一轮正常退出或预期 SIGKILL，再启动同一隔离配置的 --continue。这是测试恢复步骤，不是产品自动重启承诺。

## Boundary

SIGHUP 是终端挂断相关的信号路径验证，没有实际关闭用户的终端应用；不把它描述成覆盖所有终端软件的关闭策略。SIGKILL 验证正常清理回调不可达的路径，但不穷举所有崩溃原因。若用户同时结束 tmux server、操作系统终止子代理或机器关机，本功能不能保证进程继续存活。

现有持久化与 controller lock 允许在确认本机旧 owner PID 已不存在后恢复控制；本次实验在真实 PID 消失后验证成功，不主张以超时替代身份核验。状态损坏、权限不足、PID 复用等情况仍应保留诊断并避免误关闭。

## Cleanup

每组 launcher 核验主进程、子代理、隔离 server 和 keeper 的退出，并确认 socket 不再可用和临时目录已删除。没有操作用户已有 tmux server，没有启动 TCP 服务。

## Follow-up

#21 已有足够证据支持保留策略。进入 #22 确定跨 session 发现与处置方式。正式实施时保留这四种回归，避免将任何 session_shutdown 一律接到 close all。
