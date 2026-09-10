# Pi goal storage probe

## Scope

本轮延续 [规划关 #2](https://github.com/wangxuyang1221/adventure/issues/2)，验证 C7 会话级 goal 与 C8 显式继承所依赖的存储条件。脚本为 `prototypes/goal-runtime-probe/session-storage.mjs`，是受控存储实验，不是正式 goal 实现。

在 Pi 0.84.3 和 0.85.1 实际运行各七项断言，结果一致。使用真实 `SessionManager` 和仓库内临时目录，直接写入固定消息作为存储夹具，没有调用模型、读取真实用户会话或修改宿主。finally 清理本实验创建的目录，并断言目录已删除。

## Results

| Case | Observed result | Meaning |
| --- | --- | --- |
| 新持久化模式会话 appendCustomEntry | `isPersisted()` 为 true，但 JSONL 文件不存在 | persist 模式不代表首条目标快照已写盘 |
| 再添加 user，随后添加首条 assistant | user 之后仍无文件；assistant 之后已有文件，重开可读 goal | Pi 首条 assistant 会触发此前积累记录的写盘 |
| complete 后树导航到旧 user，再添加分支 | 当前 branch 不含 complete 快照，但 getEntries 仍有；重开保留累计 123 | 按 session owner 和全会话最新记录读取，可以支持 C7，不应按当前路径恢复 goal |
| 将分支复制成新会话 | 新 session ID，历史仍带源 goal custom entry | 必须以 ownerSessionId 排除外来记录，不能扫描最后一条 goal 就自动继承 |
| 分叉路径尚无 assistant，再写显式继承快照 | 新会话 JSONL 文件仍不存在 | 只用 custom entry 的持久化门禁无法保证这个继承场景跨进程恢复 |
| 分叉路径已有 assistant，再写显式继承快照 | 重开保留 deferred 与累计值，源会话不变 | 在已落盘会话中，归属明确的快照和门禁可按候选方案保存 |
| 写清除记录再重开 | 最新有效记录为 goal=null | 必须保留清除记录，不恢复更早目标 |

## Source check

已核验本地两个版本实际行为，并定点读取 0.84.3 的 `dist/core/session-manager.js`：`_persist` 在尚无 assistant 且未 flushed 时直接返回；`createBranchedSession` 对没有 assistant 的复制路径同样推迟写盘。`dist/core/agent-session-runtime.js` 的 fork 使用此分支创建方式。TUI clone 使用 fork 的 `position: "at"` 路径。

官方固定版本源码：[session-manager.ts](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/session-manager.ts)、[agent-session-runtime.ts](https://github.com/earendil-works/pi/blob/4e58f324fae8ebfa98a3d45181fb248072a2afac/packages/coding-agent/src/core/agent-session-runtime.ts)。SDK 文档和声明未提供面向扩展的通用会话强制 flush 接口，不调用下划线内部方法或伪造 assistant 来强制写盘。

## Design impact

此前候选方案“目标仅写 Pi custom entry”不足以支持首条回复前的持久保存，不能直接提升为已确认架构。C7 和 C8 的产品规则仍成立，需调整存储设计或明确限制入口。

历史取舍：用户已按 C10 选择下列选项 1，选项 2 不采用。具体恢复协议见 [存储设计](./pi-goal-storage-design.md)。

1. 推荐保留新会话直接使用 goal 的能力。插件维护独立目标状态文件，成功持久化后才确认创建或继承，并将会话记录作为历史镜像。提供明确的恢复入口处理 Pi 会话文件尚未落盘的目标。需要定义源会话定位、一次写入责任、原子替换、损坏恢复和镜像失败规则；不修改 Pi 核心，不伪造会话消息。
2. 只在 Pi 会话文件已实际落盘时允许创建或显式继承 goal。保留 custom entry 为状态存储，新会话或无 assistant 的分叉须先完成一次正常回复。实现简单，但偏离 Codex 的 goal-first 使用方式。

独立状态文件的目录、孤立目标恢复交互及并发写保护在用户确定产品取舍后设计。尚未写入任何独立 goal 状态文件，未扩大工作目录外写入授权。

## Reproduction

```bash
PI_OFFLINE=1 PI_TELEMETRY=0 node prototypes/goal-runtime-probe/session-storage.mjs
PI_OFFLINE=1 PI_TELEMETRY=0 node prototypes/goal-runtime-probe/session-storage.mjs /absolute/path/to/node_modules/@earendil-works/pi-coding-agent
```

## Continuation

C10 已确认 goal-first 持久化取舍；后续按 [正式规格](./pi-goal-spec.md) 和 [实施切片候选](./pi-goal-slices.md) 推进，先等待切片审核。已有十三项调度实验仍有效，但不证明新的持久化设计。未运行真实 TUI fork/clone 交互，未覆盖进程崩溃和磁盘写入失败；这些不能由正常写盘断言替代。
