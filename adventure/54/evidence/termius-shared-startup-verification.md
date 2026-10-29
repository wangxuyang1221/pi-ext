# Termius Shared Startup Verification

## Result

共享 TUI 启动回显修复独立复验通过。新增 8 项 Python 测试全部通过，含 6 次真实 Pi 启动；正式共享 `tui codex-ui --recipe` 在 Termius 普通/全屏均完成真实协商、输入与正常退出。

累计仍为 **54 passed / 0 failed / 4 unverified**，整体 `unverified`。本轮补齐多项物理分支，没有把局部成功升级为完整 ID，也没有改动产品、驱动、夹具、测试、skill 或预算。多行 composer 复制有两次失败尝试，未确认产品错误。

## Execution

- 验证 HEAD：`6fe6ce47ab87755bcb539a4b122c00ae967f01fb`；仅本 worktree，独立 gpt-6.1-sol/high，未委派。
- 新 RUN：`.tmp/termius-shared-startup-66-0cpCwK`；Termius 9.41.1，10.2.1 仅更新提示；原生 CUA 已实际使用。
- Node v22.22.2 / pnpm 11.9.0 / Pi 1.4.0 / Python 3.12.13。每个 fresh 实例先 doctor；失败尝试后 doctor。一次误用 doctor 的 `--json` 参数被拒绝，随后改用正式 doctor 和输出重定向，未变更任何检查。
- 核对 47 条来源记录和 345 份继承 artifact；唯一历史 hash 差异为已知 commands.py 修复，当前驱动和新增测试与父报告相符。两消费者各 32 个 JS 与当前 dist 字节一致。
- 消费 tarball SHA256：`03058ebfa8f11a6f2f554cf93c61919eb40bcc6544382cd8b70305daefdedd0d`。原版 doctor API 为 false/false，补丁为 true/true。
- 执行 `conda run -n codex-py312 python .cursor/skills/verify-pi-ext/scripts/test_commands_terminal.py -f`，`TERMINAL_TEST_RECORD` 保存真实 PID、raw 标志和恢复记录。ready 失败、中断、正常退出均恢复 termios；启动标志不含 ECHO/ICANON。
- 没有重跑完整 CPU、Working 四入口、旧 CLI、build、pack 或完整 check；205 文件/2958 测试是已核对的父代理结果，非本轮执行。

## Shared TUI

| Mode / columns | Evidence | Exit / restoration | Observation |
| --- | --- | --- | --- |
| fullscreen / 120 | `.tmp/test-results/verify-codex-ui-QX7MDj` | 0 / termios identical / removed | 真实 DA 与颜色回复进入输入日志；无字面回复输出 |
| fullscreen / 32 | `.tmp/test-results/verify-codex-ui-67ag1m` | 0 / termios identical / removed | 真实 DA 与颜色回复进入输入日志；无字面回复输出 |
| regular / 120 | `.tmp/test-results/verify-codex-ui-kmZYAb` | 0 / termios identical / removed | 真实 DA 与颜色回复进入输入日志；无字面回复输出 |
| regular / 212 | `.tmp/test-results/verify-codex-ui-qkdI05` | 0 / termios identical / removed | 真实 DA 与颜色回复进入输入日志；无字面回复输出 |
| regular / 212 | `.tmp/test-results/verify-codex-ui-2s1o4d` | 0 / termios identical / removed | 真实 DA 与颜色回复进入输入日志；无字面回复输出 |
| regular / 40 | `.tmp/test-results/verify-codex-ui-TmzyWk` | 0 / termios identical / removed | 真实 DA 与颜色回复进入输入日志；无字面回复输出 |

120 列两模式首个 header 前的新鲜截图与原始 ANSI均无字面 CSI/OSC 回复。正常输入和 `/quit` 后 shell 可用；六个共享实例都保存 agent、session、workspace 后删除 scratch，driver/Pi 均停止，锁已消失。120/40/32 列采用本轮 tmux 可见分栏，client_utf8=1；recipe 行列与实际 pane 一致。212 列为原生外层完整终端。

