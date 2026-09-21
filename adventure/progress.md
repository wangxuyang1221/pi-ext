# Handoff

> 从 Continuation Point 接续。完整规格只在Spec Issue正文维护。用户已确认英文产品文案，并接受原生同步逐字删除在大粘贴场景的性能与内存代价。#12本轮再次通关；#14已通过；恢复#15完整标签实施，不推进异步双状态方案，不缩减功能范围。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为Pi实现行内`$skill`选择与激活。本轮交付右侧标点激活、输入框与成功快照正文的整体青色标签，以及cube/command手动降级和持久偏好。

- [Map #1](https://github.com/wangxuyang1221/pi-ext/issues/1)、[Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2)保持open，最终用户确认前不关闭。
- [#14标点激活](https://github.com/wangxuyang1221/pi-ext/issues/14)已通过，产品基准`d8a6a40d05e7cf3db63b553520bb2717453c04a0`。
- [#15完整标签体验](https://github.com/wangxuyang1221/pi-ext/issues/15)恢复实施，尚未交付标签。此前暂停在动作策略，产品src仍与#14相同。
- [#12编辑契约](https://github.com/wangxuyang1221/pi-ext/issues/12)因成本反例重开，现已再次通关；[收尾证据](evidence/skill-label-native-undo-closeout.md)提交`594f120e49b60a949ceb33c29d899b85b27d3243`。
- [#16安装交付与整体验收](https://github.com/wangxuyang1221/pi-ext/issues/16)仍等待#15，最后一个worker承担完整Spec验收。

## Evolution

旧#8/#9/#10已实现并验收输入、快照及恢复，不改作本轮新关。旧产品基准`0b9231d`。用户曾批准卸载全局`@tunglam/pi-inline-skills@0.1.3`，改装本worktree生成入口。日常Pi依赖本worktree，不得删除。

#5确定右侧有限句读和ASCII句点例外，候选仍双侧空白。#11/#13确定青色无底cube与command手动降级，原生skill卡片不美化。#12确认自动成标、完整跨行、屏幕复制视觉文字，以及保留大粘贴折叠。隐藏标记路线窄行丢色且多一次undo；setText原子删除损坏paste注册表，均不采用。原文/范围/投影分离和原生删除/分组undo曾通过24项探针与两组PTY。

用户审核三关#14/#15/#16，原输入与正文/偏好合并为#15。用户用“next?”恢复后，#14通过并推送。随后明确新增产品文案使用英文。

#15实测10 MiB折叠paste旁删除64字符名称，65份native快照产生约650 MiB额外heap。#12因此重开；按词替代污染kill ring，setText破坏paste，直接补全有异步提交竞态。补充pending原文＋FIFO事务探针通过19项局部测试和低成本样本，但带来双状态协调与宿主移交问题，未进入产品。

用户明确选择接受原生同步删除的性能代价，保留完整功能，放弃异步双状态。128 MiB额外内存及禁止按名称长度复制paste都是原代理门槛，不再阻塞。收尾查明native undo没有应用级上限，64/256/1024名称及累计1349步可恢复；快照仍可达时不会GC。#12依据用户决定与这些证据再次通关，完整风险和实际步骤计数要求已移交Spec。

## Agreed Decisions and Constraints

- 只在`/Users/wangxuyang/Code/t3code/pi-ext-skill-mentions`、分支`adventure/skill-mentions`工作。允许维护冒险Issues及原生关系、提交推送本任务代码资料。不改main，不建PR/合并/部署，不新增全局Pi/字体/终端修改或安装。
- 主代理协调，一次推进一关；每关独立worker，不再委派，返工复用原worker。切片已审核，不重复询问。修订范围仍须用户审核。
- 只用公开API，不补丁已有实例/prototype或Pi上游。保留CodexEditor外观、callbacks、快捷键、补全、slash、原生skill卡片。
- 两处标签默认cube U+F01A7，command为⌘ U+2318；同为`#8DF9FD`正常字重，无新增背景/模拟边框。视觉不显示`$`，底层仍为`$skill-name`。图标偏好持久，重启/reload保持；不探测字体，不自动改终端。
- 手写到有效分隔符成标，不在名称途中锁定；菜单、完整粘贴、历史末尾直接成标。超长名称完整跨行；左右、Backspace/Delete整体操作，undo恢复，无只撤销投影步骤。
- 保留大粘贴折叠，折叠内部不单独画标签，但展开原文正常激活。屏幕复制视觉文字，不新增原文复制命令。
- 输入标签仅表示识别；正文只标成功快照。未知/不可读完全静默。模型、队列、外部编辑器和持久化保留原文与图片，无图标/ANSI/投影标记污染。
- 用户接受原生同步逐字删除＋分组撤销的内存/时间放大，不接受内容损坏、错误undo、旧文发送或kill ring污染。不实施pending/native双状态或异步事务。极端OOM未验证，不承诺无限输入安全，不以已接受成本反复阻塞。
- 分组按动作身份和实际有效native步骤计数，不能按UTF-16长度或同文搜索journal；正式实现须考虑grapheme、无效操作、补全拦截、自定义键位及同步回调合并/重入。
- 新增命令说明、成功/错误提示统一英文，命令名称及参数保持原样。其他文本遵守`docs/agents/repository-language-policy.md`，正文中文、标题/小节英文、代码注释/测试名英文、commit中文。
- 不修复18份无关旧缺文件，不删测试、不降正确性门槛。dist只构建，不手改。Map/Spec最终确认前保持open，远端冒险分支不自动删除。

## Established Facts and Required Context

### Runtime and product

实际Node22.22.2、pnpm11.9.0、Pi0.86.0；Python3.12.13、pyte0.8.2。Context7只有main，目标版本依据是本机声明/源码、官方固定commit`ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`散列和实际运行。不要将main索引当0.86.0保证。

产品在`extensions/skill-mentions/src/`及对应`__tests__/`。v1协议保存UUID requestId、原任务、真实skill路径和正文；message_start消费时读取并展示，message_end保存同role user与图片。展示entry不进入模型上下文。队列保存原文，历史恢复不读文件；活动分支卡片缺失不补、孤立隐藏，压缩不重注入旧正文。Pi首次assistant前不落盘，本扩展不提供WAL或损坏JSONL修复。

编辑器在resources_discover组合公开factory，reload补active context历史，首次启动/resume由宿主填充。正文逐消息transformer闭包身份通道在真实SDK核验可行，不依赖相同任务文本；尚未实现完整正文视觉矩阵。

修改产品前按需读[输入实施](evidence/skill-input-implementation.md)、[历史实施](evidence/skill-history-implementation.md)、[旧安装验收](evidence/skill-install-acceptance.md)。后者包含tarball/隔离安装/八入口/五组真实PTY；不是本轮标签验收。使用离线faux，不误触真实MCP、远端provider或子代理任务。

### Verified deliveries and design evidence

- [#14报告](evidence/skill-punctuation-implementation.md)：只改正式references.ts，完整29标点及Unicode句点例外，候选未放宽。正式280/280；native/Codex真实安装PTY各18类检查、27次faux消费。协调者复跑check2233 passed/5 skipped与旧MCP失败一致。100KiB标点负载中位6.12ms。
- [边界报告](evidence/skill-reference-boundaries.md)、[字体/颜色](evidence/skill-ui-icon-font-and-color.md)：句读决策、两字形与RGB依据。已装字体不代表当前终端选用，不承诺自动检测。
- [旧编辑探针](evidence/skill-label-editing-probe.md)、[原文投影宿主探针](evidence/skill-source-host-probe.md)：24项和两组PTY证明小规模路径，保留失败路线。探针按文本找journal、按render找帧等不能直接迁入产品；正式布局、鼠标、视口、所有动作由#15承担。
- [首轮阻塞](evidence/skill-label-implementation-blocker.md)，`7cf2607`：650 MiB成本反例及11项正式API限制核验。失败日志仍保留，旧成本脚本门槛已被用户取舍取代，不删除历史、不说已优化。
- [异步事务补充](evidence/skill-label-serial-supplement.md)，`8b760ee`：19项实验通过，但用户未采用，后续不继续异步路线。清理记录更正为`e03e876`。
- [原生undo收尾](evidence/skill-label-native-undo-closeout.md)，`594f120`：24项通过。原生栈无应用级数量/字节上限与淘汰；64/256/1024名称、单组1025及累计1349步恢复无截断。`$𠮷`只需2个native删除步骤，不是UTF-16 length 3，错误计数会过量undo。
- 正常提交清undo；`setText("")`不清undo且可新增快照。撤销/正常提交/无引用editor释放后小样本heap下降，RSS未立即下降。真实reload须清扩展强引用、分组记录、回调，不能把fixture的GC等同实际宿主已释放。极端10 MiB×1024/连续多组/OOM未测，不再为证明性能而制造大分配。

### Checks and cleanup

最新正式测试291/291，包含280项旧产品测试及11项边界核验，不代表标签已通过。最新check为typecheck通过、2244 passed/5 skipped，仍一个既有MCP suite缺`prototypes/mcp-status-ui-prototype/src/codex-startup.js`；独立build/入口import通过，package:check仍缺旧`docs/goal-descendant-acceptance.md`，不能称全仓通过。

worker环境可能污染goal fixture；仅测试子进程清除`PI_SUBAGENT_PARENT/PI_SUBAGENT_LAUNCH/PI_SUBAGENT/PI_SUBAGENT_ID`，不修改全局环境或测试。正常主代理复跑结果已与worker一致。

各轮新实验子进程已回收，无新listener，临时目录已清理。旧`.tmp/skill-ui-prototype-GG4yw8`当前不存在，时间/原因未明；此前“已保留”表述已更正，不重建空目录冒充恢复。可复现源码仍在`adventure/experiments/skill-mention-ui/`，继续原型前读`/Users/wangxuyang/.agents/skills/wangxuyang/make-a-prototype/SKILL.md`及引用。

## Current Assumptions

原生同步动作和分组undo的关键正确性有证据，用户接受成本，因此足以恢复正式实施。但完整布局/所有原生动作、连续undo合并、回调重入、真实reload引用释放仍需#15正式验证。小实验不是产品交付。出现新的正确性反例回流Planning，不将其混为已接受性能。

正文身份通道可行，但成功快照标签、同文不同快照、队列/分支/压缩完整矩阵未实现。#16须区分SDK、PTY UTF-8输入与物理IME，不能冒称实际操作。

## Continuation Point

#12已关闭，用户取舍与收尾结论已移交Spec，自动保存后继续#15，不等待用户再次确认。主代理将复用现有worker恢复完整实施。

1. #15 worker `01a0c163-4879-7531-af23-b7eef1ddaf71`已保留上下文。补任务前核对其状态和实际HEAD，避免重复施工；用对应prompt返回settledCursor等待本轮。#14 worker已关闭。
2. 向原worker提供更新后的Spec/#15、收尾报告及当前HEAD，恢复TDD产品实现。保留原生同步路线，不复制探针文本journal/帧识别或异步双状态；不再次因128 MiB成本阻塞。所有英文产品文案已授权。
3. worker只维护#15 Execution/Delivery/Verification，协调者维护Acceptance、关卡关闭、Map/Spec/progress。现有三轮Acceptance记录均只是阻塞/证据核对，尚无完整标签验收通过。
4. #15完整通过后自动保存，派发独立#16 worker做产物、当前扩展组合、完整Spec与延期验证和清理。最终交付提交用户确认时停止，Map/Spec保持open。

交接skill绝对路径：

- `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md`及`references/issue-templates.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/develop-with-tdd/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/handoff/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/slicing/SKILL.md`，仅修订切片时需要
