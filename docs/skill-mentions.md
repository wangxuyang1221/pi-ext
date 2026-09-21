# Skill mentions

## Install

需要 Node.js 22.19+ 和 Pi 0.86.0。使用仓库指定的 pnpm 11.9.0：

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pi install "$PWD"
```

安装整个包会启用 `package.json.pi.extensions` 中的八个扩展。可在 `pi config` 单独停用其他扩展；只临时加载本功能可使用：

```bash
pi -e "$PWD/extensions/skill-mentions/dist/index.js"
```

本地 package 安装只记录路径，不复制文件；更新后重新构建并重启或 `/reload`。不要同时加载 package 和同一扩展的源码/编译入口。

需要可搬运的本地产物时：

```bash
pnpm pack --pack-destination ./artifacts
```

然后在独立的 pnpm 项目中安装实际 tarball，路径替换为生成产物的绝对路径：

```bash
pnpm add --ignore-scripts /absolute/path/to/pi-ext-0.1.0.tgz
pi install "$PWD/node_modules/pi-ext"
```

该方式安装 pnpm 解包后的本地目录，不是已发布 npm 包。保留该项目供 Pi 加载。包的 peer dependencies 固定 Pi 0.86.0。首次克隆时不包含 dist，不使用 Git package 安装代替构建。

## Input

输入 `用 $re` 可按 Pi 已发现的 skill 名称过滤。候选使用 skill 自带名称和描述，不另扫一套技能目录。

- 有候选时 Tab 或 Enter 选择当前项，只补全名称，不发送。菜单关闭后 Enter 正常发送。
- Esc 关闭菜单且保留输入。保留完整有效引用仍会激活；要避免激活，删除或转义 `$`。
- 可在句中和后续行引用，补全保留两侧正文与其他行。
- 候选片段两侧仅接受空格、换行、Tab 或输入边界。名称中间的光标不弹候选，紧贴标点也不弹候选。
- 提交激活时，左侧仍只接受上述分隔；右侧另外允许 `,.;:!?，。；：！？、…)]}）］｝】》〉」』”’"'`。例如 `$research，继续`、`$research)` 可激活，`文字$research`、`（$research）` 仍不激活。
- ASCII 句点 `.` 紧接 Unicode 字母、数字、下划线或连字符时不结束引用。`$research.md`、`$research.中文` 不激活，末尾的 `$research.` 或句点后为空白时可激活。其他允许标点不限制其后正文。
- `/`、反斜线、`@`、`#`、运算符、开括号及未列出的标点不构成新边界。不从 `$research-extra` 或 `$research_other` 中截取 `$research`，名称必须完整匹配。
- Markdown 行内代码、围栏代码或 `\$research` 中的引用不补全、不激活。
- 完整引用手写、粘贴和菜单补全等效；部分名称不激活。未知名称原样发送，不提示、不阻断。

自定义快捷键继续由 Pi 的 `keybindings.json` 管理，修改后 `/reload`。原生 slash 补全和 `/skill:name` 入口保持不变。本功能只处理 TUI 普通 user 消息，包括其他扩展发送的 user，不处理 assistant/tool/custom 消息或 RPC/print。

## Labels and icons

输入框和成功加载快照的任务正文显示青色 `#8DF9FD` 标签：图标和完整名称为正常字重，继承宿主背景，不新增底色。原生 skill 卡片保持原样。

