# Pi extension verification runtime

本目录提供共享运行入口，九个扩展各有独立 SKILL.md 和 features 索引。中文正文、英文标题与 metadata 遵循仓库语言规则。运行前读取受影响扩展的全部 feature 文件，完成后逐条标注状态。

## Launch

从仓库根目录执行：

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run metadata
```

Node 要求 22.19+，pnpm 按 package.json 的 packageManager。Pi coding-agent、ai、agent-core、tui 必须版本一致，当前固定 1.4.0。使用本地 node_modules 中的 CLI，不使用全局 pi。Python 使用 Conda 的 codex-py312，需要 pyte；subagent 还需要 tmux 和 fish。

Context7 未提供这个包的 1.4.0 版本文档，因此 CLI 参数依据已安装的官方 dist/cli/args.js，版本核验复用 scripts/pi-host.mjs。运行与隔离依据 [仓库测试说明](../../../docs/testing.md)。

每次 run 从空目录启动。共享 helper 复用 test-support/environment.mjs 的凭据白名单与目录隔离；所有配置、session、临时文件和证据都在仓库 .tmp 下，不加载用户的 HOME 配置和外部凭据。外层只负责运行与收集证据，生产工具、TUI、session 和文件操作由真实 Pi 执行。

## Doctor

```bash
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
```

这是只读前置检查，输出实际版本、CLI 路径、HEAD、gitRoot、工作区修改、构建入口及 pyte 可用性。independentCheckout=false 表示 Git 信息来自父仓库，此类副本的 repository:check 不能作为独立 checkout 检查。sharedDependencies=true 表示 node_modules 解析到其他目录，按下方并行规则处理。subagentSocket 给出当前宿主夹具最长已知 socket 路径的字节估计及系统上限；fits=false 时 subagent case 会在创建锁和进程前拒绝执行，须缩短工作区路径。它不证明其他临时 socket 一定可用。

Doctor 不证明 provider 认证有效，也不代替重新 build。lockPresent 表示已有验证占用固定证据文件名；只读取 .tmp/verify-pi-ext.lock 中的 PID/case，不启动第二个实例。

运行中查看本次 summary.json 的 pid、scratch、command，与操作系统进程核对；TUI 仍需等到 ready 事件、匹配提示或场景 driver 的就绪条件。不要只用进程存活判断可用。doctor 失败时先修复缺失依赖或构建，再 drive。

## Drive

统一格式为 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run <case>`，把 `<case>` 替换为下列名称。不要并行运行这些 case，也不要同时运行其他会重新构建 dist 或写相同 fixture 证据的命令。

| Case | Actual path and scope |
| --- | --- |
| metadata | 真实 CLI 的 /codex-metadata 查询、保存、重置和配置文件核对 |
| metadata-project | 隔离项目 --approve 冷启动、项目覆盖、reset 保留字段和非法版本拒绝 |
| fast | 真实 CLI 的 /fast on/off/toggle/无参数与落盘开关 |
| permissions | 真实 write 审批 Deny/Allow once、磁盘副作用、full 升级取消 |
| permissions-modes | 真实 print/json 拒绝和 RPC 客户端拒绝、取消/接受 Full access，核对文件字节 |
| goal | 真实 InteractiveMode 的 goal 工具卡片、状态和历史，生产 dist |
| goal-accounting | 仓库 host:accounting:check，四个真实宿主用量场景 |
| goal-footer | 仓库 goal:footer:check，原生/Codex footer 及两种 TUI 模式 |
| mcp | resume-ui-host.py --live --repeat 1，真实本地 stdio echo 与历史重开 |
| mcp-transports | transport-fixtures 与 integration，真实本地协议服务及边界断言 |
| subagent | host:tmux:check，两轮生产 root/child、角色、Fast 与生命周期 |
| codex-ui | codemode-pty.py，真实 QuickJS、本地 MCP、调用树与 /inspect |
| codex-ui-fullscreen | 上述场景的 fullscreen 入口 |
| thinking | thinking-pty.py，固定模型消息的真实 TUI 思考呈现 |
| tool-status | tool-status:check，多模式生产 renderer 的状态播放 |
| search | search-ui/smoke.py --restart，生产搜索 renderer 与固定外部结果 |
| search-resume | web-search:resume:check，普通/fullscreen/禁用时恢复历史 |
| search-references | 生产工具入口到本地 HTTP，跨会话引用、异步切换、冷恢复及原子保存；会话身份由夹具提供 |
| skills-resume | 真实 native CLI 的两次 /resume 与首次 --resume，含精确搜索、删除源文件后恢复；要求 Pi 摘要补丁 |
| compact | resume-runtime 与 repair-runtime，真实 SDK 会话、模型目录/HTTP 边界替身 |
| skills | 当前 checkout 的本地 pi install 与 native PTY，全程无需模型服务 |

