# Termius repair verification

## Result

本轮由独立 gpt-6.1-sol / high 执行，没有委派，没有修改产品、宿主补丁、共享驱动、断言或 CPU 预算。基准为 `6bd1c3e2071e9c020c2e7c8fde8b4621ffc800a4`。

四个补丁/原版 × regular/fullscreen 入口的草稿可读性修复均通过实机复验。生产 `/copy` 的四份真实系统粘贴均与 191 字节多段原文完全相等，首尾空格和末尾 LF 保留；前轮失败的同一 185 字节样本也得到 185 字节，哈希完全相同。

累计 **54 passed、0 failed、4 unverified**，整体仍为 `unverified`。新增完整通过 ID 为 `ui-reply-markdown`。`ui-composer` 的已知可读性失败已消除，但全部必要物理分支尚未补齐，因此由 failed 更新为 unverified。动态选区复制有失败尝试，最终因非样本粘贴停止，不能据此判定产品根因或宣称物理验收通过。没有使用 verified-unreachable 豁免，没有修改 Acceptance 或关闭 Issue。

[机器索引](termius-repair-verification.json) 更新全部 58 个 ID，分别记录本轮新增、沿用证据、实际入口、截图、文件、doctor、PID、退出和清理。原始根为 `.tmp/termius-repair-verification-66-20261029-r1`，旧报告和失败证据保留。

## Baseline and provenance

- cwd 始终为 `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/pi-animation`，分支 `adventure/pi-animation`，开始工作树干净；主 checkout 未改。
- 完整读取本 worktree 的 AGENTS、语言政策、提交政策、testing，以及两个指定 skill、feature map、working/installation/interactions/regions/layout、manual-terminal、旧 driver 和共享运行说明；实际调用两个 skill 的 doctor 与驱动。读取 unslop；诊断前另完整读取 ub-mode，没有新增或修改产品测试。
- Node v22.22.2、pnpm 11.9.0、Pi 1.4.0、Python 3.12.13。依赖独立，旧 skill doctor 的 independentCheckout=true、sharedDependencies=false、lockPresent=false。该 doctor 的 subagent socket 长度提示与本轮未运行的 subagent case 无关。
- 独立核对修复索引的 17 份来源和 157 份 artifact，174 个哈希全部匹配。全局 Pi 入口 SHA-256 前后均为 `f04afd35fb16a3647b49ebb4bb67cbccba10a64fc6b5d1d5dfdd320e4f4ef331`。
- 使用新消费安装 `.tmp/local-refresh-install-CzIw6h`。独立 check 构建后，两个消费者各 32 个 codex-ui JS 与当前 dist 逐字节一致，64 项全部匹配。tarball SHA-256 为 `03058ebfa8f11a6f2f554cf93c61919eb40bcc6544382cd8b70305daefdedd0d`。未重新 pack，没有用旧 eoWVvw 安装证明修复。
- 新消费 doctor 均通过，补丁 regular/fullscreen API 为 true/true，原版为 false/false。每个实际新实机实例启动前保存独立 doctor；恢复实例使用单独的 PID 和退出文件。

## Automated verification

独立运行 `pnpm_config_verify_deps_before_run=false pnpm run check`，退出 0，205 个测试文件、2958 项测试通过；发布包边界检查及八个扩展的 source/dist 加载通过，两组 loadErrors 均为 0。已有 MCP 命令替换 warning 保留在日志。没有重复完整旧 CLI、CPU 或旧自动矩阵。

两个 skill 本轮实际调用的主要入口如下。

```bash
node .cursor/skills/verify-pi-text-regions/scripts/doctor.mjs
pnpm_config_verify_deps_before_run=false pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
conda run -n codex-py312 python scripts/local-refresh-pty.py <new-evidence-dir> --working --mode <regular|fullscreen> --cli <CzIw6h-consumer-cli> --extension <installed-codex-ui-index> [--original]
pnpm_config_verify_deps_before_run=false pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run codex-ui
```

| Published entrance | Assertions | Result |
| --- | ---: | --- |
| patched / regular | 54 | passed |
| patched / fullscreen | 54 | passed |
| original / regular | 54 | passed |
| original / fullscreen, serial recheck | 54 | passed |

每个有效入口均核对完整旅程、公开事件、真实工具文件 `TOOL-FINISHED`、取消文件缺失、正常退出和逐实例清理。独立读回的 finished 帧均为完整 synchronized frame，无 Working、无速率、Goal 行保留。原版 fullscreen 的有效证据使用 `published-original-fullscreen-serial-recheck`；第一次同入口的功能通过记录保留，但不作为串行要求的有效证据。

旧 codex-ui skill 的正式 smoke 串行重跑通过，证据为 `.tmp/test-results/verify-codex-ui-DsnydK`，summary.status=passed、exitCode=0、cleanup=removed。它实际驱动生产 codemode 树、inspector、真实本地 MCP 及恢复等路径。修复轮的 CLI regular/fullscreen 各 139 项与 10 份逐进程 doctor 独立读回，作为已有证据保留，不冒充本轮新跑。

