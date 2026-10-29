# Network and multiline verification

## Result

累计 **54 passed / 0 failed / 4 unverified**，整体仍为 unverified。真实联网 `interaction-network` 新增完整通过；旧 `ui-reply-markdown` 的原始剪贴板字节结论更正为 unverified。计数相同来自两项相反的状态更新，不能解释成没有新增证据。

普通/全屏真实 Working、估算速率、等待过期和 settled 隐藏通过。全屏 composer 三行真实系统粘贴为 85/85 字节，匹配预先定义的 CR 传输预期。普通 native 三行两次严格接收均被拒绝，未知内容没有保存或回显。两模式滚动有真实视口变化，默认搜索键仍未送达。

## Scope and provenance

- 基准 HEAD c7fc3e087f4f77c8b3c666279e4d815bcb6f312e，分支 adventure/pi-animation，仅本 worktree，独立 gpt-6.1-sol/high，无子委派。只更新证据和 progress。
- RUN `.tmp/network-multiline-66-DtvbtG`，Termius 9.41.1 实际从 Info.plist 读回。Node v22.22.2、pnpm 11.9.0、Pi 1.4.0、Python 3.12.13。指定新旧 skills、共享 README/RECIPES、manual 及政策均已读取。
- 新旧及消费者 doctor 通过；49份继承来源、399份artifact逐项核对。仅两份已知 Paste transport 文档哈希变化，与本轮基准提交一致。两消费者各32个 JS 与当前 dist 一致，tarball SHA256 `03058ebfa8f11a6f2f554cf93c61919eb40bcc6544382cd8b70305daefdedd0d`。
- 本轮没有 build、pack、完整 check、CPU、旧 CLI 或 Working 全矩阵。205文件/2958测试是继承结果。实际调用 doctor、正式共享 tui codex-ui 两模式，以及生产消费 CLI 的联网和自己历史恢复入口。

## Real network journey

用户明确授权 Pi 的 openai-codex/gpt-6-luna、thinking medium、不设费用上限，允许使用现有 Pi 登录。两个独立实例各一次用户任务，模型各两次远程响应，合计4次；只开放 bash，prompt和附加系统提示均限定唯一工具命令 sleep 5。没有其他 provider、文件读取或工作区外模型工具命令。两个真实工具均 exit0，耗时普通5038ms、全屏5016ms。后续两次自己历史恢复没有新增模型请求。

| Mode | Task start / settled, UTC | Actual observations | Reported usage |
| --- | --- | --- | --- |
| regular | 11:50:46.815 / 11:51:08.677 | 02开始，03 Working 3s/≈43 t/s，04/05等待8s/-- t/s，06正文推进，07结束隐藏 | input2333/output1161/reasoning65；total3494 |
| fullscreen | 11:51:49.517 / 11:52:08.985 | burst044 ≈4，060 --，080 ≈18，100 ≈69，130 ≈91，169 ≈97 t/s；10结束隐藏 | input2216/output901/reasoning0；total3117 |

普通 provider 只有 thinking start/end，未收到 thinking_delta；全屏没有 thinking 内容事件。不能据 usage.reasoning65 推断可见或隐藏思考正文。速率证据来自实际正文和工具参数推进，不把最终 usage 当短窗口采样。模型报告 cost 总和约 $0.0014859，只是模型目录的费用估计，不是账单实扣证明。两个实例正常 /quit、exit0，session、工具结果与公开事件保留。

认证仅在进程内读取现有 auth.json 的 openai-codex 记录，复制到0600隔离 auth.json；无用户 session/history/settings。认证未输出、未截图、未归档或hash，退出后删除认证及整个 runtime；本轮404份文件对当前认证值的进程内审计匹配数0。初次启动误从隔离 shell HOME 找认证，在复制前失败，保留失败并用新 r2 入口纠正，没有把它当网络失败或追加付费请求。

## Paste and selection

同一 Termius 的校准先 pbcopy 写入已知 LF 样本，再真实 super+v/Ctrl+D 到未修改 receiver.py。LF预期 exit1，无actual；预先定义CR预期 exit0，24/24字节。两次termios恢复。此前报告文字称22字节与其JSON/文件不一致，实际 `T66_PASTE_A\nT66_PASTE_B\n` 为24字节；本轮按实际字节记账，不覆写旧证据。

