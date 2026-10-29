# Termius supplemental verification

## Result

本轮只补 #66 的 Termius 实机与系统复制边界，没有委派，没有重跑 CPU、完整自动矩阵或安装。结果为 `unverified`，新增完整通过 ID 为 0，产品/共享驱动失败为 0。既有 58 个 ID 的总计仍为 53 passed、0 failed、5 unverified。

Termius 的应用获取、AX、菜单及新建/关闭本地标签可操作，未返回安全拒绝。但本轮无法把键盘或粘贴输入送入专用本地 shell，Pi 未启动。另有关闭标签后 AX 与截图标题不一致的现象，不能确认截图的新鲜度。未将这两项实机驱动限制归为产品故障，也未将应用可访问改写为实机验证通过。

[机器可读索引](termius-verification.json) 保存来源、动作、截图及清理证据的绝对路径和 SHA-256。先前 [独立报告](final-verification.md) 和索引保持原样。

## Identity and authorization

- cwd 为 `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/pi-animation`，分支 `adventure/pi-animation`，开始 HEAD 为 `d9a8eed80295226b142ca8cbe0f372ee0bb65463`，开始工作树干净。
- Termius bundle 为 `com.termius-dmg.mac`，实际安装版本 `9.41.1`，来自 `/Applications/Termius.app/Contents/Info.plist` 的 CFBundleShortVersionString。画面中的 `10.2.1` 是待升级提示，没有更新。系统为 macOS，截图为 2764×1724 像素。字体、终端行列和实际图片协议均未核实，没有改全局设置。
- 用户已授权本轮样本文本覆盖系统剪贴板并粘贴到本工作目录。授权没有要求再次确认。未读取或输出用户原剪贴板，未向远程主机粘贴，未读 auth、发远程 provider 请求或产生付费调用。
- 已完整读取指定两个验证 skill、相关 feature、manual-terminal、CLI helper 说明，以及 write-todo-list、unslop、AGENTS、语言/提交 policy 和 testing。Issue #55 全文与 #66 已读取，计划追加到 #66 Execution，未改 Acceptance。
- 没有修改产品、宿主补丁、正式驱动或测试。scratch 仅准备隔离启动目录与证据分析，没有调用 skill-creator、maintain 或 source-reader。

## Reused baseline and preparation

新 RUN 为 `.tmp/termius-verification-66-20261029`。Node v22.22.2、pnpm 11.9.0，doctor 确认 Pi 1.4.0。仓库、新旧消费目录和异常恢复/最终 doctor 均退出 0。补丁版 regular/fullscreen API 为 true，原版均为 false。

复用 `.tmp/local-refresh-install-eoWVvw`，明确不是新安装。73 份前轮 sourceHashes 全部与当前文件匹配，原版/补丁两个消费目录的 7 个生产 JS 各自与仓库 dist 相同，共 14 次逐字节哈希比对。tarball 仍为 `8469325ca95bf53ccfce46aef45c7dedd4c3a57d1a0986fd1b06b6f3f1cfa7e1`。因此使用既有相同来源的完整自动检查基础证据，没有重跑 build/check/CPU。

按 manual recipe 为 regions/working/composer × patched/original × regular/fullscreen 准备 12 组空 HOME、agent、workspace、XDG 和 tmp。生产 Working 使用正式 codex-ui/permissions、原有 working-provider；composer 使用正式 codex-ui 与原有 model-provider。faux 仅替外部模型。各组 launch.sh、command.json、plan.json 以及准备的 agent settings 均保留。没有任何组被启动，不能将准备文件视为运行证据。

已准备包含中文、双空格、缩进子项、表格和代码围栏的 Markdown，保存在 RUN/expected-markdown.txt，共185字节。它只是预期样本，未由本轮 assistant 生成、未运行 /copy，也没有实际粘贴文件。

## Actual UI actions

全部 UI 操作只使用 `mcp__cua_repl`。未调用 AppleScript、osascript、其他 UI CLI，也未重试被拒绝的 Ghostty。

1. `cua.getApp("com.termius-dmg.mac")` 与 `getAXStateAndScreenshot()` 成功。初始窗口为 `Termius - Local Terminal`，本机空闲 shell 提示符可见。
2. 从 File 菜单选择 `New Local Terminal`，创建本轮专用 `Local Terminal (1)`。没有点击任何远程标签、连接、重连、Hosts、Keychain、SFTP 或日志。
3. 尝试关闭非绑定升级提示并聚焦 `Terminal input`，使用 `typeText` 录入以下隔离命令，然后 `pressKey("Return")`。实际画面没有显示命令执行，也没有进入预期 `TERMIUS-66` 提示符。

   ```text
   unset HISTFILE; exec /bin/sh /Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/pi-animation/.tmp/termius-verification-66-20261029/isolate.sh
   ```

