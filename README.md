# pi-ext

为 [Pi Coding Agent](https://github.com/earendil-works/pi) 提供五个扩展和一套主题：

- `codex-compact` 为支持的 ChatGPT auth 模型提供 Codex Remote Compaction V2。
- `openai-fast-mode` 为匹配的 OpenAI 和 OpenAI-Codex 模型注入 priority service tier。
- `codex-ui` 使用 Pi 品牌实现 Codex 风格的 TUI profile，并提供 `codex-pi` 主题。
- `mcp` 连接 Model Context Protocol 服务器，并将工具注册为 `mcp__<server>__<tool>`。
- `skill-mentions` 提供行内 `$skill` 补全、加载和历史原文编辑，保留原生 skill 外观。

## Requirements

- 支持 Linux 和 macOS；原生 Windows 不在支持与 CI 验证范围内。
- Node.js 22.19 或更高版本
- 最低支持版本与默认开发环境固定为原版 Pi `1.5.2`，可选补丁使用独立依赖树，范围、降级和隔离验证见 [Pi compatibility](docs/pi152-compatibility.md)。
- 支持 24-bit color 的终端可获得最接近设计稿的颜色效果

CI 在 Linux 和 macOS 上执行完整检查，并在 Linux 上运行 PTY 和 skill 安装验收。运行入口是各扩展 `dist/` 目录中的 ESM 文件，Pi 启动时不需要转译 TypeScript 源码。

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

## Skill mentions extension

`skill-mentions` 在 TUI 输入框任意行提供 `$` skill 候选。例如输入 `用 $re`，再用 Tab 或 Enter 补全名称；第一次 Enter 只选择候选，菜单关闭后 Enter 才发送。发送后保持 Pi 原生 skill 卡片外观，兼容默认编辑器和本仓库 CodexEditor。

候选两侧需要空格、换行、Tab 或输入边界。提交激活保留左侧限制，右侧另接受明确的句读和闭合符号，例如 `$research，继续`；`$research.md` 不激活。代码、转义和左侧紧邻正文的引用保持原文。多项引用在同一 user 请求中生效，重复项去重；未知或不可读项静默保留原文。

输入框与成功快照正文显示青色整体标签，默认 cube 图标需要支持 U+F01A7 的 Nerd Font。缺字时用 `/skill-label-icon command` 切换为 `⌘` 并保存偏好。

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
  "effectiveContextWindowPercent": 95,
  "metadataClientVersion": "0.156.0"
}
```

`autoCompactTokenLimit` 必须为正数，默认和上限均为模型原始 context window 的 90%。`autoCompactScope` 可设为 `total` 或 `bodyAfterPrefix`；默认使用 `total`。

模型压缩 hash 来自当前账号可见的官方 Codex 模型目录。选择模型时不查询目录；首次实际请求或 Pi 发起压缩时，扩展用 Pi 已解析的认证向 `https://chatgpt.com/backend-api/codex/models` 发一次 GET，然后在进程内缓存结果。`metadataClientVersion` 默认是已验证的 `0.156.0`，只接受三段十进制版本号。受信任项目的有效配置覆盖全局配置。目录会按客户端版本和账号筛选模型；上游提高版本门槛后，可能需要把此配置改为已核验的新版本，或更新扩展默认值。扩展不依赖 Codex CLI，也不会替 Pi 注册新模型。

使用 `/codex-metadata` 查看当前有效版本、来源和配置文件路径。`/codex-metadata version 0.157.0` 将版本写入全局 `pi-codex-compact.json`，仅修改 `metadataClientVersion` 字段；`/codex-metadata reset` 删除全局该字段，保留其他配置。命令不修改项目配置，受信任项目的有效版本仍优先，reset 后可能继续使用项目版本。设置完成后，新请求读取新配置；已开始的请求继续使用原目录快照。命令不联网验证输入版本，也不会自动追踪最新版。

只有当前模型与历史模型都查到非空 hash 且值不同时，hash 比较才触发过渡压缩。目录不可用、离线、未包含旧模型或使用自定义代理地址时，hash 为未知，普通对话和原有窗口缩小判断继续执行。冷启动时，过去固定表覆盖的旧模型也可能没有 hash；旧 checkpoint 已保存的 hash 仍用于恢复。目录 GET 的 HTTP 阶段最长等待 3 秒，宿主认证耗时不计入这个上限。查询成功结果缓存 5 分钟，未知模型和失败请求按 30 秒限流。

