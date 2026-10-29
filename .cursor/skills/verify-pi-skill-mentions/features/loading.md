# Skill loading and snapshot delivery

验证 skill-mentions 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `skill-multi`：同请求多个 skill 生效。
- `skill-dedupe`：重复引用去重。
- `skill-punctuation`：右侧合法句读触发。
- `skill-unknown`：未知引用保留原文。
- `skill-unreadable`：不可读引用保留原文。
- `skill-native-card`：成功使用原生卡片。
- `skill-request-snapshot`：每个请求保留独立内容快照。

## How to get to it (user POV)

同一请求 $alpha $beta $alpha；$research，继续；/skill:alpha。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- skills helper 通过本地 pi install 加载当前 checkout 的 dist，不做 pnpm 发布包安装；发布 tarball 另跑 skill-mentions:acceptance。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run skills`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui skill-mentions`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 检查 provider events 中实际收到的 skill 内容和 user task，重复项只读一次，未知/不可读原样保留；TUI 显示原生卡片和成功标签。修改 skill 后新请求用新内容，恢复旧消息仍显示旧快照。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/skill-mentions/__tests__/flow.test.ts extensions/skill-mentions/__tests__/loading.test.ts extensions/skill-mentions/__tests__/protocol.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

本地读取结果和 provider 输入都要保存，只有标签外观不足。原生 /skill: 是独立入口，确认 driver 是否实际覆盖再报告。

不可读分支再执行 `pnpm exec node extensions/skill-mentions/__tests__/journeys.mjs permission`。驱动对已发现的 beta 设置 chmod 000，先断言实际无读取权限，再提交含 beta/alpha 的任务，核对 beta 原文保留、alpha 成功且 UI 无读取错误。恢复 644 后新请求必须成功读取 beta。以管理员身份运行导致权限前置条件不成立时，记录 blocked，不能改用删除文件冒充权限拒绝。

`skills-combination` 验证 V1/V2/V3 快照和删除后上下文。快照变更另跑 [mutation 入口](../SKILL.md#launch)，同一断言必须在 baseline 通过、缓存变异的 V2 读取处失败、恢复后通过。只在仓库内副本改源码并编译，不修改正在被其他验证使用的生产 dist。

验收依据为 [flow.test.ts](../../../../extensions/skill-mentions/__tests__/flow.test.ts)、[loading.test.ts](../../../../extensions/skill-mentions/__tests__/loading.test.ts)、[protocol.test.ts](../../../../extensions/skill-mentions/__tests__/protocol.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
