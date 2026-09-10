# Goal scheduling blocker

## Status

本报告保留 C11 确认前的历史 Red 证据。[C11](https://github.com/wangxuyang1221/adventure/issues/2#issuecomment-5600566440) 已接受这里的限定队列副作用，不再以此阻塞原路线。恢复实施后的实际产品 C11 测试已双版本通过；新的原生重试 Esc 分类失败及未完事项见 [execution report](./goal-execution-report.md)。下文源码未改、无产品行为变化等描述仅适用于前次诊断阶段。

实施关 [#6](https://github.com/wangxuyang1221/adventure/issues/6) 阻塞，未交付自动执行功能。依据 [spec #3](https://github.com/wangxuyang1221/adventure/issues/3) 的调度契约与 V1，及 #6 明确规定的“公共接口无法满足输入保护时返回规划”。

基准 `f4a7e44b43070748f082523b7377b165c9471e9e` 加已验收 #4/#5 未提交工作区。只新增诊断夹具和本报告，未修改 goal 产品源码、其他扩展或宿主。没有 commit/push/deploy。

## User visible changes

本轮无产品行为变化。原计划是在仅保存目标的基础上增加自动推进、三个模型工具、edit/pause/resume、错误停止和状态显示。调度候选未通过前置反例，以上行为均未交付。

## Todo

- [x] 核验 #3/#6、前置 #5 验收与原生 closed 依赖，保留工作区。
- [x] 读取固定 Codex 工具描述、响应和 continuation 源码，以及 Pi 双版本公开扩展接口与实际 TUI abort 路径，运行既有测试基线。
- [x] 建立真实 PTY + InteractiveMode 诊断夹具，核验 SDK/TUI 差异、其他扩展消息和真实键盘 follow-up。
- [ ] 按 TDD 实现工具、状态迁移与提示边界。因主调度路线阻塞未开始。
- [ ] 按 TDD 实现调度、输入保护、错误停止和完整 turn 审计。须先解决下述反例。
- [x] 运行全仓 check 与双版本 #4/#5 回归，保存失败证据并交回。

## How to test

本次先核验最危险的前置假设，不把夹具中模拟的 paused 状态冒称产品实现。两个版本都运行原装 `InteractiveMode`，Python 标准库 PTY 写入 `/probe` 和 `/probe-exit`，没有用受控 `ctx.ui` 代替真实 TUI。免费 `fauxProvider` 提供模型响应，关闭网络，所有测试记录只写仓库内目录。

场景如下：

1. 首次模型响应结束时，通过公开 `pi.sendMessage` 依次排入一个 goal continuation 和另一扩展的 custom follow-up。
2. 后续监听者使夹具 goal 失效，模拟暂停或替换发生在入队之后。
3. `context` 对失效的自有提醒调用 `ctx.abort()`，同时返回过滤后的上下文。这是规划实验支持的候选门禁，不是最终调度器。
4. 检查模型调用数、底层 end 数量、其他扩展消息是否进入上下文与持久化会话、编辑器文本和网络调用数。

预期应只有初始与另一扩展的两次模型请求，不执行旧目标请求，且保留其他扩展消息。`GOAL_PROBE_ASSERT_PROTECTION=1` 对此断言。

另有两项对照：不调用 abort、只过滤自有提醒；以及同样扩展代码使用默认 SDK abort 绑定。真实键盘变体在 context 检查窗口通过 PTY 输入文本与 Alt+Enter，事件确认 `source: interactive`、`streamingBehavior: followUp`。

## Results

环境 macOS、Node v22.22.2、pnpm 11.9.0。Pi 实测版本 0.84.3 和 0.85.1。Context7 `/earendil-works/pi` 只有 main 文档，版本行为以已安装对应版本官方源码和本次运行结果为准。

两版本结果一致：

| Binding and case | Model calls | Low-level ends | Other extension message | User follow-up |
| --- | --- | --- | --- | --- |
| 默认 SDK 绑定，context abort + filter | 2 | 3 | 保留并执行 | 本对照未添加 |
| 真实 TUI，context abort + filter | 1 | 2 | 丢失，未进入上下文、会话或编辑器 | 本对照未添加 |
| 真实 TUI，只 filter、不 abort | 3 | 2 | 保留并执行 | 本对照未添加 |
| 真实 TUI，context abort + 真实 Alt+Enter | 1 | 2 | 丢失 | 退回编辑器，未执行 |

纯 custom 队列下 `ctx.hasPendingMessages()` 返回 false，不能以此决定安全 abort。用户 follow-up 没有丢字，但由插件内部清理触发了退回编辑器；另一扩展的消息没有恢复路径。

两个版本的保护断言实际退出 1，错误为 `AssertionError: Unrelated extension message was lost by stale-goal cancellation`。这是验收 Red，未通过削弱断言或替换 SDK 绑定做成 Green。默认诊断模式退出 0 仅表示采集完成，不表示输入保护通过。

### Cause and alternatives checked

真实 TUI 的 `bindCurrentSessionExtensions` 为公开 `ctx.abort()` 绑定 `restoreQueuedMessagesToEditor({ abort: true })`。该方法先 `clearAllQueues()`，后 `agent.abort()`。`AgentSession.clearQueue()` 只返回用户文本数组供编辑器恢复，却会通过 `agent.clearAllQueues()` 删除所有底层队列，包括未归入用户数组的 custom messages。

本地代码定位：

- Pi 0.84.3 `dist/modes/interactive/interactive-mode.js:1445-1452,3552-3565,3584-3603`，`dist/core/agent-session.js:1144-1152`。
- Pi 0.85.1 同文件 `1400-1407,3583-3596,3615-3634`，`dist/core/agent-session.js:1195-1203`。
- `extensions/runner.js` 的 `emitContext` 和 `emitBeforeProviderRequest` 捕获 handler 异常并继续，抛异常不是可用的请求取消协议。仅过滤提醒已经通过真实 TUI 对照验证，仍多出一次旧目标触发的模型请求。

当前公开 ExtensionContext 没有选择性撤销一条 custom follow-up、枚举并重排所有队列、或绕过 TUI 队列清理的 abort 方法。因此不能直接把已有 SDK `context-abort` 候选移入产品。没有读取私有 session 对象、修改 abort handler、禁用压缩或覆盖用户队列。

这证明当前主要候选路线失败，不证明所有纯扩展方案都不可能。比如公共 provider 层拦截属于另一条尚未验证的路线，需重新核验模型注册、信号、恢复与会话隔离，不应直接宣称可行。按照 #6 边界先回流 #2，由协调者决定规划续接，不在实施时悄悄接受丢消息或额外模型请求。

## Reproduction

夹具：

- `extensions/goal/__tests__/tui-abort-probe.mjs`
- `extensions/goal/__tests__/tui-abort-driver.py`

每次使用新的证据目录，脚本拒绝混用已有 `events.jsonl`。

```bash
# 预期失败：真实 TUI 的输入保护验收。
GOAL_PROBE_ASSERT_PROTECTION=1 conda run -n codex-py312 python \
  extensions/goal/__tests__/tui-abort-driver.py \
  .scratch/goal-level6-evidence/reproduce-red \
  node_modules/@earendil-works/pi-coding-agent

# 真实键盘 follow-up 变体。
GOAL_PROBE_TYPED=1 conda run -n codex-py312 python \
  extensions/goal/__tests__/tui-abort-driver.py \
  .scratch/goal-level6-evidence/reproduce-typed \
  node_modules/@earendil-works/pi-coding-agent

# 不 abort 对照，诊断完成但多一个旧目标触发的模型请求。
GOAL_PROBE_GUARD=0 conda run -n codex-py312 python \
  extensions/goal/__tests__/tui-abort-driver.py \
  .scratch/goal-level6-evidence/reproduce-no-abort \
  node_modules/@earendil-works/pi-coding-agent

# SDK 对照，不是真实 TUI 验收。
GOAL_PROBE_SDK=1 GOAL_PROBE_ROOT=.scratch/goal-level6-evidence/reproduce-sdk \
  node extensions/goal/__tests__/tui-abort-probe.mjs \
  node_modules/@earendil-works/pi-coding-agent
```

0.85.1 的 package root：

```text
/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.85.1/4011d0a1b084fee9580232c1f0d858a8429fe70851ed74fe182409e63aa52ab9/node_modules/@earendil-works/pi-coding-agent
```

本地证据保存在 `.scratch/goal-level6-evidence/`：`tui-0843`、`tui-0851`、`tui-typed-*`、`tui-no-abort-*`、`sdk-*`、`red-*`。各 TUI 目录包含终端原始 ANSI、事件 JSONL 和实际会话 JSONL。原始事件中的 other-extension 缺失与 SDK 对照同时保留，不只保存结论。

## Regression and limits

- 基线及最终 goal 单测 25 项通过。
- `pnpm run check` 通过，828 passed、1 既有 skipped；类型检查、构建、发布包检查通过。构建没有手改 dist。
- 两版本各运行 `lifecycle-runtime.mjs` 15 项、`runtime.mjs` 6 项、`processes.mjs` 4 项，全部通过。日志 `*-0843.log`、`*-0851.log`。
- `git diff --check` 通过。
- goal 产品源码 SHA256 与 #5 验收值完全一致：index.ts `975196e3b92832b78961e8e567a480993e05bf58176827e337a4cf5da8e61b59`，storage.ts `437eb17a67c2ef672530e4903f7cb24f384ded3e3a8144c04ff50b78d1ca9afe`，lock.ts `377db47a3fb435a4d4927f9b4a6ccb38ccd5588f77bc244948ef3621313772bb`。

V1 只有当前反例和对照证据，核心验收失败，不能关闭。真实 Esc、取消弹窗、重试取消、压缩矩阵尚未执行。V4 工具与完整 turn 实现尚未执行。预算、子孙计费、附件和完整 codex-ui 集成本来就不在本关范围内。

九个 PTY 子进程全部经 `/probe-exit` 正常退出并 waitpid 回收，PID 为 5007、12055、12056、12057、26894、26895、26896、31598、35040。`ps` 与按这些 PID 限定的 `lsof` 复核无残留进程和监听端口。SDK 对照和既有回归进程已退出，进程测试自行清理其临时目录。没有启动监听服务；保留本报告所需的少量会话、ANSI 和日志，不写用户全局目标或配置。

## Sources

- [规格 #3](https://github.com/wangxuyang1221/adventure/issues/3)
- [实施 #6](https://github.com/wangxuyang1221/adventure/issues/6)
- [规划调度实验](https://github.com/wangxuyang1221/adventure/issues/2#issuecomment-5598111320)
- [前置 #5 协调者验收](https://github.com/wangxuyang1221/adventure/issues/5#issuecomment-5599500919)
- [Pi 0.84.3 InteractiveMode 源码](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/modes/interactive/interactive-mode.ts)
- [Pi 0.85.1 InteractiveMode 源码](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/modes/interactive/interactive-mode.ts)
- [固定 Codex goal spec](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/spec.rs)