最小全扩展验证依次运行 metadata、fast、permissions、goal、mcp、subagent、codex-ui、search、skills。每个扩展至少一条真实宿主旅程。它不会把九个完整行为索引全部自动执行。

### Parallel workspaces

并行任务各用独立工作区、dist、.tmp、锁和配置；优先使用真实 checkout/worktree，并分别安装依赖。复制目录没有独立 Git 清单，repository:check 可能因此失败，保留原始失败并标明环境原因，不能删检查绕过。

共享 node_modules 链接不是只读隔离。pnpm_config_verify_deps_before_run=false 只阻止重装依赖，Vitest 3.2.4 仍可能写 results.json，Vite 7.3.6 的默认 bundle loader 仍会写 .vite-temp。共享依赖副本在运行任何 Vitest 前，须仅在自己的副本中完成下列更正并保留 diff：

1. vitest.config.ts 顶层 cacheDir 设为该副本 .tmp/vite-cache 的绝对路径，test.cache=false；确认 offline/host projects 继承该配置。
2. 在该副本 scripts/test.mjs 的 vitest run 参数中加入 --configLoader runner，使 host:tmux:check 等嵌套 pnpm test 也使用它。仅对外层命令传 --no-cache 或设置环境变量不够。
3. 用已安装 Vitest 的 createVitest 解析 root/offline/host，保存并断言 cache=false、本地 cacheDir、configLoader=runner。未核验所有入口前不运行共享依赖测试。发现先前缓存写入时如实记录，不清理或回滚其他任务共享的缓存。

Unix socket 计入路径字节数；选择仓库内短路径，或在自己的夹具 wrapper 中 cd 到 socket 目录并使用相对 -S。保留原始失败和适配 diff，重新验证原断言。以上都不授权写到工作区外或使用用户默认 tmux server。

### Interactive journeys

需要补充本地命令或配置旅程时，通过执行工具的 `tty: true` 启动，例如：

```bash
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui permissions
```

其他有效名称是 codex-compact、openai-fast-mode、goal、mcp、subagent、codex-ui、skill-mentions、codex-search。启动输出给出本次 evidence 和 scratch。通过 PTY 发送真实命令和按键，输出包含实际终端画面。输入 `/quit` 退出，等待外层返回后再读证据。

交互启动加载该扩展及固定 faux provider，没有联网模型和默认 MCP server。普通输入返回 Verification response；包含 WRITE_PROOF 的用户输入请求真实 write 写入工作目录 proof.txt，工具结果之后返回普通回复。provider 只替换生产边界上的模型服务，记录实际 context 与工具结束事件。它不会自动生成特定 goal、搜索、远程 compact 或 subagent 编排序列。这些需要对应已有场景夹具或已授权的真实服务；缺少时报告 blocked，而不是把普通 faux 回复当成功。

skill-mentions 的交互入口启用隔离 agentDir 中的 skill 发现，创建种子后使用 /reload。codex-ui 的交互入口把仓库 codex-pi 主题复制到隔离 agentDir/themes，供 /settings 选择；不会写用户的主题目录。

需要 skill、settings、图片或历史作为前置条件时，只在输出的 scratch 里创建该 feature 要求的种子，并记录 seed 动作。若后续需要重开同一会话，须在本次 driver 的生命周期内重开；tui 命令退出后 scratch 会清理，不能拿一个新 run 验证旧状态的恢复。对这类旅程复用具备 restart/resume 的对应 case。

交互退出只会标记 manual-review-required。代理必须审查 action、terminal、文件与 feature 通过条件后，在证据目录另写 verdict.md；不能把零退出码当行为通过。

## Evidence

每次 helper 输出唯一目录 `.tmp/test-results/verify-<case>-<id>/`：

