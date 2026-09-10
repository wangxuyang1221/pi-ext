# Goal budget implementation

## Understanding

实施 adventure #7 的主代理计费与软预算，沿用已验收 #4/#5/#6。固定 Codex 0.153.4 commit 3d2ee51ca2d5db578f328aa75e20aa22c0197c9a，验收 Pi 0.84.3/0.85.1。

## User Visible Changes

- 创建目标后累计主代理非缓存输入和输出，显示实际用量、剩余预算和 active 时间。编辑、恢复不清零，创建前消耗不追溯。
- 可选最大预算同时作为省略预算时的默认值，显式超限创建失败。`/goal --budget` 仍为 objective，不增设解析。
- 达到预算只提醒当前回合收尾一次，保留超额实际用量并停止自动续跑。缺失 usage 显示统计不完整诊断。

## Todo

- [x] 核对固定 adapter、存储/调度调用顺序、配置入口和单调时间检查点，建立前置回归基线。
- [x] 实现配置校验及默认预算，保持命令原解析。
- [x] 实现目标代次绑定、用量检查点与去重、active 单调时间，覆盖创建/替换/恢复/错误交错。
- [x] 实现一次预算收尾提醒和停止续跑，保留当前回合超额结算。
- [x] 增加离线真实 adapter、双版本 SDK/TUI 验收资源，运行前置回归及完整 check。
- [x] 将证据追加到 #7 并更新正文读回，交回写权，不关闭 Issue。

## How To Test

- 每项行为先写失败测试再实现，记录 Red/Green 命令及结果。
- 预算100，adapter 输入120缓存40输出20含reasoning8，首次计100，后续10合计110，提醒一次、无硬取消、无下一自动回合。
- 创建前消息、重复消息、替换后旧事件不计入；编辑/恢复保留110。缺失或非法 usage 不伪造精确值。
- 注入单调时钟验证 active 累计、暂停/离线不计时；错误/额度/重试交错不漏账且状态符合规格。
- 事件不按 streaming delta 写盘；去重/检查点成本不随 token delta 数量增长。
- 真实双版本 SDK/TUI 离线夹具验收，禁止付费请求。复跑 #4/#5/#6 及 `pnpm run check`，记录进程停止和监听端口释放。

## Notes

- 交付证据：https://github.com/wangxuyang1221/adventure/issues/7#issuecomment-5602949981 。报告 [Goal budget acceptance](./goal-budget-acceptance.md)。实施完成不等于协调者已验收。
- 子孙与外部代理、美元硬封顶归后续范围。
- C11/C12 不变，不接入 editor 或 provider 检查层。
- 配置和产品英文文案按 #3 已授权范围，测试所有写入注入仓库内。