有效窗口默认为原始窗口的 95%，用于调度判断和压缩请求的工具输出裁剪预算。`effectiveContextWindowPercent` 接受大于 0 且不超过 100 的有限数值；若模型配置里的窗口已经扣除了余量，可设为 100，避免重复扣除。这个配置不会改变默认 90% 自动压缩阈值，也不会修改 Pi 自身的压缩调度。本地估算超窗不再直接阻止远端压缩，最终由服务端判断。

插件观察到成功普通回复且历史覆盖边界仍有效时，自动压缩使用服务端 total usage 加未覆盖增量；模型、分支、前缀或检查点变化时回退本地估算。多媒体与特殊轮次估算使用固定版本 Rust 参考向量作差分校验。加载在本扩展之后的 payload 转换无法完整观测；本地估算不代表服务端精确 tokenization，也不证明线上压缩质量。

压缩请求超过有效窗口时，扩展仍可裁剪工具输出，但不再丢弃旧 user turn 后只压缩最新一段；服务端明确拒绝完整历史时会直接失败，不提交新 checkpoint，也不进入额外的超窗恢复循环。诊断保留原始错误分类，`recoveryAttempted` 为 `false`；网络重试及 Pi 普通请求超窗后发起压缩的流程不变。保留历史的 64k 预算计入图片，并原子保留或删除图片及相邻标签。文本边界采用 UTF-8 首尾保留截断。Pi 发起压缩时，如系统提示已改变，扩展会刷新缓存指令。

恢复已有压缩历史时，扩展通过 `context_with_system` 保留初始系统提示与中途更新的顺序，再校验请求历史前缀。MCP 工具顺序或声明变化不会因移除 Pi 摘要而丢失系统更新；真实前缀不匹配仍中止请求，不删除检查点或自动重压缩来绕过校验。

当前 V2 路径不消费 `/compact focus text` 的 focus text，也不执行分段压缩。

Pi 1.5.2 的初始和增量 `additional_tools`、工具移除与重声明提示、纯空白工具输出、active projection、pending tool calls 期间的 system 顺序，以及 function/grammar item ID 规则已对齐。待发送的真实 user entry 与随后 custom context 按来源一起保留；已经执行过的历史仍受 retention 预算约束。新 checkpoint 保存可选的 `preservedInputSources`，不以文本相同合并两次提交。请求开始时固定历史、工具、提示词和模型；远程等待期间这些信息变化会取消提交，并保留旧 checkpoint。

恢复 encrypted checkpoint 后会重新声明边界处仍可用的工具，随后应用后续工具更新。服务端压缩不保留可执行工具声明；该恢复避免压缩后模型失去工具，同时继续遵守隐藏与移除规则。

旧 V2 checkpoint 缺少来源字段时，只有完整 preserved 后缀及 retained user 都能唯一映射到原始 entry，才允许继续压缩。旧保留区含无法映射的截断副本、重复来源或缺失后缀时，取消本次压缩，保留旧 checkpoint，并报告 `preserved_input_source_unproven`。请求失败后提交新输入时，失败输入与请求 payload 使用同一冻结标记清理，完整投影校验继续生效。

历史明文上限为 64k tokens。实际预算还要扣除新 opaque、待发送输入、instructions 和 tools，并在截断后复查；最多 16 次本地调整，不会为满足本地估算截断本次输入。同一请求最多执行一次本地估算触发的远程修复，写入 checkpoint 不重置次数；Pi 对真实 overflow 另保留一次 compact-and-retry。仅因本地估算偏高且自动压缩失败，不禁止正常 provider 尝试。认证、策略和明确的 context-window 错误仍按原分类结束。

同 hash 的模型窗口下切与 automatic 压缩共用这一次本地容量修复，修复失败或写入 checkpoint 都不重置额度；不同 hash 所需的协议迁移独立处理。自动压缩的真实 HTTP 401/403 会终止当前请求，空正文、读取超时、超限或读取失败都不会让原请求继续发送。

