# Subagent UI baseline

## Scope and version

本次冒险为 https://github.com/wangxuyang1221/pi-ext/issues/24，基准提交 262824026e192e8c421ce1e1796db7b269723038。仅做源码核验，未运行真实终端视觉对比。

## Findings

- extensions/subagent/src/renderers.ts：renderTitle 使用 dim 的 •，动作使用 toolTitle 加粗，目标使用 accent 加粗，后缀使用 dim。prefixDetails 使用首行两个空格加 └、后续四个空格。宽度不足时截断。
- 同一文件：六种操作均支持结果渲染；折叠和展开的信息由各 render 函数控制。本轮保留其信息结构。
- extensions/subagent/src/tools.ts：六类工具通过 renderShell self、renderCall、renderResult 接入自定义显示。
- extensions/subagent/src/quit.ts：退出使用标准选择弹窗和错误通知。本次已确认范围是主对话工具消息。
- extensions/codex-ui/src/tool-status.ts：统一使用 ⏺；pending/running 为 warning，completed 为 success，failed 为 error，interrupted/timed_out 为 warning。
- extensions/codex-ui/src/read-group-layout.ts：Read 使用主题色标题、accent 文件名、dim 辅助信息、竖线内容和折叠/展开布局。
- extensions/codex-ui/src/tools.ts：Bash 时间线具有独立布局，仍使用同一状态标记函数。不可将 Bash 专有结构视为所有工具必须复制的规范。

## Boundaries

工具调用成功不必然表示子代理任务完成。spawn/prompt 调用和代理生命周期、wait 超时需要在 #27 明确视觉映射，避免仅依据代理状态为调用着色。

候选方案是提取上述共用规则。原型制作和具体视觉规则均待用户决定，不能把候选写成已确认要求。

## Runtime

本机实际版本为 Node.js v22.22.2 与 pnpm 11.9.0，packageManager 指定 pnpm@11.9.0，Pi 相关依赖锁定为 0.86.0。本轮没有使用第三方新接口或修改产品代码。

## Baseline check

pnpm run check 已执行：类型检查通过；测试为 158 个文件通过、2 个文件失败、3 个文件跳过，2372 项通过、4 项失败、11 项跳过。构建与包校验因测试阶段失败未执行。失败发生在未改产品代码的基准上：mcp status-ui-prototype 测试缺少 prototypes/mcp-status-ui-prototype/src/codex-startup.js；四项真实 tmux 测试报告 socket 路径过长。当前 worktree 路径较长，进入实施验证前应使用更短工作路径，或按已有测试机制解决路径约束。不得将本次记录视为验证通过。原始日志本地位于 .scratch/ui-planning-check.log。