## Physical Branches

| Branch | Evidence and result |
| --- | --- |
| Composer wide / sessions | 普通和全屏 120 列 codex-pi，中文/ASCII/长行三行草稿；真实 fork/new/resume 后再拖选文字和空白；全屏继续一次实际请求。首轮异步 fork 预填覆盖草稿后等待稳定再清除重输入，未采用过渡帧作结果。 |
| Composer narrow / themes | 普通40 codex-pi文字/空白拖选；全屏32 codex-pi/light文字/空白拖选；light宽屏及普通40新会话草稿清晰。32列长行实际折行，背景连续，无可见光标残影。95/96号普通40 light选择落下方空白，不计通过。 |
| Dynamic editing / focus | 补丁普通与原版两模式实际中间插入，F6均记录 `draft-中文-aXbc`；F7 overlay关闭。原版普通首次 q/Esc未送达，doctor留证后点击本轮标签与终端恢复，原始失败保留。 |
| History / lifecycle | 补丁普通、原版全屏各七次实际请求并settled；全屏Ctrl+Home/End可见旧/新正文；补丁普通原生settings切换模式再返回，stop/start/new/reload；原版全屏stop/start/new/reload；全部正常quit。 |
| Scroll / default search | 普通滚轮、全屏鼠标滚动没有可证明的视口变化；默认Ctrl+Shift+F没有搜索overlay。Shift+PageUp/Down误入模型菜单后Esc退出，没有模型请求。继承隔离Ctrl+F搜索1/1的通过范围保持独立。 |

## Clipboard

只复制已知隔离样本，不读取原剪贴板、不向远程粘贴。native 选择用 Termius 拖选再 `super+c`；全屏宿主选区用隔离 `fullscreenCopyOnSelect=true` 并观察 Copied。退出后仅用 ASCII `typeText` 启动受限 receiver，再真实 `super+v`、Ctrl+D；复制至接收结束没有调用 `app.paste`。expected 均事先固定。

| Path | Known selection | Result |
| --- | --- | --- |
| Shared regular120 / native | `第一行 中文 ASCII` | 22/22 bytes，SHA256 `d6ae72488ae5076ceac1f85b727f9b3ab2e2fa617b064a295b9e161e766c43bc` |
| Patched regular212 / native | `Region demo 966 / 1` | 19/19 bytes，真实最新动态行 |
| Original regular32 / native | `Region demo 1227 / 1` | 20/20 bytes，真实最新动态行 |
| Original fullscreen32 / host | `Region demo 30 / 1` | Copied，18/18 bytes |
| Shared regular212 / native, two fresh runs | 完整三行固定85字节草稿 | 两次REJECTED、exit1；actual未创建，未知内容未回显、未保存或读取 |

补丁全屏40/light的18/18字节成功和生产 `/copy` 四入口首尾空白/LF精确证据继承，未重跑。最早补丁普通选择少末尾 `1` 时停止该尝试，未进入 receiver；后用新实例完成19/19字节。多行两次拒绝保留原始截图及预期，不根据实际内容改 expected，不认定 ui-composer 完整通过。

## Requirements Mapping

