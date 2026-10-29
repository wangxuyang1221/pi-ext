# Termius recovery verification

## Result

本轮在 gpt-6.1-sol / high 独立补验，没有委派，没有修改产品、宿主补丁、正式驱动或测试。当前 CUA 输入和截图可用，Pi 已实际运行。发现两项验收失败，按委托交主代理 Astra high 判断和修复，不把失败改为通过。

- `ui-composer`：Termius 当前浅色终端中，codex-pi 的深灰 composer 使用深色文字，草稿几乎不可读；同一草稿切换 light 后清楚可见。补丁/原版、普通/全屏均有现场。字符没有丢失，公开 editor 事件保留中文全文。此为本轮观察到的终端适配问题，没有证明由局部刷新补丁引入。
- `ui-reply-markdown`：生产 `/copy` 明确显示成功，真实系统粘贴所得为 184 字节，session assistant 原文为 185 字节。差异是末尾一个 LF。宿主 `AgentSession.getLastAssistantText()` 返回 `text.trim()`，与实际差异一致。按本任务逐字保留空格与换行的标准失败，不能以 trim 后相等放宽标准。

沿用既有 53 个 passed，只把上述两个原 unverified ID 更新为 failed；其余三个必要边界仍 unverified。合计为 **53 passed、2 failed、3 unverified**，整体 failed。新增完整通过 ID 为 0；新增通过的物理子分支和未到达分支见下文。原 final-verification、termius-verification 及其 JSON 均未覆盖。[本轮机器索引](termius-recovery-verification.json) 包含全部 58 个 ID、来源、动作、截图及原始文件 SHA-256。

## Identity and baseline

- 固定 cwd `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/pi-animation`，branch `adventure/pi-animation`，开始 HEAD `9fbfed8a4ad0e82d904c86ddc0df883295bd5ae1`，开始工作树干净。
- RUN `.tmp/termius-recovery-66-20261029-r1`，与前轮隔离。Termius bundle `com.termius-dmg.mac`，实际版本 9.41.1，10.2.1 仅为待升级提示，没有更新。Node v22.22.2、pnpm 11.9.0、Pi 1.4.0。
- 完整读取两个指定验证 skill、相关 feature/manual/CLI helper、write-todo-list、unslop，以及本 worktree 的 AGENTS、语言政策、提交政策、testing；读取 Spec #55 和 Issue #66，计划追加到 Execution，Acceptance 不变。没有因本轮任务重新调用维护 skill 或开启 source-reader。
- 复用 `.tmp/local-refresh-install-eoWVvw`，不是新安装。73 份来源哈希与前轮相同，两消费者各 7 个生产 JS 哈希匹配，tarball SHA-256 仍为 `8469325ca95bf53ccfce46aef45c7dedd4c3a57d1a0986fd1b06b6f3f1cfa7e1`。没有重跑 CPU/check/build；既有对应哈希的完整检查仅作为基础证据。
- 仓库与补丁/原版消费 doctor 通过，API 分别为 true/true 与 false/false。每个新的入口有 doctor，异常另存 doctor。`working-patched-regular` 使用本轮启动前的 `doctor-patched.json`。

## Terminal control and isolation

1. 本轮首先在原有空闲 Local Terminal 输入 `T66_RECOVERY_PROBE`，没有回车。截图显示完整字符，随后 Ctrl+U 截图确认清空。AX Value 曾漏掉数字和下划线，未据 AX 推断屏幕字符。此探针不计 Pi 验收。
2. File → New Local Terminal 只创建一个 `Local Terminal (1)`。完整 AX 与截图均确认自己标签和本机提示符后才录入隔离命令。原有本地及远程标签保留，没有连接、重连、输入或关闭远程标签。
3. 用 CUA 输入并执行 `unset HISTFILE; exec /bin/sh <RUN>/isolate.sh`，截图出现 `T66-RECOVERY`。隔离 shell 使用空 HOME、禁用 history、白名单 PATH；Pi 各自使用空 HOME/agent/workspace/tmp/XDG，不读用户 auth，不发远程模型请求。
4. 所有 UI 动作只用 CUA。截图来自文档返回的 screenshot bytes，没有 AppleScript、其他 UI CLI、Ghostty 重试或不可用的 launch_app。初始截图部分内容不可见，使用 Window → Zoom 后可见完整 footer；随后通过真实窗口边缘拖动缩窄。没有改全局主题、字体或设置。
5. 终端实际传入 `TERM=xterm-256color`、`TERM_PROGRAM=Termius`，未伪装 Kitty。启动尺寸依次有 38×142、52×212、25×73；实际 resize 读回 25×73。最小窗口宽度为 1440 像素，本轮没有达到物理 32/40 列。退出时窗口恢复到初始 2764×1724 像素。