4. 发生异常后先运行只读 doctor，退出 0。保存现场，再尝试 `ctrl+u`、`app.paste(<同一命令>)` 和 Return，仍未进入 shell。`app.paste` 的文档行为为临时写 pasteboard 后恢复原内容；没有通过 pbpaste 或其他方式读取原剪贴板，也未将此尝试作为真实复制验收。
5. 使用窗口暴露的 `Raise`，点击本地终端内容，尝试 `ctrl+u`、`typeText("unset HISTFILE")`、Return；再选择自己的本地标签，尝试 BackSpace 与 `a`。画面无相应 shell 输入。没有继续发送测试旅程的盲按序列。
6. `setValue(Terminal input, "unset HISTFILE")` 能改变 AX field Value；随后 Return 不清除该 Value，也未产生可观察的 shell 执行。AX 字段赋值不等于终端输入。该 Value 随后用 `setValue(..., "")` 清除。
7. 通过 Window 菜单中自己的窗口条目 `makeKeyAndOrderFront:` 选择键盘窗口，再聚焦、ctrl+u、粘贴隔离命令和 Return，结果仍相同。本地内容没有进入 Pi，RUN 内无 pid、events.jsonl 或 exit-code 标记。
8. 保存失败现场后，只点击本轮 `Local Terminal (1)` 的 close-tab。AX 明确移除该标签并回到原有 `Local Terminal`，未关闭原本本地标签和其他标签。但随后截图仍呈现先前标题和内容，连续观察亦未解决 AX/截图不同步，故不使用截图证明最终窗口或像素状态。

现场截图仅做故障证据。已裁去顶部90像素，避免保留远程标签信息。原始 screenshot 字节的哈希、裁剪范围和裁剪后哈希保存在 RUN/screenshots.json，未用 pyte 或重绘图片冒充实机。`00-isolated-shell.png` 是最初计划名称，实际并未进入隔离 shell，其内容不能据名称视为成功。

## Feature verdicts

| ID / branch | Supplemental result | Exact remaining gap |
| --- | --- | --- |
| interaction-physical | unverified | 四个 host/mode 入口均未启动；动态区域、Working、拖选、实际复制粘贴和图片像素均未执行。应用访问成功不补齐这些分支。 |
| ui-composer | unverified | 中文/ASCII/长行/多行、中间光标、light/codex-pi、宽窄以及 new/fork/resume 后的真实像素/拖选分支均未到达。既有 ANSI 自动证据保留。 |
| ui-reply-markdown | unverified | 已备代表样本，但未产生本轮生产回复、未运行 /copy、无实际粘贴文件或逐字比较。既有 session/TUI 自动证据保留。 |
| interaction-network | unverified | 本轮不在授权范围，无远程 provider/model/费用范围或凭据，未请求。 |
| ui-interrupted | unverified | 未改变原 Write/Edit 精确 await 按键落点缺少可观察/可控制阶段的结论。 |
| interaction-image physical pixel branch | unverified | 未取得 Termius 实际协议能力或 /fixture-image 降级画面。不声称 Termius 支持或不支持 Kitty，也未伪装 TERM_PROGRAM。 |
| Other 53 IDs | prior result retained | 没有新运行，不新增这些 ID 的实机覆盖声明。 |

没有 verified-unreachable 豁免。没有可交 Astra high 的产品最小复现，因为尚未加载产品。续验首先需要在当前允许的 CUA 路径建立可见、可确认的本地键盘输入与新鲜截图，然后使用保留脚本按手册启动各入口。远程和精确 Write/Edit await 不因这一条件恢复而自动通过。

## Cleanup and delivery

- AX 已确认自己的 `Local Terminal (1)` 移除，原有本地标签保留。关闭后的像素状态因截图/AX不一致未获独立确认。
- 没有 Pi 启动标记、公开 session_start 或 Pi PID；没有本轮测试服务及监听。12 组未运行的 runtime 已删除，prepared-agent、命令、脚本、预期样本和全部失败/doctor 证据保留。
- 清理时读取到的 ttys002 shell 与其 Termius helper 实际开始于10月28日，早于本轮，未终止。没有按名字 kill 或对终端共享 PGID 发信号。
- Termius 存在应用管理的 Helper，不能仅凭进程名称视为自己的测试进程，未对其强杀。本轮没有创建独立后台测试进程。
- 未改全局 Pi、主题、字体、设置或版本；没有停用户原型、删旧证据或整个 .tmp。没有 push、PR、merge、deploy 或关闭 Issue。
- `pnpm_config_verify_deps_before_run=false pnpm run hooks:check` 通过。仅证据文本变更不重跑前轮完整 check，提交仍运行仓库 pre-commit 门禁。

本关交主代理审核。系统剪贴板授权已经存在，无需重新申请；剩余首要条件是实机输入/截图链路恢复，而非同一范围的再次授权。