| Requirement | Proven scope | Remaining |
| --- | --- | --- |
| `manual-terminal.md#actions-and-evidence` #1 | 动态周期、中文中间编辑、可见120/40/32列、错行/输入观察；本轮加原版两模式。 | 无新增缺项 |
| `manual-terminal.md#actions-and-evidence` #2 | 七次真实请求、全屏键盘历史、overlay关闭/草稿、静态/更新后动态选择。 | 普通终端滚动、全屏鼠标滚动、默认搜索键可见效果。 |
| `manual-terminal.md#actions-and-evidence` #3 | 补丁/原版普通 native 复制、原版全屏 host copy-on-select；继承补丁全屏复制；22字节中文单行、18/19/20字节最新动态文本均真实系统粘贴。 | composer完整三行文字换行的选区一致性。生产 /copy 首尾空白/LF 四入口证据继承，未重跑。 |
| `manual-terminal.md#actions-and-evidence` #4 | 继承真实文本降级与协议证据。 | 真实图片像素及off后残影，需获准且实际支持协议的终端；不伪造 TERM_PROGRAM。 |
| `manual-terminal.md#actions-and-evidence` #5 | 真实settings模式切换、stop/start/new/reload/quit及归档；原版正常回退。 | 远程 provider 独立授权会话。 |
| `README.md#manual-boundaries` #1 | 正式共享tui、含中文ASCII长行三行草稿、两模式/主题/宽窄、new/fork/resume文字与空白拖选，单行实际复制22/22。 | 完整三行选区两次粘贴 REJECTED。没有额外要求全部维度笛卡尔积；原版新能力可用性另有实机证据。 |
| `README.md#manual-boundaries` #2 | 继承已经通过的补丁/原版普通/全屏生产 /copy 精确首尾空白、LF及正文证据。 | 无新增缺项 |
| `README.md#file-mutation-cancellation` | 继承 Bash 实际取消和原有自动边界；未重新抢时序。 | Write/Edit 精确await取消无可控阶段。 |

## Verification IDs

下表的继承项均指向已核对的 [上一轮索引](termius-selection-recovery-verification.json)，其完整 evidence 链与本轮来源/产物 hash 见配套 JSON。未重跑的自动项只保留原通过范围。