- 菜单确认、完整粘贴和历史回填直接成标。手写名称须输入空白或允许的右侧标点后才成标，不因中途匹配完整名称而锁定。
- 左右方向键跨过整个标签；Backspace/Delete 整体删除，一次撤销恢复。名称过长会完整换行，不使用省略号。单个标签高于输入视口时，编辑器分页键可逐页查看中间行，保持源光标在标签边界。默认 regular 为 PageUp/PageDown，fullscreen 使用 Ctrl+PageUp/Ctrl+PageDown（普通 PageUp/PageDown 留给宿主会话滚动）；fullscreen 中也可滚轮浏览。继续普通编辑时视口重新跟随光标。其他原生编辑、按词删除、kill ring 和外部编辑器仍使用原文。
- 大粘贴保留 Pi 原生折叠，块内不单独画标签；提交按展开原文识别。标签与折叠块混排、删除和撤销保留完整内容。
- 输入标签只表示已识别名称；正文只标识本次成功读取的快照。未知或不可读项仍是普通文字，无额外报错。
- 普通模式保留终端自己的鼠标选区；Pi 0.86.0 的应用鼠标点击定位在 fullscreen 模式中生效，点击标签内部会吸附到边界。屏幕复制得到显示文字，不承诺自动还原 `$`；模型、队列、持久历史和外部编辑器没有图标或 ANSI。

默认 cube 使用 Nerd Fonts 的 `md-cube_outline`（U+F01A7）。终端字体需要支持该字形；缺字时可手动切换为 command（`⌘`，U+2318）：

```text
/skill-label-icon command
/skill-label-icon cube
```

命令同时更新输入和正文，保存到 Pi agent 目录的 `skill-mentions.json`，重启及 `/reload` 沿用。非法参数或保存失败显示英文错误；失败不改变当前模式、不声称保存成功。读取损坏或不支持的设置时报告错误并回退 cube。缺失设置文件表示使用默认值。扩展不检测字体、不安装字体、不修改终端设置，command 字形也需要字体支持。

## Editing costs

整体删除使用同步原生逐字动作，再按实际有效步骤分组撤销；不是异步待提交文本。大粘贴会随每个原生步骤复制 undo 快照。已有 10 MiB 粘贴旁 64 字符名称的实验观察到约 650 MiB 额外 heap；这是用户已接受的取舍，不是恒定内存实现。

Pi 0.86.0 的 undo 栈没有应用级容量上限或淘汰。正常提交清栈，`setText` 清空草稿不清 undo；只有不可达快照可被 GC 释放，RSS 不保证立即下降。扩展在真实 reload 时释放旧 editor 的动作记录、布局、provider 包装和回调；仅通过当前 TUI 身份临时移交折叠原文，新 editor 消费后删除移交记录。移除扩展时也先通过公开 UI 边界交出展开原文。reload 不承诺跨 editor 保存旧 undo 栈，这是宿主原有边界。

本轮常规布局、64/256/1024 名称及至多 1 MiB 粘贴的实测见标签报告。没有执行极端组合或破坏性 OOM 测试，不承诺任意输入规模安全。

## Snapshots and history

`$research $research $adventure` 只加载两项，按首次出现顺序组织在同一 user 请求中，不拆成两轮任务，也不保证模型分别按顺序执行。图片与任务一起保留。已发现 skill 读取失败时静默退回普通文本，其他项照常加载，失败项不显示为已激活。

steer/followUp 队列保存原始输入，实际消费时读取文件。因此排队期间修改 skill 会影响待消费消息。消费后将真实路径、相对目录和正文保存为本次快照，后续修改或删除源文件不改变该历史。skill 正文中的美元引用不会递归激活。

原生 skill 卡片出现在对应任务之前。历史回填、再次编辑显示原文，不显示内部快照封装。reload/resume/tree/fork 只显示当前有效分支已有卡片，隐藏未完成 user 的孤立卡片；缺失卡片不补写，不重读 skill 文件。

压缩允许移除卡片。模型上下文由普通 user 内的快照及 Pi 正常压缩决定，不由卡片决定。user 被摘要覆盖后，不重新注入旧 skill 全文。磁盘仍保存快照不等于模型当前始终能看到全文。

持久化遵循 Pi 自身边界，首次 assistant 前可能尚未落盘。本扩展不增加存储事务、断电恢复或损坏 JSONL 修复保证。

## Verification