实际 provider payload 可用于严格验证 hidden declarations 和 forced prompt。工具只新增时检查至多四个候选策略，只有完整 input、instructions、tools 匹配且有效回放一致才接受。工具移除、重声明场景支持精确普通投影；隐藏策略若无法证明则拒绝。forced 路径信任本 handler 观察到的 `instructions`，不独立验证提示词来源，也不支持任意 context hook 或后续 handler 改写。

在 provider 请求之外发起压缩，包括 `/compact` 和 Pi 自身的 threshold/overflow hook，若工具可见性无法由仍有效的已观察快照确定，需要显式配置 `manualProjection`。普通配置且没有隐藏声明时使用：

```json
{
  "manualProjection": { "hiddenTools": [] }
}
```

使用隐藏声明时列出实际隐藏的工具名；使用强制提示词时再提供非空字符串 `forcedPrompt`，例如 `{"manualProjection":{"hiddenTools":["internal_tool"],"forcedPrompt":"Your exact forced prompt"}}`。这是受控投影契约，配置必须与扩展实际规则保持一致。Pi 在回合结束后会恢复基础 system prompt，因此不能用布尔开关让插件从 `getSystemPrompt()` 猜出之前的 forced prompt。无工具配置可以直接压缩；信息不足时只取消本次压缩并报告原因。会话、历史、工具或提示词变化会使观察快照失效。

非成功 HTTP 响应的 body 使用固定 300 秒总时限和 1 MiB 诊断上限，持续收到 chunk 不会延长时限。读取不完整时不允许模型 fallback；401/403 和无法区分 quota 的 429 不重试，503 保持最多两次额外 HTTP retry。成功 SSE 仍使用原有 idle timeout。

不要同时加载本扩展和独立的 `npm:@yeungkc/pi-codex-compact@0.0.6`，否则同一组 hooks 会执行两次。迁移现有安装时，应先验证本 package，再从 Pi settings 停用独立 npm entry 并重启或 reload。

本目录基于 `@yeungkc/pi-codex-compact` 0.0.6 导入；精确 commit、同步范围和本地改动记录见 `extensions/codex-compact/UPSTREAM.md`，上游 MIT license 见同目录 `LICENSE`。

## OpenAI Fast Mode extension

`openai-fast-mode` 为配置中精确匹配的 `openai` 模型，以及 `openai-codex` 的任意模型注入 `service_tier: "priority"`。新加入 Pi 的 `openai-codex` 模型无需更新扩展名单。可使用以下命令切换：

```text
/fast
/fast on
/fast off
/fast toggle
```

普通 root 会话的启动参数 `--fast` 会启用并持久化 Fast Mode。全局状态继续保存在 `~/.pi/agent/extensions/pi-openai-fast-mode/config.json`；项目级状态保存在 `.pi/pi-openai-fast-mode/config.json`，迁入本仓库后无需迁移现有配置。旧配置中的 `openai-codex` 逐模型 targets 会在下次加载时移除，但持久化的开关保持不变。

若 `openai-codex` 请求明确返回模型不支持 Fast，扩展会提示 `Fast mode is not supported for openai-codex/<model>. This request failed. Retry to use standard mode for this model in this session.`，并仅在当前会话内对该模型停止注入；原因不明确的错误不会禁用 Fast。`setStatus("pi-openai-fast-mode", "fast")` 只表示扩展请求了 Fast，不保证服务端最终使用 Fast。扩展仍会清理 0.3.0 使用的 below-editor widget。不要再单独加载 `npm:pi-openai-fast-mode`，否则 `/fast`、flag 和 provider hooks 会重复注册。

本目录基于 `pi-openai-fast-mode` 0.3.0 导入；精确 commit、同步范围和本地改动记录见 `extensions/openai-fast-mode/UPSTREAM.md`，上游 MIT license 见同目录 `LICENSE`。

## Codex UI profile

`codex-ui` 仅在 Pi 的 TUI 模式中接管以下组件：

