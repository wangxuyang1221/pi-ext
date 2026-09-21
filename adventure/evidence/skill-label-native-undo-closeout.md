# Native undo capacity and lifetime closeout

## Decision and result

用户已选择原生同步逐字删除＋分组撤销，接受每字符快照复制大粘贴的时间与内存放大。不实施pending/native双状态或异步事务。此前代理设定的额外128 MiB预算及禁止按名称长度复制paste的条件不再阻塞本轮；内容完整、同步读取/即时发送、kill ring、分组undo及超长名称完整显示要求仍有效。

本轮没有发现UndoStack容量导致的恢复截断。Pi 0.86.0没有应用级数量或字节上限，没有满栈淘汰分支。实际两宿主均恢复了64/256/1024字符名称，单个逻辑动作1025个原生步骤及连续累计1349步都未丢失快照。可以把本项证据交回协调者判断#12通关，不需要因已接受的分配成本重新询问用户。

没有数量上限不等于无限内存安全。快照在undo栈中仍可达时，GC不会把它们释放。原生提交清空undo；`setText("")`不清空undo。丢弃无外部引用的editor后，实验观察到对象回收和heap下降，但RSS没有随之立即下降。

本次接手HEAD为`414f6a5`，工作分支`adventure/skill-mentions`。只新增实验、证据及历史说明，没有修改产品`src/`，没有自动恢复完整#15或推进#16。

## Source audit

版本依据为安装的Pi 0.86.0。重新通过gh读取官方固定commit `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`，与安装source map内的UndoStack和Editor源码逐项SHA-256相同，见[来源及4096项核验结果](skill-label-native-undo-source.json)。本轮没有可调用的Context7工具；复用此前文档核验记录，未把Context7 main冒充0.86.0。

| Operation | Source behavior | Consequence |
| --- | --- | --- |
| `UndoStack.push` | `stack.push(structuredClone(state))`，没有容量参数、长度判断、shift或淘汰 | 应用级不限数量，受实际堆、引擎和操作系统资源限制 |
| `UndoStack.pop` | 返回最后一个快照，不重新clone | 弹出项不再由栈持有；恢复为当前状态的内容仍被editor引用 |
| `UndoStack.clear` | `stack.length = 0` | 移除栈对全部快照的引用，不承诺立即触发GC或返还RSS |
| `Editor.pushUndoSnapshot` | 保存`state`、整个`pastes` Map及`pasteCounter` | 可见标签旁的大粘贴也随每步复制 |
| Backspace/Delete | 每个实际删除grapheme或合并行的步骤先push一次 | ASCII名称N个字符加`$`需要N+1个快照；不能假定每UTF-16 unit一步 |
| `Editor.undo` | pop后恢复state、pastes及counter，重置编辑合并状态 | 分组撤销可同步发出同样数量的公开undo事件，恢复原文、游标和折叠注册表 |
| `Editor.setText` | 正文不同时先push，然后清当前paste注册表并设置正文；不clear undo | 清空可见输入不是释放历史的操作，undo仍能还原清空前的paste和更早编辑 |
| 正常提交 | 展开原文，再清当前state、paste和undo栈，然后onChange/onSubmit | 提交后再undo不会复活已提交草稿 |

独立源码审计还创建该模块自己的UndoStack，push4096个嵌套对象/Map，修改入参后按逆序完整pop，核对深拷贝与clear。此模块不是包入口导出的产品API，直接加载仅用于孤立源码验证。编辑器实验从不读取或操作其private undoStack，不补丁实例方法、prototype或上游。

没有“达到100/256/1000容量后如何处理”的实现分支，因此不需要分批落盘或其他容量溢出修复。4096项实测不是无限容量证明；没有应用级上限的结论来自完整UndoStack实现及Editor调用审查。

## Correctness evidence

实验位于`adventure/experiments/skill-label-native-undo/`。最终[24项测试](skill-label-native-undo-final-tests.log)通过，[独立tsc](skill-label-native-undo-final-types.log)退出0。

