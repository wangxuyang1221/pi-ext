# Text region verification skill creation

## Scope

Implementation #64，基于 `845fdc408a45feaf74745167a53991352bc22e15`，工作区为 `.scratch/worktrees/pi-animation`，分支 `adventure/pi-animation`。由当前唯一编码 worker 完成，没有再委派、推送、创建 PR、合并或部署。未修改产品行为、旧 codex-ui skill、父代理 progress/slices、Acceptance 或用户原型。

交付 [verify-pi-text-regions](../../../.cursor/skills/verify-pi-text-regions/SKILL.md) 及五组 feature。新的只读 doctor 检查实际 CLI、两 renderer 能力、固定版本、构建文件及来源哈希。复用正式 PTY、安装和 CPU 驱动；PTY 增加实例身份、输入对应 ANSI 字节位置、workspace/agent 证据归档，并在进程组未清空时保留 runtime。三个正式脚本增加 shebang 和可执行权限。没有复制 PTY 框架或引入新产品 extension。

完整读取了用户指定的 create-verification-skill 及 README/create-note/search 引用、ub-mode、writing-for-agents 及 SKILL-MECHANICS、write-todo-list、unslop；仓库 AGENTS、语言/提交政策、Testing、最新 #54/#55/#64、progress/slices、正式 API/Working 文档及 #61–#63 证据。执行计划仅维护在 Issue #64 Execution。

## Environment and isolation

实际 Node v22.22.2、pnpm 11.9.0、Pi 1.4.0、Conda Python 3.12.13、pyte 0.8.2。依赖已存在，先核对 hooks，不重装共享 hooks 配置。所有 pnpm 与提交命令使用 `pnpm_config_verify_deps_before_run=false`，Python 使用 `conda run -n codex-py312 python`。

本次原始资料有两个入口，均留在当前 worktree：

- `.tmp/create-text-region-verification/`：红灯/绿灯、类型检查、覆盖率、质量工具、完整 check、命令日志与本次 RUN 指针。
- `.tmp/verify-text-regions-bukMuU/`：按新 skill 生成的空目录自证、doctor、安装、PTY、真实副作用和清理证明。

每次 PTY 都创建新的 evidence 子目录，从新 HOME/agent/workspace 开始。`instance.json` 保存实际 CLI 参数、PID、runtime、开始时间与 `initialWorkspaceEmpty=true`。输入的 provider 响应和 compaction 摘要来自已有远程边界替身；真实宿主负责权限、shell、输入、取消、retry、自动压缩和退出。不是从内部 setter 设置 Working 状态。

## Self-proof

按新 skill 的 Launch 构建，运行真实只读 doctor，再执行 Working feature 的完整普通模式旅程。CLI 正常退出并完成 Cleanup，之后再次读取证据和工具文件。

```bash
pnpm_config_verify_deps_before_run=false pnpm run build
node .cursor/skills/verify-pi-text-regions/scripts/doctor.mjs
conda run -n codex-py312 python scripts/local-refresh-pty.py "$RUN/working-regular" --working --cli "$PWD/node_modules/.bin/pi"
```

`RUN` 为上述本次绝对目录，由 skill 中 mktemp 命令创建。首轮 `working-regular-red` 的 53 项产品旅程通过，但后置证据契约失败：清理后没有 `artifacts/workspace/tool-proof.txt`。这个有效红灯保存在 `evidence-red.log`，不能将首轮记为完整自证通过。驱动原来只在删除前断言实际文件，缺少可复查副本。

修复后新目录 `working-regular` 重新执行完整旅程，53 项检查通过，外层和 CLI 退出码均为 0。保留的工具文件内容准确为 `TOOL-FINISHED`；取消后的 `should-not-exist.txt` 不存在。设置副本的 `tuiMode=regular`，三个 session_start 和三个 session_shutdown 对应真实 new/reload/quit。公开事件另包括 11 个 agent_start、8 个 agent_settled、2 个 tool_execution_start/end、2 组 ui_prompt_start/end、1 个 overflow compaction 和 1 个 session_compact。

