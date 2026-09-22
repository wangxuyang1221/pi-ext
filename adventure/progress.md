# Handoff

> 从 Continuation Point 继续本次冒险。当前文件已替换继承的旧冒险存档；其他既有 adventure/ 材料属于历史任务，除非明确引用，不作为本次决策依据。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

统一 subagent 与 codex-ui 的视觉。Map：https://github.com/wangxuyang1221/pi-ext/issues/24。完整有效要求只在 [Spec](https://github.com/wangxuyang1221/pi-ext/issues/25) 维护。

## Evolution

用户提出 UI 不统一且尚无设计想法，显式调用 adventure。用户回复“同意”批准建图、独立 worktree 和冒险分支推送。随后两次回复“1”，分别选择先统一视觉并保留信息结构、覆盖全部六类主对话工具消息。方向关卡 #26 已通关，当前进入 #27。

## Agreed Decisions and Constraints

- 沿用 Spec 中已确认的视觉统一方向与六类工具范围，不能重新询问已经作出的选择。
- 用户尚未确认具体设计、原型制作或实施切片。
- 使用本 worktree 与分支提交推送本次材料和代码，不创建 PR、不合并、不部署。
- 主工作区有大量 adventure/ 未提交删除，必须保留，不能从 worktree 回写恢复。
- 简体中文沟通；编辑 artifacts 前读取 docs/agents/repository-language-policy.md。禁止 skill-creator。遵循主仓库 AGENTS.md 与用户的全局约束。
- 当前规划由主代理独立推进；进入已审核的 Implementation 后按 adventure 指派 worker，worker 不再委派。fork_turns 为 none，代码实施使用 worker 类型，并提供所需 skill 的绝对路径及要求完整读取。

## Established Facts and Required Context

工作目录：/Users/wangxuyang/Code/t3code/pi-ext/.scratch/subagent-ui-consistency。分支：adventure/subagent-ui-consistency。基准：262824026e192e8c421ce1e1796db7b269723038。

[源码调查](evidence/ui-baseline.md) 保存现有差异及证据边界。subagent 使用灰色 •；codex-ui 使用按工具状态着色的 ⏺。Read 与 Bash 布局不同，共用状态标记。现有折叠/展开已经存在。工具调用成功与子代理任务完成不能混同。

Map 与 Spec、#26、#27 已使用 GitHub 原生子 Issue 关系。冒险分支已推送。当前只修改规划材料，未实现或运行视觉原型。pnpm run check 类型检查通过，但测试有基准失败：MCP 原型依赖 JS 文件缺失、四项 tmux 测试因 worktree 路径过长失败；构建与包校验未执行。详细计数见源码调查的 Baseline check。检查进程已退出，未启动持续运行的服务。

继续时读取 [当前关卡 #27](https://github.com/wangxuyang1221/pi-ext/issues/27)、Spec 与 /Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md。如进入原型流程，读取其 references/prototyping.md；用户确认制作范围后才读取并使用 /Users/wangxuyang/.agents/skills/wangxuyang/make-a-prototype/SKILL.md。原型根目录按 adventure 要求为 adventure/prototypes/。

## Current Assumptions

候选：采用 codex-ui 共用的状态标记、标题和辅助文字规则，保留 subagent 信息结构。是否制作六类消息的真实 Pi 终端前后对照原型尚未确认。具体配色、间距和状态映射尚未批准。

## Continuation Point

第一关已通关并自动保存，继续 #27。下一题向用户确认是否制作已在 #27 描述的终端对照原型。范围为六类工具、进行中/成功/失败/超时、折叠/展开与窄屏，固定数据、不启动真实子代理任务。用户可选择直接讨论规则。不得把批准制作视为批准视觉方案。

后续按原型制作与审阅结果确定规则，通过 #27 后移交 Spec，使用 slicing 形成切片并取得用户审核，再创建 Implementation 并逐关派发、验收。最终运行 pnpm run check 和适用的视觉核验，清理任务进程，等待用户交付确认后才关闭 Map/Spec。
