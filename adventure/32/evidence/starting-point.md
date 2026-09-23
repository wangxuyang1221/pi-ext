# Starting point

## Scope

本记录描述基准提交 501d395 的静态代码事实，不代表新功能已经运行验证。

## Subagent

- [工具定义](../../../extensions/subagent/src/tools.ts) 的 spawn schema 包含 task、cwd、model、thinkingLevel，没有 agent_type 或 fast。model 必须是完整 provider/model，并在启动前检查模型注册表。
- [启动管理](../../../extensions/subagent/src/manager.ts) 用独立 tmux window 启动普通 Pi TUI，传递 model 与 thinking，未传递独立 Fast 设置。
- [扩展入口](../../../extensions/subagent/src/index.ts) 使用 PI_CODING_AGENT_DIR 或 getAgentDir() 解析 agent directory，并传给子代理。
- managed child 不注册 subagent 编排工具，现有范围为 root 到直接子代理。

## Fast mode

- [配置选择](../../../extensions/openai-fast-mode/src/config.ts) 优先使用项目现有 .pi/pi-openai-fast-mode/config.json，否则依据扩展位置选择项目或用户配置。
- [生命周期和命令](../../../extensions/openai-fast-mode/src/index.ts) 在加载时同步并保存 targets，--fast 和 /fast 会保存 enabled。只添加 --fast 到 child 启动参数不足以实现独立的会话设置。
- 父子进程是否即时跟随其他进程的配置变化尚未验证，不能从共享文件推导为实时同步。

## Environment

- Node.js v22.22.2，pnpm 11.9.0；packageManager 指定 pnpm@11.9.0。
- package.json 声明 Pi 相关包 0.87.0。新 worktree 尚未安装依赖。
- 本阶段没有修改产品代码，没有启动服务，没有执行 pnpm run check。正式交付前须完成该检查。

## Remaining verification

角色发现、配置注入、Fast 会话设置与状态恢复均待规划；需要在后续实施中验证实际启动和请求路径，不能仅凭参数测试判定父子隔离成立。
