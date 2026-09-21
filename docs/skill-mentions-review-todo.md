# Skill mentions review todo

## Understanding

修复 `main@2d184f0f92cd`、Pi 0.86.0 上已复现的三个问题：撤销分组错位、消息对象替换后技能快照丢失、重绘前导航使用过期布局。按以下顺序实施，保持现有静默回退、队列消费时读取和压缩策略。

核实阶段已使用真实 CustomEditor 和 AgentSession 执行 8 个临时探针；模型使用 faux provider，未执行真实终端 PTY。探针已清理；下列实现已完成，验证结果见 Execution results。

## User Visible Changes

- 删除技能标签后，经过鼠标定位或无效果历史导航继续输入，连续撤销能准确恢复每一步，显示标签与原文一致。
- 前置扩展合法克隆 user 消息后，技能正文仍进入模型输入和持久化 user 消息，卡片显示与实际快照一致。前置扩展修改正文时的处理规则须先完成下述契约调查。
- 文本修改后，即使尚未重绘，上下移动、分页和鼠标定位也使用当前文本的布局。

## Todo

- [x] 修复 `label-editor.ts` 中原生输入合并状态与插件 `word` 状态的同步，覆盖有效鼠标点击、提前委托路径及无效果 `historyPrevious/historyNext`；保留正常连续输入的撤销合并，不额外增加原生 undo 快照。
- [x] 查明 Pi 0.86.0 的 user 消息 start/end 配对、串行与重入语义，以及取消、异常和 session 生命周期边界，确定不依赖对象身份或正文相等的关联方案；明确前置处理器修改正文时如何保留修改、处理技能集合与快照，不用旧任务覆盖新正文。
- [x] 按调查结论修复 `index.ts` 的快照关联和未完成请求清理，使相同文本的排队请求保留各自快照与图片；保证模型输入、持久化 user 消息和卡片可见性一致，完成或废弃的请求不残留在 pending 状态，不为关联请求重复读取技能文件或扫描全部历史。
- [x] 抽出渲染与坐标操作共用的布局刷新逻辑，在垂直导航、分页和鼠标命中测试前确保布局有效；覆盖文本、标签、宽度、图标及名称集合变化。布局输入不变时复用缓存，避免输入处理与紧随的 render 重复构建相同布局。

## How To Test

每项修复先写表达正确行为的失败测试，确认失败原因后实施最小修复，再运行相关回归。复用现有 editor 和 lifecycle fixture。

- 撤销：从 `$alpha` 标签开始，Backspace → 输入 `a` → 点击 `a` 末尾 → 输入 `b` → 连续撤销三次，原文必须依次为 `a`、空字符串、`$alpha`；每一步同时检查标签显示。分别用自定义绑定的无效果 `historyPrevious/historyNext` 替换点击，得到相同结果。保留连续输入整词、整体删除、折叠粘贴、补全和历史浏览的既有断言。
- 消息关联：在 skill-mentions 之前注册 message_end 处理器，分别保持原对象、仅克隆、替换并修改正文，检查最终 provider 输入、持久化 user 快照、图片和卡片可见性；正文修改按调查确定的契约断言。覆盖相同文本排队但技能文件内容不同、取消或未完成配对，以及适用的 reload/session 切换清理。处理链无扩展错误，孤立卡片不能因 pending 残留持续显示。
- 布局：`setText("$alpha\nabc")` → `render(80)` → `insertTextAtCursor("\nxyz")` → Up，中间不 render，光标必须为 `{ line: 1, col: 3 }`。补充 setText、普通输入后未重绘的上下导航、分页和鼠标命中，覆盖窄宽换行、标签消失与恢复、图标或名称变化；与先 render 再操作的对照组比较。
- 性能：用确定性调用计数检查布局缓存，连续导航和重复渲染同一布局输入不得重复执行 layoutLabels，变更后首次需要布局时才重建。以多条重复文本请求验证完成后的 pending 不累积、技能读取次数不因关联方案增加。复用现有布局与长标签验证设施；原生逐字删除的既有快照成本不作为本次优化目标。
- 集成：运行现有 skill-mentions 测试，并使用仓库 PTY 验证设施在 fullscreen 模式验证真实点击与连续撤销；regular 模式保留终端选区行为。记录实际覆盖范围，不把 fixture 验证称为 PTY 验证。
- 最终验证：运行 `pnpm run check`，要求类型检查、测试、构建和发布包校验全部通过；若仍有无关阻塞，明确记录失败项及未执行阶段，单独运行可执行的构建和包校验，不将整体标记为通过。任务启动的服务或后台进程须停止，并确认监听端口释放。

