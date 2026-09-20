# Handoff

> 从 Continuation Point 接续。完整规格只在 Spec Issue 正文维护，报告中的历史候选不替代用户决定。当前等待用户确认交付，不自动合并或部署。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为 Pi 实现 `$` 行内 skill 选择与激活，保留原生 skill 外观。产品实现和本功能验收已完成，等待用户确认。

- [Map #1](https://github.com/wangxuyang1221/pi-ext/issues/1) 与 [Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2) 保持 open。
- [#8 输入闭环](https://github.com/wangxuyang1221/pi-ext/issues/8)、[#9 队列与历史](https://github.com/wangxuyang1221/pi-ext/issues/9)、[#10 安装交付与整体验收](https://github.com/wangxuyang1221/pi-ext/issues/10) 均通过协调者验收并关闭。
- 产品提交 `0b9231d4645df658e5160f71ef49b439746dfbe4` 已推送。后续仅保存存档，不改产品。
- 使用入口：[docs/skill-mentions.md](../docs/skill-mentions.md)。完整证据：[安装验收报告](evidence/skill-install-acceptance.md)。

## Evolution

用户在 #4 选择首批只做输入，发送后美化 #6 延期关闭，不是验收通过。#5 确定输入规则，#7 确定消费时快照、提前原生展示、同 user 持久化及公开 editor 适配，结论已移交 Spec。

实施切片已获审核，上次暂停后用户以 next 恢复。独立 worker 依序交付 #8 和 #9，协调者重跑89/89及112/112并验收。

#10 最初因旧发布清单缺13份文档、MCP suite缺5个prototype源文件而停下。用户明确这些文件与新功能无关。本轮不恢复它们、不删旧测试、不降低旧检查门槛。实际验证表明 pack 不以前述 package:check 为前置，tarball 可以生成和安装。因此旧失败单独报告，不再把它当作必须先修的功能阻塞。

真实PTY揭示此前替代宿主漏测的 /reload 时序：transcript 在 session_start 前重建，editor 重建不迁移历史。#10 先补失败测试，再以公开延迟渲染组件、仅reload时填充历史修复，同时避免startup重复历史。#9 Acceptance保留缺口发现及后续闭环记录。

## Agreed Decisions and Constraints

- 工作区 `/Users/wangxuyang/Code/t3code/pi-ext-skill-mentions`，分支 `adventure/skill-mentions`。用户已批准该worktree、分支提交推送和本仓库冒险Issues维护。仅本任务，不改main、不建PR、不合并、不部署、不改全局Pi。
- 只用公开API，不修改已有实例方法或原型，不改Pi上游。旧slash入口、历史及CodexEditor外观/回调/快捷键保持原样。发送后美化仍延期。
- 输入、静默回退、重复去重、多skill、来源边界等完整规则在Spec。手写/粘贴/补全等效，Tab/Enter先选择不发送，取消不删除引用。不要重新询问。
- 消费时读取文件，队列保留原文；同一user保存任务、图片和快照。恢复不重读，仅显示当前分支已有有效关联卡片，隐藏孤立展示，不补卡、不固定或重注入已压缩全文。
- 用户已明确旧缺文件与新功能无关，不为本任务恢复18个文件，也未授权删除旧测试或清理旧引用。保留全仓失败和本功能通过的区别。
- 写文本前读 `docs/agents/repository-language-policy.md`。新增用户可见产品文案需确认语言，当前沿用skill元数据和原生组件，没有新增提示文案。
- 用户确认交付前Map/Spec保持open。远端冒险分支不自动删除。

## Established Facts and Required Context

- Node22.22.2、pnpm11.9.0、Pi0.86.0，Python3.12.13、pyte0.8.2。Context7无全部精确版本文档，已用安装源码、固定官方commit与真实运行补充核验，来源在各实施报告。
- 产品在 `extensions/skill-mentions/src/`，测试在对应 `__tests__/`。package.json默认Pi入口、发布files、构建/typecheck/clean、包检查清单均已接入；dist只生成，不手改。
- 严格v1封装含UUID requestId、原任务、skill真实路径与正文。`protocol.ts`提供decodeSnapshot。message_start消费时读取并提前展示，message_end保存同role user，图片保留。展示entry不进入模型上下文。历史不读取源文件。
- 公开editor factory在resources_discover组合，Proxy仅处理setText/addToHistory，其他方法和属性委托原editor。reload填充active context历史，首次启动/resume仍由原生宿主填充。重复discovery不重复安装。
- [#8实施报告](evidence/skill-input-implementation.md)含协议、语法、性能和输入到模型闭环；[#9实施报告](evidence/skill-history-implementation.md)含队列、JSONL、runtime切换、tree/fork、压缩与原生持久化边界。修改对应行为前读取。
- [#10完整验收](evidence/skill-install-acceptance.md)为最终接续必读，含完整Spec矩阵、真实reload缺陷Red/Green、实际产物、PTY及局限。协调者已核对源码修复、验收脚本和五组原始记录，独立重跑117/117通过。
- 真实产物命令 `pnpm run skill-mentions:acceptance` 执行prepack/build、tarball清单检查、隔离pnpm安装、八入口import、pi install及五组CLI PTY：native、native-fullscreen、codex、combined、combined-fullscreen。每组15类断言、19次离线消费，含正常退出后源文件删除再恢复，共10个Pi进程。
- 五组均覆盖中文多行/两侧正文、Tab/Enter、原生卡片、四次reload、自定义快捷键、原生slash、插件图片消息、静默失败、真实followUp消费时文件更新及CLI恢复。全部八扩展组合未过滤清单；未执行真实MCP连接、子代理任务或远端provider。
- 最终本功能117/117无skip，独立tsc与实际prepack/build通过。[全仓check](evidence/skill-install-final-check.log)为typecheck通过、2070 passed/5 skipped，仍因既有MCP缺文件收集失败；[package:check](evidence/skill-install-final-package-check.log)仍因旧文档缺失失败。两者都不能称通过。worker测试子进程清除四项PI_SUBAGENT标记避免root fixture误判，没有排除测试。
- 缺文件详细路径及历史在[旧阻塞报告](evidence/skill-install-blocker.md)，其“先恢复文件”建议已被用户后续方向取代，不从该停点重启。
- 中文测试为真实PTY UTF-8输入、粘贴与光标编辑，未操纵物理IME候选窗口；图片只验内容保留。tree/fork、压缩和多条steer为真实SDK/runtime离线测试，不冒充PTY。任意第三方覆盖factory不在保证范围。
- Pi首次assistant前不落盘，写盘失败可能使parent链断开。插件不增加WAL/事务/损坏JSONL修复。历史快照不代表模型始终可见全文。
- 临时安装、tarball、隔离HOME/配置/session/cache均已清理；最终10个PTY PID正常退出回收，协调者也确认无skill-install临时目录或残留PTY命令。无本任务监听服务或端口，无真实模型请求，未修改全局Pi。

## Current Assumptions

本功能无待修复的已知验收失败。旧全仓缺文件问题仍存在，不能因为本功能通过就标记消失。物理IME、外部MCP、付费provider及任意第三方组合未执行，不是本次已测保证。

没有新需求或待审核切片。用户尚未确认最终交付，不能自动关闭Map/Spec。

## Continuation Point

停止推进，等待用户确认交付。用户确认后更新Map、Spec和本存档，提交推送并关闭Map/Spec；不自动合并、部署、创建PR或删除远端分支。用户提出修改时重新打开受影响关卡，按原验收和工作范围处理。

最后worker `01a0be90-2ed7-76f6-807e-976844772b8f` 保留上下文，当前无执行中任务。同一session收到返工优先复用；跨session先核对可用性与工作区，避免重复施工。需要继续原关时交给worker的skills均须行动前完整读取及必要引用：

- `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/develop-with-tdd/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md`

worker维护Implementation执行计划/交付/验证，协调者记录Acceptance及存档。不继承协调者整段对话，不再委派。主代理保存流程用 `/Users/wangxuyang/.agents/skills/wangxuyang/handoff/SKILL.md`。
