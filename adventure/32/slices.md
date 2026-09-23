# Implementation slices

状态：用户已确认两个切片的粒度并授权施工，指定执行代理类型为 expert。规格依据为 [Spec #33](https://github.com/wangxuyang1221/pi-ext/issues/33)，两个切片依次执行。

1. [Slice 1 #37](https://github.com/wangxuyang1221/pi-ext/issues/37) 交付不依赖角色文件的子代理 Fast 设置与会话隔离。
2. [Slice 2 #38](https://github.com/wangxuyang1221/pi-ext/issues/38) 依赖 Slice 1，交付角色配置并负责组合后的整体验收。

## Slice 1: Independent subagent Fast mode

- goal: 用户可通过 `subagent_spawn.fast` 独立控制子代理 Fast；未指定时继承启动当时的主代理开关；子代理内的 `/fast` 随会话保存并跨 reload/resume 保留。
- in_scope: spawn 参数和默认值解析、主代理当前开关读取、child 启动传递、会话状态持久化与恢复、Fast 扩展的共享配置写入隔离、必要元数据与状态显示、该能力的文档及测试。覆盖不带 agent_type 的完整使用路径。
- out_of_scope: 角色文件扫描、agent_type 选择与角色目录公布，由 Slice 2 完成；不新增 provider 或实时服务能力探测。
- dependencies: none。
- acceptance: 通过真实 Pi 会话与实际 child 路径记录出站 payload，覆盖主关子开、主开子关、缺省继承及父子后续互不跟随；验证 `/fast` 不影响 sibling，首次回复前保存的 true/false 在 reload/resume 后正确恢复。对启动、命令、reload、恢复和 shutdown 前后共享配置做字节比较，确认 child 不写共享配置；root 持久化行为保持现状。覆盖现有本地模型匹配、明确 Codex Fast 拒绝和其他错误，不自动重放。运行适用回归及 `pnpm run check`，将完整证据保存到本场 evidence。测试设施可使用离线 provider，但必须运行真实 host/child 集成路径，并说明它验证的是出站请求而非服务端实际调度等级。
- boundaries: 遵守 Spec 的全部 Fast 规则。false 是显式值；不能从 footer 反推父开关；恢复值优先于 launch 初值；编排工具仍只暴露给 root。保持现有模型、身份、容量和认证契约，不手改 dist，不创建 PR、合并或部署。事件名、custom entry 类型及必要内部拆分由 worker 决定；若改变用户可观察行为或恢复保证，交回 Planning。

## Slice 2: Role configuration and integrated delivery

- goal: 用户可维护 JSONC 角色文件，root 根据角色名及可选 description 选择 agent_type，子代理使用合并后的运行设置，完整功能达到 Spec 验收要求。
- in_scope: 用户级 agents 目录、角色加载和验证、启动/reload 快照、root 可见目录、错误隔离与提示、agent_type 参数、model/thinkingLevel/fast 合并、必要启动元数据、角色与 Fast 组合验证、使用文档、整体验收及临时资源清理。
- out_of_scope: 项目级或 Codex 配置兼容、TOML、角色指令、实时文件监听、向 child 暴露编排工具或角色目录；不新增 provider 支持或改变现有 Fast 兼容策略。
- dependencies: Slice 1。
- acceptance: 验证默认及自定义 agent directory、四字段均可选、显式参数优先、false 覆盖、未知或错误类型启动前拒绝、错误文件只在 root 提示且不进入目录。通过真实 child 启动与 reload 检查工具信息和模型上下文，不含角色目录或 description 注入；root 能看到合法角色及说明。验证角色文件变更在 reload 前后使用正确快照，已有 child 保持原设置。组合测试覆盖角色 Fast 默认、显式覆盖与父级继承最终落到实际请求和会话恢复；共享配置及角色文件不被 child 改写。最后由本 slice 的 worker 对照完整 Spec 逐项整体验收，运行 `pnpm run check`、核对发布包与文档、清理测试进程和资源，提交证据与未覆盖边界供协调者审核。
- boundaries: 实现范围以 Spec 为准，复用 Slice 1 的独立 Fast 契约。只读取用户级 `<Pi agent directory>/agents/`，文件名决定类型；description 只供 root 选择，不是 child 指令。错误角色不回退、不沿用旧配置；保留普通 spawn、随机显示名、容量及生命周期语义。配置加载的内部拆分和诊断格式可由 worker 决定，不能放宽 root/child 可见范围或恢复保证。操作限制沿用 Spec working agreement。

## Acceptance ownership

Slice 1 承担独立 Fast 的实际请求、共享文件隔离、会话保存恢复和 root 兼容性。Slice 2 承担角色加载与 spawn、root/child 目录边界和角色 Fast 合并后的跨组件行为，并负责最终整体验收。局部参数或注册函数测试不能替代上述集成证据。

## Review

用户已确认依赖顺序与粒度，无需再次审核。后续若改变切片范围或依赖，按 slicing 流程重新提交审核。
