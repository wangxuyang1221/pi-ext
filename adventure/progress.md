# Handoff

> 从 Continuation Point 接续。完整规格只在 Spec Issue 正文维护。用户已提出新需求，当前等待 #11 原型样式选择，不再从上一版的交付确认停点继续。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为 Pi 实现 `$` 行内 skill 选择与激活。上一版已实施并验收；用户现要求右侧标点允许激活，候选仍要求双侧空白，并明确选择输入框及发送后正文两处都有特殊UI。当前 [Planning #11](https://github.com/wangxuyang1221/pi-ext/issues/11) 已做可运行原型，待用户选样式，不是新需求已正式交付。

- [Map #1](https://github.com/wangxuyang1221/pi-ext/issues/1) 与 [Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2) 保持 open。
- [#8 输入闭环](https://github.com/wangxuyang1221/pi-ext/issues/8)、[#9 队列与历史](https://github.com/wangxuyang1221/pi-ext/issues/9)、[#10 安装交付与整体验收](https://github.com/wangxuyang1221/pi-ext/issues/10) 均通过协调者验收并关闭。
- 产品提交 `0b9231d4645df658e5160f71ef49b439746dfbe4` 已推送。后续仅保存存档，不改产品。
- 上一版使用入口：[docs/skill-mentions.md](../docs/skill-mentions.md)。旧版验收：[安装验收报告](evidence/skill-install-acceptance.md)。
- 当前原型入口：[原型README](experiments/skill-mention-ui/README.md)，含Landing Map、真实启动命令、预览、smoke与限制。接续必读。

## Evolution

用户在 #4 选择首批只做输入，发送后美化 #6 延期关闭，不是验收通过。#5 确定输入规则，#7 确定消费时快照、提前原生展示、同 user 持久化及公开 editor 适配，结论已移交 Spec。

实施切片已获审核，上次暂停后用户以 next 恢复。独立 worker 依序交付 #8 和 #9，协调者重跑89/89及112/112并验收。

#10 最初因旧发布清单缺13份文档、MCP suite缺5个prototype源文件而停下。用户明确这些文件与新功能无关。本轮不恢复它们、不删旧测试、不降低旧检查门槛。实际验证表明 pack 不以前述 package:check 为前置，tarball 可以生成和安装。因此旧失败单独报告，不再把它当作必须先修的功能阻塞。

真实PTY揭示此前替代宿主漏测的 /reload 时序：transcript 在 session_start 前重建，editor 重建不迁移历史。#10 先补失败测试，再以公开延迟渲染组件、仅reload时填充历史修复，同时避免startup重复历史。#9 Acceptance保留缺口发现及后续闭环记录。

之后用户明确批准卸载全局 `@tunglam/pi-inline-skills@0.1.3`，并批准仅安装本worktree的 `extensions/skill-mentions/dist/index.js`。均已执行并用pi list核对，原本main工作区pi-ext及codex-search独立源码入口不变。因此不得删除此worktree，日常Pi仍依赖该路径。

用户截图中的 `$presentations,` 和 `$lark-doc,` 因旧规则紧邻标点不激活。用户要求识别与补全规则分开，并选择两处UI。主代理以make-a-prototype在真实Pi/Codex UI内比较accent/tint，产品代码及全局安装本轮未改。

## Agreed Decisions and Constraints

- 工作区 `/Users/wangxuyang/Code/t3code/pi-ext-skill-mentions`，分支 `adventure/skill-mentions`。用户已批准该worktree、分支提交推送和本仓库冒险Issues维护。仅本任务，不改main、不建PR、不合并、不部署。本轮原型不改全局Pi；此前两次全局卸载/安装有单独明确批准，不推定为后续全局修改授权。
- 只用公开API，不修改已有实例方法或原型，不改Pi上游。旧slash入口、历史及CodexEditor外观/回调/快捷键保持原样。原生skill卡片美化仍延期；本轮选定的是任务正文引用标识，不是卡片美化。
- 旧版完整规则在Spec，已标为修订中。用户新方向保存在#11，通关后移交Spec：激活允许右侧标点，补全仍双侧空白；UI两处均做。具体样式尚未确认，标点全集与生产语法还需明确。手写/粘贴/补全等效、静默回退、去重、来源边界等旧决定继续保留。
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

- 新原型位于 `adventure/experiments/skill-mention-ui/`，两种样式 `accent` 和 `tint`。主代理推荐浅底色但用户尚未选择。截图 [tint](evidence/skill-ui-tint-both.png) / [accent](evidence/skill-ui-accent-both.png) 是真实PTY颜色网格转PNG，字体和行距是approximation，不是macOS窗口截图。
- 原型复用实际Pi CLI、完整codex-ui、产品补全/加载/协议/历史adapter及原生卡片。fixture仅含两个无外部动作skill与离线faux provider。用户可直接编辑/发送，`/prototype accent` 或 `/prototype tint`切换。
- 原型2项行为测试、独立tsc及3组真实PTY smoke通过。输入/发送后装饰、原文与快照、Tab不发送、标点不弹菜单、公开reload切换均已核验。测试发现Pi成对美元会进入LaTeX解析，实验显示转换用代码span保护美元并恢复父背景；不把ANSI写进任务或模型。
- 原型输入仅装饰完整可映射的逻辑行，软换行/折叠/滚动裁剪保守不高亮；标点只覆盖示例集合；live显示按文本匹配是实验，不可替代产品请求ID关联。详细限制和重实现点见原型README。不能因为原型能运行就直接迁为产品。
- 本轮全仓check仍typecheck通过、2070 passed/5 skip、同一MCP缺文件suite失败；单独build通过，package:check旧文档失败。三个最终PTY进程正常退出，临时目录清除，无监听服务器或残留端口。

## Current Assumptions

样式候选尚未获用户确认，新行为没有正式切片或生产验收。暂以短行、codex-pi主题和示例标点完成视觉判断；长期语法、软换行、主题、历史关联和生产组合需要后续规划及实施。

旧全仓缺文件问题仍存在，不恢复无关资料。原型不修改当前安装的插件行为，用户在日常会话仍会看到旧边界。

## Continuation Point

等待用户查看原型并选择accent/tint或提出修改。#11保持open，Map/Spec保持open且Spec修订中。不要把用户先前选择“3，两处都做”误解成已选某种配色，也不要重复询问两处范围。

原型启动：在本worktree运行 `pnpm exec node adventure/experiments/skill-mention-ui/run.mjs tint`。退出自动清理，不连接真实provider；可加`--native`或改为`accent`。本轮使用的skill为 `/Users/wangxuyang/.agents/skills/wangxuyang/make-a-prototype/SKILL.md`，继续原型前完整读取及必要引用。

样式确认后继续查明影响可实现性的最少问题，#11通关将有效要求移交Spec，再按slicing审核新增实施切片，不能直接改日常产品。主代理当前是Planning推进者，原型独立完成，未派发worker。

最后旧worker `01a0be90-2ed7-76f6-807e-976844772b8f` 曾保留上下文，当前没有本轮worker任务；复用前核对是否仍存活。新的Implementation按adventure要求独立上下文，原关返工可复用旧worker。工作区状态核验后行动，避免重复施工。实施所需skills须完整读取及必要引用：

- `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/develop-with-tdd/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md`

worker维护Implementation执行计划/交付/验证，协调者记录Acceptance及存档。不继承协调者整段对话，不再委派。主代理保存流程用 `/Users/wangxuyang/.agents/skills/wangxuyang/handoff/SKILL.md`。
