# Goal journey drivers

`extensions/goal/__tests__/verification.mjs` 是维护中的实际 TUI 入口。先按 [skill](SKILL.md) 完成构建与 doctor，再从仓库根目录运行。所有命令使用合成 provider；budget 与 accounting 经过生产 native adapter，其余模型响应使用 faux provider。目标命令、选择器、存储、模型工具执行与会话切换使用生产代码。

```bash
pnpm exec node extensions/goal/__tests__/verification.mjs matrix tools
```

## Journey selection

把下表参数接在上述脚本路径之后。每个参数组合独立运行，不从前一次证据目录恢复 scratch。

| Parameters | Feature IDs and observable assertions |
| --- | --- |
| `lifecycle` | `goal-create`、`goal-edit`、`goal-clear`、`goal-resume`、`goal-recover-session`、`goal-tombstone`、`goal-native-clone`。创建、编辑统计保留、拒绝替换、重开拒绝恢复、原会话恢复、清除后冷开，原生 clone 无目标。 |
| `matrix lifecycle` | `goal-replace`、`goal-details`、`goal-pause`。接受替换后只结算新 activation 的用量；方向键和 PgUp/PgDn 滚动、详情 p 暂停、Enter 关闭后保持状态。 |
| `matrix tools` | `goal-get`、`goal-create-tool`、`goal-update-tool`。模型实际发起空目标 get、无目标 update、非法正文/预算、重复创建、非法状态和额外参数；核对每个 toolResult 与权威记录。小数预算必须拒绝，不能接受宿主转换后的整数。 |
| `matrix config` | `goal-budget-default`。非法配置拒绝创建，修正后 reload，超限拒绝、未指定预算使用配置上限。 |
| `matrix missing` | `goal-tool-missing`。实际禁用必要工具、显示缺失项；恢复工具和普通输入不恢复目标，显式 resume 后才恢复。 |
| `continuation stream-interrupt` | `goal-escape`。普通 active 流式响应 Esc，首次 settled 为 paused，显式 resume 完成同一目标。 |
| `continuation retry-c12` | `goal-retry`。原生 retry 等待时 Esc，首次 settled 为 blocked，之后显式 resume。 |
| `continuation input-steer` / `continuation input-followup` / `continuation c11` | `goal-steer`、`goal-followup`。真实用户输入及外部消息保留；失效的自有续跑不取消用户消息。 |
| `continuation loop-pause` | `goal-loop`。重复工具结果触发 paused，恢复后清除循环原因。 |
| `matrix empty` | `goal-auto`、`goal-empty`。初始回合之后恰好三个连续空白自动轮次才 blocked。 |
| `matrix 401` / `matrix length` / `matrix deferred` | `goal-settled-error`。分别核对最终错误、长度限制、deferred 转 blocked，统计不丢失。 |
| `recovery` | `goal-before-first-reply`、`goal-recover-orphan`。首次回复落盘前目标已保存；冷启动恢复不存在的会话时先拒绝警告，再接受接管，恢复本身零请求。 |
| `matrix reopen-paused` / `matrix reopen-blocked` / `matrix reopen-usage_limited` | `goal-reopen-confirm`。每种停止状态冷开各执行拒绝和接受；拒绝零请求、目标不变，接受才开始。 |
| `matrix lock` | `goal-lock`。两个真实 TUI 打开同一 session，第二个不能夺锁；第一个仍能读写。另用本次创建的不明身份锁验证拒绝，修复后重开。 |
| `matrix storage` | `goal-storage-error`。在 GoalStore 的 pre-rename 边界注入 EIO，原文件字节不变；修复后普通输入仍保持停止，显式 resume 恢复。 |
| `matrix inheritance` | `goal-tree`、`goal-native-fork`、`goal-fork`、`goal-clone`、`goal-deferral`。从有预算、非零统计的 active 种子出发；当前位置 clone、reload、冷开保留门禁，用户输入解除；真实 tree、历史 goal-fork、原生 fork。比较源文件原始字节及独立 recordId/ownerSessionId。此场景固定存储时钟，避免计时 checkpoint 改动干扰源文件比较。 |
| `content '' 0` / `content '' 1` | `goal-long`、`goal-content-edit`、`goal-attachment-copy`。原生/Codex UI 的真实图片粘贴与 Copy attachment、长正文、冷开编辑；删除临时图片后由生产 read 解码已复制图片。剪贴板完全替换为合成 PNG。 |
| `matrix content-select` | `goal-attachment-text`、`goal-content-cancel`。真实选择 Keep as text、Cancel、带内容包的替换确认取消，核对旧目标与内容包。 |
| `matrix content-validation` | `goal-content-validation`。真实编辑保存超过 1 MiB、33 张附件、超过 20 MiB、源 symlink 和正文 checksum 错误；每次失败后旧目标保持不变。平台路径解析、其他链接/非法引用边界另由定向测试补证。 |
| `accounting root` / `accounting child` | `goal-root-usage`、`goal-child-usage`、`goal-missing-usage`。真实 TUI、native adapter 与独立 child 进程；缺失 usage 警告跨 edit/reload/resume 保留。全部 adapter、去重与 cache 规则再运行共享 `goal-accounting` SDK 入口。 |
| `budget soft` / `budget baseline` / `budget quota` / `budget interrupt` | `goal-soft-budget`、`goal-quota`、`goal-escape`。超限收尾仅一次、实际用量不截断、resume/reload 不新开请求；明确 quota 为 usage_limited。预算收尾 Esc 取消当前请求，保留 budget_limited，禁止新轮次。 |
| `matrix freeze` | `goal-freeze`。paused/blocked/usage_limited/complete 期间显式 root 请求不计入目标；暂停前发起的响应在恢复后仍被 activation fence 排除。直接 child 的停止期 baseline 再运行下一行四种参数。 |
| `child-freeze freeze-paused` / `child-freeze freeze-blocked` / `child-freeze freeze-usage_limited` / `child-freeze freeze-complete` | `goal-freeze`。生产 subagent 工具启动独立 child 进程；先计 10，停止期间报告 50 只推进 baseline，resume 保持 10，再报告 60 后累计 20。四种停止状态分别实跑。 |
| `matrix time` | `goal-time`。非零 active 时间后退出，等待独立离线间隔，再冷开；离线时间不增加累计值，重开后的 active 时间继续累计。 |
| `footer` / `footer --fullscreen` / `footer --native` / `footer --native,--fullscreen` | `goal-footer-codex`、`goal-footer-native`、`goal-footer-fullscreen`、`goal-detail-snapshot`、`goal-minute-refresh`。四入口的分钟边界、静止输出、resize；打开详情等待秒数不变，关闭再打开秒数必须增加。 |

