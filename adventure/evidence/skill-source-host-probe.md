# Source projection host probe

## Question

保留 Pi 原生文本、撤销与大粘贴折叠时，能否仅通过公开接口，在真实输入框投影整体 skill 标签？本实验判断实施路线是否成立，不交付生产编辑器。

## Landing Map

- Target：Pi 0.86.0 主输入框，原生 Editor 与仓库 CodexEditor。
- Context：实际 CLI、真实 editor factory、原生补全、skill 卡片、Markdown 正文及 reload；不重建宿主界面。
- Contract：原生编辑器保留原文和粘贴注册表，旁路维护标签范围与显示坐标；公开回调、提交和 getExpandedText 保留 `$skill-name`。

## Approach

[source-model-probe.ts](../experiments/skill-mention-ui/source-model-probe.ts)区分原生缓冲、标签范围与投影布局。成标不写回buffer；可容纳一行的标签整体换行，超长标签按字素跨行着色。cube与command走同一映射。

[source-host-probe.ts](../experiments/skill-mention-ui/source-host-probe.ts)组合原有编辑器，先运行真实render，再替换内容行，保留真实边框和菜单。Codex背景直接复用产品paintBackground，保留真实提示符。光标标记、滚动窗口及鼠标位置通过投影映射。没有改写原实例的方法或prototype，没有访问paste注册表和undo私有字段。

此包装器只认识当前两个宿主的边框输出。正式实现不能把这种输出形状假设当成任意编辑器的稳定协议。公开方向事件只是证明可行的实验方法，不要求复制逐字循环到生产代码。

## Red and green

此前原文模型的4轮见[旧报告](skill-label-editing-probe.md#source-model-probe)。本轮补充：

- 原文游标未映射到跨行位置，坐标测试先失败。补上范围与字素映射后，宽度8/16/80的中文和标签边界往返通过。
- command模式最初仍输出cube；两字形统一几何映射后通过。
- 原生setText会清空内部pastes。折叠粘贴旁删除标签后只剩字面标记，混排测试失败。这推翻旧探针的setText整块删除路线。替代为公开原生删除事件，记录所需undo操作数、批量通知回调，用户一次undo恢复整个标签与原生paste快照。局部测试及真实PTY均通过。
- 宿主最初只显示原文，没有cube与投影光标；包装后真实Editor的宽度8/16/80边框、光标标记、标签和不超宽断言通过。
- 首轮真实PTY在插入再删除相邻X后失去末尾标签。先补失败用例，再修复重新识别，原真实流程通过。
- 鼠标落入折叠标记内部时，该原文偏移无法由原生游标到达，出现往返重试。[失败日志](skill-source-folded-cursor-red.log)。改为根据原生事件实际跳过的区间吸附边界，混排坐标和完整内容保留通过。

## Verification

```bash
pnpm exec vitest run --config adventure/experiments/vitest.config.ts adventure/experiments/skill-mention-ui/
pnpm exec tsc --noEmit --target ESNext --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop --types node adventure/experiments/skill-mention-ui/*.ts
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs cube --native --source --capture
pnpm exec node adventure/experiments/skill-mention-ui/run.mjs command --source --capture
```

- [24项实验测试](skill-source-host-tests.log)通过，其中原文模型9项、宿主1项、此前行为/样式14项。[独立tsc](skill-source-host-types.log)退出0。
- [cube/native真实PTY](skill-ui-cube-native-source.json)，最终PID56248，正常退出0。
- [command/Codex真实PTY](skill-ui-command-source.json)，最终PID56434，正常退出0。
- 两组实际CLI验证输入与正文颜色/字形、原生卡片、原文与两份快照、provider输入无ANSI/投影标记、真实Tab补全不发送、左右整块跨越、Backspace/Delete、undo、历史回填及往返reload。新增12行折叠粘贴与可见标签混排，删除及一次undo均保留完整展开原文。
- 窄列映射由真实Editor单测验证，不冒充已完成真实终端resize、物理鼠标或IME验收。
- [全仓check](skill-source-host-check.log)仍为typecheck通过、2070 passed/5 skipped，既有MCP prototype缺文件导致失败，后续build/package步骤未执行。没有恢复无关文件、跳过测试或降低门槛。
- 本次PTY子进程已退出，launcher临时目录已清除；没有启动监听服务。保留用户此前手动启动的tint目录。

## Fixtures and limits

复用已有离线faux provider与presentations/lark-doc具名fixture，不向真实模型请求，不改全局安装、用户配置或字体。真实skill加载/协议/补全和周边UI来自现有产品。实验的有限标点适配不代替#5最终语法；正文关联也仍是旧实验机制，不证明同文不同快照正确。

PNG来自真实PTY网格，字体栅格化属于approximation；不能证明用户终端选用相同字体。两处效果见[cube](skill-ui-cube-native-source-detail.png)及[command](skill-ui-command-source-detail.png)。

## Implementation handoff

路线有关键路径证据，可结束本关的可行性调查。以下必须在正式输入标签切片完成，不视为已通过：

- 用公共按键动作配置处理自定义键位，而非硬编码默认事件；按词删除、kill ring、外部编辑器、onChange次数、连续undo和重复文本状态必须回归。当前journal按文本找历史仅是探针，不是生产历史关联设计。
- 完整上下移动及跨行标签吸附、真实resize、鼠标/滚动、菜单位置、宿主边框与视口适配。探针含有限实现，不证明所有边界正确。
- 大折叠块混排的连续编辑、撤销与提交；对长名称/多标签测试有界处理与响应时间。原生事件重复删除可能制造多个undo快照，正式方案需测量时间/内存，不能无条件迁移。
- 把#5正式解析器用于所有生成来源，重载资源、历史与队列恢复按稳定身份处理。probe没有替代产品的requestId设计。
- 输入标签切片验证上述编辑路径；正文/设置切片验证成功快照和持久偏好；最后的安装交付与整体验收验证IME、终端、扩展组合和完整Spec。公开API不足时回到Planning，不引入私有补丁。

可直接复用离线launcher、fixture和测试场景。原文/范围/投影分离是有证据支持的设计；原型的帧识别、journal和默认按键循环应按正式契约重写，不直接发布。
