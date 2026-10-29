# Subagent journey drivers

## Run

从仓库根目录执行，先构建生产 dist，并按共享 skill 的 Doctor 核对环境。

```bash
pnpm exec node .cursor/skills/verify-pi-subagent/scripts/run.mjs
pnpm exec node .cursor/skills/verify-pi-subagent/scripts/run.mjs "subagent-legacy-$(date +%s)" legacy
```

第一个入口驱动完整的本地 root CLI/PTY 旅程。第二个入口从本地 Git 的 `6ec995fae1086e5c00525d6e9a43055e3f625b21` 读取真实 v2 源码，在本次 scratch 中加载，验证旧 child、旧 writer、离线升级和升级后的后续请求。该 revision 不存在时，legacy 入口明确失败并保留证据。补齐这段历史后重跑，不能改写 schemaVersion 代替旧 writer。

每次生成唯一的 `.tmp/test-results/subagent-pty-<timestamp>/`。显式 label 用于对照实验，目录已存在时拒绝覆盖。runner 创建独立 HOME、agentDir、workspace、session、XDG 目录，复用共享凭据白名单。tmux wrapper 在自己的 scratch 中使用相对 `-S socket`，不连接用户默认 server。fixture provider 的 fetch 会记录并拒绝网络调用。它只替换模型响应，不证明远程认证或线上服务。

## Fixtures and scope

- `provider.ts` 发出指定的生产工具调用，记录 request、tool、settled、session、tree 与 abort 事件。长文本、失败和等待由它生成。根输入 `GENERATE_LONG_USER` 会在模型边界展开为 36 KiB 工具参数，避免把终端逐字输入能力混作 detail 分页前提。
- `controller.ts` 调用生产 `extensions/subagent/dist/index.js`。仅 root 增加 `audit_parallel`，以同一个真实 root context 并发调用五次生产 spawn，记录 reservation 与唯一进程数采样。Pi 普通模型工具的串行执行不能用于证明并发 reservation。
- 三类 preflight 拒绝通过 controller 在真实 child 的 input handler 边界注入缺少 model、缺少 auth 和 auth resolver 抛错。检查生产拒绝分类、脱敏、无模型请求。它证明生产防护处理对应输入，不冒充三家真实远程认证故障。
- 未确认投递在 tmux submit 边界暂时将原生 session 设为只写，并隐藏 capture-pane 观察。child 仍收到真实输入并写入历史，parent 无法读到确认。恢复权限后核对恰好一个 user turn，持续存活，无自动重发。这个故障在自己的文件权限和外部命令边界注入，不修改生产 state。
- 关闭失败由自己的 tmux wrapper 对 kill-window 返回 77；身份反例通过真实 tmux pane 的实例 marker 改动触发。解除故障后重试，检查进程、slot 与原生历史。

## Observable assertions

full 旅程保存每次按键、工具参数与结果、终端画面和生产 JSONL 副本，包含以下组合。

1. spawn → wait/list → `/quit` Escape → `/reload` → 立即 prompt。driver 没有额外 sleep，生产 runtime 负责 Ctrl+C 安全间隔。
2. `/quit` Leave temporarily → 同一 root session 文件重开 → `/reload` → 继续 prompt/wait。暂离、恢复及 reload 后核对同一个 child ID/PID，并检查原生历史中的新消息。
3. 三类拒绝、确认丢失、关闭失败重试、并发超容量、角色增删改与 reload、显式参数覆盖、非法角色和模型零资源。
4. 忙碌 follow-up、对应代次 timeout/settled、大历史 turns 快照翻页期间追加、五种 detail section 的 UTF-8 多页还原、工具失败和部分文本失败。
5. 同一 namespace 双 root 的写入竞争、错误 pane marker 保留 slot 并拒绝投递、真实 child `/new`、历史 alias 关闭后新 session 继续、`/tree` 回退后的游标。
6. 两个同时存活 namespace 的 close-all 隔离、启动 pending 时 `/quit` 拒绝、End session 关闭失败留在会话、main 正忙时 Escape 不 abort、End session 后确认 child PID 退出。

结合原 `run subagent` 宿主组使用。生产启动延迟、凭据交接文件与内建 provider 映射仍由该宿主组验证。不能将本 fixture 的自定义 provider 无凭据运行当成凭据交接成功。

## Evidence and cleanup

查看 `journey.json` 的 `passed`、逐条 `assertions` 和 `cleanup`，以及 `wrapper-cleanup.json`。成功必须同时满足所有断言、`allStopped: true`、`scratchRemoved: true`、`evidenceRetained: true`。JSONL、事件、terminal ANSI 在删 scratch 前复制，证据不随清理删除。

runner 将 exit、启动 error、180 秒期限和 SIGINT/SIGTERM 一起等待。取消后向自己的进程组发送 TERM，最多给 driver 10 秒清理宽限，然后通过共享 `stopProcessGroup` 强停并有界核对进程组退出。driver 在 finally 清理自己 fork 的 root、私有 tmux server 和记录 PID，再核对监听端口。环境准备、启动失败、超时和清理异常均写入 `wrapper-cleanup.json` 与 `output.log`。缺少 driver 清理凭据时保留 scratch 并失败，按共享清理规则检查明确归属的 PID/socket。不得用新一轮覆盖失败目录。

wrapper 的短回归使用 `pnpm exec node --test .cursor/skills/verify-pi-subagent/scripts/wrapper.test.mjs`，分别验证 ENOENT、准备失败、忽略 TERM 后强停和正常结束的摘要、日志及 scratch 行为。它们验证 wrapper，不计入产品 29 项行为通过数。真实中断仍须在已有 child 的 CLI 旅程中发送 SIGTERM，核对原生 journey 的清理凭据。

## Detector check

需要确认暂离断言能发现旧漏洞时，运行 `pnpm exec node .cursor/skills/verify-pi-subagent/scripts/run.mjs "subagent-leave-fault-$(date +%s)" leave-fault`。该入口预期退出 1，唯一故障开关在本次 controller 的 select 返回边界，把实际选择的 Leave temporarily 交给生产逻辑时变成 End session。`leave-keeps-child` 应在真实 child PID 消失时失败，同时清理完成。它不修改生产源码或 dist，也不宣称复现了任意源码变异。正常 full 入口不启用此开关。
