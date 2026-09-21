# Handoff

> 本文是 subagent cleanup 冒险的当前存档。继承目标、已确认需求和证据边界，从 Continuation Point 继续。完整规格以 Spec Issue 正文为准。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

解决用户退出 Pi 后遗忘 session，subagent 长期留在后台、需要手动 kill tmux server 的问题，同时保留暂时离开后 resume 的用途。

入口为 [Map #17](https://github.com/wangxuyang1221/pi-ext/issues/17)、[Spec #18](https://github.com/wangxuyang1221/pi-ext/issues/18)。方向关卡 #19 已通关，当前进入 [Planning #20](https://github.com/wangxuyang1221/pi-ext/issues/20)，核验退出选择和定向回收。没有实施切片或 worker。

## Evolution

起初候选是主进程退出就关闭子代理。用户指出退出可能是暂时离开，只有用户能判断是否真正结束会话。统一按进程退出回收未获确认，不再作为设计依据。

用户随后依次确认正常退出时选择意图，暂时离开允许 subagent 继续后台工作，明确结束则停止所属全部代理，包括工作中的代理。#19 的结论已移交 Spec。

## Agreed Decisions and Constraints

完整要求与验收草案见 [Spec Behavior](https://github.com/wangxuyang1221/pi-ext/issues/18#behavior)。续接不可丢失的边界如下：

- 正常退出时由用户选择“暂时离开 / 结束会话”。前者继续运行子代理，后者停止所属全部子代理，不等待任务完成。
- #20 已确认但尚未通关移交 Spec 的细化：用户日常使用 /quit；仅有存活 subagent 时询问，空闲待命也算存活；默认 End session；清理失败保留主 Pi、显示失败详情并允许重试，已关闭的代理不恢复。
- 用户所说的退出，是退出 Pi 或关闭终端使主 agent 进程退出；切换 session、detach tmux、一轮回复结束均不属于已确认的回收触发条件。
- 尚未批准无选择退出时自动停止，也未批准暂时离开后的超时回收。停止进程不表示删除历史记录。
- 用户已同意在 `/Users/wangxuyang/Code/t3code/pi-ext-subagent-cleanup` worktree 和 `adventure/subagent-cleanup` 分支开展本冒险，维护 GitHub Issues，提交并推送冒险分支；不创建 PR、不合并。
- 不操作用户已有 tmux 会话。主工作区存在一批未提交的资料删除，未纳入本冒险。当前 worktree 从 `38a623c` 创建，继承的其他冒险证据不是本任务验证结果。
- 遵循仓库语言策略；产品文案为英文。Python 使用 conda codex-py312；依赖使用固定 pnpm，dist 仅由构建生成。
- adventure skill 规定实施前审核 slices，进入实施后再派发独立 worker；规划目前由主代理独立完成。

## Established Facts and Required Context

已建立并推送冒险分支，Map 使用原生子 Issue 关联 Spec 和各关卡，后续 Planning 原生依赖 #19。

[起点核验](evidence/subagent-cleanup-starting-point.md)记录本地源码和官方版本证据。Pi 0.86.0 的 `session_shutdown` 不适合作为普通退出选择弹窗的直接入口：普通退出时 TUI 已停止，且该事件也会因 reload/new/resume/fork 触发。没有找到专用的可取消 before-quit 事件，退出快捷键又是保留快捷键。公开 raw terminal input 接口可作为候选，但尚未证明可安全覆盖现有退出操作。

现有插件退出只关闭主 runtime 状态并释放 namespace，没有调用子代理关闭路径。manager 已有按所属 namespace 关闭 all 的实现，需要核验接入时序、失败和并发退出场景。

Context7 已定位官方库，但查询失败；使用本地 0.86.0 包和已联网核验的官方 tag commit `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`。

本次只修改冒险资料与 Issues，产品代码未变，已完成退出入口隔离原型，结果见下文。未启动服务或后台代理。已运行固定 pnpm 的 frozen-lockfile、ignore-scripts 安装。`pnpm run check` 类型检查通过，2333 测试通过、5 跳过，但 MCP suite 因既有 `prototypes/mcp-status-ui-prototype/src/codex-startup.js` 缺失而失败，后续 build/package 步骤未执行；日志在本 worktree `.tmp/subagent-cleanup/check.log`。未宣称全仓通过。

## Current Assumptions

公开 editor factory + onSubmit 已在 /quit 原型中验证可接入选择；尚不能推广到全部退出路径、生命周期或代理回收。原型默认项已按用户选择调整为 End session 并完成 12 组补验；取消行为仍为候选，实际询问条件和回收失败尚未接入原型。不能假设 registerShortcut 能覆盖 Ctrl+D，也不能在关闭终端后要求用户回答弹窗。

## Continuation Point

当前进入 #20，用户已明确日常通过 `/quit` 退出。已使用 make-a-prototype skill 完成 `adventure/prototypes/quit-choice/` 原型，12 组真实 Pi PTY 和 TypeScript 检查通过。详见 [可行性报告](evidence/subagent-quit-entry-feasibility.md)，需要交互复现时读取原型 README。当前等待用户回答已发送的问题：无法取得可靠 subagent 状态时，是保留主 Pi 显示错误供重试，还是提示后按暂时离开退出。默认 End session 的 12 组原型补验已完成，所有测试进程已退出。之后确认完整交互候选及取消规则，核验实际 manager 回收、失败后重试、正在生成时退出和生命周期，完成 #20；不重复询问已确认选项。

后续独立关卡为 [#21](https://github.com/wangxuyang1221/pi-ext/issues/21)，决定无法取得退出选择时的规则；[#22](https://github.com/wangxuyang1221/pi-ext/issues/22)，处理暂时离开后遗忘。不得在 #20 中自行决定这两类规则。

继续完成 Planning 并移交 Spec，按 slicing skill 形成切片供用户审核；审核后创建 Implementation，再按 adventure 的 worker 流程编码、运行验收和保存。最终须由用户确认交付才关闭 Map 与 Spec。当前未授权安装本冒险产物到用户日常 Pi 配置。