三行源草稿在选择前固定，源LF SHA256 `ac558cfc92f756fe44f14b56156572ff14f86fa6b750690b8e811c00b94bff40`。只按已证明的 LF→CR 预先导出传输预期，85字节，SHA256 `18bdb00960c7aa8c58abf456bc79560601019c4ee1088e9371354c81c5c4eedc`。源、传输预期和实际文件分开保存，没有从actual反推、trim、补空格、删prompt标记或改写actual。

| Entrance | Real copy path | Strict result |
| --- | --- | --- |
| shared regular213 | Termius native drag + super+c | REJECTED，exit1，无actual |
| shared fullscreen213 | 隔离fullscreenCopyOnSelect=true，宿主反色及Copied! | MATCH，exit0，85/85，实际SHA256与CR预期相同 |
| new production regular213 | 新隔离入口、显式聚焦，预先写不同哨兵；native drag + super+c | REJECTED，exit1，无actual，停止该尝试 |

复制至接收结束仅用ASCII typeText启动receiver，真实super+v/Ctrl+D，无app.paste、getter或远程粘贴。全屏通过证明文字、空格及换行结构经已校准通道一致，不证明剪贴板原始LF/CR。普通失败根因未定位为产品或驱动；不能以全屏成功或单行旧结果推断普通三行通过。

## Copy observation audit

旧 `capture-paste.mjs` 只注册process.stdin data/end，没有raw设置或输入flag捕获。旧RUN没有可排除ICRNL的termios/stty证据。当前实测LF→CR与canonical可能的CR→LF组成有损观察通道，最终LF文本完全相同不足以证明原始剪贴板的LF/CR区别。

旧185/191字节文件、首尾空格和末尾LF、当前会话各段正文连接相等及已修复的trim行为证据全部保留；收窄的是原始字节结论。按旧skill未放宽的逐字节要求，ui-reply-markdown整体回到unverified。没有改旧证据或receiver。

## Scroll and input boundaries

普通终端52/53由自己的旧Pi正文开头回到当前末尾，证明Termius原生scrollback可用。全屏44/45在生产transcript中从header及首段移动回末尾，滚动条和Jump to latest message可见。CUA本通道down进入旧历史、up返回新历史；既有单方向无变化不能证明滚轮不可用。普通scrollback可包含本轮更早输出，不宣称它是宿主管理的历史滚动。

默认Ctrl+Shift+F没有overlay。真实Pi加载纯观察器后，该键无terminal_input字节；同一观察器随后收到完整T66_KEY_PROBE及03，证明观察器有效。未修改键位，未把旧Ctrl+F替代绑定计为默认搜索。新history实例初次出现原cwd已删除的Continue提示，39–42是在ready前的动作，排除为产品滚动/搜索通过证据；确认隔离cwd并取得43后才使用44–49。

Termius图片仅继承textfallback/Kitty协议范围，图片像素仍缺真实支持协议的获准终端，不访问已拒绝的Ghostty，不伪造TERM_PROGRAM。Write/Edit精确await取消仍没有可观察、可控制阶段，保留原边界，不抢时序。

## Verification IDs

下表继承项指已核对的上一轮链，完整路径和hash见[JSON](network-and-multiline-verification.json)。