已有 Working/footer CPU 的八份来源与八份 raw 哈希均匹配，未重跑。原矩阵使用简化 editor；修复轮真实 CodexEditor 的三轮额外成本补测另行保留。后者仍是主代理自测，本轮只核对其来源和原始 artifact 连续性，没有将两类测量混合或写成新的独立 CPU 测量。

## Termius product journeys

仅使用文档化 CUA API 控制 Termius 的本轮 Local Terminal。实装 9.41.1，待升级提示 10.2.1 未安装。实际传入 `TERM=xterm-256color`、`TERM_PROGRAM=Termius`，未伪装 Kitty。窗口保持 2764×1724；实际启动读回 38 行、142 列。没有改终端全局配色或字体，没有操作远程标签、Hosts、Keychain、SFTP 或用户原型。

先在原本空闲 Local Terminal 进行无回车字符探针并 Ctrl+U 清空，再创建自己的 `Local Terminal (1)`。新标签执行禁 history 的隔离 shell，所有 Pi 的 HOME、agent、workspace、XDG 和 tmp 都在本轮 runtime 内；不加载用户配置或 auth。faux 仅替代模型边界，生产宿主、composer、renderer、session 和剪贴板路径实际运行。

| Entrance | Readability observations | Production copy |
| --- | --- | --- |
| patched / regular | codex-pi/light 三行中文和 ASCII、中间插入；实际文字及空白区拖选；冷恢复、new/fork/resume 部分组合 | 相同旧样本 185/185；恢复来源分支的多段样本 191/191 |
| patched / fullscreen | codex-pi/light 三行草稿、中间插入、文字及空白区拖选；codex new、light new/fork/resume | 191/191 |
| original / regular | codex-pi/light 草稿；codex 拖选；两主题的 new/fork/resume | 191/191 |
| original / fullscreen | codex-pi/light 草稿、中间插入；codex 拖选；两主题的 new/fork/resume | 191/191 |

四入口的深灰 composer 均已清楚显示浅色草稿。第一项对照可见 `06-patched-regular-readable-draft.png` 和 `16-light-real-draft.png`；其余入口见 29、33、41、47、54、60 等截图。实际拖选的选区与空白区域有截图，但这些截图不等于选区内容已实际粘贴比对。不能把上表的部分组合扩张为全部宽度、主题、会话和拖选组合均通过。

生产复制严格按以下路径留证：先用已授权哨兵覆盖剪贴板，实际提交 `/copy`，确认成功提示，正常退出 Pi，确认自己的 PID 已停止，再启动只接收 stdin 的 `capture-paste.mjs`。看到 CAPTURE READY 后用真实 `super+v` 粘贴，EOF 结束。没有 pbpaste、剪贴板 getter、callback 或文件原文替代粘贴，没有 trim 或换行归一化。

- 同一旧样本原文与实际粘贴均为 185 字节，SHA-256 均为 `999f50e3c7fb47d9a3aa5d16591583bc3d3b1defcdd1a07d8b4fa721c4903bf9`。
- 四份多段样本均为 191 字节，SHA-256 均为 `2ef7bf731ae44f83a08907826bd2cf5e432a9de44de10789a8676253bb2a75f3`。持久 session 中存在两个 text 段，原序连接与实际粘贴一致；首部和尾部都是字节 `20 20 0a`。
- patched regular 另构造不同的 fork 回复。新会话 `/copy` 报无可复制回复；来源会话与 fork 经原生选择器切换，恢复来源后实际粘贴为其 191 字节正文，没有复制 fork 的不同正文。截图 21–28、实际 session 和 comparison JSON 支持这一隔离结论。其他三入口不据相同内容样本单独证明不同回复之间的全部隔离组合。

## Regions and physical boundaries

补丁 fullscreen 的正式示例实际运行，挂载显示 region API。首次 pause 后，画面从 animation/footer `355/456`，经 animation 到 `356/456`、footer 到 `356/457`、both 到 `357/458`，证明独立和同时更新。公开 F6 editor 事件为 `draft-中文-aXbc`；F7 overlay 实际打开并关闭。

七条真实 History 请求生成 Response 0–6，Ctrl+Home 显示 Response 0，鼠标滚轮改变历史视口，Ctrl+End 返回 Response 6。区域高度、light 主题、stop/start、new 和真实 reload 有截图及 start/shutdown 事件。图片使用实际环境运行 `/fixture-image`，屏幕显示 `[Image: [image/png] 1x1]` 文本降级；移除后不残留该行。此结果只证明补丁 fullscreen 的实际文本降级，不证明 Termius 的所有协议能力，也没有图片像素通过证据。

以下分支仍缺证据或有失败尝试。