- 使用 `pi v0.84.3` 官方 wordmark 的 header
- 实色背景 composer
- model、thinking、Fast Mode、cwd、git branch、context-left 主状态行，另显示可选扩展状态行
- 普通 assistant 回复使用外层列表缩进，自动换行和后续段落保持对齐
- 原生消息位置用 `Thinking` 标题和引用竖线显示完整思考文本，流式与完成后保持同一规则
- 隐藏原生 streaming working row；输入框上方显示 Working 转圈、反光与计时，footer 右侧显示估算接收速率（[说明](docs/codex-working-rate.md)）；窗口标题保持原有 80ms 单色转圈，正文思考状态仍保持静态
- Read 连续文件分组与每文件三行短预览，以及 `edit`、`write` 的紧凑 renderer
- Bash 逐条显示 `$ Bash(command)` 与前三行输出，按 `Ctrl+O` 原位展开完整命令和已捕获输出
- Codemode 调用树与 `/inspect` 面板，分别显示父脚本输出和子调用结果

每段连续的非空 Thinking 通过公开 Markdown transformer 添加 `Thinking` 标题，并把所有源文本行放进同一个原生引用块。多个标题及正文全部保留，无标题文本正常显示，空思考不生成标题。对所有 provider 使用同一规则，不提取最后标题、不按行宽截断，也不设置固定阅读宽度。标题、列表、链接、代码和表格由原生 Markdown 排版，已有引用会形成嵌套引用。输入框上方不安装思考 widget，也不预留它的空白区。

流式输出逐步显示已收到的内容，生成工具参数、执行工具和 `message_end` 不切换为另一套思考显示规则。取消、失败和恢复会话仍显示已收到的内容。引用块的斜体、颜色和换行沿用 Pi 原生样式，不添加自定义 ANSI 样式。`Ctrl+T`、隐藏占位及消息 padding 保持原生行为，隐藏时仍显示 `Thinking...`，结束时不自动改变用户的隐藏选择。转换只影响显示，不修改 session 原文、模型上下文或请求参数，也无法增加服务端没有返回的思考内容。

完整思考会占用更多终端行，流式增长和 resize 可能推动下方工具内容，不保证单行高度。普通回复仍使用原有外层列表，工具及其他 UI 不变。更新后请重启 Pi 并恢复会话，不要只依赖 `/reload` 更新模块。

离线终端验收加载构建后的生产扩展，使用固定消息验证原生折叠、流式更新及 resize，不调用真实模型：

```bash
pnpm run build:codex-ui
node extensions/codex-ui/__tests__/fixtures/thinking-cli.mjs --smoke
PYTHONDONTWRITEBYTECODE=1 conda run -n codex-py312 python extensions/codex-ui/__tests__/thinking-pty.py
PYTHONDONTWRITEBYTECODE=1 conda run -n codex-py312 python extensions/codex-ui/__tests__/thinking-pty.py --fullscreen
```

Write / Edit 从参数生成到执行结束前，都显示黄色静态 `~ Writing / Editing` 与路径，目录弱化、文件名突出，不计行或展示中间内容，Ctrl+O 不增加进行中内容。成功前缀灰色，失败前缀红色，可靠识别的中断为黄色；错误正文不重复加叉。

本地 Write 在内置文件队列中采集旧内容，新建成功显示 `Added`，覆盖显示 `Edited`。Write 复用 Edit 的行号、增删统计与 diff 样式，默认显示 12 个 diff 行，灰色省略提示紧随正文，Ctrl+O 展开已保存的 diff。缺少变化元数据的旧 Write 结果暂时保留原有总行数摘要，不推测新建或覆盖。

Write / Edit 的 diff 显示层在高亮和背景填充之前移除回车及原始终端控制序列，避免 CRLF 行被补齐空格擦空。CSI 按完整终结字符范围识别，光标序列后紧接的源码保持完整；OSC 等字符串控制序列若到行尾仍未闭合，则隐藏该行剩余 payload，不延伸到下一源码行。磁盘内容和持久化 patch 保持原样。

Write diff 采集限制为旧、新文本各 1 MiB，合计 4000 行，保存的 patch 不超过 2 MiB。不可读或超限时保留真实成功标题，普通模式显示 `Diff unavailable`，不编造增删数。Write / Edit 每行只高亮前 4096 个 UTF-16 单元，其余内容保留。