动作、ANSI、单元格/光标、spinner 帧/灰度、公开事件和实际 agent/workspace 副本分别保存在 `actions.json`、`terminal.ansi`、`screens.json`、`events.jsonl`、`artifacts/`。`side-effects.json` 是清理后的独立读回结果，`cleanup-working-regular.json` 确认 PID 10993 与其进程组不存在、监听为空、runtime 删除而证据仍存在。

故意传入不存在 CLI 的 `missing-cli` 入口，驱动和 CLI 均返回 1，仍保存 instance/ANSI/actions/screens/summary 与已有 agent/workspace，进程组空且 runtime 删除。该失败没有 events，因为真实宿主根本未启动；缺事件被如实保留，未补造成功记录。PID 11463 的检查与首轮 PID 9727 一并保存在 `cleanup-initial.json`。

## Installation verification

按新 feature 从本次源码执行 `local-refresh-install.mjs --pack`，创建新安装根 `.tmp/local-refresh-install-VfmMYy`。没有引用先前个人安装路径。补丁/原版冻结安装与再次冻结安装均通过，锁文件字节未变，七个发布生产 JS 与本次构建逐字节一致。两个 probe 分别为 true/false；doctor 对实际两个消费目录均通过，记录实际 bin 与包目录。全局 Pi 入口与目标文件采用只读哈希快照比对。

本次 tarball SHA-256 为 `8469325ca95bf53ccfce46aef45c7dedd4c3a57d1a0986fd1b06b6f3f1cfa7e1`。与 #63 相同是产品包内容未改的结果；安装和下述旅程是本次新运行，不引用旧通过结果。安装日志、tarball、锁文件和副本保留在本次安装根。

新增原版发布入口 `published-original-fullscreen` 使用本次原版 bin 与已安装 codex-ui，完整 53 项 Working 旅程通过，退出码 0，PID 14961 退出且 runtime 删除。它验证 doctor 的原版分支和安装后实际降级路径。此次没有宣称四个发布组合全部重验，完整矩阵仍按新 skill 留给 #66。

## Quality and regression

- doctor 初始 CLI 测试在 helper 尚不存在时失败，随后真实入口/版本/API、错误 project/extension/flags 检查通过。最终 10 项定向测试覆盖 Node 22.19 边界及更高/不支持版本，缺失目录不会被创建。离线单测仅替代 Conda 版本查询，避免日常 `pnpm run check` 依赖 Python 安装；真实 doctor 自证使用实际 Conda、pyte 和两个宿主。
- 首次 Vitest 覆盖率因默认排除 `.cursor` 得到空报告；显式 include/exclude 后重新采集 LCOV。新 helper 行覆盖率 94.11%、分支 93.75%、函数 100%；未覆盖的 CLI 顶层输出/错误包装由真实 CLI 自证执行，不伪记成单测覆盖。crapper 从有效 LCOV 得到最高 CRAP 3，其他新函数为 1–2。
- dryer 的当前版本不识别 `.mjs`，第一次明确输出 `No source files to analyze`。随后对逐字节相同的临时 `.ts` 副本检查 doctor，另检查正式 Python 驱动，0.8 阈值未发现重复。没有把第一次空分析当成功。
- mutator 对新 doctor 的 11 个位置全部 killed，0 survived、0 uncovered。使用独立 Vite configLoader runner、禁用缓存和单 worker；保留 baseline 与每个变异的测试输出，核对失败来自对应行为断言。没有用导入/构建失败计作 killed，也没有等价变异需要伪造结论。
- PTY 的本次变更是身份/留证及清理块，没有新增复杂函数。现有 send 圈复杂度 1；crapper complexity-only 报告保留旧 pump 的 CC 10，Python 覆盖率/CRAP 未采集，未对整套旧 PTY 声称全覆盖或全量变异通过。新留证通过真实红灯→完整旅程重跑及失败启动清理检验。
- `typecheck:tests` 通过。最终 `pnpm run check` 通过，结果见下节。

