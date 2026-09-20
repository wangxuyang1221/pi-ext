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
- 引用两侧仅接受空格、换行、Tab 或输入边界。`用 $research 调查` 可识别，`文字$research`、`（$research）`、`$research，继续` 不识别。
- 光标处于名称中间、Markdown 行内代码、围栏代码或 `\$research` 时不补全、不激活。
- 完整引用手写、粘贴和菜单补全等效；部分名称不激活。未知名称原样发送，不提示、不阻断。

自定义快捷键继续由 Pi 的 `keybindings.json` 管理，修改后 `/reload`。原生 slash 补全和 `/skill:name` 入口保持不变。本功能只处理 TUI 普通 user 消息，包括其他扩展发送的 user，不处理 assistant/tool/custom 消息或 RPC/print。

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

本功能的产物与 PTY 验证独立记录，不替代全仓 check 或 package:check。当前全仓既有缺失文档和 MCP prototype 会使这两项失败，不能据此宣称全仓通过。执行环境、逐项 Spec 证据及终端验证边界见 [安装验收报告](https://github.com/wangxuyang1221/pi-ext/blob/adventure/skill-mentions/adventure/evidence/skill-install-acceptance.md)。
