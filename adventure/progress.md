# Handoff

> 本文是 subagent cleanup 冒险的当前存档。继承目标、已确认需求和证据边界，从 Continuation Point 继续。完整规格以 Spec Issue 正文为准。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

解决用户退出 Pi 后遗忘 session，subagent 长期留在后台、需要手动 kill tmux server 的问题，同时保留暂时离开后 resume 的用途。

入口为 [Map #17](https://github.com/wangxuyang1221/pi-ext/issues/17)、[Spec #18](https://github.com/wangxuyang1221/pi-ext/issues/18)。方向 #19、正常退出 #20 和未选择退出 #21 均已通关，当前进入 [Planning #22](https://github.com/wangxuyang1221/pi-ext/issues/22)，确定遗忘的后台代理如何被发现与处理。没有实施切片或 worker。

## Evolution

起初候选是主进程退出就关闭子代理。用户指出退出可能是暂时离开，只有用户能判断是否真正结束会话。统一按进程退出回收未获确认，不再作为设计依据。

用户随后依次确认正常退出时选择意图，暂时离开允许 subagent 继续后台工作，明确结束则停止所属全部代理，包括工作中的代理。#19 的结论已移交 Spec。#20 随后完成正常 /quit 的细化、真实原型与失败重试核验；用户确认 Escape 取消退出后，本关也已移交 Spec 并关闭。

## Agreed Decisions and Constraints

完整要求与验收草案见 [Spec Behavior](https://github.com/wangxuyang1221/pi-ext/issues/18#behavior)。续接不可丢失的边界如下：

- 正常退出时由用户选择“暂时离开 / 结束会话”。前者继续运行子代理，后者停止所属全部子代理，不等待任务完成。
- #20 已移交 Spec 的细化：用户日常使用 /quit；仅有存活 subagent 时询问，空闲待命也算存活；默认 End session；查询失败或清理失败均保留主 Pi、显示失败详情并允许重试，已关闭的代理不恢复。Escape 取消退出选择，返回原会话，subagent 保持原样。
- 用户所说的退出，是退出 Pi 或关闭终端使主 agent 进程退出；切换 session、detach tmux、一轮回复结束均不属于已确认的回收触发条件。
- 用户已确认未经过选择就退出时保留 subagent，不能根据主进程消失自动清理；未批准任何超时回收。停止进程不表示删除历史记录。
- 用户已同意在 `/Users/wangxuyang/Code/t3code/pi-ext-subagent-cleanup` worktree 和 `adventure/subagent-cleanup` 分支开展本冒险，维护 GitHub Issues，提交并推送冒险分支；不创建 PR、不合并。
- 不操作用户已有 tmux 会话。主工作区存在一批未提交的资料删除，未纳入本冒险。当前 worktree 从 `38a623c` 创建，继承的其他冒险证据不是本任务验证结果。
- 遵循仓库语言策略；产品文案为英文。Python 使用 conda codex-py312；依赖使用固定 pnpm，dist 仅由构建生成。
- adventure skill 规定实施前审核 slices，进入实施后再派发独立 worker；规划目前由主代理独立完成。

## Established Facts and Required Context

已建立并推送冒险分支，Map 使用原生子 Issue 关联 Spec 和各关卡，后续 Planning 原生依赖 #19。

[起点核验](evidence/subagent-cleanup-starting-point.md)记录本地源码和官方版本证据。Pi 0.86.0 的 `session_shutdown` 不适合作为普通退出选择弹窗的直接入口：普通退出时 TUI 已停止，且该事件也会因 reload/new/resume/fork 触发。没有找到专用的可取消 before-quit 事件，退出快捷键又是保留快捷键。已用公开 editor factory/onSubmit 验证 /quit 接入，不依赖 raw terminal input 覆盖所有退出路径。

现有产品插件退出只关闭主 runtime 状态并释放 namespace，没有调用子代理关闭路径。原型通过公开编辑器回调接上真实插件工具后，已完成 9 场景后端核验，见 [后端可行性报告](evidence/subagent-quit-backend-feasibility.md)。其中暂时离开后 resume 接管原代理、部分回收失败后重试、工作中退出与 reload 均已实际验证。正式并发回归仍归实施。

#21 新增 [无选择退出报告](evidence/subagent-unselected-exit-feasibility.md)：4 组实际主进程 SIGHUP、SIGTERM、SIGKILL、Ctrl+D 退出后，原子代理继续存活，新主进程 resume 同一 session 并成功回收。SIGKILL 首次退出没有 session_shutdown，也能恢复控制。所有测试资源已清理；SIGHUP 是信号路径验证，不是实际关闭所有终端应用。

Context7 已定位官方库，但查询失败；使用本地 0.86.0 包和已联网核验的官方 tag commit `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`。

本次只修改冒险资料、原型与 Issues，产品代码未变。原型曾启动隔离 Pi、离线模型子代理与 tmux server，均已清理；没有操作用户已有后台代理。已运行固定 pnpm 的 frozen-lockfile、ignore-scripts 安装。`pnpm run check` 类型检查通过，2333 测试通过、5 跳过，但 MCP suite 因既有 `prototypes/mcp-status-ui-prototype/src/codex-startup.js` 缺失而失败，后续 build/package 步骤未执行；日志在本 worktree `.tmp/subagent-cleanup/check.log`。未宣称全仓通过。

## Current Assumptions

正常 /quit 方案和原型覆盖的实际回收已确认；不能推广到全部退出路径或替代正式集成回归。无选择退出的保留策略已确认。遗忘后的提醒、查看、手动清理或自动回收方案尚未确认。不能假设 registerShortcut 能覆盖 Ctrl+D，也不能在关闭终端后要求用户回答弹窗。

## Continuation Point

当前进入 #22。下一问是遗忘处置方向：提醒并提供跨 session 的统一清理入口、关闭仍由用户决定，还是允许达到约定期限后自动回收？尚未收到选择，不自行加自动回收时限。

#20、#21 的已确认规则已在 Spec，勿重复询问。原型保留 12 组入口矩阵、9 组正常后端以及新增 4 组未选择退出证据，全部测试进程已清理。

已静态定位 state-store 的 scan/list 和 controller lock，可作为跨会话发现/清理的调查起点，但当前尚未验证完整流程。按用户方向进一步明确提醒时机、可见范围和处置动作，必要时继续在本 worktree 以真实隔离会话验证；不操作用户已有代理。

继续完成 Planning 并移交 Spec，按 slicing skill 形成切片供用户审核；审核后创建 Implementation，再按 adventure 的 worker 流程编码、运行验收和保存。最终须由用户确认交付才关闭 Map 与 Spec。当前未授权安装本冒险产物到用户日常 Pi 配置。