- summary.json 包含 command、版本、工作区修改、PID、退出码、状态和 cleanup。
- output.log 收集自动驱动的完整输出。
- commands.py 的旅程保存 journey.json、terminal.ansi、agent/sessions/workspace 副本，包含按键、画面、配置与工具结果。
- artifacts 保存本次新建或更新的 fixture 证据，包括 tool-status 的五模式 JSON 与最后一次 ANSI。每个 JSON 记录各状态画面；最后一次 ANSI 不能冒充全部模式的原始终端记录。某些旧 fixture（如默认 thinking 成功路径）只输出断言日志，额外截图、OSC 或持久恢复需专用驱动导出。

每条验收写出 feature/sub-feature ID、实际入口、动作、结果、证据路径与边界。状态使用 passed、failed、blocked、unverified。代码测试通过属于补充证据，不替代用户入口。截图或最终文件单独都不够，至少要能重建“做了什么以及发生了什么”。修改工具同时核对文件字节或 session 结果；需要否定副作用的分支核对目标文件未出现、server 请求次数未增加或 git refs 未变。

同一个 ID 的必要分支缺少证据时，整体记 unverified，同时列出已通过部分；存在失败分支则整体 failed。另列 unit、SDK、CLI/PTY、本地协议、远程服务等证据层级。旧报告中“passed 但部分分支未覆盖”的计数保留为历史，不能沿用为新的完整验收结果。SDK 直接调用恢复/导航不等于真实 /resume、/tree 选择器，进程重开后还应发送后续请求并核对上下文。

离线/测试模式只是配置，不是零副作用保证。本运行确实写隔离配置、session 和临时文件，也可能创建本地进程、socket 或 loopback 服务。metadata 脚本验证没有模型请求；权限脚本验证拒绝未写文件；subagent 的 fast 报告验证共享配置未被 child 改写。其余网络跳过范围按场景证据报告，不把 PI_OFFLINE 解释成禁止一切网络。正式 skill 安装验收可能访问 registry。

默认不继承真实凭据。联网压缩质量、provider priority 实际采用情况、实时网页搜索及第三方远程 MCP 服务都没有由离线证据证明。真实目标不会自带 faux provider、预置历史或本地 MCP fixture，这些是本次验证环境提供的前置步骤；需要另在真实目标上覆盖。

## Cleanup

helper 会在正常完成、失败和可处理的中断后回收自己启动的进程，删除自己的 scratch，保留 evidence。PTY 驱动负责其 fork 出来的 Pi；tmux 与网络 fixture 负责自己的 private socket/server。不要按进程名 kill，也不要操作用户默认 tmux server。

最终核对 summary.cleanup 为 removed、process.groupStopped 为 true，且 summary、日志和所需 proof 文件仍存在。对于带本地监听端口的 journey，还需读取 fixture 的关闭断言；如失败日志列出 PID/端口，用只读进程和端口检查确认，清理仍有不确定性则判 failed。无服务的命令 PTY 无需启动监听端口。

SIGKILL/宿主崩溃不能执行 finally。发生此类中断时读取锁、summary 与 fixture 中的 PID/socket/端口，核验身份后只清理该次资源。保留 evidence；清理未确认前不删除 scratch，不盲删锁继续运行。隔离并不意味着可以同时运行固定文件名的旧 fixture。

外层 timeout 或中断会先向自己的驱动发送 SIGTERM。新命令驱动会记录 Pi 退出；旧 fixture 若缺少这份确认，helper 保留 scratch 和锁并记录 cleanup=unverified，必须核验其分离的 PTY/tmux 进程后再清理。

## Helpers

verify.mjs、commands.py 和 permissions-modes.mjs 均带 executable 位。对外入口如下：

```bash
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run permissions
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run permissions-modes
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run metadata-project
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui permissions
```

commands.py 由入口传入 case、scratch 和 evidence，负责 PTY 按键与证据；permissions-modes.mjs 复用入口的隔离环境，驱动 print/RPC 并保存客户端消息；command-provider.ts 由真实 CLI 加载。通过 verify.mjs 运行这些内部驱动，避免缺少隔离环境。

## Maintenance

新增或删除核心行为时，同时更新各扩展 features/README.md、对应 feature 文件和 features.json。使用 `/maintain-verification-skill` 核验文档是否仍与实现一致。变更交付前运行 `pnpm run check`。