| ID | Result | Basis |
| --- | --- | --- |
| `region-independent` | passed | 继承已核对证据；本轮未重跑。 |
| `region-edit` | passed | 继承已核对证据；本轮未重跑。 |
| `region-lifecycle` | passed | 继承已核对证据；本轮未重跑。 |
| `region-original` | passed | 继承已核对证据；本轮未重跑。 |
| `working-stream` | passed | 继承已核对证据；本轮未重跑。 |
| `working-permission` | passed | 继承已核对证据；本轮未重跑。 |
| `working-cancel` | passed | 继承已核对证据；本轮未重跑。 |
| `working-recovery` | passed | 继承已核对证据；本轮未重跑。 |
| `working-replacement` | passed | 继承已核对证据；本轮未重跑。 |
| `interaction-focus` | passed | 继承已核对证据；本轮未重跑。 |
| `interaction-transcript` | passed | 继承已核对证据；本轮未重跑。 |
| `interaction-image` | passed | 继承已核对证据；本轮未重跑。 |
| `interaction-physical` | unverified | 普通终端与全屏鼠标历史双方向有视口变化；全屏三行宿主复制85/85 CR传输字节；默认搜索在真实Pi输入观察器中没有字节。 |
| `interaction-network` | passed | 普通/全屏真实 openai-codex/gpt-6-luna medium，各一次用户任务及两次远程响应；Working、≈速率、无输出过期、settled隐藏及退出清理。 |
| `cpu-dynamic` | passed | 继承已核对证据；本轮未重跑。 |
| `cpu-normal` | passed | 继承已核对证据；本轮未重跑。 |
| `cpu-native` | passed | 继承已核对证据；本轮未重跑。 |
| `cpu-equivalence` | passed | 继承已核对证据；本轮未重跑。 |
| `install-patched` | passed | 继承已核对证据；本轮未重跑。 |
| `install-original` | passed | 继承已核对证据；本轮未重跑。 |
| `install-published` | passed | 继承已核对证据；本轮未重跑。 |
| `install-isolation` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-header` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-composer` | unverified | 共享全屏固定三行85字节内容和换行结构经已校准通道一致；普通native两次REJECTED，无actual文件。 |
| `ui-status` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-theme` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-resize` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-user-markdown` | passed | 继承已核对证据；本轮未重跑。 |
| `ui-reply-markdown` | unverified | 独立审查旧canonical接收器；185/191字节内容、首尾空格和尾LF文件证据保留，撤回原始剪贴板LF/CR完全一致的推断。 |
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
| `ui-interrupted` | unverified | 未抢时序；继承 Bash 取消及受控执行层测试范围。 |
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

## Execution limits

报告生成脚本首次因模板字符串转义语法错误未执行，纠正后生成并逐项核对；不涉及产品或验证结果。

初次无回车typeText探针显示重复a，paste探针正确，清空后才执行。后续ASCII typeText实际正确并留屏。两次接收器就绪画面曾滞后，先只读PID/截图，滚动回最新输出确认READY后才paste，没有重复启动命令。

首次普通复制后Escape与Ctrl+C在同一批输入成为1b03，没有清草稿，/quit附在已知样本后提交到faux，未执行工具。再次独立/quit正常退出；复制内容仍由后续严格receiver判定REJECTED，不回避此控制错误。后来的生产普通入口把Escape/Ctrl+C分开，空草稿留屏后退出，但严格粘贴仍REJECTED。

全屏首次拖选未得稳定选区，重新聚焦自己的标签/终端后反色可见。Termius更新通知遮挡宿主右上角反馈，关闭该通知后重取明确Copied；没有更新应用或改全局设置。最终关tab后AX/截图短暂保留旧标签，原标签一次AX点击返回invalidUIElement；重新读取完整AX确认本轮标签已消失、原标签保留。

## Cleanup and delivery

31个记录PID逐一ps和TCP LISTEN lsof均exit1。四个生产Pi和两个shared driver/Pi均正常退出，无存活；直接runtime和临时认证目录删除，shared scratch自动removed，锁不存在。自己的login/zsh和嵌套shell退出，ttys003为空。没有启动tmux或监听服务。仅关闭本轮Local Terminal (1)，恢复2764×1724；原标签、全局Pi、用户原型、消费安装和旧证据保留。

原始RUN和两份shared证据保留，JSON索引记录404份本轮artifact及57份来源hash，认证文件与编译缓存排除。只提交本报告、JSON和progress，不push、不PR/merge/deploy。#66仅更新Execution/Delivery/Verification，Acceptance、Map、Spec及关闭交主代理。

## Continuation point

已授权的真实联网和可执行滚动补证完成。下一步需要定位普通native多行复制与默认键输入通道；原始/copy字节需要不转换的独立观察链；真实图片像素与Write/Edit精确await仍缺指定前置条件。当前没有可确认的产品或共享驱动新故障，也没有降低标准或接受豁免，#66仍未完成。