### Codemode call tree

Pi 1.5.2 的 codemode 使用调用树显示。收起时预览前 5 项并标出剩余数量，按 `app.tools.expand` 的实际绑定展开，默认 `Ctrl+O`。兄弟调用按开始顺序排列，多层调用保留父子归属。Read/Bash 沿用现有正文布局，Edit/Write 在捕获数据足够时显示原有 diff；未知工具和模型辅助调用使用通用摘要。

父脚本完成不表示所有子调用成功。被脚本捕获的失败仍显示警告，第 5 项以后的失败也不会被隐藏。中断、超时和缺失状态分别说明；状态未知不推断为成功，也不暗示此前文件修改已经回滚。`Output to model` 显示脚本返回给模型的内容，子工具原始结果另行展示。

`/inspect` 打开当前分支最近一次 codemode。`Tab` / `Shift+Tab` 切换 Calls、Script、Output，上下键选择调用，翻页键滚动，取消键关闭；面板提示使用当前快捷键绑定。宽屏分栏，窄屏只显示所选详情。原始结果仅在本进程有界缓存中保留，不新增持久化；重启、切换分支、reload 或 compaction 后只重建宿主保留的元数据，缺失正文、参数或 diff 会明确提示。图片只提供占位，不缓存二进制预览。

显示层最多保留 32 个父记录、每父 1024 项、合计 4096 个子项；原始子结果和派生布局各按 4 MiB 预算淘汰。超过预算只影响 UI 详情，不改变执行结果。

### Tool execution settings

工具覆盖在 TUI、print 和 RPC 中都会生效。默认 Read / Bash 通过公开 `SettingsManager` 的合并规则，读取 `getAgentDir()/settings.json` 与受信任项目的 `.pi/settings.json`，保留 `shellCommandPrefix`、`shellPath` 和 `images.autoResize`；项目配置优先，不信任项目的配置不读取。读取不写配置或锁文件。文件不存在时使用其余有效配置或默认值；应读取范围的配置损坏或不可读时，默认 Read / Bash 返回英文工具错误，不调用底层执行器，不静默回退。错误说明失败范围及修复后 `/reload` 的步骤，不包含配置正文或命令前缀。这不是退出 Pi 或终止会话，聊天、Edit、Write 不受本插件的配置检查限制。

成功配置与配置错误均按 cwd 和信任状态在首次执行时取得快照，普通工具调用和重绘不重复读文件。修改或修复配置后使用 `/reload` 或重启；错误快照不会自行重试，已生效的成功快照也不会实时检测文件损坏。跨项目会话使用新项目配置，不监听文件变化，也不自动同步宿主尚未持久化的内存设置。

这是异常时拒绝执行的妥协，与原生 Pi 在配置 reload 失败后保留旧值继续执行不同。扩展不保存跨 reload 的旧配置副本，也不承诺取得宿主保留的配置。

SDK 内存覆盖、自定义 settings 存储和宿主自定义执行器不在自动继承范围内。SDK 可使用 `codexUi(pi, { getExecutionOptions })` 显式返回 `{ read: { autoResizeImages }, bash: { commandPrefix, shellPath } }`；这份配置替代文件配置，每个快照只取一次。需要自定义 operations 或执行器时可传入 `toolFactories`，沿用 `registerCodexTools` 的四工具 factory 契约；自定义 factory 自行管理执行参数，不套用默认文件配置。扩展不会探测或修改 Pi 内部执行器。

### User message layout

用户消息直接使用原生灰色背景和 Markdown，不再注入 `›` 标记及额外段落空白。首行代码围栏、表格、列表和标题保持原生语义，用户自己输入的 `›` 保持原样；不修改会话原文和模型输入。

### Assistant reply layout

普通回复通过公开 `registerMarkdownTransformer` 显示为一个外层列表项：首行使用 `-`，后续源文本行缩进两格，自动换行、标题、代码块和表格由 Pi 原生 Markdown 排版。空白内容不添加标记，已有列表会再嵌套一层。转换按文本块执行，同一回复含多个文本块时可以出现多个外层标记。

