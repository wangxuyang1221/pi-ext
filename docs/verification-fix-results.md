# Product regression verification results

## Scope

2026-10-28 在本仓库完成五项修复。环境为 macOS、Node 22.22.2、pnpm 11.9.0、Pi 1.4.0、MCP SDK 1.29.0。原失败证据保留在 `.tmp/parallel-verification-TXdlMV/`，本轮证据主要位于 `.tmp/regression-fixes/`。

本报告只更新五项回归及对应反例，不重算历史 265 个行为 ID 的覆盖率。模拟响应仅替代外部模型或服务；未实跑的远程服务、真实账号额度及计费保持未验证。

## MCP progress

`mcp-progress`、`mcp-deadline`、`mcp-cancel` 的相关真实 SSE 分支通过。旧实现没有发送 progressToken，600ms 调用在约 150ms 失败；添加 SDK onprogress 后成功。持续进度仍在硬截止结束，未知 token、无进度和停止进度均不能无限延长，用户取消传到服务端，调用次数始终为 1。测试关闭服务后核验连接被拒绝。

稳定入口为 `progress-transport.test.ts`，并已纳入共享 helper 的 mcp-transports。红灯日志为 `mcp-red.log`，修复后为 `first-three.log` 和最终完整检查日志；本地协议成功不代表所有远程 transport 均已验收。

## Goal quota

`goal-quota` 的解析与真实 SDK 状态分支通过。先确认两个 Codex 前缀错误均无法识别，再加入有界包装标准化。精确代码、JSON、compaction/summary 包装均通过；裸 429、rate_limit、鉴权、网络和含糊额度文本仍不误判。

`quota-runtime.test.ts` 使用合成 SSE，经已安装 native Codex adapter 和生产 Goal SDK，覆盖 active 与在途 budget_limited。明确额度错误进入 usage_limited，普通 rate_limit 保持 blocked 或 budget_limited，目标身份与累计量保留。原 `restore-runtime.mjs` 接受/取消恢复确认的完整旅程也通过，接受后仅启动一次请求，取消不写状态。

证据为 `mcp-green-quota-red.log`、`quota-runtime.log`、`quota-restore.log` 和最终完整检查日志。

## Search session scope

`search-reference` 的客户端会话隔离分支通过。生产工具入口到真实本地 HTTP 的旧路径复现 B 携带 A 引用；修复后 B 未 open 的 find/click/screenshot 在本地拒绝且不发请求，B open 后只使用自己的引用，A 重新加载后仍可使用 A 引用。鉴权等待期间切换、请求返回前切换均保持请求和落盘身份一致。直接输入 refId 的原契约保留。

`ref-store.test.ts` 与既有 codex 测试覆盖同会话并发合并、不同会话隔离、旧文件忽略且保留、损坏与身份不符报错、原子替换失败保留原文件、后续队列继续执行。1/100 个其他会话下，目标 load 和 remember 合计只读取目标文件两次。

稳定入口为共享 helper 的 search-references。证据为 `search-red-quota-green.log`、`summary-core-green.log`、`search-helper.log` 和最终完整检查日志。工具上下文的会话身份由夹具提供，fork/clone 以不同 ID 验证隔离，不宣称真实 `/fork`、`/clone` 菜单旅程已覆盖；本地响应不证明远端引用校验。

## Goal escape

真实事件表明，Pi 取消流式响应时生成了新的 assistant 时间戳，而绑定运行的 signal 已 aborted。旧 scheduler 在时间戳检查处返回，首次 settled 仍 active。新逻辑按有效 ticket/signal 提交暂停，并保留正常响应的时间戳校验、内部取消区别和终态优先级。

未改原 PTY 断言，stream-interrupt 连续三次通过，首次 settled 即 paused，显式 resume 后才继续。tool-interrupt、retry-c12、retry-dialog、edit-cancel、replace-cancel、input-steer、input-followup 均通过。SDK 和 scheduler 测试继续覆盖过期目标/会话事件、内部取消、混合队列、幂等停止和预算/完成/额度终态。

原失败旅程、临时观测和提炼结果分别为 `esc-red/`、`scheduler-trace.ts`、`esc-trace.json`；生产代码中的临时观测已移除。通过证据为 `esc-green-1/`、`esc-green-2/`、`esc-green-3/` 及 `goal-pty-results.json`。

## Skill mentions and host patch

