# Handoff

> 从 Continuation Point 接续。完整规格只在Spec Issue正文维护。#5/#11/#12/#13均已通关并移交Spec；当前等待本轮完整实施切片审核，不重复询问样式、标点、跨行、降级或大粘贴选择。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为Pi实现行内`$skill`选择与激活。上一版已验收；本轮增加右侧标点激活、输入框和发送后任务正文的整体标签，以及手动图标降级。规划与关键可行性验证已结束，尚未实现新产品行为。

- [Map #1](https://github.com/wangxuyang1221/pi-ext/issues/1)、[Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2)保持open。Spec已确定，可用于实施，但新切片须先审核。
- 旧Implementation #8/#9/#10已关闭，不能改作本轮新关卡。产品代码基准`0b9231d4645df658e5160f71ef49b439746dfbe4`。
- [旧版说明](../docs/skill-mentions.md)、[旧版完整验收](evidence/skill-install-acceptance.md)说明已有能力；不代表本轮通过。
- 最新[源文本投影宿主报告](evidence/skill-source-host-probe.md)是输入标签worker接手必读，包含实验入口、失败路线、实际证据与未验证边界。

## Evolution

最初#4只做输入，卡片美化#6延期。#5/#7确定语法、消费时快照、同user持久化和公开编辑器组合。旧worker依次交付#8/#9/#10；真实PTY发现reload重建时序与历史遗漏，补失败测试后修复。旧MCP suite缺5个prototype文件，发布检查缺13份文档；用户明确与新功能无关，不恢复。实际tarball能够生成、隔离安装并运行，因此两种检查结果分别报告。

用户随后明确批准卸载全局`@tunglam/pi-inline-skills@0.1.3`，安装本worktree的`extensions/skill-mentions/dist/index.js`，已执行核对。当前日常Pi依赖此worktree，不得删除。

旧语法拒绝标点紧邻引用。用户要求激活与候选边界分离；否定accent/tint和紫色粗标签，逐步选定青色无底cube。#11视觉通关；#5确定有限句读/闭合符号和ASCII句点例外；#13确定command手动降级且命令保存偏好。

#12确认自动成标、屏幕复制不还原原文、超长名称完整跨行。最新用户选择保留大粘贴折叠，内部不单独显示标签，发送仍按展开原文激活。实验发现旧隐藏投影在窄行丢色，直接setText转换多一个undo；改用原文/范围/投影分离。随后发现setText整块删除清空paste注册表，撤销/内容损坏，故该路线作废。公开原生操作与分组撤销替代方案通过局部及真实CLI验证，#12已关闭并移交Spec。

## Agreed Decisions and Constraints

- 只在`/Users/wangxuyang/Code/t3code/pi-ext-skill-mentions`、`adventure/skill-mentions`工作。已获批准维护本冒险Issues、提交推送本任务资料/代码。不改main、不建PR、不合并、不部署。没有新全局配置/安装/字体修改授权。
- 只用公开API，不改原实例方法、prototype或Pi上游。保留CodexEditor外观/回调/快捷键、slash入口、原生skill卡片。卡片美化仍不在范围内。
- 规格权威见Spec：候选仍双侧空白；右侧允许明确句读，左侧不放宽。`$research.md`不激活，末尾`$research.`可激活；完整集合及Unicode名称例外读Spec，不沿用原型有限适配。
- 两处标签默认cube U+F01A7，图标与名称同为`#8DF9FD`、正常字重、无新增背景。手动命令切换command `⌘` U+2318并持久化，重启/reload沿用，不自动探测字体或改终端。视觉隐藏`$`，底层仍为`$skill-name`。
- 手写到有效分隔符才成标，不在名称途中锁定；菜单确认、完整粘贴及历史回填直接成标。超长名称完整跨行；左右、Backspace/Delete整体操作，undo恢复，无仅撤销投影步骤。保留原生大粘贴折叠与完整原文。屏幕复制仍复制视觉文字，不新增原文复制命令。
- 输入标签只表示名称识别；正文仅标记成功快照。未知/读取失败完全静默回退；同一user保留任务、图片和消费时快照。队列保留原文，恢复不重读；孤立卡片隐藏，缺失不补，不重注入被压缩全文。
- 新切片未经审核，不改产品、不创建Implementation。实施使用独立worker，一次推进一关；主代理协调验收。旧候选四关名称不是审核结果。
- 不修复18个无关缺文件，不删旧测试、不降低门槛。写文本前读`docs/agents/repository-language-policy.md`；新产品文案语言须先确认。当前探针复用原有fixture文案。
- 用户确认最终交付前Map/Spec保持open，远端分支不自动删除。

## Established Facts and Required Context

### Runtime and product

Node22.22.2、pnpm11.9.0、Pi0.86.0，Python3.12.13、pyte0.8.2。Context7仅有Pi main，版本依据来自安装源码/声明、固定官方commit和真实运行。源链接在报告中。

产品位于`extensions/skill-mentions/src/`与对应`__tests__/`；dist只生成。严格v1快照协议含UUID requestId、原任务、真实skill路径/正文。message_start消费时读取并提前展示，message_end保存同role user与图片；展示entry不进入模型上下文。历史恢复不读源文件。编辑器在resources_discover组合公开factory，reload补active context历史，首次启动/resume仍由宿主填充。

修改旧行为前读取[输入实施](evidence/skill-input-implementation.md)、[历史实施](evidence/skill-history-implementation.md)、[安装验收](evidence/skill-install-acceptance.md)。后者包含117/117测试、真实reload失败修复、完整旧Spec矩阵，以及`pnpm run skill-mentions:acceptance`的tarball/隔离安装/八入口/五组真实PTY证据。保留离线faux provider，不误触真实MCP、子代理或远端provider。

旧PTY已验证UTF-8中文输入/粘贴和编辑，但不是物理IME候选窗口；tree/fork/压缩/多条steer部分由真实SDK离线测试，不能称PTY。Pi首次assistant前不落盘，插件不提供WAL/事务/损坏JSONL修复；快照保存在历史不保证永远处于模型上下文。

### Planning evidence

- [边界报告](evidence/skill-reference-boundaries.md)和`experiments/skill-reference-boundaries/verify.mjs`：真实解析器临时副本的89断言通过，未改产品。
- [字体/取色报告](evidence/skill-ui-icon-font-and-color.md)：截图色RGB141/249/253，JetBrainsMono Nerd Font Mono3.4.0 cmap覆盖两字形，两者宽度1。已安装不代表用户当前终端实际选用，无自动检测承诺。
- [旧编辑探针](evidence/skill-label-editing-probe.md)保留窄行丢色、多余undo、原生大粘贴阈值等反例。Pi超过10行或1000 UTF-16 units时折叠，getText返回标记，getExpandedText/onSubmit保留完整原文。不可将setText删除旧结论当作当前方案。
- [最新宿主报告](evidence/skill-source-host-probe.md)：24项探针通过、独立tsc退出0，cube/native和command/Codex真实CLI PTY通过，含12行折叠粘贴旁原子删除与一次undo完整恢复。最终PID56248/56434退出0，临时目录清除，没有监听服务。保留用户此前的`.tmp/skill-ui-prototype-GG4yw8`，不要误杀。
- 新探针无隐藏投影标记，原文/标签范围/布局分离。只通过公开原生编辑/撤销操作保存paste数据。宽度8/16/80坐标、跨行着色及光标标记通过单测；不可达折叠标记偏移通过原生游标边界吸附，失败及Green均记录。
- 真实PTY覆盖补全不发送、两处标签、原文与快照、history/reload、左右/Delete/Backspace/undo；使用旧实验的有限标点适配及正文关联，不能代替正式解析器或同文不同快照验收。
- 正式输入切片仍须重做稳健的宿主帧/视口、连续undo状态关联、公共按键动作与长输入性能。逐字事件循环、按文本找journal、按render字符串找边框是探针限制，不是指定生产方案。上下/鼠标/resize、kill ring/外部编辑器、IME等责任已写Spec Deferred verification。
- 本轮[全仓check](evidence/skill-source-host-check.log)仍typecheck通过、2070 passed/5 skipped，既有MCP缺文件suite失败，后续build/package被短路。旧独立build通过、package:check缺文档记录仍有效，不声称本轮全仓通过。

### Prototype entry

在本worktree运行：

```bash
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs cube --native --source
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs command --source
```

真实CLI离线fixture；退出清理，`--capture`自动执行smoke。旧无`--source`入口是隐藏标记原型，不作为正式路线。[README](experiments/skill-mention-ui/README.md)解释入口区别。继续原型前完整读取`/Users/wangxuyang/.agents/skills/wangxuyang/make-a-prototype/SKILL.md`及必要引用。

## Current Assumptions

原文/范围/投影分离已有关键路径证据，足以实施；尚未证明探针可直接发布或适配所有终端/编辑器。具体实现属于正式切片，公开API不足时回流Planning，不能换私有补丁。

本轮完整切片当前仅为待审核方案：1标点激活，2输入整体标签，3正文标签与图标偏好，4可安装交付及整体验收。前后依赖为1→2→3→4，共享产品代码，按adventure顺序执行。用户尚未接受这次完整清单。

## Continuation Point

等待用户审核本轮完整切片，主对话给出每关goal/in_scope/out_of_scope/dependencies/acceptance/boundaries。Spec Deferred verification已标出拟分配的责任。不要将最新“1”误读为切片批准；它只确认保留大粘贴折叠。

审核通过后：

1. 依当前slicing方法把完整字段保存到新的Implementation Issues，设置Map子Issue及原生依赖，Spec补责任链接。旧#8/#9/#10不重用。
2. 更新Map为首个可执行关卡，按handoff保存、提交推送；用户无暂停要求则派发首个worker。
3. 主代理一次协调一关，worker独立上下文、不再委派，维护Issue执行计划/交付/验证；协调者逐轮追加Acceptance、通过后关闭并存档。
4. 最后worker完成整体验收、延期验证和清理。用户确认前Map/Spec保持open，最终交付待确认时停止。

当前无本轮worker。旧worker`01a0be90-2ed7-76f6-807e-976844772b8f`曾保留，勿直接假设仍存活；新关须新上下文，返工复用原worker。接手先核对工作区与subagent状态，避免重复施工。

必读skill及交接时需提供的绝对路径：

- `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/slicing/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/develop-with-tdd/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/handoff/SKILL.md`

新产品文案在开始编写前确认语言；不因此重开已确认的业务范围。文件写入/全局副作用仍受仓库和用户授权边界限制。
