# Goal budget acceptance

## Current accounting boundary

下方为 #7 的历史记录。当前根与受管直接子代理均使用 `input + output + cacheWrite`，排除 cacheRead，reasoning 已含于 output。缺失/非法/未经证实的全零 usage 在有无预算时均警告并继续，历史缺口不会因后续有效 usage、编辑、恢复或重载消失。预算只能约束已观察用量的自动续跑，不是硬 token 或费用上限。跨 provider 支持、停止后的报告基线和新验收入口见 [Goal provider support](goal-provider-support.md)。

## Status

实施级别：#7 主代理预算与统计已实现，待协调者独立验收；不自行关闭 Issue。[交付证据评论](https://github.com/wangxuyang1221/adventure/issues/7#issuecomment-5602949981) 已追加，正文更新读回为 OPEN，写权已交回协调者。基准为 `f4a7e44b43070748f082523b7377b165c9471e9e` 加已验收的未提交 #4/#5/#6。本报告不把子孙归集、外部代理或美元硬封顶算作已完成。

## Contract And Sources

- [完整规格 #3](https://github.com/wangxuyang1221/adventure/issues/3)、[实施 #7](https://github.com/wangxuyang1221/adventure/issues/7)。C11/C12 沿用，不包装 provider、不接入 editor、不改 Pi 核心。
- 固定 [Codex 0.153.4 accounting.rs](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/accounting.rs)、[runtime.rs](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/src/runtime.rs)、[budget_limit.md](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/ext/goal/templates/budget_limit.md)。普通错误只停止 active，不覆盖已落盘 budget_limited；额度错误可覆盖为 usage_limited。提示保留原文及许可证。
- Context7 查询只覆盖 main，未将其当作固定版证据。实际依据为安装的 `@earendil-works/pi-ai` 0.84.3/0.85.1 的 `dist/api/openai-codex-responses.js`、`openai-responses-shared.js` 和对应 Pi `dist/core/agent-session.js`。原生映射 `input = input_tokens - cached_tokens - cache_write_tokens`，`output = output_tokens`，reasoning 为输出内含元数据。已归一化 input 不再减 cacheRead，output 不再加 reasoning。
- 真实宿主 `sendCustomMessage` 在 `triggerTurn:false` 时不进入 steering 分支。因此收尾采用 `{deliverAs:"steer"}`，不能附带 false；该问题由双版本真实 SDK 夹具揭露，单元 mock 未覆盖。

## Implementation

- `extensions/goal/src/budget.ts`：只读 `getAgentDir()/goal.json` 的 `maxGoalTokenBudget`。缺省不设限；已配置上限兼作默认；显式预算不得超过上限；只接受正安全整数，拒绝未知字段、null、非法 JSON。无写用户配置操作。命令不解析预算旗标。
- `accounting.ts`：请求前绑定 goalId/generation/owner，final message 结算，创建前及被替换目标的晚到消息不计入当前目标。持久化累计 source checkpoint 和最后 receipt；启动扫描宿主历史一次，以 responseId 优先去重。不按 streaming delta 写盘，不使用 tokensBefore/footer totalTokens。原生压缩/分支摘要只使用公开 usage。
- `storage.ts`：用量和 checkpoint 同一原子提交，重试不加倍；保留实际超额值。使用单调时钟累计 active 整秒及当前预算收尾时间；暂停、空闲已耗尽和离线不计时。创建/替换清零，编辑/恢复/继承不清零。
- `scheduler.ts`、`tools.ts`、`upstream.ts`：一次软收尾提示，保留当前回合工具执行及后续可见用量，不启动下一自动回合；确实完成时仍可标 complete。额度错误、普通错误、运行中 Esc 按既定状态优先级结算。摘要、工具响应显示实际/剩余预算及缺失 usage 诊断。

## Evidence Boundary

`budget-fixtures.mjs` 注入离线 Responses API SSE 响应，经过两版**实际原生 Codex adapter**、SDK 和 TUI；不是自写 usage mapper，不是付费真实模型抓包。全局外网 fetch 被禁止，记录 networkAttempts 为 0。JWT 仅为离线形状夹具，无真实凭据。

已知原始输入120、缓存40、输出20（含reasoning8），原生归一化为 input80/cacheRead40/output20，目标累计100；再收到7+3累计110。缺失 usage 时 adapter 可能初始化全零，此时不能证明精确零消耗；保存 `usageIncomplete`，保留已观察值并警告。错误/取消未暴露 usage 的部分无法恢复真实数量，不虚构数字。

去重 seen 集合随本会话已结束响应数量增长，启动 O(history)，正常响应 O(1) 查重、固定大小累计 checkpoint；不宣称无限历史常数内存。断电最多恢复最后成功检查点，未收到/未保存的 usage 不能保证零丢失。非正常退出最后一个不足整秒区间不保证保存。

## Tests

环境：Node.js 22.22.2、pnpm 11.9.0、conda codex-py312 Python 3.12.13；Pi 0.84.3 与 0.85.1。

- TDD 日志 `.scratch/goal-7-red-*.log` / `green-*.log`：配置、累积检查点、单调时间、命令配置、一次收尾、耗尽后后续用户回合不计费、落盘 receipt 重放、null 配置。真实 SDK 的 Red/Green 另覆盖原生 steering 参数、压缩 usage 和错误优先级。后加回归覆盖替换晚到消息及失败 checkpoint 重试。
- 单元：`.scratch/goal-7-final-unit.log`，6 文件63测试通过，包含 110/100、重复事件、离线时间、收尾时间、恢复编辑保留。
- 双版本原生 adapter/SDK：`.scratch/goal-level7-final-sdk-retry-{0843,0851}/results.json` 和各场景 `events.json`、`adapter-mapping.json`。每版11场景：110/100、纯文本跨限收尾、收尾真实完成、普通错误未跨限、模型创建前基线、重复 responseId、预算收尾原生重试后仍110且只提醒一次、跨限后额度错误、带 usage 的跨限错误、缺失 usage、原生压缩1021精确累计。
- 双版本实际 InteractiveMode PTY：`.scratch/goal-level7-final-tui-{0843,0851}-{soft,baseline,quota,interrupt}/`，每版4场景，保存 `terminal.ansi`、事件和结果。验证仅一次预算上下文，110/100、创建前1000排除、quota→usage_limited、Esc→paused、编辑取消 objective 不变、resume/reload 不重置、无额外请求。
- #4/#5/#6 SDK 回归：`.scratch/goal-7-final-{runtime,execution-runtime,processes}-{0843,0851}.log` 及 `goal-7-final-lifecycle-runtime-{0843,0851}-green2.log`，全部通过。生命周期旧断言曾把发生真实响应后的统计要求为完全不变，改为保持身份和统计基线不降低；无请求时继承快照仍逐字段相等。
- #6 双版本 TUI 回归：`.scratch/goal-7-final-regression-{0843,0851}-*.log`，每版14场景通过：retry-c12、stream-interrupt、stream-pause、tool-interrupt、edit-cancel、replace-cancel、c11、retry-dialog、input-steer、input-followup、compact-success、compact-failure、compact-cancel、compact-manual。原先37 tokens/11秒的旧固定断言随正式计费调整为不低于保存基线；状态、请求数、用户文字、其他扩展消息及 C11/C12 断言保留。
- `soft-b` 早期 PTY 驱动曾把 Esc 后命令串入 editor，原断言未检出；该证据无效。驱动已在读 PTY 时延迟输入并新增 objective 精确断言，以上 final 场景重新通过。失败日志保留，不冒充最终通过。

## Reproduce

```sh
pnpm exec vitest run extensions/goal/__tests__
pnpm exec tsc -p extensions/goal/tsconfig.json
GOAL_BUDGET_EVIDENCE=.scratch/budget-sdk node extensions/goal/__tests__/budget-runtime.mjs node_modules/@earendil-works/pi-coding-agent
GOAL_BUDGET_SCENARIO=soft conda run -n codex-py312 python extensions/goal/__tests__/budget-tui-driver.py .scratch/budget-tui node_modules/@earendil-works/pi-coding-agent
pnpm run check
```

第二版以实际 0.85.1 安装目录作为最后参数。所有测试数据和环境目录注入仓库；不安装/修改全局配置。PTY driver 在 finally 回收进程组，SDK finally dispose，processes 夹具等待子进程退出。最终清理与完整 check 结果见下节。

## Final Verification

`pnpm run check` 全部通过，日志 `.scratch/goal-7-final-check.log`：类型检查、70测试文件通过/1跳过、866测试通过/1跳过、构建及7个扩展发布包校验通过。跳过项为既有 subagent 在线集成测试，未执行付费模型调用。`git diff --check` 通过。

`.scratch/goal-7-cleanup.json` 核验本任务40个记录的 PTY PID 均退出，监听端口0；SDK/processes 脚本均结束并 dispose，进程列表无 goal 测试遗留。未启动 HTTP 服务。所有证据留在仓库 `.scratch/`，不提交、不推送、不部署。早期失败实验仅作诊断保留。