转换只改变 TUI 显示，不修改会话原文或模型上下文，不修改上游 Pi、私有组件或全局 `outputPad`。在 Codex 输入框提交 `/copy` 会复制当前会话分支中最近一条已完成回复的正文，保留首尾空格和换行；多段正文按原顺序连接。终端选择复制会包含显示出的列表标记、缩进和换行。thinking、工具卡片以及原生取消和错误提示保持现状。

流式更新与历史恢复使用同一规则，不增加刷新计时器或历史扫描。更新后请重启 Pi 并恢复会话，不要只依赖 `/reload` 加载新版代码。

### Output alignment

思考引用块使用原生消息 padding，引用竖线位于消息内容区域内，不再有摘要专用圆点。若希望去掉消息两侧的默认留白，可使用 Pi 的公共设置 `outputPad: 0`。在 `/settings` 中将 `Output padding` 设为 `0`，或在 `~/.pi/agent/settings.json` 的现有内容中合入：

```json
{
  "outputPad": 0
}
```

这个共享设置同时影响用户消息、普通回复和思考，左右各去掉原生的一列留白；工具和输入框内部 padding 不变。扩展不自动写全局配置，也不修改 Pi 私有组件。若历史仍右偏一列，检查已信任项目的 `.pi/settings.json` 是否覆盖了全局值。设回 `1` 或删除该字段即可恢复默认消息留白。

### Terminal activity

任务运行时，输入框上方显示青色转圈、Working 反光与计时，footer 右侧显示最近约两秒的估算输出速率。等待权限、工具、重试和自动压缩期间继续动画，无近期输出显示 `-- t/s`，任务真正 settled 后隐藏。统计口径、精度与原版回退见 [Working 与速率说明](docs/codex-working-rate.md)。

`write`、`edit`、`bash` 和 codemode 子项统一使用完整渲染，不再提供 `/lowpower` 命令。Pi 内置的 streaming working row 保持隐藏，思考文本使用原生 Markdown 完整显示。窗口标题独立使用 `80ms` 单色转圈，与自动 compact 相同帧序列；项目名和会话名保持固定，不再播放动态省略号。按单调时钟选择帧，延迟后跳过错过的帧，不补播；仅写入 OSC 标题，不请求正文重绘。动画跨重试和自动 compact 保持运行，任务 settled、取消完成或会话退出时停止，恢复静态标题；手动 compact 也有标题反馈。默认 package manifest 将 `codex-ui` 放在 `codex-compact` 前加载，使标题在耗时压缩 handler 开始前启动；手动分别加载扩展时也需保持这个相对顺序。

启用 Pi 的 `terminal.showTerminalProgress` 后，终端原生 edge progress 仍由 Pi 管理，不进入 TUI 行渲染管线。

### Theme persistence

Pi 会在 session replacement 和 reload 完成后重新应用 theme setting。`codex-ui` 的裸 `pi` 兼容兜底使用非持久的 `ThemeObject`，它只改变当前内存主题，不会替换保存的 setting。因此，当全局 theme 仍为 `dark` 时，首次启动可以显示 Codex 配色，但 `/new`、`/resume`、`/fork` 或 `/reload` 后会重新变为 `dark`。这不是终端配色漂移。

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

工具前缀按用途区分：Bash 使用 `$`、Read 使用 `@`、Edit/Write 使用 `~`，codex-search 的普通搜索使用 `⌕`，所有 MCP 调用统一使用 `⌁`。标记后一个空格，工具标题加粗且起始列对齐。参数生成、可见等待态和执行中统一黄色，成功使用主题 muted 灰色，失败红色；可靠识别的中断或超时用黄色并保留诊断。标记只随执行事件变化，不增加计时器、旋转或闪烁。Read、Bash 保留原生分组，Edit、Write、MCP 仍是独立调用，不新增 batch 卡片。

Bash、Read、MCP 的正常正文统一使用 `text`，在 codex-pi 主题中为原 Bash 的亮灰 `#d6d6d6`。目录、行号、连接线与截断提示仍弱化，文件名强调色及 diff 增删色不变。未全局修改 `toolOutput`，默认工具卡片和 MCP 连接状态保留原有配色。

