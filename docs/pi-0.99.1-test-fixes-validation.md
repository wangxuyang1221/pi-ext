# Pi 0.99.1 test fixes validation

## Scope

用户在 Fast/Goal 调研后授权修复测试。本轮只修改 `extensions/subagent/__tests__/fast-production.test.ts` 和 `extensions/goal/__tests__/provider-runtime.mjs`，同步文档。保留此前升级改动，不修改生产 `src/`、Write 测试或 tmux 锁逻辑，不提交、发布或部署。

环境为 macOS、Node `v22.22.2`、pnpm `11.9.0`，仓库 Pi 四个相关包均为 `0.99.1`。证据在 `.scratch/pi-0.99.1-test-fixes/`。Linux/Windows 本轮未运行。

## Fast

原正式用例在首轮复跑即于第 185 行失败，见 `fast-red-1.log`。修正仅针对 child `b`：使用原有 12 秒 `until()` 等待首个 finalized assistant entry 落盘，再从同一个 transcript 快照比较两个索引。额外断言 Fast entry 存在且 `enabled: false`、assistant entry 存在，避免负索引误判。

没有给所有 spawn 增加等待，故意阻塞首个响应的 child `a` 仍可验证“回复前状态已保存和开关可修改”。没有增加固定 sleep、扩大超时或删除原场景。

正式完整用例连续三次通过，见 `fast-green-{1,2,3}.log` 及对应 JSON。每次均保留全部 13 个配置隔离 checkpoint，以及角色、继承/显式覆盖、reload、恢复会话和错误降级检查。

## Goal

原 stale continuation 的四种输入现按两种 abort binding 分别验收，共八个场景：none、steer、followUp、foreign，分别使用 TUI binding 和默认 SDK binding。其他 provider、工具恢复、预算、替换目标与准入场景保留。

- TUI 调用安装包真实 `InteractiveMode` 的队列清理和编辑器恢复方法。仅编辑器存储和终端显示使用无终端的测试对象；这不是完整 PTY 端到端证明。
- 用户输入通过公开 `session.steer()` / `session.followUp()`，等待返回 `queued`。外部 custom message 通过公开 `sendCustomMessage()`，不注入私有队列。
- TUI follow-up 按历史 C11 验证退回编辑器，同时保留已有 `UNSENT_DRAFT`；foreign 消息可以被清除。已送达的 steer 仍自动执行。
- 默认 SDK follow-up 和 foreign 留在队列，取消后不自动执行。分别检查队列数量、消息类型和内容，避免把 custom message 未出现在用户文本列表中误当成丢失。
- 验证取消前已有历史在内存与真实 JSONL 中都不变，持久化 Goal 的 identity、generation、objective 和累计 usage 不被清除，工具恢复门禁仍在。
- 用户 follow-up 另验收显式恢复：TUI 将编辑器文字重新提交，SDK 通过公开 `clearQueue()` 取回文字再提交。第二次请求确实包含保留输入，队列最终清空，Goal identity 和恢复门禁不变。

### Compatibility boundary

测试报告分别输出 `automaticRequests`、`resumedRequests`、`pendingUserInput`、`pendingMessages` 和 `editorText`。follow-up 的结果是取消后共 1 次请求，显式重新提交后总计 2 次，不能把总数 2 当成自动执行已恢复。

默认 SDK 的历史“两次请求自动执行”保证仍未恢复。对应场景输出明确的 `compatibility` 字段，并保留 [Goal 调研](pi-0.99.1-goal-followup-test-research.md) 的旧版本通过记录。这次调整将 TUI C11 验收与 SDK 当前行为拆开，没有移动原有入队位置、改为批量消费队列或改生产调度来掩盖差异。

### Red and green

先写 TUI 预期、保留原缺少 abortHandler 的夹具，运行后 `stale-queued-continuation-tui-followUp` 因用户输入仍排队而失败，见 `goal-red/command/run.log`。接入实际 TUI 取消方法后通过，再加入真实 JSONL 历史完整性断言，继续通过。

整个 provider runner 共连续三次通过，最终为 26 个场景、65 次离线请求。证据为 `goal-green-{1,2,3}/command/run.log`。期限仍为原 10 秒，没有删掉场景或条件跳过。此前纯粹检查没有 `stopReason: aborted` 的断言由实际输入去向、请求次数、历史和 Goal 完整性验证替代，因为宿主取消也可能生成 `stopReason: error`，不能靠枚举名判断用户文字是否丢失。

## Final validation

| Command | Result | Evidence |
| --- | --- | --- |
| Fast isolated integration | 连续三次完整通过 | `fast-green-{1,2,3}.log` |
| Goal provider runtime | 三次通过，最终 26 场景、65 请求 | `goal-green-{1,2,3}/command/run.log` |
| `pnpm run host:accounting:check` | 整组通过，包含根 accounting 74 场景/288 请求、子进程 16 场景、provider 26 场景以及原先 fail-fast 未执行的 terminal 路径 | `accounting.log` |
| `pnpm run check` | 两次均为 2639 passed、3 failed、13 skipped；类型检查通过，后续链被测试失败阻断 | `check.log`、`check-repeat.log` |
| Independent wrapper regression | 8 passed | `wrapper-recheck.log` |
| `pnpm run build` | 独立补验通过 | `build.log` |
| `pnpm run package:check` | 通过 | `package.log` |
| `pnpm run host:check` | 源码/dist 各八个入口加载通过 | `host.log` |

主检查仍未全绿，三个失败不隐藏：

1. Write 的 null/number 拒绝断言仍失败，因宿主实际转换成字符串后写入。本轮未获针对 Write 的具体修正选择，不改这两个用例。
2. wrapper 的真实 Vitest 取消用例在两次全套运行中均出现“worker 和端口已停止，但隔离 HOME 仍存在”的失败。单独运行八个 wrapper 用例通过，原因未定位。本轮没有修改 wrapper 或放宽其断言，也不能用单独通过抵消全套失败。

Fast 和 Goal 的独立验收通过不等于主检查通过。tmux 空锁按用户要求未处理，也未重跑完整 tmux 矩阵。

## Cleanup

Fast 用例的 finally 均关闭本任务私有 tmux server，记录 PID 全部退出、socket 不可用。Goal runner 清除 timer、关闭 session 并删除临时运行目录；accounting 驱动也报告进程组停止。失败的 wrapper 用例由测试监督 finally 关闭受控 listener 和子进程并删除隔离目录。

结束时复查 47 个日志记录的任务 PID，均已退出；未发现本轮 Fast、Goal provider 或 wrapper 的存活命令，Fast/Goal 临时目录均已删除，见 `cleanup.json`。`git diff --check` 和 provider runner 语法检查通过。没有修改全局 Pi、真实凭据、用户配置或用户会话，未调用付费模型。