1. **Dynamic selection copy.** 第一次真实选中更新后的 `Region demo 193 / 1`，终端 `super+c` 后实际粘贴仍为哨兵。该按键不是 Pi 全屏选区的原生复制键，不能据此认定产品失败。doctor 后创建独立 copyretry 实例，观察 68→69 更新及最新选区，尝试原生 Ctrl+X，无明确成功反馈，随后尝试 Termius Edit → Copy。正常退出并实际粘贴后得到非样本内容。本轮立即停止该边界，删除原始粘贴和相关截图，不读取、转述或保留私人内容。没有证明产品或控制通道中的具体根因，也没有把失败尝试改成 passed。
2. **Physical search.** 实际 Ctrl+Shift+F 未打开搜索，随后输入的 Response 0 出现在 composer。doctor 通过。Pi 退出后，用既有 stdin receiver 只观察物理搜索键，再按 Return/EOF，文件只含 `0a`。该诊断不包含 Pi 运行时的协议协商，因此只能证明本次按键未到接收端，不能把它解释成已验证搜索，也不能确定是终端、快捷键处理还是 CUA 的原因。
3. **32/40 columns.** 自己标签的右键菜单仅观察到 Split horizontally，实际创建的是上下空分屏，随后 Dismiss；View 菜单未观察到纵向分屏入口。没有调整全局字体或伪造 stty resize。分屏期间缺少 stty 读回，不能从截图宣称列数。32/40 列及相应完整物理矩阵保持 unverified。
4. **Other regions entrances and image pixels.** patched regular、original regular/fullscreen 仅准备，未启动。非样本粘贴后停止物理验收并清理，没有再靠重复粘贴尝试推进。其 runtime 已归档并删除，不能作为入口通过证据。真实图片像素仍 unverified。
5. **Remote provider and exact cancellation.** 未指定远程 provider/model、凭据和费用范围，未读用户 auth 或发付费请求。Write/Edit 精确 filesystem await 仍无可观察、可控制阶段；没有采用抢时序或既有 Bash 取消证据豁免。

## Coverage

全部 58 个累计 ID 的状态及增量见 JSON coverage。53 个既有 passed 保留，其中 Working、安装等增加了本轮子证据；`ui-reply-markdown` 新增完整 passed。

| ID | Cumulative result | Remaining requirement |
| --- | --- | --- |
| ui-composer | unverified | 物理32/40列、全部宽度/主题/会话/拖选组合和选区实际内容比对 |
| interaction-physical | unverified | 动态选区系统复制、真实搜索、窄列、其余 regions 入口、图片像素 |
| interaction-network | unverified | 明确的远程模型、可用凭据及费用范围 |
| ui-interrupted | unverified | 真实 Esc 精确命中 Write/Edit 的可观察可控制 await 阶段 |

失败尝试与未验证分支均交主代理判断和安排后续，未自行接受缺口。四入口 `/copy` 修复通过不等于整场功能已经交付。

## Execution corrections and evidence limits

- 最初读取原版 fullscreen summary 时，该 PTY 尚未结束，收尾分析失败；同一 shell 随后误启动旧 smoke，造成短暂并行。已定向 TERM 自己的旧 wrapper，保留中断证据 `.tmp/test-results/verify-codex-ui-Sb7lcc`，不计通过。核对 wrapper/driver PID、进程组及目标命令已停止后清理其独立 scratch/lock，再串行重跑 smoke。原版 fullscreen 另在本轮结束前独立串行重跑完整54项，使用新目录和 doctor，不重用重叠运行证明串行要求。
- 第七次 History 的 app.paste 报 CUA `-10005` 粘贴冲突。公开记录只出现前六条合成请求；在任何进一步截图前清空未提交编辑器，F6 读回空字符串，再重做第七条。没有将控制错误归为产品丢字。
- 部分紧邻按键的截图仍是处理前画面。复制均重新取得明确成功通知，动态选择以另取稳定帧和再次推进的帧为准，没有用输入中的命令截图代替执行结果。
- 初始 check 的外层 PID 和精确外层起止时间未单独持久化，完整日志、退出文件和工具完成结果仍在。被主动中断的旧 smoke 没有保存其内部 fixture 子 PID，保留这一缺口及定向进程扫描结果。两个早期准备截图未保存裁剪前 raw 哈希，裁剪 PNG 哈希仍在；后续截图均有 raw 哈希、尺寸和裁剪坐标。
- 100 份主截图由真实截图字节裁去顶部90像素，保留本地内容。非样本粘贴相关截图及原始文件已删除并在索引排除；不提交远程标签信息。

## Cleanup and delivery

四个有效发布入口逐次核对 PID/进程组、监听、runtime 和必要证据。所有本轮实机 Pi 及接收器的15个记录 PID 均读回停止、监听为空；恢复实例没有覆写首次 PID。三个仅准备的入口归档后删除 runtime。自己的 login/zsh PID 85748/85749 在关闭本轮 Local Terminal (1) 后退出，ttys003 查询为空，shell-home 删除。原有 Local Terminal 空闲提示符截图与 AX 一致，远程标签、用户原型、消费者安装、日志和旧证据保留。

最终另核对26个记录PID和相关进程组，全部停止、无监听，验证锁不存在；全局Pi入口哈希仍相同。机器索引保留本轮与成功/中断smoke的396份artifact哈希。

只提交本报告和 JSON 索引，不 push、不创建 PR、不修改 Map/Spec/Acceptance、不关闭 Issue。执行结果整理到 #66 的 Execution、Delivery 和 Verification。整体仍待主代理审核未验证边界。
