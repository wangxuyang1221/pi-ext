# Fast planning evidence

## Scope

本记录为 [Planning #36](https://github.com/wangxuyang1221/pi-ext/issues/36) 提供实现前证据，不代表候选方案已通过运行验收。

## Shared configuration writes

[Fast extension](../../../extensions/openai-fast-mode/src/index.ts) 在 loadForContext、--fast、/fast 和 session_shutdown 保存配置。Pi reload 会触发 shutdown，因此 child 隔离须覆盖整个生命周期，不能只把独立值加到启动参数。

[payload](../../../extensions/openai-fast-mode/src/payload.ts) 基于 config.enabled、模型支持情况和当前会话排除列表决定是否注入 service_tier。Fast 开关与模型实际是否支持 Fast 不是同一个状态，父子继承应读取开关值，不能从 footer 是否显示 fast 推断。

## Session state interface

通过 Context7 查询 [官方扩展文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)，appendEntry 用于不进入模型上下文的自定义会话状态，session_start 可从 sessionManager 读取。文档来自 main，已对主工作区安装的 Pi 0.87.0 发布源码进行交叉核验：

- dist/core/agent-session.js 将 appendEntry 转交给 sessionManager.appendCustomEntry。
- dist/core/session-manager.js 的 appendCustomEntry 添加 custom entry；_persist 在尚无 assistant 且尚未 flushed 时延迟写入。
- 因此存在 custom entry 接口不能单独证明首次回复前设置一定落盘。具体 managed child 的预创建 session 文件路径是否满足即时写入条件尚未实测，实施前不得据此承诺恢复行为已验证。

## Implementation implications

可沿用现有 launch 元数据传递初始解析值。会话内开关与恢复的存储方案尚未决定；如果选用 custom entries，需覆盖首次模型回复前的切换和退出；也可核验现有 subagent 会话状态存储的持久化方案。

尚未改代码或执行运行实验。