## Action log

1. 核对 worktree/分支/HEAD 与干净状态，完整读规则、skills、Issues、最终源码入口和旧证据，避免在默认主目录修改或重做产品实现。
2. 在 #64 Execution 写唯一执行计划，确定五组 feature，识别只读 doctor 和清理后副作用证据缺口。
3. 先写 doctor 的失败入口测试，新增最小诊断脚本；保留真实版本/API 错配的拒绝行为，抽出 Node 版本边界供正常测试验证。
4. 写 Launch/Doctor/Drive/Evidence/Cleanup/Helpers、五个严格四 H2 feature 和独立物理终端续验说明，指向现有正式驱动。
5. 从新空目录实跑生产 Working，证据留存红灯后只改 PTY 留证/身份/清理，重新完整运行并核对真实文件和取消无副作用。
6. 以无效 CLI 验证失败时仍留证并清理；对所有已记录 PID 及进程组查询监听和存活。
7. 先读取质量工具 help，再执行 coverage/crapper/dryer/mutator。修正覆盖率路径及 dryer 扩展名适配，保留初次无效报告，限定质量结论范围。
8. 一次文档编辑命令因嵌套 heredoc 同名而在 shell 解析阶段失败，未写入文件；改用独立 delimiter 后核对生成命令中的 PID 转义。新打包、干净安装两个宿主、真实 doctor、原版发布入口完整旅程；保留本次安装与全局 Pi 只读快照。
9. 核对文档链接与类型，运行完整 check、整理原始路径/限制及 Issue Delivery/Verification，提交仅本关产物，不推送。

## Final checks and cleanup

完整 `pnpm run check` 返回 0，204 个文件、2951 项测试通过，构建/类型/文档链接/密钥扫描/发布边界及八个扩展 source/dist 加载均通过。既有 MCP 命令替换提示仍在，loadErrors 为 0。日志为 `.tmp/create-text-region-verification/check.log`。

[机器可读索引](create-text-region-verification.json) 保存本次 doctor、安装结果、原始路径、来源哈希、各旅程结果和清理状态。四个 PTY PID 9727/10993/11463/14961、安装 PID 13596、完整 check PID 17638 均已退出，针对记录 PID 的 TCP LISTEN 查询为空；PTY 进程组空且自身 runtime 删除。变异 worker 目录为空，质量报告与覆盖率已归档到本次证据目录，只删除本次生成的 coverage 子目录。

原始证据、失败记录、工具文件副本和本次安装根继续保留。没有启动常驻服务；没有按进程名清理或删除其他任务目录。全局 Pi 路径/真实目标/文件哈希前后一致，用户原型未操作。

## Boundaries for independent verification

本关证明新 skill 可实际驱动完整用户旅程，不代替 #65 旧 codex-ui 全 feature 维护或 #66 独立最终验收。没有执行这两关，也没有更新它们的 Acceptance。

CPU feature 精确映射最终生产 Working/CodexFooter/TokenRate 与真实 AgentSession 历史成本：两模式、120×40、0/200/1000 对、50 帧预热、三轮 7×320 帧交替、全部 user/system/字节/哈希、动态至少 30% 下降、正常/未用 API 额外不超过 max(10%,0.1ms/帧)，以及独立 32ms 原生补测。本关未重新跑完整 CPU 矩阵，不引用机制基准或 #63 的旧 CPU 通过结果冒充新测。

物理终端像素、实际鼠标拖选、系统剪贴板/图片像素、远程联网 provider 和精确 Write/Edit await 取消落点本关未验。manual-terminal 与 interaction feature 给出前置条件、隔离命令、操作和证据要求；缺权限、终端协议或凭据时必须报告具体 `unverified`，不能省略或自行标完成。没有修改全局终端设置或系统剪贴板。未发现需要改变既定产品行为的缺陷。
