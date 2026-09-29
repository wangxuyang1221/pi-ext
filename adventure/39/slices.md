# Goal tool UI implementation slice

状态：待用户审核。用户已确认原型 summary 方案，本列表尚未获审核，不创建或派发 Implementation。

依据：[Spec #40](https://github.com/wangxuyang1221/pi-ext/issues/40)。本次只需要一个垂直切片，三个工具共用展示规则，不按工具或测试工序拆关。

1. Slice 1: Ship the Goal summary display

## Slice 1: Ship the Goal summary display

- goal: 正式 Goal 的三个工具以已确认的 summary 样式显示，和 codex-ui 工具协调，并保持原有功能与模型数据不变。
- in_scope: Goal 内的正式 renderer 与工具注册接入；调用状态、默认摘要、展开详情、安全文本回退与终端适配；对应组件、SDK/PTY 测试、必要运行说明和本场证据；本切片承担整体验收。
- out_of_scope: minimal 或展示密度配置；原型切换命令进入正式产品；Goal 存储、调度、预算与计量逻辑改动；footer、`/goal`、其他工具展示或全局渲染架构重构；PR、合并、部署。
- dependencies: none。Planning #41 和 #42 已形成充分依据，不存在需要另一实施切片先交付的契约。
- acceptance: 逐项满足 Spec 的 Acceptance 与 Deferred verification。在真实 Pi 的正式 Goal + codex-ui 组合下，验证三个工具和 Bash/Write/Edit 同屏、普通/全屏、摘要/展开、全部合法目标状态与调用异常、长文本/中文/emoji/控制字符/窄屏/主题切换。提供执行和结果契约不变、历史行快照、reload/重启、Goal 独立加载及非交互调用的证据。检查极窄宽度、异常 details 回退、重复重绘资源有界性与任务进程清理。运行 `pnpm run check`。具体场景脚本、性能测量方法与参数由 worker 的执行计划细化，不降低上述通过条件；原型日志不替代正式代码的组合验收。
- boundaries: 使用现有 Pi 0.87.0 API，只附加展示，不改变 execute、schema、description、content/details 的语义及形状。按已确认原型的 summary 行为实现，Spec 为完整规则来源；数据只来自该次调用快照，不读实时 Goal/存储。Goal 保持独立构建，不跨 rootDir 导入 codex-ui 源码；局部类型、组件复用与缓存由 worker 决定。保留本场原型与证据供审阅，不把 fixture 或试验命令带进正式入口。只在本场 worktree 改 src、测试与交付资料，不手动改 dist。遇到需要改变已确认体验或 Goal 功能的分歧时退回 Planning，不自行扩大范围。

## Review

等待用户确认单切片的范围、依赖和粒度。审核通过后将以上完整内容放入 Implementation Issue，执行计划只在该 Issue 正文维护。