| ID | Result | This round / remaining |
| --- | --- | --- |
| `region-independent` | passed | 补丁普通模式动态计数；静态/最新动态选区截图；原版两模式正常显示。 |
| `region-edit` | passed | 补丁普通、原版普通/全屏的 F6 事件均为 draft-中文-aXbc；实际光标中间插入。 |
| `region-lifecycle` | passed | 补丁普通与原版全屏 stop/start/new/reload；补丁普通经原生设置切换全屏再普通；正常 quit。 |
| `region-original` | passed | 原版普通 32 列、全屏 120/32 列实机可用；缺补丁 API 正常回退；真实复制分别 20/20 与 18/18 字节。 |
| `working-stream` | passed | 继承已核对证据；本轮未重跑。 |
| `working-permission` | passed | 继承已核对证据；本轮未重跑。 |
| `working-cancel` | passed | 继承已核对证据；本轮未重跑。 |
| `working-recovery` | passed | 继承已核对证据；本轮未重跑。 |
| `working-replacement` | passed | 继承已核对证据；本轮未重跑。 |
| `interaction-focus` | passed | 动态期间 F7 overlay、关闭与草稿保持；原版普通焦点通道一度失效，doctor 后点击自己的标签恢复，保留失败动作。 |
| `interaction-transcript` | passed | 原版全屏 Ctrl+Home/End 可见旧/新正文；鼠标滚动和默认搜索键尝试未证明；继承替代绑定搜索的独立范围。 |
| `interaction-image` | passed | 继承已核对证据；本轮未重跑。 |
| `interaction-physical` | unverified | 新增补丁普通 native selection 19/19、原版普通 native selection 20/20、原版全屏 host copy-on-select 18/18 字节；编辑、可见 resize、overlay 和生命周期补证。 剩余：普通模式终端滚动、全屏鼠标滚动和默认 Ctrl+Shift+F 的真实可见效果尚未证明；需要能把这些输入可靠送达的物理终端/控制通道并保存视口或搜索结果。Termius 未证明图片像素能力，图片分支还需真实支持协议的获准终端。 |
| `interaction-network` | unverified | 继承已核对证据；本轮未重跑。 剩余：未指定远程 provider/model、凭据及费用范围；未读取用户 auth，未发送付费请求。需明确这些条件后运行独立联网会话。 |
| `cpu-dynamic` | passed | 继承已核对证据；本轮未重跑。 |
| `cpu-normal` | passed | 继承已核对证据；本轮未重跑。 |
| `cpu-native` | passed | 继承已核对证据；本轮未重跑。 |
| `cpu-equivalence` | passed | 继承已核对证据；本轮未重跑。 |
| `install-patched` | passed | 当前 dist 与 patched 消费安装各32个 JS 完全匹配；doctor API 为 true/true。 |
| `install-original` | passed | 当前 dist 与 original 消费安装各32个 JS 完全匹配；doctor API 为 false/false，实际原版动态输入与复制可用。 |
| `install-published` | passed | 消费 tarball SHA256 与指定值一致；本轮不重打包。 |
| `install-isolation` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-header` | passed | 共享 tui 普通/全屏首 header 前无字面 CSI/OSC 回复，真实终端协商进入输入日志。 |
| `ui-composer` | unverified | 共享正式 tui：120 列 codex-pi 两模式 new/fork/resume 后草稿及文字/空白拖选；40 列普通、32 列全屏；light 宽屏和全屏窄屏；单行 22/22 字节，完整三行两次 REJECTED。 剩余：两模式、两主题、宽窄及 new/fork/resume 的清晰草稿和拖选已补证；单行中文选区实际粘贴 22/22 字节。完整三行选区的两次真实粘贴均 REJECTED，缺少与预先固定 85 字节草稿一致的选区复制证据；原因未定位，须独立定位终端选区/复制路径后重验，不能按单行成功推断多行通过。 |
| `ui-status` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-theme` | passed | 原生 settings 选择 light，宽屏及全屏32草稿/选择；不是每个维度的笛卡尔积。 |
| `ui-resize` | passed | 可见 tmux 左 pane 120/40/32 列且 client_utf8=1；共享 recipe 与实际 pane 尺寸一致，补全普通40和全屏32的真实草稿。 |
| `ui-user-markdown` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-reply-markdown` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-working` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-receive-rate` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-thinking-stream` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-thinking-collapse` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-thinking-resume` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-title` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-title-stop` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-tool-rendering` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-read-group` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-bash-preview` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-expand` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-write-added` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-write-edited` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-diff` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-error` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-interrupted` | unverified | 继承已核对证据；本轮未重跑。 剩余：Write/Edit 的 filesystem await 没有可观察、可控制的精确取消阶段；须有可控阶段后证明真实 Esc 到达，现有 Bash 取消和受控测试不能替代。 |
| `ui-codemode-order` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-codemode-failure` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-inspect-tabs` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-inspect-scroll` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-codemode-cache` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-codemode-resume` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-shell-prefix` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-shell-path` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-image-resize` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-project-trust` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-settings-error` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-settings-reload` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-headless` | passed | 继承已核对证据；本轮未重跑。 |

## Cleanup

- 最终逐一复核 58 个已记录 PID：`ps` 与 TCP LISTEN `lsof` 均为 exit1。包含自动真实Pi场景、四份doctor、共享driver/Pi、直接Pi、receiver wrapper、tmux server/pane/client及本轮tab shell。未记录的短命子进程不虚构PID；receiver返回、共享清理及最终RUN命令扫描另有证据。
- 四份直接入口的隔离 agent/session/workspace归档后删除runtime；六份共享scratch自动归档并删除；本轮tmux server已停止，socket已移除，共享helper锁不存在。没有启动监听服务。
- 专用 Local Terminal (1) 已关闭，原Local Terminal保留；Window Zoom已恢复2764×1724。没有改终端字体/主题/键位或更新Termius，没有触碰用户原型、旧证据、远程连接和全局Pi。
- 截图、动作、已知样本粘贴文件、ANSI、事件、来源及产物hash、PID与清理记录保留在RUN和共享evidence目录。Node compile cache不列入执行证据hash。

## Delivery

本轮仅交付报告与JSON索引，并更新progress的执行/验证续接点。未push、未建PR、未merge/deploy；未改Acceptance、Map或Spec，未关闭#66。

## Continuation Point

启动回显修复已独立通过。交主代理定位三行composer选择复制的两次REJECTED及滚动/默认搜索输入未显示效果；当前证据不能确认根因，也不能通过降低断言或补夹具消除缺项。图片像素、远程provider和Write/Edit精确await按上表所列真实前置条件续验。整体#66仍未完成。
