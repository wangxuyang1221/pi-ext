# Subagent fixes acceptance

## Result

主代理已独立验收本次 1–6 项修复，全部通过。验收范围是当前版本新建的 child；按用户要求，不处理旧数据和更新前已运行的 child。

| Item | Bug | Accepted behavior |
| --- | --- | --- |
| 1 | prompt 的 wait 可能误认上一轮完成 | 新任务的 cursor 绑定 deliveryId；child 消费消息后写入 receipt，wait 等待对应 generation 完成。覆盖排队、快速完成和旧轮在投递过程中结束。 |
| 2 | 中断后旧 leaf 隐藏已落盘进展，游标可能跳过内容 | 记录 leaf snapshot 的位置，允许读取后续有效分支；增量游标不倒退。覆盖 recent_activity、turns、detail 和树导航。 |
| 3 | 空文本 assistant 错误被过滤 | read、wait 和 renderer 保留 stopReason/errorMessage；长错误及部分文本有摘要上限，完整内容可分页读取。 |
| 4 | 单目标 close 删除 interrupted child 的关系，却未关闭恢复可达的进程 | 删除前核验并关闭恢复可达的 runtime；失败保留关系和容量占用，不误关历史 alias 对应的活跃 sibling。 |
| 5 | turns 输出大小无上限 | 完整 JSON 每页不超过 72 KiB，固定 snapshot 分页，活动不重复不遗漏；长 user 文本可通过 detail 取回。 |
| 6 | reservation 提前被 reconciliation 接管，导致成功 spawn 被当作失败清理 | 对 parent、epoch、token、process identity 和 locator 完整匹配后幂等接管，不重复占位或误杀。 |

主代理验收曾发现修复 2 引入树导航后游标倒退的问题。worker 增加两个失败测试后修正，主代理对应的独立场景也已通过。

## Independent verification

主代理重跑，不以 worker 的通过报告代替验收。

- 独立脚本 `.scratch/subagent-acceptance-20260909/acceptance.mjs`：8 passed、0 failed。日志 `acceptance-final.log`。
- 显式启用 `PI_SUBAGENT_ISOLATED_INTEGRATION=1`：真实 Pi 0.84.3 CLI、tmux 3.6b、离线 provider，1 passed。日志 `isolated-final.log`。
- `pnpm run check`：905 passed、2 skipped，类型检查、构建和发布包校验通过。日志 `check-final.log`。
- 两个默认跳过入口分别是原有在线集成测试和新增隔离集成测试；后者已单独启用通过，没有运行前者。
- `git diff --check` 通过。

以上日志均位于 `.scratch/subagent-acceptance-20260909/`。真实集成测试使用仓库内专用 HOME、agentDir、会话和 tmux socket，不加载用户资源或凭据。PID 31450、31449 已退出，专用 socket 不再可连接，临时目录已删除。未启动 TCP 服务。真实 CLI 验证只覆盖项目依赖 Pi 0.84.3，不宣称已实测全局安装的 0.85.1。

## Commit boundary

应用户要求，仅提交 subagent 修复、对应测试、生成产物、README 的 Subagent 段落和本报告。goal 计费的 usage 文件、beforePrompt 和相关 hooks/测试仍留在工作区，没有混入提交。

提交内容先在 `.scratch/subagent-commit/` 独立组装，以 HEAD 为基底，仅叠加本次提交文件，并重新生成 dist。该快照的 `pnpm run check` 为 835 passed、2 skipped，类型检查、构建和六扩展发布包校验全部通过；同一份源码的独立验收脚本为 8 passed、0 failed。日志分别为 `.scratch/subagent-commit-check.log` 和 `.scratch/subagent-commit-acceptance.log`。前文的 905 个测试是含尚未提交 goal 功能的完整工作区结果，两者范围不同。

下文 goal 交叉验证及 handoff、临时日志引用记录工作区验收过程，不表示那些文件随本次提交发布。

## Preserved changes

已核对 `.scratch/goal-8-handoff/` 的变更归属，没有重套归档 patch。保留另一 session 的 `beforePrompt`、usage hooks、goal 源码及既有 package/scripts/README 改动。

`extensions/subagent/src/usage.ts` 与归档 own-only 副本一致。goal 的 index、storage、scheduler 源码 SHA-256 与交接记录一致。

另外独立重跑校正后的 goal IPC 临时夹具，budget、late、duplicate 三个场景均通过。总 token 分别为 130、10、130；网络请求均为 0，子进程 32143、32145、32147 均正常退出且已确认不存在。证据位于同一目录的 `accounting-{budget,late,duplicate}/`。

## Separate fixture defect

另一 session 的 `extensions/goal/__tests__/child-runtime.mjs` 使用 `{ agentId: child.sessionId }` 调用 `subagent_close`，实际参数应为 `{ target: child.sessionId }`。夹具未在外层断言失败的 toolResult，因此内部关闭失败后仍可能打印通过，并由 finally 强制清理子进程。

本次没有修改该文件。用于交叉验收的 `.tmp/subagent-fixes/checked-child-runtime.mjs` 修正参数并增加外层失败 toolResult 断言，三个场景全部重跑通过。原脚本的参数和断言缺口仍需该功能负责人修复。

## Accepted compromises

- turns 的无状态分页每页重新读取和解析 native JSONL。worker 对同一份 20 条、每条 64 KiB 的历史进行五次测量：旧版一次全取平均 3.965 ms；新版第一页 3.148 ms，全部 20 页平均 46.241 ms。完整翻页更慢，不能将输出变小描述为整体性能提升。本次接受这个有界输出的代价，不新增历史缓存。
- receipt reader 在单次 wait 内仅扫描追加字节，找到 receipt 后停止读文件；多个独立 wait 仍各自扫描历史。
- tmux 不可达不等于任意 OS 子孙进程均已死亡；不将本次关闭测试当作该保证。
- 未验证外部截断 native JSONL、磁盘故障或所有真实 tmux 故障时序。

实现、Red/Green 过程及性能原始证据见 `handoff/handoff-20260909-232214.md`。上述是已声明的实现边界，不冒充新发现且已修复的 bug。
