# Prototype review

## Decision

待用户审阅。用户已批准制作，不等于已批准采用。

请判断：这一版是否让 subagent 与 codex-ui 更协调，同时仍保留当前的信息和操作习惯？建议先对照折叠态，再在终端按 Ctrl+O 查看展开态。

## Preview

PNG 来自真实 Pi PTY 的屏幕单元格，使用 Menlo 与符号字体重绘。颜色、文字和位置来自真实捕获；字体回退、字形基线及行高属于预览近似，最终以运行入口为准。

| Scene | Before | Candidate |
| --- | --- | --- |
| Collapsed | [Before](previews/before-success.png) | [After](previews/after-success.png) |
| Expanded | [Before](previews/before-expanded.png) | [After](previews/after-expanded.png) |

其他场景：[进行中](previews/after-running.png)、[失败](previews/after-error.png)、[等待超时](previews/after-timeout.png)、[40 列长名称](previews/after-width-40.png)。

## Technical results

- 40 组渲染对照通过，前后文字信息一致；0、1、2、12、40、80、120 列边界通过。
- 真实 Pi 0.86.0 PTY 检查通过：原版普通模式、候选普通模式、候选全屏模式。每次覆盖 9 个捕获场景，验证六类消息、状态颜色、展开/折叠、长名称与窗口变化。
- 原型运行中的 fetch 调用数为零；所有原型进程退出，隔离会话和运行目录已清理。测试输出保存在仓库 .tmp 中，不需要后台进程或监听端口。
- 生产源码与 dist 未手工修改。候选仅在原型运行目录编译和替换 renderer。

## Repository checks

已执行 pnpm run check：类型检查通过；159 个测试文件通过、1 个失败、3 个跳过，2376 项测试通过、11 项跳过。失败是基准中已经缺失的 prototypes/mcp-status-ui-prototype/src/codex-startup.js。进一步检查确认该原型目录在当前提交中不存在，并非此次原型导致。

worktree 从长路径移到 .scratch/u 后，先前失败的四项真实 tmux 测试已通过。

另行运行 pnpm run build 通过；pnpm run package:check 失败，缺少基准中的 docs/goal-descendant-acceptance.md。以上完整检查未全部通过，不能作为生产交付验收。本关仍是视觉原型审阅，不扩展为修复历史仓库材料的任务。

## Continue

使用 [README](README.md) 的一条命令启动。方案批准后，将规则移交 Spec，再由用户审核实施切片；本原型不直接发布到生产插件。