## Working observations

四个消费入口均实际启动，公开 session_start 的 tty=true；只以 faux 替外部模型，生产 codex-ui、permissions、组件与宿主实际运行。

| Entrance | Actual observations | Exit |
| --- | --- | --- |
| patched / regular | 生产青色 spinner、灰白 Working 反光、0s 到后续计时、右侧 ≈ 速率、Goal 第二行；overlay 开关；中文中间插入；取消后隐藏；真实权限等待仍动画且速率过期为 --，批准后 shell 生成 TOOL-FINISHED；settled 后隐藏；/quit | 0 |
| patched / fullscreen | 生产 spinner/反光/计时/≈、Goal、三行中文草稿和中间插入；F8 input 等待与关闭；取消后隐藏；原生 /settings 双向切换 renderer，settings 落盘；/new 与真实 reload 后 idle 无旧 Working；/quit | 0 |
| original / regular | 生产组件正常回退，spinner/反光/计时/≈、Goal；中文草稿；light/codex-pi 切换；真实窗口 212→73 列时 footer/草稿保持；取消后隐藏；/quit | 0 |
| original / fullscreen | 73 列中的生产 spinner/反光/计时/≈、三行中文、Goal；取消后隐藏；同一草稿 light/codex-pi 对照；/quit | 0 |

关键截图位于 RUN：`04-working-stream-a.png`、`06-working-overlay.png`、`12-working-permission-expired-a.png`、`15-working-tool-settled.png`、`20-fullscreen-multiline-draft.png`、`21-fullscreen-input.png`、`26-fullscreen-mode-switched.png`、`29-fullscreen-reload.png`、`35-original-regular-narrow-attempt.png`、`40-original-fullscreen-draft.png`。精确计时精度依赖既有测试；本轮静态截图不证明 80ms/32ms 调度精度，也不证明远程 provider。

首次 `typeText` 输入中文后，F6 实际记录 `draft--aXbc`。异常 doctor 通过，改用文档支持的 app.paste 后 F6 准确记录 `draft-中文-aXbc`；原失败没有算中文通过。这是输入方法证据，未将其归为产品字符丢失。

## Composer failure

最短实机复现如下，源码线索供主代理检查，不代替修复验证。

1. 保持 Termius 现有浅色终端，隔离设置 theme=codex-pi，加载正式 codex-ui，启动 regular 或 fullscreen。
2. 粘贴 `fallback-中文-long-line\nsecond line\nthird  line`。实际深灰背景上的深色草稿几乎看不清，输入位置和内容仍在。
3. 用夹具 F9 调用公开 setTheme(light)。同一草稿立即清楚可见，F6 公开 editor 记录全文，没有重新输入草稿。

补丁 ordinary 的 `10-working-chinese-paste.png`、补丁 fullscreen 的 `20-fullscreen-multiline-draft.png`、原版 ordinary 的 `33-original-regular-draft.png` 与 `34-original-regular-light.png`、原版 fullscreen 的 `41-original-fullscreen-codex-settled.png` 与 `42-original-fullscreen-light-settled.png` 保留现场。CodexEditor 两种 render 路径均只装饰 selectedBg，正文默认前景的处理需由主代理检查。本轮不修改代码，也不认定旧输入故障的根因已经查明。

未继续把拖选、空白区、new/fork/resume、所有宽度/主题组合算作通过；这些分支须在修复后补齐。当前结论是有已观察到的可读性失败，并非所有 composer 分支都已执行。

## System copy failure

使用正式 composer provider 生成包含中文、双空格、缩进子项、表格、代码围栏及引用的代表回复，经过真实模型请求边界和持久 session。固定回复仅替代远程模型，生产 renderer 与 `/copy` 没有替身。

- 先核对完整 `/copy` 输入，重新聚焦最新 AX Terminal input 后 Return，`54-copy-refocused-return.png` 明确显示 `Copied last agent message to clipboard`。
- 正常 `/quit` 并核对 Pi 已退出。启动只接收 stdin 的本轮 `capture-paste.mjs`，截图确认 CAPTURE READY 后，用 CUA `super+v` 实际系统粘贴；没有用 pbpaste、native clipboard getter 或文件读取代替粘贴。
- 接收程序采用 canonical stdin，第一次 Ctrl+D 刷出无尾换行的最后一行，确认仍在接收后第二次 Ctrl+D 结束，保留实际文件及 shell 返回画面。
- 原文 `markdown-regular-assistant.txt`：185 字节，SHA-256 `999f50e3c7fb47d9a3aa5d16591583bc3d3b1defcdd1a07d8b4fa721c4903bf9`。
- 实际 `markdown-regular-retry-pasted.txt`：184 字节，SHA-256 `268b856f89c8609f5d68c7e983f1a8056982a82e0bda3c73e188ca41341f7887`。
- 差异仅为末尾 LF，正文中文、双空格、缩进、fence 和表格原文一致，没有 renderer 外层列表。严格字节结论为失败；没有将 trim 后相等视为通过。
- 宿主 `dist/core/agent-session.js` 的 getLastAssistantText 最后执行 `return text.trim() || undefined`；`handleCopyCommand` 使用此返回值。固定 Pi 1.4.0 的此行为属于宿主现状，不证明由本轮插件修改引入。