`read`、`edit`、`write`、`bash` 使用 Pi 1.5.2 的官方 tool definitions 执行。`edit` 优先根据真实 `EditToolDetails.patch` 还原 old/new 行号与 hunk，并绘制整行 added/removed 背景、独立 sign 和 syntax-highlighted content；sign 与源码之间保留一个空格。本地 `write` 通过公开 operations 在原文件队列内采集变化，执行成功后才生成并保存 patch，不改写模型可见的原工具结果。注入的自定义 Write factory 仍按原契约委托执行，不擅自探测本地文件。Bash 使用 `renderShell: "self"`。每个已执行调用显示一条 `$ Bash(command)`，`Bash` 文字仍与 `Read`、`Edited` 对齐。尚未执行的 pending 调用暂不显示，错误或完成结果不会被隐藏。内部仍按同一 assistant 消息中的连续 Bash 维护归属，不跨 text、thinking、其他工具、缺失组件或消息合并；重复 ID 的额外组件独立显示。发现重复时，已绑定的旧成员保持原位，尚未绑定该 ID 的组件不再接管 candidate，因而缺失组件不能成为后来组件搬移旧命令的入口。取消旧统计标题、命令树和耗时列。长命令默认按当前宽度单行省略，展开保留完整命令及逻辑换行。

默认预览前三个终端显示行，超出时显示精确的 `… +N lines` 和实际展开绑定。正常正文使用 `text` 色，输出前缀灰色，失败正文红色；已核验的取消与超时使用警告色。无输出时分别显示 `Running…`、`(No content)` 或 `Command failed`。只在宿主明确标记失败且尾部诊断匹配时，才把退出码、取消或超时诊断提到预览首行，不根据日志中的 `Error` 判断失败。

全局 `app.tools.expand` 默认绑定 `Ctrl+O`，原位展开全部已捕获输出，保留原有空行和宿主错误原文；执行完成不覆盖展开选择。截断提示保持可见，包括宿主失败结果丢失 details 后保留在文本中的截断 footer；不读取 `fullOutputPath` 补齐输出，也不把捕获内容称为完整日志。缓存按调用内容版本、宽度和样式失效，未变化调用不重复清理、计数或着色。Bash 不创建耗时刷新计时器。

更新后请重启 Pi 并恢复会话，确保加载新版代码；不要仅凭 `/reload` 成功判断旧进程已完成代码升级。分组只改变显示，不重新执行 Bash，也不修改持久化结果或用户 `!` Bash。

Read 在同一 assistant 消息内按调用顺序合并相邻读取，不跨 text、thinking、其他工具或消息边界。每个文件显示不加粗的主题 `accent` 文件名、暗灰目录和实际返回范围，默认附最多三屏幕行预览及余量提示。预览每行最多提取 512 个 UTF-16 代码单元，长行裁剪而不换行。全局 `app.tools.expand` 快捷键展开完整输入路径和最多 40 行源码，再次按键恢复短预览。错误、取消和续读提示保留；图片及归属不明的调用独立显示，避免宿主附件与文件名错位。分组不改变执行、权限或持久化结果。

Read 分组按会话来源维护，显示组件重建不会被算成重复调用。唯一 ID 的历史及本轮已完成 Read 在真实历史重建、`/reload` 后仍保持分组；旧组件回调不能覆盖逻辑结果。结果按流式更新、执行结束、最终消息的优先级递进，采用 codex-ui 已收到的 `message_end` 修订，不被迟到的执行事件覆盖。tree 和压缩后只使用当前可见历史，普通工具事件直接更新受影响记录，不重新扫描全部历史。

真实重复 ID 使用各行本地参数和结果，不共享歧义数据，也不修正宿主自身按 ID 复用行的限制。图片、缺失来源/结果、从未绑定的视图仍断开分组。已接受的边界是：公开接口没有行卸载通知，插件不检测宿主无通知移除曾绑定视图的情况；不为此读取私有组件列表或增加轮询。