## Notes

- 核实阶段的现有 skill-mentions 16 个测试文件全部通过，但未覆盖上述缺陷。
- 核实阶段 `pnpm run check` 类型检查通过，全仓 2312 个测试通过、5 个跳过；MCP 测试套件因缺少 `prototypes/mcp-status-ui-prototype/src/codex-startup.js` 加载失败，后续构建和包校验未执行。该缺失文件问题不属于本清单的修复范围。
- 当前默认扩展中未发现替换 user 消息的前置处理器，消息关联问题属于条件触发的兼容性缺陷。
- 不重做已接受的高内存撤销方案，不改变未知或不可读技能的静默回退、队列消费时读取、压缩后不补卡或重注入正文，以及 reload 不保留旧 editor undo 栈的边界。
- 修改 `src/` 与对应 `__tests__/`，不手工修改生成的 `dist/`。本清单已执行，修复在 `fix/skill-mentions-review` 分支提交。

## Execution results

- 2026-09-21：三项核心缺陷及正文替换后的显示缓存、最终封装失败后的显示回退均已按失败测试 → 修复 → 回归完成。
- 宿主依据：Pi 0.86.0 的 `agent-loop.js` 对初始及排队 user 均顺序 await start/end；`agent.js` 禁止并发 prompt，事件监听器被等待，异常运行最终发出 agent_end。关联使用单个活动请求，不依赖消息对象、timestamp 或正文相等；会话结束与迟到读取均有保护。
- 前置处理器修改正文时，保留最终任务与图片，按最终引用更新技能集合；同一请求每个文件最多读取一次。卡片读取有效 user 的最终快照，孤立卡片隐藏。
- 布局缓存调用计数测试通过：导航、鼠标与 render 共用同一缓存，未变布局不重复构建；文本、图标、名称与宽度变化均触发相应刷新。
- `node --expose-gc extensions/skill-mentions/__tests__/label-performance.mjs` 的 17 组布局与删除/撤销案例全部通过，旧 editor 可被 GC 回收。包含 100 KiB 草稿的 10/100/1000 个标签，以及至多 1 MiB 粘贴旁的标签删除；耗时仅作观测，不据此宣称性能提升。
- 最终 `pnpm run check`：类型检查通过，2333 个测试通过、5 个跳过；唯一失败套件仍是缺失 MCP prototype 模块的 `status-ui-prototype.test.ts`。其中 skill-mentions 的 16 个文件、380 个测试全部通过。
- 单独 `pnpm run package:check`：被另一处原有缺失文件 `docs/goal-descendant-acceptance.md` 阻塞，不能宣称发布包校验通过。这两项仓库缺失文件均未改动。
- 最终 `pnpm run build` 通过，dist 仅由构建生成，未手工编辑。
- 真实 CLI/PTY：原生 regular、原生 fullscreen、Codex fullscreen 均通过现有 spacing 验证和新增连续撤销检查。fullscreen 使用真实 SGR 鼠标点击，regular 使用无效果 historyNext；各模式同时保留原有图标、标签删除/撤销、窄宽布局、分页、外部编辑器及折叠粘贴检查。Codex 探针曾因未匹配 `›` 提示符失败，修正坐标查找后通过，未放宽原文与撤销结果断言。
- PTY 使用工作区编译产物与隔离的本地配置，没有重新安装包或调用真实模型；不等同于已通过 tarball 安装验收。证据位于 `adventure/evidence/skill-review-pty-{native,native-fullscreen,codex-fullscreen}.json`。所有 PTY 子进程均被回收，隔离目录已删除，未创建监听端口。