`skill-resume` 的两种选择器回归通过。native、native-fullscreen、codex、codex-fullscreen 均由真实 CLI 正常提交生成 snapshot，再经过两次 `/resume`、首次 `--resume`、精确检索、删除源文件后的卡片恢复及后续模型请求。选择器在 session_start 前已有正确摘要，恢复选择不改历史字节。10/100 会话的真实 loader/SessionManager 测试补验名称优先、named 筛选、同文、长/中文/多行 task、损坏/未知协议和异常转换保留原文；搜索按键不重复解码。

证据为 `summary-native-2/`、其他三种 `summary-*` 模式目录及 `summary-pty-results.json`。首轮 `summary-native/` 因观测器读取转换前 message_end 而失败；驱动改为断言实际模型上下文中的 user 消息，并补充失败清理的强制退出上限。失败记录保留，子进程已回收。

共享 helper 新增 skills-resume，实跑证据位于 `.tmp/test-results/verify-skills-resume-41staS/`。真实 tarball 安装后也通过 native 选择器专项，证据为 `.tmp/test-results/regression-summary-artifact.json` 和 `regression-summary-summary-native/`。

Pi patch 经干净目录冻结安装自动复现，锁文件字节不变，source/dist 加载通过。原始未补丁 Pi 1.4.0 也可加载扩展，但没有摘要接口。安装与移除方式、启动 cwd 的扩展范围、外部发布包消费边界见 [补丁说明](pi-session-summary-patch.md)。证据为 `frozen-install.log`、`patch-compatibility.json` 和 `package-summary.log`。

## Default CLI entry follow-up

用户要求全局 `pi` 生效后，检查发现原测试直接启动 `dist/cli.js`，而默认 bin 实际启动 `dist/bundle/cli.js`。因此之前的摘要验证不能证明默认命令已修复。补丁现已将 bundle 入口转到已修复的模块；发布包专项改为启动消费项目的 `node_modules/.bin/pi`。

拟安装的全局启动器在 `.tmp/global-pi-activation/pi`，通过本仓库 `node_modules/.bin/pi` 启动，保留参数、环境与工作目录。`verification-fixed/journey.json` 记录两次进程内选择器、冷启动选择器、搜索、恢复卡片和原始模型上下文均通过。发布包消费验证也通过，证据为 `.tmp/test-results/global-entry-artifact.json`、`global-entry-summary-native/`。冻结锁文件离线安装保持锁文件字节不变，并确认默认 bundle 入口已应用补丁。

原全局宿主作为反例，在摘要断言处失败。第一次失败清理等待退出时，macOS PTY 未排空导致退出阻塞，已终止本轮驱动并确认相关进程消失；驱动现改为先关闭 PTY 再等待子进程退出。反例重跑按预期失败且子进程全部回收，见 `.tmp/global-pi-activation/unpatched-cleanup/`。

用户最终选择临时启动补丁宿主，未替换全局启动器，也未修改全局 Pi 包或用户设置。可在任意目录执行 `/Users/wangxuyang/Code/t3code/pi-ext/node_modules/.bin/pi`，沿用现有全局配置，Goal 保持用户手动卸载的状态。该命令依赖本仓库路径及依赖目录，不影响普通全局 `pi` 的升级。

入口修复后再次执行 `pnpm run check`，193 个测试文件、2869 项测试及构建、类型、发布包、宿主检查全部通过，日志为 `.tmp/global-pi-activation/check.log`。本轮记录的进程均已停止，证据目录无残留 socket，临时安装和补丁编辑目录已移除，见同目录 `cleanup.json`。

## Final checks and cleanup

完整 `pnpm run check` 退出 0，193 个测试文件、2869 项测试全部通过；构建、类型检查、发布包和 source/dist 宿主加载校验均通过。日志为 `.tmp/regression-fixes/check-final.log`。新增 helper、Python 驱动及发布包专项已实际执行，最后文档链接与 diff 空白检查通过。

`cleanup.json` 核验 26 个已记录 PID 全部退出，证据目录无残留 socket，verification 锁已移除。MCP 协议测试在关闭后断言端口连接被拒绝，Search 等待 HTTP server 关闭，测试入口确认进程组退出。临时补丁编辑目录、原始宿主验证副本和干净安装目录已删除，失败及成功证据保留。

其他行为 ID 沿用原报告中的限制，不因本轮相关分支通过而整体改为 passed。没有创建提交、PR 或发布。
