# Goal footer acceptance

## Scope

正式实现位于 `extensions/goal/src/` 与 `extensions/codex-ui/src/`。goal 发布有版本号、当前会话限定的摘要事件，并通过 `setStatus` 提供原生 footer 回退；不接管 footer。codex-ui 分开缓存模型行与目标行。原型保留于 `prototypes/goal-footer-prototype/`，不作为生产依赖。

`GoalLease.displayTiming` 从现有计时基准投影显示值，不读盘、不取得锁、不克隆完整快照，也不改变入账。暂停写盘期间冻结在该检查点，完成后重新调度。`GoalPresentation` 只预约下一次累计分钟边界，同一目标至多一个 timeout；暂停、完成、清除、存储挂起和 dispose 后停止预约。内容包仅在内容变化或打开详情时展开，失败不会在分钟 tick 上重试。

`/goal` 使用可滚动详情面板。秒数与用量是打开时快照，没有刷新定时器。打开期间不占用命令互斥标记；执行暂停或恢复时重新检查会话 epoch、记录、目标、activation、状态和内容，拒绝旧面板操作新目标。保留原有预算、完成审计、token 口径与恢复行为。

## Reproduce

环境：Node.js 22.22.2、pnpm 11.9.0、Pi 0.84.3、TypeScript 5.9.3。Python PTY driver 使用 `codex-py312` 中的 pyte。

```sh
pnpm run goal:footer:play
pnpm run goal:footer:check
pnpm run goal:footer:benchmark
pnpm run check
```

`play` 启动隔离、禁网、禁止模型续行的正式 UI fixture。可使用 `/goal`、`/goal pause`、`/goal resume`、`/goal clear`；`/fixture-boundary` 将 fixture 时钟移到下一分钟之前，`/fixture-complete` 用于初始 fixture 的完成状态演示。这些辅助命令仅存在于测试文件，不进入发布产物。`--native` 停用 codex-ui，`--fullscreen` 使用 fullscreen。临时数据和测量结果写入仓库 `.tmp/`，退出清理子进程。

## Behavior evidence

用户已确认手动验收通过，并要求提交与推送。本确认不补足下文列明的未测项目或仓库检查缺项。

- 单元测试覆盖分钟格式边界、十分钟十次定时回调、未变文字不重复发布、内容只展开一次、旧异步结果失效、异常延迟不产生忙循环、存储投影不读写、慢暂停提交、预算收尾冻结、宽度截断、详情滚动和旧面板操作拒绝。
- 正式 PTY 已通过 codex-ui regular/fullscreen 与 native regular/fullscreen 四种模式。覆盖详情快照等待后不变、关闭、暂停、恢复、完成、清除、分钟边界，以及 40/80/120 列缩放。每种模式的分钟内静止采样均为 0 个终端输出字节。这不是 CPU 测量。
- 既有 accounting PTY 的 root 用量缺失警告、查询、编辑、reload 和恢复链路通过。既有内容 PTY 的原生 footer 创建、图片附件持久化、重开详情与全文编辑通过。调整了这些 driver，使其先关闭新详情面板，并在重开时拒绝恢复确认，避免误触发模型。
- 主题变化时缓存会随 theme identity 或 invalidate 失效；本轮未跑真实 PTY 的主题切换交互。内容 PTY 的 codex-ui 分支与直接子代理分支未在本轮重跑。

## Performance evidence

阈值在本轮测量之前确定：每次分钟帧 CPU 中位数不超过 60ms，单帧 wall time p95 不超过 100ms。60ms 折算每分钟一次，平均为单核的 0.1%；100ms 用于限制单帧阻塞。该阈值不是根据首轮结果倒推。

实现前未采集基准。本轮从固定提交 `341c22b15035392c8bd8a8cb5df203bd71c61e24` 重建旧 footer，与当前实现做实现后的对照，不宣称是实现前实测。测试使用真实 `TuiMainScreen`、`UserMessageComponent` 与 `AssistantMessageComponent`，120×40，消息使用 dark 主题、footer 使用固定无色 theme。每组预热 5 帧、测量 60 帧，完整运行三轮。

| History pairs | Minute frame CPU median range | Worst wall p95 | Idle / tool-wait output median |
| --- | --- | --- | --- |
| 0 | 0.024–0.105ms | 0.217ms | 69 bytes |
| 500 | 1.213–1.435ms | 1.991ms | 69 bytes |
| 2000 | 7.099–9.272ms | 9.886ms | 69 bytes |

范围合并空闲、受控工具等待和受控流式输出三类负载。所有组通过阈值。首次运行的 2000 对历史空闲对照：旧 footer 无变化渲染为 5.383ms CPU、0 字节；新分钟帧为 8.039ms CPU、69 字节。说明 Pi 仍会遍历组件树，不能把差分输出当作零成本。按最慢组中位数 9.272ms 折算每分钟一次约占单核 0.016%，这只是该文本负载下的刷新成本估算，不是整个 Pi 的 CPU 利用率。

工具等待用静态标签表示，不含 working spinner；流式输出用显式更新帧表示，不含模型网络流。历史是有界文本和代码块，不代表任意长工具输出、图片或所有终端。基准直接驱动 renderer，不包括模型、存储和整个进程的长期空闲采样。真实终端模拟器 CPU 未测，PTY 不能代替这项。若仍遇到高 CPU，应单独定位 spinner、工具渲染或终端模拟器，而不能仅凭此次结果排除它们。

原始结果生成于 `.tmp/goal-footer-benchmark.json`；本轮三次结果另保留于 `.tmp/goal-footer-benchmark.log`、`goal-footer-benchmark-2.json`、`goal-footer-benchmark-3.json`。

## Repository verification

目标相关测试为 38 个测试文件、421 个测试通过。`pnpm run goal:footer:check` 四种模式通过，退出后检查未发现本任务 fixture 进程残留，没有启动监听服务。

`pnpm run check` 已执行，类型检查通过；全量测试 1134 个通过、2 个跳过、1 个 suite 失败，失败来自既有缺项：`extensions/mcp/__tests__/status-ui-prototype.test.ts` 引用缺失的 `prototypes/mcp-status-ui-prototype/src/codex-startup.js`。未伪造该原型。

独立 `pnpm run build` 通过。独立 `pnpm run package:check` 仍因缺失 `docs/goal-descendant-acceptance.md` 失败。后续发布检查尚未越过此错误，不宣称整个仓库检查通过。
