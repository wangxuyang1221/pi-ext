# Handoff

> 从 Continuation Point 接续。完整规格只在Spec Issue正文维护。用户已恢复冒险，#14标点激活已验收通过，代码提交`d8a6a40`。下一关#15完整标签体验尚未派发，等待确认新增用户可见产品文案的语言。已审核的切片、样式、标点、跨行、降级及大粘贴选择不重复询问。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为Pi实现行内`$skill`选择与激活。上一版已验收；本轮增加右侧标点激活、输入框和发送后任务正文的整体标签，以及手动图标降级。#14已交付右侧标点激活；#15标签/偏好与#16整体验收待完成。用户已确认把输入标签和正文/偏好合为一关，完整范围和验收不变。

- [Map #1](https://github.com/wangxuyang1221/pi-ext/issues/1)、[Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2)保持open。Spec已确定，可用于实施，三关切片已审核。
- 旧Implementation #8/#9/#10已关闭，不能改作本轮新关卡。旧产品代码基准`0b9231d4645df658e5160f71ef49b439746dfbe4`；#15接手产品基准为#14交付提交`d8a6a40d05e7cf3db63b553520bb2717453c04a0`。
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
- 用户已审核三关：[#14标点激活](https://github.com/wangxuyang1221/pi-ext/issues/14)、[#15完整标签体验](https://github.com/wangxuyang1221/pi-ext/issues/15)、[#16安装交付与整体验收](https://github.com/wangxuyang1221/pi-ext/issues/16)。原Slice 2和3合并，其余范围/验收不削减；各Issue含完整六字段。三者均为Map子Issue，原生依赖14→15→16。用户已用“next?”恢复推进，旧暂停已撤销。#14验收通过；#15等待产品文案语言确认后派发。主代理协调，一次推进一关，worker独立上下文。
- 不修复18个无关缺文件，不删旧测试、不降低门槛。写文本前读`docs/agents/repository-language-policy.md`；新产品文案语言须先确认。当前探针复用原有fixture文案。
- 用户确认最终交付前Map/Spec保持open，远端分支不自动删除。

## Established Facts and Required Context

### Runtime and product

Node22.22.2、pnpm11.9.0、Pi0.86.0，Python3.12.13、pyte0.8.2。Context7仅有Pi main，版本依据来自安装源码/声明、固定官方commit和真实运行。源链接在报告中。

产品位于`extensions/skill-mentions/src/`与对应`__tests__/`；dist只生成。严格v1快照协议含UUID requestId、原任务、真实skill路径/正文。message_start消费时读取并提前展示，message_end保存同role user与图片；展示entry不进入模型上下文。历史恢复不读源文件。编辑器在resources_discover组合公开factory，reload补active context历史，首次启动/resume仍由宿主填充。

修改旧行为前读取[输入实施](evidence/skill-input-implementation.md)、[历史实施](evidence/skill-history-implementation.md)、[安装验收](evidence/skill-install-acceptance.md)。后者包含117/117测试、真实reload失败修复、完整旧Spec矩阵，以及`pnpm run skill-mentions:acceptance`的tarball/隔离安装/八入口/五组真实PTY证据。保留离线faux provider，不误触真实MCP、子代理或远端provider。

旧PTY已验证UTF-8中文输入/粘贴和编辑，但不是物理IME候选窗口；tree/fork/压缩/多条steer部分由真实SDK离线测试，不能称PTY。Pi首次assistant前不落盘，插件不提供WAL/事务/损坏JSONL修复；快照保存在历史不保证永远处于模型上下文。

### Punctuation delivery

- [#14交付报告](evidence/skill-punctuation-implementation.md)：正式产品仅修改`references.ts`，分离激活与补全右边界，29个明确句读/闭合符号与Unicode句点例外，其他加载/快照/历史实现未改。已更新使用说明、正式测试与真实安装验收夹具，无新产品文案。
- 正式10文件280/280通过，比旧基准增加163项；29个允许标点实际Red→Green。原生/Codex真实安装PTY各18类检查、27次离线消费通过，覆盖输入来源、Tab/Enter不误发送、标点、Unicode、静默回退、图片、队列版本、reload与重启历史。不是#15标签或#16整体验收通过。
- worker最终与协调者独立复跑`pnpm run check`一致：typecheck通过，2233 passed/5 skipped，仍一个旧MCP缺文件suite失败。worker独立build通过，package:check仍缺旧文档。直接worker测试曾受子会话标记污染，清除测试子进程的四项PI_SUBAGENT标记后恢复基准，未修改测试或skip。
- 协调者核对产品diff、正式矩阵、PTY夹具及两组JSON证据，第一次验收通过，无返工。100KiB标点混合负载中位6.12ms，原空白负载7.32ms，低于既定100ms预算。
- worker四个PTY进程已退出并回收，安装/fixture临时目录已清理，无遗留listener；保留旧原型目录。代码及证据已推送`d8a6a40`。本轮未改全局Pi配置或安装。

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

三关粒度和范围已获用户确认，不再是候选方案。#14已交付并验收`d8a6a40`，但不证明#15标签路线已经达到正式交付标准。派发#15前核对最新HEAD和前置验收提交。

## Continuation Point

当前停点：#14通关后自动保存，等待用户决定#15新增产品文案的语言。需要确认的仅是命令说明、切换成功提示、非法参数和偏好读写失败提示等用户可见文本；命令/API标识不翻译。建议英文以保持Pi命令界面一致，也可选择中文。此建议尚未获用户确认，不得把“继续”当作语言批准。

接续步骤：

1. 用户确认语言后，将决定写入Spec和#15，再派发独立上下文worker执行[完整标签体验#15](https://github.com/wangxuyang1221/pi-ext/issues/15)。不重复创建或审核三关；#14已解除其前置阻塞，#16仍等待#15。
2. 提供Map、Spec、#15、最新宿主探针报告、#14交付报告、worktree与实际HEAD、授权边界和skill绝对路径。原文/范围/投影分离仍须正式实现验证，不能直接复制探针限制。worker在Issue维护计划，主代理不替代worker编码。
3. 一次协调一关，worker不再委派。协调者核对证据、逐轮追加Acceptance，通过后关闭并自动存档，然后继续#16。API不可行时回流Planning，不绕过公开API约束。
4. #16的最后一个worker承担整体验收、延期验证和清理。Map/Spec在最终用户确认前保持open，交付待确认时停止。

#14 worker `01a0bfae-4f5a-7737-a94c-60d9eeb857bf`已交付且验收通过，无在执行施工；本轮任务结束将释放。若后续出现#14回归，先核对可复用worker与工作区状态。#15要求新上下文worker，不能复用#14上下文直接负责新关。

必读skill及交接时需提供的绝对路径：

- `/Users/wangxuyang/.agents/skills/wangxuyang/adventure/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/slicing/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/develop-with-tdd/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/write-todo-list/SKILL.md`
- `/Users/wangxuyang/.agents/skills/wangxuyang/handoff/SKILL.md`

新产品文案在开始编写前确认语言；不因此重开已确认的业务范围。文件写入/全局副作用仍受仓库和用户授权边界限制。
