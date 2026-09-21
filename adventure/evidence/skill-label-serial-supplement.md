# Skill label serial transaction supplement

## Result

这是[Implementation #15](https://github.com/wangxuyang1221/pi-ext/issues/15)的补充调查，不是产品交付。[首轮阻塞报告](skill-label-implementation-blocker.md)及其失败日志保留，产品`src/`未改，#15完整范围未缩减，#16未推进。

单项补全的异步性本身不足以否定这条路线。新增包装探针在实际Pi 0.86.0 CustomEditor和仓库CodexEditor上证明：对已覆盖的删除、读取、提交、setText和undo动作，公开API组合可以让消费者同步看到接受后的原文/光标和回调，同时将原生动作串行提交。旧补全忽略AbortSignal也不必阻塞后续提交。10 MiB折叠粘贴旁64字符名称的删除只需一次原生undo，观测额外heap/RSS低于预设128 MiB。

这为#12提供了一个有实测依据的候选，修正的是“直接异步补全不能满足时序”之后尚未验证的组合，不推翻首轮逐字成本、按词kill ring及setText破坏粘贴的反例。尚未证明完整EditorComponent的所有操作均可采用此方案，也没有发现一个足以否定所有包装策略的不可消除缺口。不能据此自动解除#15阻塞。

## Candidate

实验位于`adventure/experiments/skill-label-serial/`，没有装入扩展入口。它不是可直接迁入产品的编辑器。

- 包装层接受动作时同步更新pending视图，`getText/getExpandedText/getCursor`读该视图；消费者`onChange/onSubmit`也在同一调用栈发生。原生Editor仍持有自己的原文和paste注册表，但提交可能落后于pending视图。
- pending视图保存不可变来源片段、原文游标和按动作身份排列的撤销视图。折叠paste片段共享源字符串，不逐字符复制，不按任务文字、paste展开内容或render帧找历史。引用识别复用#14正式`findReferences`。
- FIFO队列通过公开autocomplete provider提供一个强制Tab候选。`applyCompletion`返回目标原文范围替换结果和游标，原生创建一次undo快照。没有调用setText做标签删除，没有读取private，也没有替换现有实例方法或prototype。
- 每次尝试携带generation和operation id；取消使旧结果失效，尚未完成的已接受动作重试。包装层抑制重复的原生回调，只向消费者发布一次同步逻辑回调。测试同时观察真正的原生提交，避免只验证影子状态。
- 包装层代理普通provider时，用AbortSignal竞争包装Promise。原生请求取消后，该包装Promise立即结束；底层provider以后成功或拒绝都有处理，但不再应用旧结果。它不能强行终止第三方provider自行启动的外部资源。
- 关闭先拒绝新输入、取消旧补全，再等待已接受队列提交，最后解除回调。直接丢弃队列会丢失已接受undo，已保留失败证据。

原生`startAutocompleteRequest`先等待`previousTask`，所以只递增generation、换provider或丢弃旧结果不够：忽略取消信号的旧Promise仍会挡住新请求。AbortSignal竞争必须在旧请求进入原生等待链之前就安装。这要求包装从编辑器生命周期入口开始管理provider，而不是发现阻塞后才临时接管。

## Focused verification

先测同步读取，再增加同栈提交和取消；核心成立后才测10 MiB成本。没有重跑逐字/按词成本路线。

| Sequence | Observed result | Boundary |
| --- | --- | --- |
| Delete → 立即三个getter | 两宿主同步得到`.`和列0；排空后原生也一致 | 默认键，单行ASCII fixture |
| 同栈Delete → Enter | 消费者顺序为`change:.`、`change:`、`submit:.`，原生稍后仅提交`.`一次 | 不需要用户增加等待或再按一次键 |
| Delete → 外部编辑器读取 → setText → 两次undo | 外部输入为删除后的正文；立即读取和排空后的原生都按顺序恢复 | 验证公开getExpandedText/setText接缝，未启动外部编辑器进程 |
| Delete → setText(同文) → undo | 同文setText仍把光标置尾、通知变化，不额外增加undo单元 | 修复前列0，期望列1，见Red日志 |
| 连续三次Delete → 连续三次undo | 每步pending原文正确，最终原生恢复`$alpha $beta` | 按已观察动作身份回退，不搜索同文历史 |
| 旧provider永不完成且忽略AbortSignal → Delete → Enter | 无须释放旧Promise即可排空并提交`.`；之后旧成功结果不应用 | 包装必须从请求开始就在场 |
| pending删除 → Escape → undo → 关闭 | 删除重试，关闭排空已接受undo，原生恢复原文 | 需要await候选dispose，尚非真实reload验收 |
| 旧provider → 删除 → 关闭 → 旧Promise拒绝 | 没有迟到应用、重复回调或未处理拒绝；关闭后的新输入无效 | 不证明任意第三方资源可被强制取消 |
| 折叠粘贴混排可见标签 → 删除 → undo | pending及原生展开内容均保留，paste内重复`$alpha`不用于历史匹配 | 来源通过公开bracketed paste输入，在队列空闲时记录 |
| 当前普通provider成功 | 正常应用一次、回调一次、一次原生undo恢复 | 仅普通文本，避免把“全部补全都禁用”误算成功 |
| onSubmit同步setText预填下一草稿 | 消费者立即看到下一草稿，原生按提交后setText顺序落地 | 验证回调重入而非延迟回调 |

最终[19项实验测试](skill-label-serial-final-tests.log)通过，配套[独立tsc](skill-label-serial-final-types.log)退出0。实验使用实际Editor实现、inert TUI及受控Promise，不是SDK整机、真实CLI、PTY或物理IME验证。

### Red and green

- [即时读取Red](skill-label-serial-read-red.log)：起始骨架直接委托原生Delete/getter，两个宿主只删掉`$`，返回`alpha.`而非整体删除后的`.`；[pending读取Green](skill-label-serial-read-green.log)通过。
- [关闭Red](skill-label-serial-shutdown-red.log)：立即dispose使已接受undo被丢弃，两宿主原生残留`.`；[排空关闭Green](skill-label-serial-shutdown-green.log)通过。
- [同文setText Red](skill-label-serial-external-red.log)：提前返回遗漏原生光标重置语义；修复后纳入最终19项Green。
- [中间动作结果](skill-label-serial-actions.log)保留。首轮报告、逐字失败目标及正式边界测试没有被替换成这些Green。

## Cost evidence

沿用#15 Execution的单次额外heap/RSS各128 MiB门槛。64字符名称旁分别放1/10 MiB折叠paste，先做一次预算检查，再预热5轮、采样20轮。每轮使用真实CustomEditor、公开bracketed paste/插入和单项补全；删除后立即读取展开正文，排空后核对原生，最后用一个用户undo触发一个原生undo并核对完整恢复。

环境：Apple M5、Node22.22.2、darwin arm64、pnpm11.9.0。[最终原始结果](skill-label-serial-final-performance.log)：

| Paste | Name length | Median / max delete | Observed extra heap | Observed extra RSS | Observed process RSS | Native undo |
| --- | --- | --- | --- | --- | --- | --- |
| 1 MiB | 64 | 0.512 / 1.002 ms | 3.12 MiB | 3.16 MiB | 150.53 MiB | 1 |
| 10 MiB | 64 | 3.738 / 4.744 ms | 30.12 MiB | 30.11 MiB | 230.98 MiB | 1 |

耗时从接受删除起到原生提交排空，包含一次pending展开读取和断言，不包含初始化、GC及undo。内存在删除前GC后建立基线，在pending读取后和原生提交后采样；不是分配追踪器捕获的瞬时绝对峰值，也不包含初始化已持有的paste和既有undo栈。基准脚本的`peak*`字段表示这些采样点的最大值。恢复原文断言和源码的一次快照路径共同排除了按名称字符数生成65份native快照的旧策略。

初次同规模[测量](skill-label-serial-performance.log)也保留。这里通过的是两组候选动作成本，不是完整长名称/多标签/布局性能矩阵；没有继续扩大到256/1024名称、1000标签或128 MiB粘贴。128 MiB是额外内存预算，不是本轮输入规模。

## Remaining boundaries

完整#15覆盖状态仍见[首轮矩阵](skill-label-implementation-blocker.md#spec-coverage)。本次只补充原子删除候选的时序及成本依据，未交付输入/正文视觉、两图标及偏好。

1. 探针不是完整EditorComponent：未实现render、布局、鼠标、菜单、跨行投影、自定义按键、普通字符输入及所有原生动作。默认ASCII回退删除不构成Unicode行为设计。
2. pending undo仅覆盖包装明确观察到的动作；构造前的原生undo历史不能预测，普通输入合并、按词操作、kill ring、历史回填及全部连续撤销仍须在正式生命周期设计中核验。首轮测试证明单项补全本身保留kill ring，本次没有假装已覆盖完整包装交互。
3. 已折叠的未知初始状态不接管；paste通过空闲时的专用输入帮助函数记录来源。普通补全与folded paste共存路径在探针中明确拒绝，不隐式展开或用文本匹配补洞。
4. 同步逻辑视图与稍后原生提交是新增状态协调责任，不能当作完整实现已自然遵守#12的原文/范围/投影分离。宿主所有读取、设置、输入、回调及移交都必须经过完整包装；直接读取内部base仍可能看到旧值。
5. 本次只证明await关闭可以排空，尚未将其接入实际session_shutdown、factory更换、reload或卸载。Pi公开async shutdown提供候选接入点，但“所有移交均会等待”尚无真实入口证据。不能在实际宿主不等待的情况下直接采用立即丢弃队列。
6. 未测真实外部编辑器子进程、真实CLI/PTY、物理IME、资源更新/重复安装、成功快照正文及队列/恢复/分支/压缩组合。没有运行完整标签组合验收。

上述是待核验的集成边界，不是已经证明无法实现的产品缺口。已测序列没有要求用户接受异步可见等待、放弃原子删除或修改Pi API。若后续发现只能靠这些行为变化消除具体反例，仍须返回Planning取得决定，不能自行批准。本次到此停止，不延伸为产品实现。

## Reproduction and repository checks

从仓库根目录执行，临时目录只放worktree内：

```bash
mkdir -p .tmp/skill-label-serial
TMPDIR="$PWD/.tmp/skill-label-serial" pnpm exec vitest run --config adventure/experiments/skill-label-serial/vitest.config.ts
pnpm exec tsc --target ESNext --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop --types node --noEmit adventure/experiments/skill-label-serial/editor.ts adventure/experiments/skill-label-serial/editor.test.ts adventure/experiments/skill-label-serial/vitest.config.ts
pnpm exec tsc --target ESNext --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop --types node --rootDir . --outDir .tmp/skill-label-serial/build adventure/experiments/skill-label-serial/editor.ts
pnpm exec node adventure/experiments/skill-label-serial/benchmark.mjs "$PWD/.tmp/skill-label-serial/build/adventure/experiments/skill-label-serial/editor.js"
env -u PI_SUBAGENT_PARENT -u PI_SUBAGENT_LAUNCH -u PI_SUBAGENT -u PI_SUBAGENT_ID TMPDIR="$PWD/.tmp/skill-label-serial" pnpm run check
pnpm run build
pnpm run package:check
rm -rf .tmp/skill-label-serial
```

| Check | Result |
| --- | --- |
| [本功能正式测试](skill-label-serial-formal-tests.log) | 291/291通过，未新增产品测试或改变原测试 |
| [pnpm run check](skill-label-serial-check.log) | typecheck通过；2244 passed/5 skipped；既有MCP suite缺`prototypes/mcp-status-ui-prototype/src/codex-startup.js`，退出1 |
| [独立build](skill-label-serial-product-build.log) | 退出0，dist仅生成 |
| [构建入口import](skill-label-serial-built-entry.log) | 退出0，不冒充真实CLI入口验收 |
| [package:check](skill-label-serial-package-check.log) | 退出1，仍缺旧`docs/goal-descendant-acceptance.md` |
| 实验构建、19项测试、成本断言 | 均退出0；实验配置独立，未加入正式vitest默认包含范围 |

日志仅清理尾随空格和末尾空行，保留失败断言、顺序与结果。没有修复无关缺文件、删除测试或降低检查门槛。四个PI_SUBAGENT变量仅在全仓测试子进程清除；未运行真实MCP、远端provider或子代理调用。

## Sources and cleanup

Context7在首轮仅返回`/earendil-works/pi`的main索引，不能作为0.86.0依据。本次复用并重查本机0.86.0源码及此前[固定commit散列核验](skill-label-api-source-audit.json)：

- [Editor](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/tui/src/components/editor.ts)：`startAutocompleteRequest`等待旧任务、请求取消及结果校验、单项强制补全、setText的同文/光标/undo语义。
- [Extension documentation](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/docs/extensions.md)：公开EditorComponent包装、getExpandedText及async session_shutdown。
- 本机`interactive-mode.js`的外部编辑器接缝先读`getExpandedText`再调用`setText`；本次测试该接缝，不声称执行了宿主完整方法。

已完整读取的Pi文档及引用清单沿用首轮报告，没有把Context7 main冒充安装版本。除补充实验、证据和#15自己的Execution/Verification外，未改Map/Spec/#12/progress/Acceptance。

本轮未启动常驻服务或新PTY。成本子进程初次PID40211/40399、最终PID20696/20697均由spawnSync等待退出，并以ESRCH确认回收；无这些PID的TCP listener。测试临时目录与本轮新产生的quality stderr临时文件已清理。最终核对发现`.tmp/skill-ui-prototype-GG4yw8`不存在；初版报告的“已保留”表述不成立，现已更正。本补充仅删除`.tmp/skill-label-serial`和`.tmp/codex-quality/quality-plugin-p57BRn.stderr.log`，没有执行删除该prototype的操作，尚不能确认其消失时间或原因。未重建空目录冒充保留成功，已向协调者报告此异常。详情见[清理记录](skill-label-serial-cleanup.log)。