首次复制尝试未确认成功状态就粘贴，出现非样本内容。接收端没有生成文件；立即终止该接收 PID，删除含意外内容的两份截图及衍生图，不保留、转述或提交其内容。没有主动查询原剪贴板。此后先用已授权的 `T66-CLIPBOARD-SENTINEL` 覆盖系统剪贴板，再执行上述确认成功的 `/copy` 和真实粘贴。该过程错误单独记录，不归为产品复制失败证据；最终失败由明确成功后的样本字节及宿主代码支持。最后系统剪贴板保留的是本轮生产 Markdown，没有恢复或读取用户原剪贴板。

## Feature verdicts and remaining work

| ID / branch | This round | Remaining |
| --- | --- | --- |
| ui-composer | failed | 深色 composer 草稿可读性失败；修复后补 light/codex-pi、普通/全屏、宽窄、拖选/空白区及 new/fork/resume 完整组合。 |
| ui-reply-markdown | failed | patched regular 的生产 /copy 与真实系统粘贴已到达，末尾 LF 丢失。修复后重验精确字节及 fullscreen/原版入口。 |
| interaction-physical | unverified | 四入口生产 Working 像素、输入、部分 overlay/input/模式/session 行为已补证；未运行 regions 示例、动态最新文字选区/系统复制、真实拖选、历史滚动/搜索与 32/40 列全部分支。 |
| interaction-image pixel branch | unverified | 只记录实际 TERM/TERM_PROGRAM；未进入 /fixture-image 或进行协议能力探测，不能断言 Termius 支持或不支持图片。文本降级亦没有本轮新证据。 |
| interaction-network | unverified | 未获本轮远程 provider/费用授权，未读 auth、未请求；faux 不能覆盖。 |
| ui-interrupted | unverified | Write/Edit 精确 await 的真实 Esc 仍无可观察/可控制阶段，保留前轮边界。 |
| Other 53 IDs | prior passed retained | 复用对应来源哈希的既有自动证据；本轮不声称重跑全部入口或 CPU。Working 新增物理子证据不自动补齐其他人工分支。 |

因已发现上述失败，按委托结束本轮产品验收并转交主代理，不派代理、不修改产品、不降低验收标准。没有 verified-unreachable 豁免。恢复后的 CUA 可运行产品这一事实，不构成所有物理边界通过。

## Cleanup and delivery

- 四个 Working PID 31645、34643、35784、36578 与恢复 composer PID 42436 已退出；粘贴接收 PID 41254 已定向 TERM，43195 正常结束。已记录 PID 均读回无存活、lsof 无监听，没有按名字或共享终端 PGID kill。
- 首次 composer 的 pid 文件被本轮 resume wrapper 覆写，未独立保留第一次 PID，这是本轮证据缺口。关闭标签前专用 ttys003 上只剩自己的 login 与隔离 zsh；关闭后该 TTY 消失，两个 shell PID 30377/30378 也退出，未留下未识别的本轮测试进程。
- 12 组 runtime 全部保存 agent/workspace 到 artifacts 后删除，只有 5 组实际启动，composer 另恢复一次。未启动的其余目录只是准备材料，不能作为通过证据。shell-home 已清理。
- 只关闭自己创建的 Local Terminal (1)，最终 AX 与 `62-final-original-local-tab.png` 同时确认回到原有 Local Terminal 空闲提示符。原有本地/远程标签、用户原型及旧失败证据保留。
- 61 份 PNG 均由真实 screenshot bytes 裁去顶部 90 像素，保留原像素，不拼接、不重绘；screenshots.json 记录原始字节哈希、原尺寸、裁剪坐标及成品哈希。包含意外粘贴内容的两个编号被明确排除。提交索引不含远程标签信息。
- hooks:check 通过；纯证据变更沿用对应哈希的既有完整 check，不重跑 CPU/check/build。提交正常执行仓库 pre-commit 门禁。只提交本轮报告和索引，不 push、PR、merge、deploy、改 Acceptance 或关闭 Issue。