- 原生CustomEditor和当前CodexEditor，Backspace/Delete两个方向，名称64/256/1024，分别65/257/1025个原生删除步骤。每组在约4 KiB、12行折叠paste旁执行，按步骤数undo后逐项核对原文、展开正文、游标；再多一次原生undo应撤销之前的插入，证明没有残留组内步骤或过量撤销。
- 连续删除1024、256、64字符名称及两个分隔空格，累计1349个native快照。按动作栈逆序撤销，每组中间状态和最初完整paste均一致，较早组未被后续组挤掉。
- 删除后立刻`getExpandedText`得到删除结果，同一调用栈Enter提交该结果。提交后超过原快照数的undo调用均不复活旧草稿。
- `setText("")`后，先undo清空，再undo原删除组，完整恢复折叠paste和名称。它可以清草稿，但不能被当作清undo API。
- 1024字符名称删除/恢复后Ctrl+Y仍取出之前保存的`keep`，没有把Backspace换成kill操作。
- 64个补充平面汉字的名称用65个grapheme步骤恢复，不能用129个UTF-16 units作undo次数。

### Local counting pitfall

最小计数反例是`$𠮷`：JavaScript字符串length为3，原生只需2次Backspace。若删除2次却undo3次，会额外撤销此前插入。测试以`before `和随后插入的`$𠮷`复现，错误的3步撤销只留下`before `。

局部修复仍在已确认同步公开API路线内：记录实际执行且产生删除的原生事件数，而不是名称的UTF-16长度；按同一动作身份保存分组数量。实验对完整有效名称按grapheme计数，正确的2步和65步恢复均通过。正式实现还须覆盖边界、无效操作、补全拦截及自定义键位，不能假定任意handleInput调用都创建快照。这是分组实现的计数要求，不是原生容量缺口，也不要求异步状态或私有API。

这些是现有原生行为的characterization和小型分组帮助函数验证，不是先制造产品失败再修复。原生未修改，不虚报产品Red→Green。帮助函数按直接动作顺序保存步骤数，不按相同正文寻找journal，不复用异步方案。实验同时核对原生每步都会onChange，未把这些回调包装成产品级的一次逻辑通知；正式#15仍须处理同步回调合并及重入，不能直接照搬帮助函数作为完整编辑器。

## Snapshot lifetime and GC

[内存原始记录](skill-label-native-undo-memory.json)使用四个独立Node子进程。每个进程只放32 KiB折叠paste与三个64字符名称，连续三组删除，加两个空格共197步。每个观测点跨事件循环执行3次显式GC，再记录process.memoryUsage。没有进行10 MiB×1024的分配，也没有OOM实验。

每个模式从约30.79 MiB heap起步；逐组删除后，GC后的heap依次约33.29、35.50、37.56 MiB。对象仍被undo引用时，显式GC没有消除这一增长。

| Action after three groups | Heap before / after GC observation | RSS before / after | Meaning |
| --- | --- | --- | --- |
| 弹出全部197步，恢复原文 | 37.56 → 31.32 MiB | 145.52 → 145.52 MiB | 被消费的历史副本可释放，当前paste及更早插入历史仍在 |
| `setText("")` | 37.56 → 37.57 MiB | 144.84 → 144.88 MiB | 可见清空没有释放undo历史 |
| undo清空，再撤销全部删除 | 37.57 → 31.32 MiB | 144.88 → 144.88 MiB | 清空前的paste和全部组仍可恢复 |
| 正常提交 | 37.56 → 31.28 MiB | 144.77 → 144.80 MiB | 清栈后历史副本可回收；真实提交正文已核对 |
| 丢弃editor且无其他强引用 | 37.56 → 31.23 MiB | 144.56 → 144.56 MiB | WeakRef随后为undefined，实验editor已被回收 |

这里观察的是GC后存活heap，不是单步分配峰值或性能采样分布。RSS由运行时分配器和操作系统管理，本次释放后没有立即下降，不能写成“内存已全部返还系统”。V8及模块初始化也会影响基线，不能从上述数值推导精确的每快照固定字节数。

丢弃对象的结果限于无provider任务、无外部闭包/宿主引用的inert TUI fixture。真实reload或编辑器更换时，仍要解除扩展自己的强引用、分组记录和回调，不能只把局部变量设为undefined就宣布真实宿主已释放。实验没有通过伪造提交来清理产品输入；真实产品只能遵守正常提交语义，不可拿发送动作作为隐形内存清理手段。

## Accepted risk and unknown extremes

[首轮10 MiB/64字符证据](skill-label-editing-api-final-red.log)仍为约650.18 MiB额外heap、651.25 MiB额外RSS及65个native undo步骤。本轮复用此证据，没有重跑大分配。旧成本脚本及失败断言保留，只补注释说明原128 MiB门槛已被用户取舍取代；首轮报告和异步补充报告也新增后续决定说明，历史内容未删除。

