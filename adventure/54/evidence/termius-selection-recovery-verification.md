# Termius selection recovery verification

## Result

本轮独立 gpt-6.1-sol / high 基准为 `06b1534c6a5c20455494853bc48f6da82da0a861`，没有委派或修改产品、宿主补丁、共享驱动、断言和预算。累计仍为 **54 passed、0 failed、4 unverified**，整体 `unverified`。新增的是实机子证据，没有新增完整通过 ID。

已完成补丁全屏最新动态选区的真实系统复制与逐字节粘贴比对、隔离替代键搜索、可见32/40列分栏，以及此前未启动的三个regions物理入口和旧skill的部分窄列composer组合。默认搜索键、完整composer组合、其余选择复制组合和图片像素仍有缺口。远程provider与Write/Edit精确await边界保留。

[机器索引](termius-selection-recovery-verification.json)记录全部58个ID、来源和消费字节、动作、截图、session、粘贴比较及清理。原始根为 `.tmp/termius-selection-recovery-66-p74Bil`。本轮只提交本报告和JSON，不push，不修改Acceptance、Map、Spec或关闭Issue。

## Native control and identity

先通过直接 `mcp__cua_repl.js` 调用 `cua.getApp("com.termius-dmg.mac")`，随后无回车键入 `T66_VERIFY_READY`。截图显示完整字符串，Ctrl+U后空闲提示符恢复。AX隐藏输入Value滞后，不据其判断实际shell内容。探针在准备工作之前完成，原始图仅在工具记录中，未另存文件。随后通过File → New Local Terminal创建自己的 `Local Terminal (1)`。

Termius实际版本沿用已核实9.41.1，10.2.1仍只是更新提示，本轮未升级。所有UI动作只用CUA；没有访问Hosts、Keychain、SFTP、远程连接或Ghostty，没有读取剪贴板。原窗口2764×1724，验收期间通过原生Window → Zoom使用4096×2336，结束恢复2764×1724。未改全局字体、主题、绑定或Pi。

两个skill的只读doctor均实际运行，补丁和原版消费doctor分别为API true/true与false/false，旧doctor独立checkout、非共享依赖且无锁。Node v22.22.2、pnpm11.9.0、Pi1.4.0、Python3.12.13。复用 `.tmp/local-refresh-install-CzIw6h/installation.json` 中的CLI和installedExtension，没有重新安装、pack或build。两消费者各32个codex-ui JS与当前dist全部逐字节相同。tarball SHA-256仍为 `03058ebfa8f11a6f2f554cf93c61919eb40bcc6544382cd8b70305daefdedd0d`，73条继承来源哈希核对无差异。

本轮按明确任务限制不重跑已通过的完整check、CPU、Working、CLI或receiver六项自测。既有205文件/2958测试等结果只是继承证据，没有冒充本轮新跑。

## Dynamic selection and actual paste

使用真实消费补丁宿主、仓库 `examples/text-region.ts` 与 `test-support/fixtures/local-refresh/provider.ts`，仅faux替代模型边界。所有HOME、agent、workspace、XDG和TMP均隔离在本轮目录。新的 `patched-copy-visible` 实例启用 `fullscreenCopyOnSelect=true`，tmux左pane实际40列、52行。

1. 用已授权哨兵覆盖系统剪贴板，不读取原内容。实际pause得到 `Region demo 48 / 1`、footer149，随后单次both得到最新 `Region demo 49 / 1`、footer150。
2. 稳定截图36确认最新文字。CUA真实鼠标拖选最新行，截图37/38/39保留反色选区。宿主真实copy-on-select反馈 `Copied!` 位于pane右上角，截图39及其检查图明确可见。没有混用Termius菜单Copy。
3. 正常 `/quit`，Pi PID87831已停止且无监听，再用ASCII typeText键入receiver启动脚本。它调用未经修改的 `adventure/54/experiments/selection-copy/receiver.py`，expected预先来自已知样本和屏幕选区。
4. 截图40确认CAPTURE READY后，真实 `super+v`、Ctrl+D。receiver只在完全匹配时保存actual，退出0，显示CAPTURE MATCH。没有stdin重定向、getter、callback或文件内容冒充系统粘贴；复制成功至receiver完成之间没有app.paste。

