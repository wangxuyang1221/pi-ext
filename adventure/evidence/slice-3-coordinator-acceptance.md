# Final coordinator acceptance

## Result

[Implementation #19](https://github.com/wangxuyang1221/adventure/issues/19) 第一次协调者验收通过，阶段 A 与 B 均通过。产品提交为 `7bff254d732c769d2e88474da645bf911fc5f6f8`。三关 Implementation 均可关闭，Map 和 Spec 保持 open，等待用户确认交付。

核对 [Spec audit](./slice-3-spec-audit.md) 与完整 Spec 的 Goal、Scope、Behavior、Design、Acceptance 和 Deferred verification，各必需项都有前序验收或本关新增证据。没有把真实远端未实测冒充通过，也没有把必需离线、原生 adapter、实际 TUI 或直接子代理链路降级为可选项。

## Independent verification

协调者读取产品差异、正式文档、原生协议夹具、TUI driver 和包加载夹具，并独立执行以下检查：

| Check | Result |
| --- | --- |
| `env -u PI_SUBAGENT_PARENT pnpm run check` | 1067 测试通过，2 项默认跳过，类型检查、构建及包校验通过。见[日志](./slice-3-coordinator-check.log) |
| `accounting-runtime.mjs` | Pi 0.84.3/0.85.1 各 74 场景、288 请求通过，包括原生 Completions/Responses/Anthropic/Google/Codex 和独立 custom 样本 |
| `accounting-child-runtime.mjs` | 两版各 16 场景、16 真实 child 进程通过，包括跨来源 70→110、缺口、receipt、冻结 10→50→60 |
| 实际 InteractiveMode PTY 抽验 | 0.84.3 根无预算、0.85.1 child 预算1000 两组通过，警告及 edit/reload/resume 后 7 token 与旧缺口可见 |
| 实际打包产物 | 独立 `pnpm pack`、解压及 artifact 检查通过；两版各加载全部7入口，4类非Codex原生流程、20请求通过 |
| 差异与清理 | `git diff --check` 通过，独立测试临时目录已删除，78个归档测试/worker PID均已退出 |

实际 PTY 抽验和包复验摘要见 [coordinator runtime](./slice-3-coordinator-runtime.json)。使用的正式复现命令见 [Accounting reproduction](./slice-3-accounting.md#reproduction) 与 [Spec audit reproduction](./slice-3-spec-audit.md#reproduction)。协调者抽验不替代 worker 已完成的两版8组 PTY、真实 tmux late/pending 及完整包内计量矩阵，这些证据也已核对。

## Design and delivery review

- 产品变更只在子代理计量成功提交后检测首次缺口并警告，没有改公式或新建计费路径，符合已有冻结规则。TDD Red、Green 和3项新增单测有记录。
- 原生 adapter 确实由目标版 pi-ai 导入并解析离线 wire 数据，没有自写归一化 mapper。Google 实际 cacheWrite 为0，80+10+0的90样本核验其真实映射；50+10+30公式由其他家族与正式公式测试覆盖。
- 实际包包含新的 `docs/goal-provider-support.md`，README及旧 descendant 文档已纠正支持范围、公式和完成后的迟到计量。其余历史验收标明历史适用范围，不改写前序验收事实。
- #17/#18 产品保持，worker 双版本重新跑 provider/terminal/execution，终态、工具关闭后的最后usage和预算优先级没有回退。之前协调者独立验收继续有效。
- 最后一个 worker 已对照完整 Spec 完成 A/B 和延期审计。没有其他待实现或必需未验证项。

## Cleanup and limits

三名本场 worker runtime 已关闭。协调者检查78个不同PID，无存活项；worktree cwd检查只见当前检查命令。任务测试进程均已退出，无任务监听端口；`.goal-*`、`.slice-3*` 和 `.coordinator-*` 临时目录无残留。临时包已删，正式复现脚本、包清单和测试证据保留。

未进行真实远端或付费provider端到端、所有私有额度文案、Windows/Linux实际TUI、断电恢复、在线subagent integration。默认check跳过2项，其中隔离integration由worker另行通过，在线项仍未执行。这些限制与获批范围一致。未改main或Pi核心，未创建PR、合并、部署或发布registry。

下一步是用户确认本地分支交付，不再自动实施。确认前 Map/Spec 保持 open；远端冒险分支不自动删除。