Footer 使用 ` ⋅ ` 分隔，并按 `model thinking ⋅ fast ⋅ cwd ⋅ git:branch ⋅ Context N% left` 排列。model 与 thinking 使用 Codex CLI 的 `#f6e2b7`，context 使用 `#f2b590`，Fast Mode 使用 `#c8a9ee`。终端变窄时会先缩短或移除 cwd 和 branch，再将 context 缩成 `N% left`；降级允许跳过等宽或更宽的中间变体，单字符目录也能显示可容纳的截断分支。model 和 context 保留到最后。


Ghostty 的窗口透明度、blur、字体和 titlebar 仍由 Ghostty 配置负责。Pi cell 只使用不透明 ANSI 颜色。

本地构建后可以直接 smoke test：

```bash
pi \
  -e ./extensions/codex-ui/dist/index.js \
  --theme ./themes/codex-pi.json \
  --use-theme codex-pi
```

## MCP extension

本 package 默认加载仓库 MCP 插件，负责连接、工具执行和 `/mcp`。它与 codex-ui 共用渲染模块，但无需启用 codex-ui 扩展本身。

在 Pi 的 `settings.json` 顶层 `extensions` 数组中合入 `"-builtin:mcp"`，可避免内置 MCP 与本插件重复加载的提示。不要覆盖已有扩展配置；修改后重启 Pi。

服务器配置支持 stdio、Streamable HTTP 和 legacy SSE。使用 `PI_MCP_CONFIG`、受信任项目的 `.pi/mcp.json` 或全局 `~/.pi/agent/mcp.json`，按此顺序选择第一个存在的文件。配置错误不会回退到较低优先级文件。

常用命令为 `/mcp status`、`/mcp reload`、`/mcp reconnect <server>`、`/mcp logs [server]` 和 `/mcp-init`。连接可以自动恢复，工具调用默认不自动重放。超时单位为毫秒，与 Pi 内置 MCP 配置不同。

历史工具可在离线时恢复显示，但历史占位不能执行；实时执行始终使用当前服务器的工具定义。工具 text 输出最多 50 KiB、2000 行，超限内容不另存为完整日志。

完整配置示例、超时与重试规则、历史恢复、展示上限和排错方法见 [MCP 使用说明](extensions/mcp/README.md)。

## Development

使用 `packageManager` 指定的 pnpm 版本安装依赖。修改 `src/` 和对应测试，构建生成 `dist/`。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
```

`check` 包含五个发布扩展及 codex-search 的类型检查、测试类型检查、离线测试、构建、包校验和源码/dist 宿主加载。codex-search 在仓库内维护，但不在当前发布和自动加载清单中。

测试命令、Unix 宿主验收、环境隔离和 CI 覆盖统一见 [Testing](docs/testing.md)。`pnpm run pi152:live` 是单独的联网入口，会产生真实服务端用量，不属于默认检查。

本地验证后可打包安装：

```sh
pnpm pack --pack-destination .scratch/release
mkdir -p .scratch/release/unpacked
tar -xzf .scratch/release/pi-ext-0.1.0.tgz -C .scratch/release/unpacked
cp pnpm-lock.yaml .scratch/release/unpacked/package/pnpm-lock.yaml
pnpm --dir .scratch/release/unpacked/package install --frozen-lockfile --prod --ignore-scripts
pi install "$(pwd)/.scratch/release/unpacked/package"
```

`prepack` 重建五个扩展。发布包包含编译产物、主题、README、许可证和来源说明，不包含测试、历史验收报告或日志。`pi install` 引用本地目录并写入用户设置，不复制目录；安装后须保留该目录，重启 Pi 加载五个入口。

## Layout

- `extensions/<name>/src/`：扩展实现。
- `extensions/<name>/__tests__/`：单元测试及真实宿主的离线夹具。
- `extensions/<name>/dist/`：构建产物，不提交。
- `test-support/`：测试环境、UI 和文件操作等共享 helper。
- `scripts/`：构建、验收、参考向量生成与质量评估工具。
- `themes/`：主题。
- `docs/`：测试说明与仓库语言规则。

## License

本地代码采用根目录 [MIT 许可证](LICENSE)。随包内容还包含适用 Apache-2.0、MPL-2.0 和 Unicode-3.0 等许可证的组件，package metadata 为 `(MIT AND Apache-2.0 AND MPL-2.0 AND Unicode-3.0)`。