expected与actual均为18字节，内容完全等于 `Region demo 49 / 1`，SHA-256为 `913bb9ba95f0ff54ecc888ca0e3a078d6c9319aef386933bbd976f39ff6423d0`。实际文件及comparison.json保留在 `patched-copy-visible/`。本轮未出现REJECTED或非样本捕获，没有读取或恢复前轮已删除的数据。

这一通过只覆盖补丁全屏、40列、light主题下的动态宿主选区。普通模式另有真实终端拖选截图，未作其系统复制字节比对；原版全屏及其他主题/宽度的动态复制也未据此判为通过。

## Narrow terminal and search

本轮独立tmux3.6b使用本轮HOME/TMP、相对socket `s` 和 `-f /dev/null`，没有连接用户默认server。实际在自己的Termius标签attach，创建左右pane；仅创建/调整布局使用tmux命令，所有Pi键盘与拖选由CUA操作，没有send-keys或直接PTY输入替代。

32列与40列有pane_width、Pi启动stty和真实截图。原版普通模式启动为38×32，补丁普通模式52×32，原版全屏38×40，最终补丁复制实例52×40。窄列截图中右侧独立shell和竖直分隔线可见，不是只改stty cols。旧skill两个内层PTY由正式recipe配置52×32与52×40，外层实际tmux匹配；未单独对其已退出内层TTY再做kernel stty读回。

搜索新实例 `patched-search` 只在隔离agent/keybindings.json将 `tui.altScreen.search` 绑定Ctrl+F。真实打开搜索，刚生成的transcript `Response 0` 得到1/1并反色，Esc关闭，截图43–46及公开请求/session支持这一结果。尝试搜索动态widget的 `Region demo 56` 得到No matches；搜索范围是transcript，未将widget无匹配视为产品失败或宣称动态widget可搜索。

默认Ctrl+Shift+F另在无覆盖绑定的40列旧skill全屏实例实际按下，没有打开搜索，CUA调用记录、截图85及tmux快照保留，shared输入日志没有该键对应字节。它与替代键通过分开报告，按键未生效的根因仍未定位。

## Regions and composer

| Entrance | New physical evidence | Limits |
| --- | --- | --- |
| patched fullscreen | 最新选区Copied及实际粘贴；40列替代键搜索与最新transcript匹配；32列首次分栏 | 初始两个实例画面/输入异常保留；完整动态复制矩阵未覆盖 |
| patched regular | 32列独立/同时更新、中文中间插入公开事件、图片文本降级、height/new/reload/quit | 中文初期经非UTF-8客户端显示下划线，不以这些截图证明中文像素；部分历史/主题/拖选组合仍缺 |
| original regular | 32列正常fallback、动态更新、overlay打开关闭、中文editor事件、height和quit | 该阶段client_utf8=0；没有系统选区复制字节证据，完整生命周期组合未齐 |
| original fullscreen | 40列fallback、可见图片文本降级及移除、stop/start/new/reload/quit | 初始窗口底部不可见；未补全真实拖选复制和历史/搜索组合 |

旧skill按文档正式 `verify.mjs tui codex-ui --recipe <本轮recipe>` 启动两次，不改共享驱动。32列regular证据为 `.tmp/test-results/verify-codex-ui-gpKzlZ`，40列fullscreen为 `.tmp/test-results/verify-codex-ui-kPiswD`。两次均正常退出、status=manual-review-required、cleanup=removed；该状态本身不是全部验收通过。

两个入口实际输入相同三行中文、ASCII和长行草稿，codex-pi/light均清楚可读。32列regular在修正UTF-8后有codex文字拖选，以及light的fork后文字/空白区准确选区；40列fullscreen有两主题的文字/空白拖选。两入口light均通过真实fork/new/resume选择器后再次显示草稿，恢复后再提交后续请求。请求context分别同时包含原来源和后续prompt，主题设置落盘为light，session副本保留。截图59–84及接触表用于独立审查。32列light早期64/65沿用旧坐标，未计为准确拖选证据，后续68/69重取稳定帧后补证。

这些是部分宽度/主题/会话组合。32列fullscreen、40列regular、原版窄列codex-ui、codex-pi下全部new/fork/resume拖选组合，以及composer选区实际粘贴字节仍缺，因此ui-composer继续unverified。没有把图片文本降级改写成真实图片像素通过。

## Corrections and evidence limits

