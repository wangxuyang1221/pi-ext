# pi-ext

为 [Pi Coding Agent](https://github.com/earendil-works/pi) 提供七个扩展和一套主题：

- `codex-compact` 为支持的 ChatGPT auth 模型提供 Codex Remote Compaction V2。
- `openai-fast-mode` 为匹配的 OpenAI 和 OpenAI-Codex 模型注入 priority service tier。
- `codex-ui` 使用 Pi 品牌实现 Codex 风格的 TUI profile，并提供 `codex-pi` 主题。
- `mcp` 连接 Model Context Protocol 服务器，并将工具注册为 `mcp__<server>__<tool>`。
- `permissions` 提供 `Default permissions` 和 `Full access` 两种模式，以及逐次调用审批。
- `subagent` 通过 tmux 管理普通 TUI Pi child，并从 Pi 原生 session JSONL 读取活动与完成状态。
- `goal` 提供目标独立保存、模型工具、事件驱动续跑、暂停/恢复、异常退出后的恢复和显式会话继承。

## Requirements

- Node.js 22.19 或更高版本
- `@earendil-works/pi-coding-agent` 0.84.3；goal 另验证 0.85.1 的实际 SDK
- `subagent` 运行时需要 tmux 3.6 或兼容版本
- 支持 24-bit color 的终端可获得最接近设计稿的颜色效果

仓库在 Linux、macOS 和 Windows 上运行通用测试；`subagent` 的真实 child runtime 仅适用于可运行 tmux 的环境。运行入口是各扩展 `dist/` 目录中的 ESM 文件，Pi 启动时不需要转译 TypeScript 源码。

## Install

先克隆源码并构建，再安装本地 package。仓库不再提交 `dist/`，不能直接使用 Git package 安装方式：

```bash
git clone https://github.com/wangxuyang1221/pi-ext.git
cd pi-ext
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pi install "$PWD"
```

本地安装引用此目录，不会复制文件。更新源码后需重新运行 `pnpm run build`。

安装后重启 Pi。使用 `pi config` 可以单独停用任一扩展或主题，而不必删除 package。

如需临时测试且不写入 settings：

```bash
pi -e "$PWD"
```

Pi package 以当前用户的完整系统权限运行。安装第三方 package 前应检查源码。

## Goal extension

启用 codex-ui 时，footer 用两行显示目标和统计：目标预览，以及状态、分钟耗时、token 用量与可选预算。耗时显示 `<1m`、`12m`、`1h 05m`，只在累计耗时跨分钟时主动刷新，不运行秒级动画；状态和用量变化仍立即显示。未启用 codex-ui 时，通过 Pi 原生 footer 的单行状态显示同一份摘要，不接管 footer。

`/goal` 详情显示打开时的精确秒数和用量快照，等待不会改变面板内容，关闭再打开才刷新。方向键和 PgUp/PgDn 滚动，`p` 暂停、`r` 恢复，仅在适用时显示；Esc 或 Enter 关闭，关闭本身不暂停。目标或会话已变时拒绝旧面板操作，需重新打开。存储异常、用量缺失和内容读取失败仍提供诊断；存储或工具恢复后使用 `/goal resume`。分钟显示不改变持久化频率、预算判定或 active 状态下的实际累计时间，不能把它理解为仅统计模型生成时间。实现与性能验收见 [Goal footer acceptance](docs/goal-footer-acceptance.md)。

在持久化交互 TUI 中使用 `/goal <objective>` 创建目标、`/goal` 打开详情面板、`/goal clear` 清除。替换未完成目标需要确认，新目标重新计数。只有整个 trimmed 参数等于控制词时才按控制词处理，因此 `/goal pause now` 是目标文本。`/goal edit` 编辑目标且保留统计，`/goal pause` 暂停，`/goal resume` 显式恢复并解除继承门禁。执行范围为持久化交互 TUI 中的 root 会话。goal 复用 Pi 当前已选模型，不按 provider 名称限制。内置 provider、`models.json` 私有模型和扩展注册的 provider 均须支持普通 function tools，并履行 Pi 消息与终止事件契约。URL、API key 与鉴权仍由 Pi 管理，goal 不增加凭据配置或任意私有协议适配。无工具模型、不合规 adapter、非 TUI、临时会话和子会话不能保证 goal 执行。模型切换不会自行启动新请求。

权威状态保存在公开 `getAgentDir()` 返回目录下的 `goals/`。新会话首条模型回复前也能保存，不依赖 Pi JSONL 已经落盘。历史 custom entry 只是镜像，失败不会回滚权威记录，下次摘要、绑定或 settled 检查点会重试。清除写入 tombstone，不从旧镜像复活。

`/goal-recover` 列出当前 cwd 中没有活跃写入者占用的目标，由用户选择。原会话文件存在时切换到该会话；不存在时先说明无法恢复未落盘对话，再在新持久化会话接管同一条记录和统计。恢复本身不发送模型请求，也不撤销文件或数据库副作用。重开 paused、blocked、usage_limited 目标时，在初始化完成后提供一次恢复确认；只有接受后才启动。reload、fork、预算已耗尽或执行环境不受支持时不提示。`--no-session` 和非 TUI 不支持这些入口。

锁使用进程、主机、实例和唯一 owner 文件标识，不按超时夺锁。同一主机明确已退出的进程可回收锁；身份不明、跨主机或 PID 已复用时不抢占。若提示锁身份不明，先退出所有相关 Pi 实例并备份 `goals/`，人工核验后只移除对应 `.lock` 目录，再运行恢复入口。不要在写入者存活时删除锁。损坏或未知版本的权威 JSON 需要从已核验的权威备份修复，不能用历史镜像自动代替。

同一会话的 `/tree` 不回退目标、状态和累计统计。普通 `/fork`、`/clone` 不继承目标，即使复制了历史镜像。`/goal-fork` 可选择历史用户消息之前 fork 或当前位置 clone，先核验当前权威快照，再保存独立新记录。目标身份、状态、预算和累计统计完整复制，源记录不变。历史 fork 会把所选用户文本放入新会话编辑器。

显式继承不会把 active 改成 paused，而是持久化 `continuationDeferral` 门禁；reload 和重开仍保留。明确的交互用户输入会解除门禁，但不把 paused、blocked 等停止状态改成 active，扩展注入消息不会解除。取消或失败不清除源目标，继承写盘失败时新会话可能没有目标。Pi 原生尚不能 clone 未落盘会话，插件会报告失败并保留已独立保存的目标，不伪造回复强行落盘。

TUI 超过4000个 Unicode 字符的目标写入 `goals/content/<bundleId>/objective.txt`，权威记录和模型上下文保存短引用。`/goal` 显示前1000字符摘要，`/goal edit` 验证引用和文件校验和后打开完整正文，重开仍可编辑。工具 objective 仍限制4000字符，不会自动物化。

Pi 原生粘贴图片会在编辑器中插入 `pi-clipboard-<UUID>.<ext>` 临时路径。提交目标时仅识别当前 Pi 临时目录中的这种路径，逐项选择 `Copy attachment`、`Keep as text` 或 `Cancel`；不读真实剪贴板、不扫描其他路径。明确选择后复制 PNG、JPEG、GIF 或 WebP 并改写正文引用，临时源删除不影响保存附件。正文上限1 MiB，每目标最多32张图、单图20 MiB；超过限制则拒绝本次保存，不改变旧目标。路径遍历、符号链接和校验和不匹配会报错。

每次编辑生成独立不可变内容包，继承的旧快照不被修改。失败只清理本次且确认未提交的包，不确定提交保留文件供修复。成功保存的旧包不会随 edit、replace 或 clear 自动删除，以免损坏继承和历史引用；备份目标时需包含整个 `goals/`。状态通过 Pi `setStatus` 展示，未加载 codex-ui 时使用默认 footer；加载后在原 codex-ui footer 下增加目标行，不替换原 editor/footer。

三个模型工具为 `get_goal`、`create_goal`、`update_goal`，工具描述与三个模板固定于 Codex main `b348fc26674189f758d5941cdab3f78f258b2aa7`。`update_goal` 允许用户明确要求的 paused，不允许模型自行决定暂停；返回实际持久状态，预算耗尽不被 pause/blocked 覆盖。完成、blocked、usage_limited 和 paused 都不会自动续跑。模型运行中 Esc 会暂停；原生重试等待中 Esc 取消后按 C12 记为 blocked，保留目标与统计，可用 `/goal resume` 恢复。关闭编辑或确认弹窗不会暂停。先等待 Pi 完成适用的重试与压缩恢复；最终 settled 仍为 length、deferred 或普通不可恢复错误时，仍 active 的目标转 blocked，保留目标供 `/goal resume`。中途失败后成功不会被旧异常停止。普通错误不覆盖 budget_limited，明确账户余额、订阅或用量额度耗尽可转 usage_limited。裸 429、含糊 billing、认证与网络错误不视为账户额度耗尽。goal 不自行网络重试、提高输出上限或取回 deferred 结果。写入或权威检查失败后停止自动推进，修复存储后显式 resume。

Goal 提示采用 Codex CLI 的历史保留方式：新工作回合记录一次提示，后续工具调用和重试不重新生成。已投递的续跑、预算与循环警告消息保留原文和位置，由统一压缩处理；目标编辑、暂停、清除或 `/reload` 不过滤旧提示，压缩后也不动态补插。只有当前运行实例仍在排队的失效请求会被取消，历史提示本身不会触发取消。运行中编辑通过 steer 在当前工具批次后送达新目标；空闲编辑启动一次。连续三个已接纳的自动续跑若 final 空白且整轮没有文本、reasoning、工具或外部活动，目标变为 blocked；显式用户工作不计入，该保护独立于重复工具检测。

必要工具 `create_goal`、`get_goal`、`update_goal` 被禁用时，goal 列出缺失项并停止新的自动续跑，不擅自启用工具，也不因工具缺失本身改变目标状态。恢复工具后须显式 `/goal resume`；普通输入、模型切换、编辑或 reload 不解锁。已经归属当前目标的最后响应仍结算 usage、预算与最终错误。取消失效自有续跑不会误取消已送达的用户 steer/follow-up 或其他扩展消息；历史提示不获得取消权限。公开事件未观察到的瞬时工具开关变化无法追溯。

根响应与受管直接子代理按 Pi 归一化 `usage.input + usage.output + usage.cacheWrite` 结算，排除 cacheRead；reasoning 已包含在 output 中，不重复加。Pi 提供 usage 的压缩和分支摘要同样结算，不使用 context tokensBefore、footer totalTokens 或任意工具内部模型调用账单。缺失、非法或未经证实的全零 usage 不虚构数量，有无预算均警告并继续。只有 cacheRead 为正时可计 0。后续有效 usage 正常追加，但查询与工具结果持续标明只含已观察用量，edit/resume/reload 不清除旧缺口。

预算是已观察 token 的软限制，不是费用或处理过的所有 token 总量。最终 usage 或来源检查点使已知累计达到预算后，只在当前仍可收尾的运行中提醒一次，要求停止新实质工作并总结；不强制中断当前模型、工具或子代理。收尾依赖模型遵守提示，实际 110/100 会保留为 110，不截到 100，也不启动后续自动续跑。根回合已结束时，迟到报告不会为提示另开收尾回合。确实完成仍可标 complete，不因预算耗尽假称完成。active 时间使用单调时钟，离线不计时。

可选配置为 `getAgentDir()` 目录下的 `goal.json`，例如 `{"maxGoalTokenBudget": 100000}`。扩展只读取，不创建或修改此配置。最大预算必须是正安全整数；配置上限同时作为创建时未指定预算的默认值，模型显式预算不能超限。未配置且未显式指定则无上限。非法配置阻止新建，修正后 `/reload`；`/goal --budget 100` 仍是目标文本，不是预算参数。

加载本仓库 subagent 时，为根目标投递的直接子代理任务也计入同一预算。归属在投递前登记，子代理按请求捕获归属并上报累计值；根检查点去重，重复读取活动不重复收费。子代理关闭后报告保留供检查点和恢复使用，替换目标后旧报告不计入新目标。paused、blocked、usage_limited、complete 后冻结目标统计；预算收尾继续计费至结束。停止期 child 报告只推进 baseline，恢复前先 checkpoint，不补收冻结期间已观察到的增量。例如该来源已计 10，停止后报告 50，目标仍计 10；恢复前基线为 50，恢复后报告 60，只追加 10。边界按报告观察时点结算，无法按真实发生时间拆分尚未报告的用量，也无法还原 provider 未暴露的失败请求或服务端消耗。主代理使用 activation fence，暂停前发起的响应不因恢复而重新收费。暂停目标不会杀子代理。显式继承复制累计统计，但不订阅源会话的子代理。C13 保留 root → direct child，不支持孙代理或第三方代理计费；managed child 不安装独立 goal 工具或循环。

当前支持范围、预算限制与复现入口见 [Goal provider support](docs/goal-provider-support.md)。多 provider 的完整交付证据见 [Spec audit](https://github.com/wangxuyang1221/pi-ext/blob/adventure/goal-all-providers/adventure/evidence/slice-3-spec-audit.md)。离线协议代表样本不等同于全部远端 provider 或模型的端到端实测。非空纯文本续跑不新增次数上限，既有空响应、重复工具与连续执行失败保护保留。

以下为此前基线验收记录。研究排名 1–7、9 的历史实现及验收见 [Goal parity acceptance](docs/goal-parity-acceptance.md)，其中旧 provider 白名单不再作为当前限制。

#4 至 #9 的基础存储、生命周期、执行、预算、直接子代理和附件/UI 已由协调者验收。Pi 0.84.3/0.85.1 的实际 SDK、受管 OS 子进程和 InteractiveMode PTY 使用离线原生 adapter 或 faux provider 夹具，不包含付费在线调用，不宣称断电零丢失。受管子进程使用真实 tmux transport 与子端 CLI，IPC 夹具仅作补充；根端使用 SDK，原生根 TUI 输入另有 PTY 矩阵。最终工作区集成结果、准确基准和未执行项见 [Goal integration acceptance](docs/goal-integration-acceptance.md)，是否通关以协调者独立验收为准。分项证据见 [Goal attachments and UI acceptance](docs/goal-ui-acceptance.md)、[Goal direct child accounting](docs/goal-descendant-acceptance.md)、[Goal budget acceptance](docs/goal-budget-acceptance.md)、[Goal execution report](docs/goal-execution-report.md)、[Goal storage acceptance](docs/goal-storage-acceptance.md) 与 [Goal lifecycle acceptance](docs/goal-lifecycle-acceptance.md)。

## Codex Compact extension

`codex-compact` 只接管 provider 为 `openai-codex` 且 API 为 `openai-codex-responses` 的模型。扩展通过 Codex Remote Compaction V2 获取加密 checkpoint，并将 V2 details 写入 Pi 的标准 compaction entry。其他 provider 和 API 继续使用 Pi 原生压缩；如果当前分支已有 V2 checkpoint，切换到非 Codex 模型时会回放原始分支，避免把加密 checkpoint marker 当作可用文本摘要。

Pi 发起的手动 `/compact`、threshold 和 overflow 压缩完全使用 Pi 原生进行中 UI，不叠加扩展 footer。Pi 提交最终 entry 后，扩展重新读取本次新写入记录并校验 hook 来源、V2 details、模型和压缩参数。校验结果会延迟到 Pi 完成 compaction 卡片重建后显示，避免通知被 transcript 重绘清除：

```text
Codex compaction applied
```

原生 compaction 卡片展开后还会显示持久化摘要：

```text
Codex encrypted compaction item.
```

若远程请求、响应结构或 checkpoint 校验失败，扩展会取消本次 Codex 压缩，不会静默降级为 Pi 本地文本摘要。若最终 entry 无法证明来自本次 V2 attempt，则显示 warning。扩展在 provider request 前自主发起压缩时，会在编辑器上方显示 `⠋ Compacting context... (esc to cancel)` 动画，并在下方保留一行间距。提示不会写入 footer；session、分支或模型切换时会立即清理。

可在全局 `~/.pi/agent/pi-codex-compact.json` 配置，也可在受信任项目的 `.pi/pi-codex-compact.json` 覆盖：

```json
{
  "autoCompactTokenLimit": 180000,
  "autoCompactScope": "total",
  "effectiveContextWindowPercent": 95
}
```

`autoCompactTokenLimit` 必须为正数，默认和上限均为模型原始 context window 的 90%。`autoCompactScope` 可设为 `total` 或 `bodyAfterPrefix`；默认使用 `total`。

有效窗口默认为原始窗口的 95%，用于调度判断和压缩请求的工具输出裁剪预算。`effectiveContextWindowPercent` 接受大于 0 且不超过 100 的有限数值；若模型配置里的窗口已经扣除了余量，可设为 100，避免重复扣除。这个配置不会改变默认 90% 自动压缩阈值，也不会修改 Pi 自身的压缩调度。本地估算超窗不再直接阻止远端压缩，最终由服务端判断。

插件观察到成功普通回复且历史覆盖边界仍有效时，自动压缩使用服务端 total usage 加未覆盖增量；模型、分支、前缀或检查点变化时回退本地估算。多媒体估算、特殊轮次边界及完整 Rust 差分尚未全部对齐；加载在本扩展之后的 payload 转换也无法完整观测。默认测试不依赖历史在线实验材料，也不以本地估算证明服务端 90% 阈值；报告重建入口见 [Codex compact quality validation](docs/codex-compact-quality-validation.md)。

压缩请求超过有效窗口时，扩展仍可裁剪工具输出，但不再丢弃旧 user turn 后只压缩最新一段；服务端明确拒绝完整历史时会直接失败，不提交新 checkpoint，也不进入额外的超窗恢复循环。诊断保留原始错误分类，`recoveryAttempted` 为 `false`；网络重试及 Pi 普通请求超窗后发起压缩的流程不变。保留历史的 64k 预算计入图片，并原子保留或删除图片及相邻标签。文本边界采用 UTF-8 首尾保留截断。Pi 发起压缩时，如系统提示已改变，扩展会刷新缓存指令。

当前 V2 路径不消费 `/compact focus text` 的 focus text，也不执行分段压缩。离线验证方法与历史证据要求见 [Codex compact quality validation](docs/codex-compact-quality-validation.md)。

不要同时加载本扩展和独立的 `npm:@yeungkc/pi-codex-compact@0.0.6`，否则同一组 hooks 会执行两次。迁移现有安装时，应先验证本 package，再从 Pi settings 停用独立 npm entry 并重启或 reload。

本目录基于 `@yeungkc/pi-codex-compact` 0.0.6 导入；精确 commit、同步范围和本地改动记录见 `extensions/codex-compact/UPSTREAM.md`，上游 MIT license 见同目录 `LICENSE`。

## OpenAI Fast Mode extension

`openai-fast-mode` 为配置中精确匹配的 OpenAI 和 OpenAI-Codex 模型注入 `service_tier: "priority"`。可使用以下命令切换：

```text
/fast
/fast on
/fast off
/fast toggle
```

启动参数 `--fast` 会启用并持久化 Fast Mode。全局状态继续保存在 `~/.pi/agent/extensions/pi-openai-fast-mode/config.json`；项目级状态保存在 `.pi/pi-openai-fast-mode/config.json`，迁入本仓库后无需迁移现有配置。

扩展通过 `setStatus("pi-openai-fast-mode", "fast")` 发布 footer 状态，并主动清理 0.3.0 使用的 below-editor widget。不要再单独加载 `npm:pi-openai-fast-mode`，否则 `/fast`、flag 和 provider hooks 会重复注册。

本目录基于 `pi-openai-fast-mode` 0.3.0 导入；精确 commit、同步范围和本地改动记录见 `extensions/openai-fast-mode/UPSTREAM.md`，上游 MIT license 见同目录 `LICENSE`。

## Codex UI profile

`codex-ui` 仅在 Pi 的 TUI 模式中接管以下组件：

- 使用 `pi v0.84.3` 官方 wordmark 的 header
- 实色背景 composer
- model、thinking、Fast Mode、cwd、git branch、context-left 和 permissions 主状态行，另显示可选 goal 状态行
- 普通 assistant 回复使用外层列表缩进，自动换行和后续段落保持对齐
- 原生消息位置的单行思考摘要，流式与完成后保持同一规则
- 隐藏 streaming working row；运行时窗口标题使用 80ms 单色转圈，正文思考状态仍保持静态
- Read 连续文件分组与每文件三行短预览，以及 `edit`、`write` 的紧凑 renderer
- Bash 逐条显示 `⏺ Bash(command)` 与前三行输出，按 `Ctrl+O` 原位展开完整命令和已捕获输出

每段连续 Thinking 从第一个完整、独占源文本行的 `**标题**` 出现时，就在原生消息位置显示 `• 标题`。后续完整标题原地替换，尚未闭合的标题不覆盖上一条；超长标题截断为一行，无标题正文不充当摘要。输入框上方不再安装思考 widget，也不预留它的空白区。

生成工具参数、执行工具和 `message_end` 后继续显示同一摘要，不再补入多段思考正文。取消、失败和恢复会话使用相同规则；完整 Thinking 仍保留在 session 与模型上下文中。摘要沿用原生思考样式，括号、方括号和反斜杠标题使用代码样式保留字面量。原生 `Ctrl+T` 及隐藏占位不变，Pi 父容器的 Spacer 不由扩展重建，无标题思考仍可能留下宿主空行。

这消除了思考延迟补入导致的工具行位移，不代表整个 Pi 零重绘。新增工具、回复、输入和 resize 仍会正常改变布局。实现、缓存边界和性能差异见 [Inline reasoning](docs/plans/codex-ui-inline-reasoning.md#results)。更新后请重启 Pi 并恢复会话，不要只依赖 `/reload` 更新模块。

Write / Edit 从参数生成到执行结束前，都显示黄色静态 `⏺ Writing / Editing` 与路径，目录弱化、文件名突出，不计行或展示中间内容，Ctrl+O 不增加进行中内容。成功圆点绿色，失败圆点红色，可靠识别的中断为黄色；错误正文不重复加叉。

本地 Write 在内置文件队列中采集旧内容，新建成功显示 `Added`，覆盖显示 `Edited`。普通模式复用 Edit 的行号、增删统计与 diff 样式，默认显示 12 个 diff 行，灰色省略提示紧随正文，Ctrl+O 展开已保存的 diff。low-power 只识别新建或覆盖，不读取旧正文、不生成 Write diff。缺少变化元数据的旧 Write 结果暂时保留原有总行数摘要，不推测新建或覆盖。

Write / Edit 的 diff 显示层在高亮和背景填充之前移除回车及原始终端控制序列，避免 CRLF 行被补齐空格擦空；磁盘内容和持久化 patch 保持原样。

Write diff 采集限制为旧、新文本各 1 MiB，合计 4000 行，保存的 patch 不超过 2 MiB。不可读或超限时保留真实成功标题，普通模式显示 `Diff unavailable`，不编造增删数。Write / Edit 每行只高亮前 4096 个 UTF-16 单元，其余内容保留。已通过 Pi 0.84.3 与 0.85.1 的普通、全屏 CLI 验收；测试及性能边界见 [Write / Edit validation](docs/codex-ui-write-edit-validation.md)。

### Tool execution settings

工具覆盖在 TUI、print 和 RPC 中都会生效。默认 Read / Bash 通过公开 `SettingsManager` 的合并规则，读取 `getAgentDir()/settings.json` 与受信任项目的 `.pi/settings.json`，保留 `shellCommandPrefix`、`shellPath` 和 `images.autoResize`；项目配置优先，不信任项目的配置不读取。读取不写配置或锁文件；损坏或不可读的 scope 与宿主一样被忽略，宿主负责其配置诊断。

配置按 cwd 和信任状态在首次执行时取得快照，普通工具调用和重绘不重复读文件。修改配置后使用 `/reload` 或重启，跨项目会话使用新项目配置；不监听文件变化，也不自动同步宿主尚未持久化的内存设置。

SDK 内存覆盖、自定义 settings 存储和宿主自定义执行器不在自动继承范围内。SDK 可使用 `codexUi(pi, { getExecutionOptions })` 显式返回 `{ read: { autoResizeImages }, bash: { commandPrefix, shellPath } }`；这份配置替代文件配置，每个快照只取一次。需要自定义 operations 或执行器时可传入 `toolFactories`，沿用 `registerCodexTools` 的四工具 factory 契约；自定义 factory 自行管理执行参数，不套用默认文件配置。扩展不会探测或修改 Pi 内部执行器。

### User message layout

用户消息的 `›` 标记单独占一个 Markdown 段落，不再拼接到正文首行。原生 Markdown 因而保留首行代码围栏、表格、列表和标题，代码中的星号等字面量不会因标记而被解释成强调语法。显示会比原来的同行前缀多出标记行及段落间距，不修改会话原文和模型输入；已经以 `› ` 开头的内容保持原样。

### Assistant reply layout

普通回复通过公开 `registerMarkdownTransformer` 显示为一个外层列表项：首行使用 `-`，后续源文本行缩进两格，自动换行、标题、代码块和表格由 Pi 原生 Markdown 排版。空白内容不添加标记，已有列表会再嵌套一层。转换按文本块执行，同一回复含多个文本块时可以出现多个外层标记。

转换只改变 TUI 显示，不修改会话原文或模型上下文，不修改上游 Pi、私有组件或全局 `outputPad`。`/copy` 使用原始回复文本；终端选择复制会包含显示出的列表标记、缩进和换行。thinking、工具卡片、编辑器以及原生取消和错误提示保持现状。

流式更新与历史恢复使用同一规则，不增加刷新计时器或历史扫描。列表排版仍有额外成本，实测和边界见 [Reply list implementation](docs/plans/codex-ui-reply-list.md)。更新后请重启 Pi 并恢复会话，不要只依赖 `/reload` 加载新版代码。

### Output alignment

单行思考摘要使用原生消息 padding。若要让圆点在第 1 列、文字在第 3 列，与工具图标和标题对齐，需使用 Pi 的公共设置 `outputPad: 0`。请在 `/settings` 中将 `Output padding` 设为 `0`，或在 `~/.pi/agent/settings.json` 的现有内容中合入：

```json
{
  "outputPad": 0
}
```

这个共享设置同时影响用户消息、普通回复和思考，左右各去掉原生的一列留白；工具和输入框内部 padding 不变。扩展不自动写全局配置，也不修改 Pi 私有组件。若历史仍右偏一列，检查已信任项目的 `.pi/settings.json` 是否覆盖了全局值。设回 `1` 或删除该字段即可恢复默认消息留白。

### Low-power rendering

`/lowpower on` 只负责简化 `write`、`edit`、`bash` 的渲染；`/lowpower off` 恢复完整工具输出，`/lowpower status` 仅查询当前状态。两种模式都会隐藏 Pi 内置的 streaming working row，并使用同一套原位单行思考摘要。窗口标题独立使用 `80ms` 单色转圈，与自动 compact 相同帧序列；项目名和会话名保持固定，不再播放动态省略号。按单调时钟选择帧，延迟后跳过错过的帧，不补播；仅写入 OSC 标题，不请求正文重绘。动画跨重试和自动 compact 保持运行，任务 settled、取消完成或会话退出时停止，恢复静态标题；手动 compact 也有标题反馈。默认 package manifest 将 `codex-ui` 放在 `codex-compact` 前加载，使标题在耗时压缩 handler 开始前启动；手动分别加载扩展时也需保持这个相对顺序。两种 low-power 模式行为一致，工具计时器不受影响。

启用 Pi 的 `terminal.showTerminalProgress` 后，终端原生 edge progress 仍由 Pi 管理，不进入 TUI 行渲染管线。Low-power 状态仅保存在当前 extension instance 中；`/new`、`/resume`、`/fork`、`/reload` 或进程重启会重新加载扩展，并恢复为默认关闭。

### Theme persistence

Pi 0.84.3 会在 session replacement 和 reload 完成后重新应用 theme setting。`codex-ui` 的裸 `pi` 兼容兜底使用非持久的 `ThemeObject`，它只改变当前内存主题，不会替换保存的 setting。因此，当全局 theme 仍为 `dark` 时，首次启动可以显示 Codex 配色，但 `/new`、`/resume`、`/fork` 或 `/reload` 后会重新变为 `dark`。这不是终端配色漂移。

如果希望所有普通 `pi` 会话默认使用 Codex 配色，请在 `/settings` 中选择 `codex-pi`，或将 `~/.pi/agent/settings.json` 设置为：

```json
{
  "theme": "codex-pi"
}
```

主题名是 `codex-pi`，不是扩展名 `codex-ui`。采用全局设置后，直接运行 `pi` 即可，并且 session replacement 和 reload 后仍会保持 Codex 配色。

如果需要保留其他全局主题，只覆盖当前 Pi run，请使用：

```bash
pi --use-theme codex-pi
```

该参数不会修改保存的全局主题，但同样会在 `/new`、`/resume`、`/fork` 和 `/reload` 后保持 `codex-pi`。之后如果在 `/settings` 中主动选择其他主题，Pi 会立即应用并正常保存该选择。

如需短命令，可以自行在 Shell 配置中添加 function：

```zsh
pi-codex() {
  pi --use-theme codex-pi "$@"
}
```

仓库不会自动修改 Shell 配置，也不提供一个假定 `pi install` 会加入 `PATH` 的 package bin。

Bash、Read、Edit、Write 与 MCP 工具调用统一使用静态大圆点 `⏺`，标记后一个空格，工具标题加粗。参数生成、可见等待态和执行中统一黄色，成功绿色，失败红色；可靠识别的中断或超时用黄色并保留诊断。标记只随执行事件变化，不增加计时器、旋转或闪烁。Read、Bash 保留原生分组，Edit、Write、MCP 仍是独立调用，不新增 batch 卡片。

Bash、Read、MCP 的正常正文统一使用 `text`，在 codex-pi 主题中为原 Bash 的亮灰 `#d6d6d6`。目录、行号、连接线与截断提示仍弱化，文件名强调色及 diff 增删色不变。未全局修改 `toolOutput`，因此 subagent、默认工具卡片和 MCP 连接状态不受影响。完整与低功耗模式均支持，低功耗 Bash 仍需展开查看正文。实现及验收见 [Tool status acceptance](docs/tool-status-acceptance.md)，正式代码的隔离 PTY 验收命令为 `pnpm run tool-status:check`。

`read`、`edit`、`write`、`bash` 仍使用 Pi 0.84.3 的官方 tool definitions 执行。`edit` 优先根据真实 `EditToolDetails.patch` 还原 old/new 行号与 hunk，并绘制整行 added/removed 背景、独立 sign 和 syntax-highlighted content；sign 与源码之间保留一个空格。本地 `write` 通过公开 operations 在原文件队列内采集变化，执行成功后才生成并保存 patch，不改写模型可见的原工具结果。注入的自定义 Write factory 仍按原契约委托执行，不擅自探测本地文件。Bash 使用 `renderShell: "self"`。full 模式下，每个已执行调用显示一条 `⏺ Bash(command)`，`Bash` 文字仍与 `Read`、`Edited` 对齐。尚未执行的 pending 调用暂不显示，错误或完成结果不会被隐藏。内部仍按同一 assistant 消息中的连续 Bash 维护归属，不跨 text、thinking、其他工具、缺失组件或消息合并；重复 ID 的额外组件独立显示。取消旧统计标题、命令树和耗时列。长命令默认按当前宽度单行省略，展开保留完整命令及逻辑换行。

默认预览前三个终端显示行，超出时显示精确的 `… +N lines` 和实际展开绑定。正常正文使用 `text` 色，输出前缀灰色，失败正文红色；已核验的取消与超时使用警告色。无输出时分别显示 `Running…`、`(No content)` 或 `Command failed`。只在宿主明确标记失败且尾部诊断匹配时，才把退出码、取消或超时诊断提到预览首行，不根据日志中的 `Error` 判断失败。

全局 `app.tools.expand` 默认绑定 `Ctrl+O`，原位展开全部已捕获输出，保留原有空行和宿主错误原文；执行完成不覆盖展开选择。截断提示保持可见，包括宿主失败结果丢失 details 后保留在文本中的截断 footer；不读取 `fullOutputPath` 补齐输出，也不把捕获内容称为完整日志。缓存按调用内容版本、宽度和样式失效，未变化调用不重复清理、计数或着色。full-mode Bash 不再创建耗时刷新计时器；low-power 保留原有有界轻量展示。

更新后请重启 Pi 并恢复会话，确保加载新版代码；不要仅凭 `/reload` 成功判断旧进程已完成代码升级。分组只改变显示，不重新执行 Bash，也不修改持久化结果或用户 `!` Bash。当前契约、真实 CLI 和性能验证记录见 [Claude-style Bash implementation checklist](docs/plans/codex-ui-claude-bash.md#results)。

Read 在同一 assistant 消息内按调用顺序合并相邻读取，不跨 text、thinking、其他工具或消息边界。每个文件显示不加粗的主题 `accent` 文件名、暗灰目录和实际返回范围，默认附最多三屏幕行预览及余量提示。预览每行最多提取 512 个 UTF-16 代码单元，长行裁剪而不换行。全局 `app.tools.expand` 快捷键展开完整输入路径和最多 40 行源码，再次按键恢复短预览。错误、取消和续读提示保留；图片及归属不明的调用独立显示，避免宿主附件与文件名错位。分组不改执行、权限或持久化结果，不提供原型的配色与布局切换命令。双版本验证及预览开销见 [Read UI validation](docs/research/codex-ui-read-validation.md)。

Read 分组仍有已知限制：`Ctrl+T` 或部分 settings 操作重建历史组件后，历史 Read 会降级为独立显示，普通重绘不能恢复。文件路径和内容仍可见，使用 `/reload` 可恢复分组。本轮接受该展示限制，不接入宿主内部组件生命周期，也不将它视为已修复。

Footer 使用 ` ⋅ ` 分隔，并按 `model thinking ⋅ fast ⋅ cwd ⋅ git:branch ⋅ Context N% left ⋅ permissions` 排列。model 与 thinking 使用 Codex CLI 的 `#f6e2b7`，context 使用 `#f2b590`，Fast Mode 使用 `#c8a9ee`。终端变窄时会先缩短或移除 cwd 和 branch，再将 context 缩成 `N% left`；降级允许跳过等宽或更宽的中间变体，单字符目录也能显示可容纳的截断分支。model、context 和 permissions 保留到最后。

Footer 首行消费 `pi-openai-fast-mode` 和 `permissions` 两个稳定 status。有 `goal` status 时在第二行显示目标状态，内容变化使缓存失效，清除后移除第二行，首行布局不变。MCP、压缩进度、low-power 和其他临时 status 不显示。内置的 `openai-fast-mode` 不再创建 below-editor widget。由于 Pi 0.84.3 没有公开 weekly quota 数据源，本 profile 不显示 weekly quota。

Ghostty 的窗口透明度、blur、字体和 titlebar 仍由 Ghostty 配置负责。Pi cell 只使用不透明 ANSI 颜色。

本地构建后可以直接 smoke test：

```bash
pi \
  -e ./extensions/codex-ui/dist/index.js \
  --theme ./themes/codex-pi.json \
  --use-theme codex-pi
```

## MCP extension

在项目中创建 `.pi/mcp.json`，或在全局创建 `~/.pi/agent/mcp.json`。配置支持 JSON comments、trailing commas，以及 `stdio`、`streamable-http`、`http` 兼容别名和 legacy `sse` transport。

```jsonc
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["dlx", "@modelcontextprotocol/server-filesystem", "."],
      "connectTimeout": 30000,
      "requestTimeout": 60000,
      "maxRequestTimeout": 120000,
      "retry": {
        "maxAttempts": 3,
        "baseDelayMs": 500,
        "factor": 2,
        "maxDelayMs": 5000,
        "background": true
      },
      "toolReplay": "never"
    },
    "remote": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  },
  "diagnostics": {
    "file": {
      "enabled": false,
      "path": ".pi/logs/mcp.jsonl",
      "maxBytes": 1048576
    }
  }
}
```

`connectTimeout` 是初始化、首次工具发现、前台重试和等待共用的总 deadline。`requestTimeout` 控制单次请求；当 `maxRequestTimeout` 更大时，progress notification 可以重置 request timer，但仍受该外层硬总上限约束。Timeout 或取消会关闭当前 transport，以终止仍在进行的 HTTP fetch，且不会重放原调用。旧 `timeout` 仍兼容，并在新字段缺省时分别作为 connect/request fallback。

连接默认最多尝试 3 次，采用 500 ms 起步、因子 2、单次上限 5 s 的 full jitter。HTTP `Retry-After` 优先，但最多等待 5 min。临时网络错误、408、429、部分 5xx 与 520–527 可重试；认证、配置和确定性协议错误不会重试。前台 deadline 耗尽后可在后台有界恢复；可用 `/mcp reconnect <server>` 取消该 server 的后台等待并立即发起单 server 重连。

工具调用自动重放默认关闭。`toolReplay: "read-only"` 只允许初始 catalog 与重连后的最新 catalog 都明确带有 `annotations.readOnlyHint === true`、且 route 所有者未变化的工具最多重放一次；该 annotation 来自服务器，不能替代对服务器和工具副作用的审查。

传给模型的 MCP text 与序列化非 text 内容合计限制为 50 KiB、2000 行，最多序列化 24 个非 text block；`details` 中的 structured output 也限制为 50 KiB。超限 raw 输出不会自动落盘。工具提示会要求 agent 缩小结果或使用 server pagination；需要完整数据时应按服务端 cursor/page/limit 分段获取。

MCP 成功结果默认显示最多五个视觉行的明亮正文，连接线与末尾截断标记 `...` 弱化；成功圆点变绿，不显示 Completed、类型或字节摘要。Ctrl+O 展开详情，正文亮度一致，仍受展示上限约束。失败保留红色错误正文；能匹配本扩展宿主诊断的取消、超时显示黄色及 `Interrupted`、`Timed out` 提示。服务器返回的普通错误文字不据此改判状态。MCP 不依赖 codex-ui，也使用相同的圆点与配色。

MCP 历史现在独立于连接恢复显示。冷恢复扫描全部分支；进程内 resume/import/fork/clone/reload 通过短寿命、仅含显示 identity 的交接文件提前注册 renderer。历史占位始终拒绝执行，实时 discovery 仍使用当前 schema；离线时停用实时工具，但已排队的实时调用保留原有安全重连路径。首次从没有交接 hook 的旧版本部署时，请重启 Pi 后恢复会话。用户级安装可跨 cwd 恢复；项目级插件在目标 cwd 不再加载、host 明确过滤工具定义或历史读取超限时，可能显示默认样式。具体限制和 Pi 0.85.1 验收见 [MCP resume UI acceptance](docs/mcp-resume-ui-acceptance.md)。

内存 diagnostics 使用每服务器有界 ring buffer，并对控制字符、常见凭据和过长字段进行清理。文件日志默认关闭；启用后写入有界 JSONL，并保留一个 `.1` 轮转备份。Stdio stderr 使用 pipe 捕获到 diagnostics，不直接写入 Pi 终端。脱敏是降低风险的措施，不是保存或分享日志的安全保证。

可用命令：

```text
/mcp status
/mcp reload
/mcp reconnect <server>
/mcp logs [server]
/mcp-init
```

`/mcp-init` 创建项目配置；修改配置或删除已注册工具后使用 `/mcp reload`。MCP 配置可以启动进程、携带 headers 并暴露有副作用的工具，应把 `.pi/mcp.json` 视为可执行配置，只信任已审查的项目，并且不要提交凭据。

Exa hosted MCP 推荐直接使用 `https://mcp.exa.ai/mcp` 的 Streamable HTTP transport。Free plan 面向 casual use，匿名请求受当前 rate limit 政策约束；production 可通过 `x-api-key` header 配置 API key。不要在文档或配置中假定固定额度，也不要把 `mcp-remote` 作为原生远程连接故障的首选修复。

完整配置、Exa tool selection、诊断边界和排错流程见 [`extensions/mcp/README.md`](extensions/mcp/README.md)。

## Subagent extension

`subagent` 不依赖额外 skill，也不修改 Pi core。每个 child 都是在独立 tmux window 中运行的普通交互式 TUI Pi；初始任务和后续 prompt 通过 tmux buffer 投递，不进入 shell command line。

扩展只在 root Pi 注册六个工具：

```text
subagent_spawn
subagent_prompt
subagent_list
subagent_read
subagent_wait
subagent_close
```

managed child 仍加载 lifecycle hooks 并写入 runtime state，但不注册 subagent 编排工具。合法管理拓扑只有 root 到 direct child；`target: "all"` 也只处理当前 root 的 direct children。每个 child 固定对应一个 tmux window 和一个 pane；投递前会验证 server、pane、进程实例和 pane 模式。session 改名或 pane 移动只有在实例证据仍匹配时才被接受，位置不匹配不等于进程死亡。

初始 task 和后续 prompt 都采用 at-least-once 投递。每条消息会在首行加入 `[subagent:<12-char-id>]`，该标识会进入 child 模型上下文；只有 Pi 原生 session 出现对应 user turn，或 TUI 显示对应 `Steering:`/`Follow-up:` pending 项时才算成功。`subagent_prompt` 成功结果会附带 `deliveryId` 和 `confirmation`。返回的 `settledCursor` 绑定本次投递；child 消费对应 user 消息时，把运行代次 receipt 写入原生 session 的 custom entry。`subagent_wait` 只在该代次完成后返回 settled，不会把投递期间上一轮的结束当成本次完成。提交后 1 秒仍无证据时返回 `delivery_unconfirmed`，但 child 可能已经接受消息；扩展不会自动重试，调用方重试可能产生重复任务。

当前投递协议只支持 Pi 默认的 `Ctrl+C` 清空、`Enter` 提交和 `Alt+Enter` follow-up 键位。自定义 keybindings、替换 editor 的 extension，以及同一 window 内增加 pane 不在兼容范围内。

每个 root namespace 默认最多占用 3 个 slot。`pending`、`starting`、`running`、`settled` 和 `closing` 均占用 slot；已确认进程死亡的 `interrupted` 不占用。并发 spawn 使用持久化 reservation 防止超卖；同一 Pi 进程切换 session 产生的 direct-child aliases 按 `processInstanceId` 去重。可通过正整数环境变量 `PI_SUBAGENT_MAX_ACTIVE` 调整上限。

`subagent_list` 返回 `{ agents, capacity, diagnostics? }`。会话切换、身份未知和当前成员损坏均保留进程名额；无关 namespace 的坏记录不阻断当前管理。容量结构为：

```json
{
  "active": 2,
  "pending": 1,
  "limit": 3,
  "available": 0
}
```

`subagent_read` 只读取 Pi 原生 session JSONL 中已经持久化的 finalized 数据，支持 `recent_activity`、`turns` 和 `activity_detail`。它不解析 tmux pane history，也不复制 transcript。`recent_activity` 默认返回最近 1 条可见 assistant 结论和 1 条 tool 状态；空文本的 error/aborted assistant 仍可见，错误原因预览最多 512 bytes，并保留 `stopReason`。tool 摘要不包含 arguments 或完整 result，失败时只附带有界预览。摘要返回计数、省略数、`hasMore` 和 UTF-8 JSON 字节数，最终 payload 不超过 72 KiB；`turns` 中的 activity 使用同一摘要投影，每页完整 JSON 同样不超过 72 KiB。`turns` 的 `hasMore` 和 `nextPageCursor` 表示当前所选 turn 范围尚有续页；用 `pageCursor` 续读固定快照，不能把增量 `after` 当成续页。跨页的同一 turn 标记 `continued: true`，user 上下文可重复，但 activity 不重复。user 摘要最多 4 KiB，失败 assistant 的部分文本最多 4 KiB。

需要原始内容时，使用 `activity_detail` 按 activity id 读取单个 `assistant_text`、`assistant_error`、`user_text`、`tool_arguments` 或 `tool_result` section。每页最多 16 KiB，并使用绑定 agent、epoch、activity、section 和字节位置的独立 cursor 继续读取。普通 activity cursor 仍绑定 agent、epoch 和 view，并保持增量位置不倒退。读取尊重主动树导航；记录 leaf 时同时保存文件位置，以区分已有的放弃分支与此后新落盘的后继记录。分页期间的新记录留给翻页完成后的增量读取。

常规协作优先使用 `subagent_read` 摘要跟踪 child，让 main 继续推进；只有失败摘要不足、需要精确证据或用户明确要求时才读取 detail。`hasMore` 不要求自动读取全部历史；如果需要补取被 count limit 省略的摘要，应复用原 `after` 并提高对应 limit，而不是使用本次返回的新 cursor。只有 main 的下一步依赖 child 结果时才使用阻塞式 `subagent_wait`；wait 复用相同的轻量摘要投影。`turns.omittedTurns` 单独表示 count limit 省略的 turn 数，不包含当前范围的待续页内容。单次 wait 默认 30 秒、最长 600 秒；timeout 后可以复用同一 `afterSettled` 再次等待。

`subagent_close` 是终结操作：先停止并确认 Pi 进程与 tmux window 已退出，再解除 direct-child 关系并删除 Extension 状态，从而释放 slot。关闭失败或确认超时时保留关系、状态和 slot，以便重试。终态 child 若重新可达，单目标 close 仍核验并关闭对应 runtime；共享进程的历史 alias 不得关闭活跃 sibling。未知 tmux 查询错误会向上传递，不当作死亡证明。成功关闭不会删除或修改 Pi 原生 session JSONL、session 目录或项目文件。

扩展要求当前 parent 使用持久化 Pi session；`--no-session` 模式下工具会明确拒绝。默认管理快照位于 Pi agent directory 的 `subagents/sessions/<sessionId>/state.json`。parent 控制事实与 child 生命周期分开写入，跨进程锁保护更新；同一 namespace 只允许一个管理控制者。状态协议已升级到 v3，升级前必须关闭旧 child、停止旧写入者。离线转换、回退、环境契约和超时边界见 [runtime reliability](docs/subagent-runtime-reliability.md)。可使用以下环境变量：

```text
PI_SUBAGENT_MAX_ACTIVE
PI_SUBAGENT_PI_PATH
PI_SUBAGENT_TMUX_PATH
```

## Permissions extension

扩展默认以 `Full access` 启动。设置 `PI_PERMISSIONS_MODE=default` 可改为默认权限模式。

```text
/permissions
/permissions default
/permissions full
```

在 `Default permissions` 模式中：

- `read`、`grep`、`find`、`ls` 和 subagent orchestration tools 不弹出确认。
- 修改型工具、shell commands 和 MCP tools 需要审批。
- `Allow this session` grant 只在当前进程有效，按操作隔离，最多保存 512 条，Pi 退出后清除。
- 非交互模式遇到需要审批的操作时 fail closed。

切回 `Full access` 需要交互确认。

## Development

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
```

常用命令：

```bash
pnpm run typecheck
pnpm test
pnpm run build
pnpm run package:check
pnpm pack --dry-run
pnpm run prototype:tui
pnpm run prototype:subagent-ui
```

仓库不提交 `dist/`、编译缓存或本地运行日志。CI 从源码构建，并检查是否有被忽略的文件仍受 Git 跟踪。`extensions/codex-compact/src/media/` 中的预编译 WASM、manifest、许可证和第三方源码包是普通构建的输入，继续纳入版本控制；普通构建只校验并复制这些资源，不调用 Rust。`prepack` 会重建七个扩展，发布包只包含编译产物、theme、README、goal 验收报告、license 和上游 attribution。包同时包含 MIT 本地实现与 Apache-2.0 的 Codex goal 复制内容，metadata 使用 `MIT AND Apache-2.0`；具体文件归属见 `extensions/goal/UPSTREAM.md`、`LICENSE` 和 `NOTICE`，不把上游内容改授 MIT。

验证本地工作区后，可安装解包目录，不必先发布到注册表：

```sh
pnpm run check
pnpm pack --pack-destination .scratch/release
mkdir -p .scratch/release/unpacked
tar -xzf .scratch/release/pi-ext-0.1.0.tgz -C .scratch/release/unpacked
cp pnpm-lock.yaml .scratch/release/unpacked/package/pnpm-lock.yaml
pnpm --dir .scratch/release/unpacked/package install --frozen-lockfile --prod --ignore-scripts
pi install "$(pwd)/.scratch/release/unpacked/package"
```

`pi install` 本地目录只记录路径，不复制目录或安装依赖。保持解包目录不动，重启 Pi 后从包 manifest 加载七个入口；正常安装会写当前用户的 Pi settings。已有安装不要重复加载同一插件。验收脚本另使用仓库内隔离 HOME/agent，不改真实配置。

`pnpm run prototype:tui` 启动 Codex、Claude、Hybrid 三套一次性 HTML 原型。生产 extension 只实现 Codex 方向，另外两套原型保留供后续使用。

## Layout

```text
extensions/
  codex-compact/
    src/
    __tests__/
    dist/
    LICENSE
    UPSTREAM.md
  openai-fast-mode/
    src/
    __tests__/
    dist/
    LICENSE
    UPSTREAM.md
  codex-ui/
    src/
    __tests__/
    dist/
  mcp/
    src/
    __tests__/
    dist/
  permissions/
    src/
    __tests__/
    dist/
  subagent/
    src/
    __tests__/
    dist/
themes/
  codex-pi.json
scripts/
prototypes/
```

## License

MIT
