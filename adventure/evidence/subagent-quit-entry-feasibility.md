# Quit entry feasibility

## Result

用户已确认日常通过 /quit 退出。在 Pi 0.86.0 的真实交互进程中，公开 editor factory 与 onSubmit 的组合可以在内置 /quit 前接入原生选择，再调用 context shutdown。无需在 session_shutdown 中显示界面，也没有修改宿主方法或 prototype。

[原型入口及边界](../prototypes/quit-choice/README.md)、[PTY 数据](subagent-quit-prototype-results.json)。12 组真实 PTY 通过，原型 TypeScript 检查通过；不是生产实现验收。

## Behavior under test

每组先 /quit 显示两个选项，Escape 取消，确认进程未退出；随后提交正常 prompt 并收到 fixture 模型响应，再 /quit 选择对应意图并退出。已逐组核对记录恰好为 cancel 和本组选择，session_shutdown reason 恰好为一次 quit。组合模式还核验 skill 正文进入模型请求。

## Environment and isolation

Node 22.22.2、pnpm 11.9.0、Pi 0.86.0。使用真实 native/Codex/skill 编辑器与真实 Pi TUI，模型为本地 faux fixture，没有加载生产 subagent 扩展。全部 launcher 和 CLI PID 已再次核验不存在；临时目录已删除。原型不启动监听服务，也没有关闭用户的 subagent 或 tmux。

## Limitations

未验证真实后台代理回收、取消/重载/恢复的全部组合、其他扩展之后替换编辑器、主 agent 正在生成时退出，以及选择后清理失败。两种选择在原型中只记录意图并退出，不能当作不同的代理处置已实现。

用户后续已确认仅在存在存活 subagent 时显示选择、默认 End session，且清理失败时保留主 Pi 并允许重试。默认选项已在入口原型调整；条件查询和真实回收不属于此原型已验证能力。用户已确认 Escape 取消退出，状态查询失败保留主 Pi 并允许重试。实际后端集成的后续证据见 [后端可行性](subagent-quit-backend-feasibility.md)，本入口报告不替代该报告。

## Repository check

pnpm run check 已执行：类型检查通过，2333 测试通过、5 跳过；一组 MCP suite 因原有 prototypes/mcp-status-ui-prototype/src/codex-startup.js 缺失而失败，因此 build/package 步骤未运行。此次产品代码未修改；没有修复无关基线问题或宣称全仓通过。