- 第一个直接全屏实例只有start事件，没有记录pause/theme/F6/quit动作结果。正常退出尝试无效后只TERM已核实PID84645；退出文件虽为0，该物理分支仍unverified。随后tmux实例收到F6/editor、pause与更新，但初始小窗口截图缺少底部内容。原版全屏也出现相同现象；原生Zoom后完整可见，恢复小窗口又复现缺失。没有确定应用/控制/尺寸链路的根因，没有归因补丁产品错误。
- 首次tmux attach漏传LANG，client_utf8=0，已知中文显示成下划线而实际editor事件保留中文。用自己的客户端重新attach，显式LANG=en_US.UTF-8并带-u后client_utf8=1，原草稿中文随即可见。不是修改字体或产品。detach初次错误地按PID指定target，退出1；改为自己的tty后成功。重新attach前还需重聚焦Terminal input，未把未进入shell的命令记为成功。
- 原版普通模式清草稿时Ctrl+U只清光标前内容，留下bc，导致一次 `/quit bc` 作为faux prompt执行。公开request保留，随后Ctrl+C清空并正常quit，没有文件工具副作用。
- CUA侧尝试导入sharp因其package.json import不受支持而失败，随后截图衍生检查统一使用codex-py312/Pillow。一次未带--no-capture-output的Conda stdin脚本未处理内容，已纠正；它不涉及产品或剪贴板。原始截图保存字节为JPEG，早期文件扩展名为.png；image-metadata.json记录真实格式，未伪称无损PNG。
- 部分准备与纠正动作按工具记录重建顺序，没有精确起止时间或各短命shell/pnpm父进程PID。长生命周期Pi、wrapper、共享driver/PTY、tmux server/pane/client、receiver与自己的login/zsh有独立身份记录；没有覆写首次Pi PID。GUI图与只读tmux文本快照分别留证，不用后者替代像素。

32列regular旧shared tui入口在Pi header前还出现字面终端能力/颜色查询响应，例如CSI/OSC回复。截图56/59及原始terminal.ansi保留该启动显示异常，40列fullscreen当前视口的截图73未显示这一前缀，结束后共享doctor通过。它不属于用户草稿，也未证明来自产品renderer，交主代理判断是否需要Astra high修复共享交互运行时。本轮没有修改或隐藏这些输出，旧入口保持部分物理通过。

没有prompt的直接实例未持久化session文件，start事件中的session路径只是预定位置；search和含误提交prompt的原版regular有真实session。旧skill两个来源会话及恢复后请求均实际持久化。

## Coverage and remaining boundaries

全部58个累计ID见JSON，54项沿用passed，本轮只添加其明确子证据。以下4项仍unverified，没有verified-unreachable或自行豁免。

- interaction-physical：本轮补丁全屏动态复制、可见窄列和搜索替代键通过；默认搜索键、普通模式与原版选择复制、完整regions组合及真实图片像素未齐。
- ui-composer：本轮32列regular、40列fullscreen的部分两主题/session/拖选通过；其余组合和选区字节比对如上。
- interaction-network：没有指定远程provider/model、凭据和费用范围，未读取用户auth或发送付费请求。
- ui-interrupted：真实Esc精确命中Write/Edit filesystem await仍缺可观察、可控制阶段，没有抢时序或用Bash取消代替。

## Cleanup and delivery

七个本轮直接Pi实例、两个旧skill的driver/PTY及receiver均停止。最终逐个读回37个记录PID，ps均退出1、监听查询均退出1且无输出；本轮路径进程扫描为空，自己的ttys003无进程。正常quit先归档各agent/workspace/session到artifacts再删除runtime，两个共享helper也已删除scratch和锁。

tmux kill-server退出0后仍有自己的socket文件。首次清理因此保持不完整，保留cleanup-initial.json；随后连接探测失败且lsof无持有者，确认server/pane/client PID均已停止，再移除该陈旧socket及自己的tmux HOME/TMP，最终cleanup通过。仅关闭本轮Local Terminal (1)，AX确认标签移除，原有Local Terminal保留；原窗口尺寸已恢复，用户原型、全局安装、消费者和旧证据保留。

全局Pi入口SHA-256仍为 `f04afd35fb16a3647b49ebb4bb67cbccba10a64fc6b5d1d5dfdd320e4f4ef331`。hooks:check及正常commit gate通过情况以提交记录为准。本轮没有新的产品代码，未运行CRAP/重复/变异或全量check。交付仅两份报告，#66的Execution/Delivery/Verification更新结果，Acceptance留主代理。