产物与 PTY 验证脚本需要 POSIX PTY、`tar`、Conda 的 `codex-py312` 环境，以及该环境中的 `pyte` 0.8.2。脚本会联网安装 tarball 的依赖；Pi 本身使用离线 faux provider，不发真实模型请求。脚本在仓库 `.tmp/` 内隔离 HOME、Pi 配置与安装目录，结束时删除临时安装并停止 PTY 进程。测试日志保存在 `adventure/evidence/`。

```bash
pnpm exec vitest run extensions/skill-mentions/__tests__
pnpm run check
pnpm run package:check
pnpm run skill-mentions:acceptance
```

复核标签的原生/Codex、regular/fullscreen 真实入口并另存证据：

```bash
pnpm run skill-mentions:acceptance --evidence-prefix=skill-label-product-final native codex native-fullscreen codex-fullscreen
node --expose-gc extensions/skill-mentions/__tests__/label-performance.mjs
node --expose-gc extensions/skill-mentions/__tests__/label-reload-memory.mjs
```

标签的来源、编辑、正文、偏好、性能及验证边界见[标签实现报告](https://github.com/wangxuyang1221/pi-ext/blob/adventure/skill-mentions/adventure/evidence/skill-label-product-implementation.md)。当前产物、全部八个默认扩展共同运行和完整 Spec 矩阵见[本轮安装验收](https://github.com/wangxuyang1221/pi-ext/blob/adventure/skill-mentions/adventure/evidence/skill-final-acceptance.md)。`combined` 与 `combined-fullscreen` 还运行受控的本地 stdio MCP fixture，不连接外部服务或执行子代理。PTY 字节注入不代表物理 IME 候选窗口或实际字体观察。

既有标点测试与真实入口结果见[标点验收报告](https://github.com/wangxuyang1221/pi-ext/blob/adventure/skill-mentions/adventure/evidence/skill-punctuation-implementation.md)。

本功能的产物与 PTY 验证独立记录，不替代全仓 check 或 package:check。当前全仓既有缺失文档和 MCP prototype 会使这两项失败，不能据此宣称全仓通过。旧版证据保留在[上一版安装验收](https://github.com/wangxuyang1221/pi-ext/blob/adventure/skill-mentions/adventure/evidence/skill-install-acceptance.md)，不能替代本轮标签验收。

## Manual terminal verification

物理 IME 与实际字体仍须人工观察。在专用终端窗口运行以下命令，不要在日常 Pi 会话中执行。launcher 只使用 worktree 内临时 HOME、配置、session 和离线 faux，正常退出后清理，不安装字体或修改终端配置。它使用本次构建入口，不是另一轮 tarball 安装测试。

```bash
pnpm run build
pnpm exec node extensions/skill-mentions/__tests__/manual-terminal.mjs native regular
pnpm exec node extensions/skill-mentions/__tests__/manual-terminal.mjs codex regular
```

也分别将 `regular` 换成 `fullscreen` 复核。每条命令启动两次 Pi，第一次 `/quit` 后自动恢复该隔离会话，第二次 `/quit` 后删除临时目录。

1. 记录操作系统、终端版本、当前字体和输入法。在中文输入法组合态中，在 `用 $al` 的前后输入中文，观察候选窗口是否贴近真实光标、选词是否只提交一次，未确认的候选不能导致 Pi 提交。
2. Tab 确认 alpha，确认两侧中文没有丢失。左右跨过标签；Backspace 删除，F8 撤销。缩窄和放宽窗口，在换行标签两侧再次用输入法选词。
3. 观察 cube 是否是清楚的线框立方体，而不是空框、乱码或重叠。提交 `用 $alpha`，检查输入框与任务正文的图标、青色、正常字重和背景继承一致，原生卡片仍在。
4. 执行 `/skill-label-icon command`，观察 `⌘`，再 `/reload`；退出进入第二次启动，确认两处仍使用 command。字体不支持时如实记录，不自动改字体或把缺字当通过。
5. 保存各宿主/模式的观察结果或截图交协调者。自动化结果不能代签这份人工记录。