原生没有容量淘汰，连续编辑期间快照可以继续累积。分组undo减少用户按键次数，不减少已经创建的快照。没有undo、正常提交或丢弃不可达editor时，不能指望GC释放这些仍可用于恢复的内容。

[本机运行记录](skill-label-native-undo-runtime.json)显示Node22.22.2、darwin arm64、NODE_OPTIONS为空，报告的V8 heap size limit为4,345,298,944 bytes。这是此次进程配置下的堆上限，不是可用内存、安全输入预算或Pi所有运行方式的保证。字符串、paste注册表、更多历史、其他扩展和临时grapheme处理还会占内存。

10 MiB搭配256/1024字符或多组连续删除的极端组合未实测；没有确认发生OOM前的可靠可恢复边界，也没有证明异常中途可以保持原子回滚。不能承诺任意长输入、任意大paste或无限次连续编辑安全。这些是已接受路线的剩余资源风险，不另行当作128 MiB性能阻塞重问用户。

超长名称的完整视觉显示、窗口布局和所有宿主操作仍归#15正式实现；本次仅验证长名称的删除与恢复，没有用输入恢复结果冒充跨行显示验收。

## Verification and reproduction

```bash
mkdir -p .tmp/skill-label-native-undo
pnpm exec node adventure/experiments/skill-label-native-undo/source-audit.mjs
TMPDIR="$PWD/.tmp/skill-label-native-undo" pnpm exec vitest run --config adventure/experiments/skill-label-native-undo/vitest.config.ts
pnpm exec tsc --target ESNext --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop --types node --noEmit adventure/experiments/skill-label-native-undo/probe.ts adventure/experiments/skill-label-native-undo/probe.test.ts adventure/experiments/skill-label-native-undo/vitest.config.ts
pnpm exec tsc --target ESNext --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop --types node --rootDir . --outDir .tmp/skill-label-native-undo/build adventure/experiments/skill-label-native-undo/probe.ts
pnpm exec node adventure/experiments/skill-label-native-undo/memory.mjs "$PWD/.tmp/skill-label-native-undo/build/adventure/experiments/skill-label-native-undo/probe.js"
env -u PI_SUBAGENT_PARENT -u PI_SUBAGENT_LAUNCH -u PI_SUBAGENT -u PI_SUBAGENT_ID TMPDIR="$PWD/.tmp/skill-label-native-undo" pnpm run check
pnpm run build
pnpm run package:check
rm -rf .tmp/skill-label-native-undo
```

| Check | Result |
| --- | --- |
| 新实验 | 24/24通过，独立tsc、实验构建及四个内存子进程均退出0 |
| [正式skill-mentions测试](skill-label-native-undo-formal-tests.log) | 291/291通过，未增加skip或删除测试 |
| [pnpm run check](skill-label-native-undo-check.log) | typecheck通过，2244 passed/5 skipped；既有MCP suite缺`prototypes/mcp-status-ui-prototype/src/codex-startup.js`，退出1 |
| [独立build](skill-label-native-undo-product-build.log)及[构建入口import](skill-label-native-undo-built-entry.log) | 退出0，dist仅生成 |
| [独立package:check](skill-label-native-undo-package-check.log) | 退出1，仍缺旧`docs/goal-descendant-acceptance.md` |

实验不在正式vitest默认包含范围内，单独运行。日志只移除末尾空行，结果不变。未测试异步候选，未运行新真实CLI/PTY、物理IME或完整组合验收；没有调用真实MCP、远端provider或子代理。四项PI_SUBAGENT环境变量只在全仓检查子进程移除，未改全局环境。

## Cleanup and continuation

内存子进程PID14575/14862/14926/14981已同步等待退出，并以ESRCH确认回收；没有其监听端口。本轮临时目录`.tmp/skill-label-native-undo`及本轮quality stderr临时文件已清理。未启动常驻服务或PTY，未改全局Pi/终端/字体。

旧`.tmp/skill-ui-prototype-GG4yw8`不存在的更正继续有效。本轮没有删除或重建它，不再声称已保留。详情见[清理记录](skill-label-native-undo-cleanup.log)。

由协调者核对本报告，决定关闭#12并恢复#15。本worker只更新#15自己的Execution/Verification，未改Acceptance、Map、Spec、#12或progress，完成后等待恢复指令，不自动扩大实施范围。