## Evidence

每次运行打印唯一 evidence 路径，默认位于 `.tmp/test-results/goal-<journey>-<id>/`。共享 helper 提供 `PI_VERIFY_EVIDENCE` 时，在该目录内再创建唯一子目录。`summary.json` 记录确切命令、版本、PID、退出码与清理结果，`output.log` 保留断言失败，`proof/` 保留原始 ANSI、session JSONL、provider 请求/上下文、动作和适用的屏幕快照。budget 还以 `bodyBase64` 保存 native adapter 的原始请求字节，并记录 `contentEncoding`，保留宿主实际使用的压缩格式。

实际模型请求证据在 `events*.jsonl` 中的 `context`、`request` 或结果的 `requests` 字段。footer 只验证显示，模型请求被阻止，不能把它当执行或工具链证明。短生命周期 scratch 退出后删除，证据目录保留。检查 `alivePids: []`、空 `listeningPorts` 和 `cleanup: removed` 才能通过。

## Remaining boundaries

真实账号额度、远端 provider 行为与未打补丁宿主需要单独实跑，本地合成 SSE 不证明这些外部条件。没有执行的参数组合记录 unverified；缺少外部条件记录 blocked。源码单元测试与 SDK 场景只能补证其实际覆盖的边界。

## Runner regression

修改归档、隔离或取消清理时再运行：

```bash
pnpm exec node extensions/goal/__tests__/verification-regression.mjs
```

此入口启动实际 TUI 后对外层 Node 发送 SIGTERM，核对 driver 与独立 PTY 组均停止、ANSI 和请求仍保存。另触发实际 driver 失败并注入 proof copy 错误，核对 summary/output 仍可读、异常 scratch 保留。回归驱动在恢复原始证据后自行删除该次保留的 scratch，并写 postcheck。普通断言失败保留证据；清理或取证失败时，正式 wrapper 留下 scratch 并以失败退出。

默认信号路径另运行 `pnpm exec node extensions/goal/__tests__/default-signal-regression.mjs`。它在普通 lifecycle 和 footer 详情中途发送 SIGTERM，核对 actions、screens、ANSI、session 和完整 PID 清理；再在 fork 返回但调用方尚未登记 PID 时发送 SIGTERM，验证统一信号 helper 先原子保存 owner 再恢复信号。九个 Python 入口均使用该 helper，SIGTERM 会进入 finally；信号处理还会先保存当前动作和画面，供超时强制清理时取证。
