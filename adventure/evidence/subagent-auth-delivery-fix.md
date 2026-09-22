# Subagent Authentication Delivery Fix

## Scope

保留上一轮的启动就绪握手；本轮补充 provider 凭据传递与明确的认证拒绝回执。没有修改用户认证配置，没有调用真实模型服务，没有自动重试未知投递。

## Evidence

- Red：隔离的真实 Pi 0.86.0 子进程显示 `No API key found for deepseek`，父进程仅得到 `delivery_unconfirmed`。
- Green：环境变量凭据、存储凭据、两者并存三个场景均完成离线模型响应；存储凭据保持原生优先级。
- Green：无凭据时父进程收到 `delivery_rejected` 和固定的认证缺失信息；释放子代理与容量预留。
- 凭据仅按所选内置 provider 筛选，通过 0700 临时目录内的 0600 文件传递。子进程读取后删除文件，父进程清理目录；测试检查进程命令、session 和状态文件不含测试密钥。
- 回执绑定 delivery、session、epoch、process instance 与父注册身份；过期、取消和其他任务的回执不能确认当前投递。
- 额外复现并修复锁文件尚未写完时的 JSON 解析异常。只允许回收已确认不存在的本机进程所持锁，不按锁龄抢占。

## Verification

- `pnpm run build`：通过。
- `pnpm run check`：类型检查通过；2376 个测试通过、11 个跳过。MCP suite 因既有缺失文件 `prototypes/mcp-status-ui-prototype/src/codex-startup.js` 无法加载，整条检查未通过。
- 单独 `pnpm run package:check`：既有缺失文件 `docs/goal-descendant-acceptance.md` 阻断。
- 实际全局 Pi bundle、编译后的扩展、隔离 tmux、离线 provider：production integration 单独重跑 9/9 通过；isolated integration 1/1 通过。
- 与全仓测试并行的前一次 production integration 有两个操作超时，单独重跑未复现。尚不能声称高负载超时问题已排除。
- 所有测试启动的进程已退出，隔离 tmux socket 已不可用，临时测试目录已清理。
- `git diff --check`：通过。

## Limits

公开扩展 API 没有统一的提交拒绝事件；当前回执只覆盖本扩展实际拦下的认证或模型缺失。其他无法确认的投递仍返回 `delivery_unconfirmed`，不推断成功或自动重发。自定义 provider、AWS/ADC 等凭据环境不在本次自动继承范围。

用户随后确认实际问题已修复，并于 2026-09-22 确认冒险验收通过。补充修复随最终存档提交；隔离测试本身不等于原会话现场验证，也未完成改动前版本的历史对照。
