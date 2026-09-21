# Handoff

> 本冒险已按用户要求手动保存并暂停，供切换会话继续。单一实施切片已批准，Implementation #23 已创建，但尚未派发 worker 或开始产品实现。收到新的继续指令后，从 Continuation Point 接手；不要重复审批或创建实施关卡。完整规格以 Spec Issue 正文为准。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

本轮交付 /quit 的退出意图选择与所属 subagent 回收，保留暂时离开和未选择退出后的后台运行及 resume。用户已要求暂不考虑长期遗忘后的提醒、统一管理或自动回收。

入口为 [Map #17](https://github.com/wangxuyang1221/pi-ext/issues/17)、[Spec #18](https://github.com/wangxuyang1221/pi-ext/issues/18)。方向 #19、正常退出 #20 和未选择退出 #21 均已通关；#22 因用户收缩范围关闭为 not planned，不视作通关。Spec 已确定，可用于实施；单一切片已由用户审核通过，[Implementation #23](https://github.com/wangxuyang1221/pi-ext/issues/23) 已创建。当前按用户要求暂停，没有 worker，也没有进行中的编码任务。

## Evolution

起初候选是主进程退出就关闭子代理。用户指出退出可能是暂时离开，只有用户能判断是否真正结束会话。统一按进程退出回收未获确认，不再作为设计依据。

用户随后依次确认正常退出时选择意图，暂时离开允许 subagent 继续后台工作，明确结束则停止所属全部代理，包括工作中的代理。#19 的结论已移交 Spec。#20 随后完成正常 /quit 的细化、真实原型与失败重试核验；用户确认 Escape 取消退出后，本关也已移交 Spec 并关闭。#21 确认未选择退出保留代理并通过恢复验证；#22 因用户要求减少复杂度而取消。随后用户批准单一实施切片，要求创建 Implementation 后保存并暂停，切换会话继续。

## Agreed Decisions and Constraints

完整要求与验收草案见 [Spec Behavior](https://github.com/wangxuyang1221/pi-ext/issues/18#behavior)。续接不可丢失的边界如下：

- 正常退出时由用户选择“暂时离开 / 结束会话”。前者继续运行子代理，后者停止所属全部子代理，不等待任务完成。
- #20 已移交 Spec 的细化：用户日常使用 /quit；仅有存活 subagent 时询问，空闲待命也算存活；默认 End session；查询失败或清理失败均保留主 Pi、显示失败详情并允许重试，已关闭的代理不恢复。Escape 取消退出选择，返回原会话，subagent 保持原样。
- 用户所说的退出，是退出 Pi 或关闭终端使主 agent 进程退出；切换 session、detach tmux、一轮回复结束均不属于已确认的回收触发条件。
- 用户已确认未经过选择就退出时保留 subagent，不能根据主进程消失自动清理；长期遗忘后的提醒、统一清理入口和任何自动超时回收已明确移出本轮。停止进程不表示删除历史记录。
- 用户已同意在 `/Users/wangxuyang/Code/t3code/pi-ext-subagent-cleanup` worktree 和 `adventure/subagent-cleanup` 分支开展本冒险，维护 GitHub Issues，提交并推送冒险分支；不创建 PR、不合并。
- 不操作用户已有 tmux 会话。主工作区存在一批未提交的资料删除，未纳入本冒险。当前 worktree 从 `38a623c` 创建，继承的其他冒险证据不是本任务验证结果。
- 遵循仓库语言策略；产品文案为英文。Python 使用 conda codex-py312；依赖使用固定 pnpm，dist 仅由构建生成。
- 切片已审核，最终交付尚未验收。当前暂停来自用户明确请求；本次没有启动 worker。恢复后 adventure 主代理担任协调者，只派发一个独立 worker 负责 #23，并禁止其再委派。
- 除已批准的冒险 worktree 与 GitHub 操作，其他目录写入或副作用需先说明缘由、范围和风险，取得用户“同意”；安装必要依赖除外。禁止使用 skill-creator。

## Established Facts and Required Context

已建立并推送冒险分支，Map 使用原生子 Issue 关联 Spec 和各关卡。Implementation #23 已关联 Map，并原生依赖已关闭的 #20、#21；不存在未完成的规划阻塞。Spec 的延期验证已明确分配给 #23。

[起点核验](evidence/subagent-cleanup-starting-point.md)记录本地源码和官方版本证据。Pi 0.86.0 的 `session_shutdown` 不适合作为普通退出选择弹窗的直接入口：普通退出时 TUI 已停止，且该事件也会因 reload/new/resume/fork 触发。没有找到专用的可取消 before-quit 事件，退出快捷键又是保留快捷键。已用公开 editor factory/onSubmit 验证 /quit 接入，不依赖 raw terminal input 覆盖所有退出路径。

现有产品插件退出只关闭主 runtime 状态并释放 namespace，没有调用子代理关闭路径。原型通过公开编辑器回调接上真实插件工具后，已完成 9 场景后端核验，见 [后端可行性报告](evidence/subagent-quit-backend-feasibility.md)。其中暂时离开后 resume 接管原代理、部分回收失败后重试、工作中退出与 reload 均已实际验证。正式并发回归仍归实施。

#21 新增 [无选择退出报告](evidence/subagent-unselected-exit-feasibility.md)：4 组实际主进程 SIGHUP、SIGTERM、SIGKILL、Ctrl+D 退出后，原子代理继续存活，新主进程 resume 同一 session 并成功回收。SIGKILL 首次退出没有 session_shutdown，也能恢复控制。所有测试资源已清理；SIGHUP 是信号路径验证，不是实际关闭所有终端应用。

Context7 已定位官方库，但查询失败；使用本地 0.86.0 包和已联网核验的官方 tag commit `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`。

本次只修改冒险资料、原型与 Issues，产品代码未变。原型曾启动隔离 Pi、离线模型子代理与 tmux server，均已清理；没有操作用户已有后台代理。已运行固定 pnpm 的 frozen-lockfile、ignore-scripts 安装。`pnpm run check` 类型检查通过，2333 测试通过、5 跳过，但 MCP suite 因既有 `prototypes/mcp-status-ui-prototype/src/codex-startup.js` 缺失而失败，后续 build/package 步骤未执行；日志在本 worktree `.tmp/subagent-cleanup/check.log`。未宣称全仓通过。

## Current Assumptions

正常 /quit 方案和原型覆盖的实际回收已确认；不能推广到全部退出路径或替代正式集成回归。无选择退出的保留策略已确认。遗忘处置已移出本轮，不是待确认的本轮需求。不能假设 registerShortcut 能覆盖 Ctrl+D，也不能在关闭终端后要求用户回答弹窗。

## Continuation Point

当前停点：用户已批准单一 slice，并要求“创建实施 level 后保存游戏进度，并暂停，我打算切换会话继续”。这些准备工作已完成；本会话到此暂停，不能自行进入实现。

下一次用户明确继续时：

1. 阅读 /Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md，核对 [Map #17](https://github.com/wangxuyang1221/pi-ext/issues/17)、[Spec #18](https://github.com/wangxuyang1221/pi-ext/issues/18) 和 [Implementation #23](https://github.com/wangxuyang1221/pi-ext/issues/23)。#23 保存已批准的六字段 slice、工作区、证据和验收责任；不要重新创建 Issue 或要求用户重复审核。
2. 确认 worktree 为 /Users/wangxuyang/Code/t3code/pi-ext-subagent-cleanup，分支 adventure/subagent-cleanup；检查最新提交、未提交改动及是否已有 worker。本次存档前基准 d2aa550，此次保存只更新 progress；产品代码仍未修改。
3. 作为协调者派发唯一 Implementation worker，显式使用 agent_type=worker、fork_turns=none。交接 Map、Spec、#23、worktree、当时的最新提交及上述证据；明确 worker 不再委派，提交推送仅限冒险分支。
4. 要求 worker 行动前完整读取 /Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md 及必要引用，在 #23 正文维护执行计划。给出完整绝对路径，不只传 skill 名称。正常行为改动须有适当测试，具体局部实现由 worker 自主完成。
5. #23 承担源码、测试、必要文档、全部延期验证和整体验收。相关证据包括 12 组入口、9 组正常后端、4 组未选择退出；这些是规划期间不同阶段的证据，不是最终产品已通过的证明。实施后运行正式回归，覆盖并发、生命周期、截止时间和原有保护。
6. 执行 pnpm run check，并核验构建和发布包的实际结果。规划期已有 MCP 缺文件失败须单独记录，不扩大范围修无关基线，也不宣称通过；若新增失败与本切片有关则修复。dist 只能由构建生成。
7. worker 完成后主代理核对 Spec 和验收证据，不通过则交回同一 worker 返工；通过后完成关卡与存档，提交最终交付给用户确认。Map、Spec 目前保持 open，不能提前关闭。

如果新证据推翻已定规格，重开相关 Planning，不能把范围变化藏进执行计划。当前没有授权将本冒险安装到用户日常 Pi 配置；没有创建 PR、合并或部署的授权。测试资源须隔离，结束时记录进程和端口清理结果。
