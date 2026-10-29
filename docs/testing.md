# Testing

本文说明开发时选择哪组测试、各组覆盖什么，以及如何判断结果和清理是否完整。日常修改运行 `pnpm run check`；涉及 tmux、终端交互或宿主用量记账时，再运行对应的 Unix 验收入口。

## Setup

使用 Node.js 22.19+ 和 `package.json` 中指定的 pnpm 版本。Pi 相关依赖固定为 1.4.0，真实宿主检查使用仓库安装的 CLI，不使用全局 `pi`。

仓库通过 pnpm 自动应用 [Pi 会话摘要补丁](pi-session-summary-patch.md)。冻结安装必须包含根目录的 pnpm-workspace.yaml、patches 和锁文件；发布包的外部宿主不会自动继承这份补丁。

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile --ignore-scripts
pnpm run hooks:install
pnpm run hooks:check
pnpm run check
```

`check` 依次校验脚本入口与本地文档链接、扫描工作区密钥，再执行构建、扩展类型检查、搜索扩展类型检查、所有 TS 测试及夹具类型检查、离线测试、发布包检查和八个扩展的源码及 dist 加载检查。测试夹具引用了 `dist/` 中的模块，因此必须先构建，确保全新检出也能通过检查。`dist/` 由构建生成，不要手动修改。

`tsconfig.tests.json` 检查 `extensions/**/__tests__/**/*.ts` 和 `test-support/**/*.ts`，包含独立运行的宿主夹具。它同时读取被测试引用的 JavaScript 类型，但不对整个 JavaScript 脚本库启用 `checkJs`。Vitest 执行通过不能替代这一类型检查。

## Commit gates

`--ignore-scripts` 不会自动安装 hooks。首次检出后显式运行上述安装命令；安装仅设置本仓库的 `core.hooksPath=.githooks`。已有其他 hooks 路径或可执行钩子时，安装拒绝覆盖，需先整合。该配置由同一仓库的 worktree 共享，相对路径始终指向当前 worktree 的 `.githooks`；切换到未包含门禁文件的旧版本后，应运行 `hooks:check` 核实状态。

`pre-commit` 调用 `pnpm run check:staged`。它直接读取整个 Git index 中的 blob，检查以下内容，不修改暂存区或工作区，也不自动 stash、修复或增加提交文件：

- Secretlint 推荐扫描规则识别的 provider token、私钥、Basic Auth 和含密码的数据库连接串。测试、文档、`.env.example` 和锁文件同样扫描，源码中的 `secretlint-disable` 不生效。扫描整个暂存快照也覆盖 amend 时未改动的文件。
- 暂存版 `.gitignore` 排除的文件，以及明确禁止的本地配置、依赖、构建输出、日志和缓存。`.env.example` 可以提交，但仍检查其内容。个人全局 ignore 配置不参与这项判断。
- 冲突标记、未解决的 index entries，以及相对于 HEAD 的新增空白错误。历史空白错误无需在无关修改中清理。
- 暂存版 `package.json` 的脚本路径和 Markdown 本地文件链接。仅存在于工作区而未暂存的目标不能满足引用；删除引用目标也会失败。

符号链接只检查目标字符串，不读取链接指向的本地文件；gitlink 等不支持的条目会失败。检查结束时再次核对 index，期间若发生变化则拒绝通过。类型检查、测试和构建仍在交付前及 CI 中运行，不随每次 commit 全量执行。

`pnpm run secrets:check` 扫描工作区内的已跟踪文件和未被忽略的新文件。它用于开发时提前发现问题，不能替代暂存区门禁。`pnpm run secrets:history` 另行扫描本地所有 refs 可达提交中的完整文件版本，包括后来删除的文件；它不自动 fetch，也不覆盖 reflog 或不可达对象，不在每次 commit 时运行。

所有扫描离线运行，输出路径、规则、行列和命中内容的 SHA-256，不输出凭据值。扫描器缺失、规则配置损坏或内容读取失败均阻止通过。规则只能识别已覆盖的凭据特征，不能保证发现任意短密码、个人数据、编码或拆分后的秘密；二进制仅检查其中可直接识别的文本，不解压归档或识别图片、音频。扫描通过不表示这些内容已完成人工审查。

误报例外维护在 [secret-exceptions.json](../config/secret-exceptions.json)，必须同时匹配具体路径、规则、message ID 和命中内容哈希，并记录原因。现有例外仅用于合成 Basic Auth 测试。新增误报先核实来源，再添加最小范围例外；不要添加整个目录的豁免。真实凭据应移出文件并撤销或轮换，历史扫描的命中不能靠删除当前文件解决。

门禁自身的验证通过真实临时 Git 仓库运行，包括拒绝提交、部分暂存、首次提交、改名与删除、worktree、安装冲突、脱敏和 CI 失败汇总：

```bash
pnpm test test-support/__tests__/repository-gates.test.ts
```

Git 允许用户跳过本地 hooks；CI 会独立执行暂存快照检查。只有远端分支保护将汇总 `Check` 设为必需检查后，才能强制阻止失败合并。仓库中的 workflow 文件本身不会启用远端保护，配置前需确认账号套餐和管理权限。

## Test groups

| Command | Coverage | Prerequisites |
| --- | --- | --- |
| `pnpm test` 或 `pnpm run test:offline` | 单元测试、离线协议测试、合成 provider、部分真实 Pi SDK 会话；不运行四个 tmux 测试文件 | Node、pnpm |
| `pnpm run typecheck:tests` | 所有 TS 测试、TS 夹具和共享 helper 的静态类型 | 先运行 `pnpm run build` |
| `pnpm run host:check` | 八个扩展的源码与 dist 加载、固定宿主版本 | 先运行 `pnpm run build` |
| `pnpm run host:tmux:check` 或 `pnpm run test:host` | 生命周期、私有 tmux socket、生产启动配置、fish、认证来源、Fast Mode 继承和恢复；两轮各 13 个用例 | macOS 或 Linux、tmux、fish |
| `pnpm run host:accounting:check` | 根会话与子会话用量、provider receipts、终止状态及恢复 | macOS 或 Linux |
| `pnpm run host:pty:check` | 权限对话框、goal footer、goal tools、MCP 恢复、工具状态、搜索和记账界面 | macOS 或 Linux、Conda 环境 `codex-py312`、Python 3.12、pyte 0.8.2 |
| `pnpm run host:benchmark:check` | footer、MCP history 和输入响应性能检查 | 同 PTY；单独运行，避免其他测试争用 CPU |
| `pnpm run codex-compact:quality:check` | Python 评分、统计和证据校验的离线单元测试 | `codex-py312`、`scripts/codex-compact-quality-requirements.txt` |
| `pnpm run skill-mentions:acceptance` | 实际打包、安装、编译文件比对、所有入口导入及安装后的真实 CLI PTY | macOS 或 Linux、Conda、pyte；安装阶段可能访问包注册表 |

Unix 的 `host:*:check` 集成入口先重新构建，再串行执行组内命令。不要同时运行多个会清理 `dist/` 的命令。

安装 Python 依赖：

```bash
conda create -n codex-py312 python=3.12
conda run -n codex-py312 python -m pip install pyte==0.8.2 -r scripts/codex-compact-quality-requirements.txt
```

Conda 环境已存在时跳过创建。普通离线测试不需要 Python、tmux 或 fish。

## Focused runs

所有 Vitest 调用都通过隔离入口。直接执行 `pnpm exec vitest` 会被仓库配置拒绝。

```bash
pnpm test extensions/goal/__tests__/storage.test.ts
pnpm test extensions/subagent/__tests__/manager.test.ts -t 'closes'
pnpm run build
pnpm test --suite host extensions/subagent/__tests__/integration.test.ts
```

`offline` 与 `host` 是互斥的 Vitest project。默认组不收集宿主测试；显式选择 `host` 时自动启用它们并禁用文件并行。缺少必需的宿主工具应当失败，不能通过跳过用例得到绿色结果。

四个宿主文件仍各自负责协议断言和资源清理。`isolated-integration` 与 `production-integration` 根据 `PI_SUBAGENT_FIXTURE_DIST` 切换源码和 dist；生命周期测试使用源码 manager 与 dist 子扩展，Fast Mode 使用源码父会话与 dist 子会话。两轮通过不表示每个文件的每一层都分别执行了源码和 dist。

故障排查时可从组内某个命令继续：

```bash
pnpm run build
pnpm run host:pty:check --from tool-ui-driver
```

`--from` 会在 `summary.json` 中记录 `partial`，这不是整组验收通过的证据。

## Isolation and shared fixtures

`scripts/test.mjs` 与 Unix 宿主入口共用 `test-support/environment.mjs`。每次运行在仓库 `.tmp/` 下创建 HOME、agentDir、临时目录和 XDG 目录，只继承白名单中的系统变量与离线验收开关。AWS、OpenAI、Google 等外部凭据和用户 Pi 配置不会自动透传。

`test-support/pi-ui.ts` 提供完整的 `ExtensionUIContext`。测试只覆盖自己需要观察的回调；未声明的交互操作抛错，避免假 UI 静默吞掉新行为。`test-support/files.ts` 用独占临时文件加 rename 写入 JSON，读取方只会看到完整快照。对应测试覆盖并发读写及写入失败后保留原文件。

`test-support/wait.ts` 给整个就绪探测设置期限，探测 Promise 本身停滞时也会超时并取消其 signal。它用于 tmux 与 wrapper 夹具。

其他 fixture 应尽量使用真实的宿主接口和明确的类型。异构工具注册表可保留泛型；需要检查工具结果时先断言内容或 details 的实际形状。只有测试故意输入非法数据时才局部绕过输入类型，并注明原因，不关闭整个测试文件的类型检查。

默认测试使用合成 provider，不发送付费模型请求。`pnpm run pi14:live` 是单独的联网验收，会产生真实服务端用量，不属于 `check` 或默认 CI。

## Evidence and cleanup

Unix 宿主入口在 `.tmp/test-results/host-<group>-<id>/` 保存：

- `summary.json`：实际 Node/Pi 版本、前置工具版本、每条命令的退出码、完成状态和清理结果。
- `<index>.log`：该命令完整的 stdout 与 stderr，包含夹具输出的版本、协议断言及清理证据。

入口为每条命令设置 10 分钟上限，组内不自动重试。普通 Vitest wrapper 与 Unix 宿主入口拥有各自的进程组，正常退出或可处理的取消后检查进程停止，再删除隔离目录；无法确认清理时保留目录并失败。

PTY 子会话和私有 tmux server 仍由夹具负责清理。操作系统强杀、CI 强制终止或脱离进程组的进程不在 wrapper 的完整回收保证内。排查失败时查看夹具记录的 PID、socket 和端口，只清理该次运行明确拥有的资源，不使用全局 `killall` 或默认 tmux server。

单独的 skill 安装验收把合成证据保存在 `.tmp/test-results/skill-install-*`，入口会自动创建目录；CI 使用 `ci-skill-install-*` 前缀。日志、临时目录和测试夹具不进入发布包。缺少前置条件、跳过、部分续跑、取消或未验证清理都不能记录为完整通过。

## CI

支持范围为 Linux 和 macOS；原生 Windows 不受支持。部分运行与验收逻辑依赖 Unix 文件权限、进程组和 shell，不能用 Windows 测试启动成功来证明兼容性。仓库中保留的 Windows Job Object wrapper 也不构成平台支持承诺。

`.github/workflows/ci.yml` 在 Linux 和 macOS 上先检查提交快照，再运行完整的 `check`。空白检查比较 PR 基准或 push 的前一提交；手动触发和新分支 push 比较 HEAD 的父提交，无父提交时比较空树。密钥、路径和引用检查始终覆盖完整快照。

Ubuntu 另跑 tmux、accounting、PTY 三个独立 job，以及 Python 评分与 skill 安装 job，保留六个执行 job。另有固定名称的 `Check` 汇总 job，使用 `always()`，只有所有必需 job 成功时才通过；失败、取消、跳过或缺失都不能视为通过。增加执行 job 时，同步更新 workflow 的 `needs` 和 `scripts/check-ci.mjs` 的必需 job 名称。每个 job 有超时，同一分支的新运行会取消旧运行；执行 job 失败时仍上传日志，保留 7 天。性能基准与联网验收不进入默认 CI。

CI 配置与本机验证是两类证据。本机通过不代表另一平台已实跑；合并前查看远端对应 job 的结果。

## Maintained acceptance fixtures

各扩展的用户行为验证见 [Pi extension verification skill](../.cursor/skills/verify-pi-ext/SKILL.md)。该入口索引九个扩展的核心行为，提供隔离 CLI/PTY 驱动、证据保存和清理规则；包含未随包发布的 `codex-search`。每个行为单独记录实际覆盖状态，不能用一次 smoke 代替完整索引。

工具状态 PTY 驱动维护在 `extensions/codex-ui/__tests__/fixtures/tool-status/`；搜索驱动维护在 `extensions/codex-search/__tests__/fixtures/search-ui/`。它们加载当前生产 renderer，模型响应和外部工具结果使用离线 fixture。`tool-status:check` 和 `web-search:check` 是对应入口，均由 Unix PTY 组调用。

`pnpm run codemode:check` 覆盖生产调用树、真实 QuickJS、本地 MCP、普通与全屏 PTY，以及缓存预算和性能；不依赖视觉原型。Goal footer 使用 `goal:footer:check` 和正式 presentation 测试。

文本区域刷新宿主补丁另有[契约、干净安装、真实 CLI/PTY 与 CPU 入口](pi-text-region-refresh.md#verification)。示例及离线 provider 的类型也纳入 `typecheck:tests`。

## Archived quality evidence

质量评分函数及离线测试仍在维护。重建已有证据报告时必须显式给出输入和输出，输出父目录必须已存在且位于仓库内：

```bash
pnpm run codex-compact:quality:report --evidence .tmp/evidence.json .tmp/report.json
pnpm run codex-compact:quality:report --chain-evidence .tmp/chain-evidence.json .tmp/chain-report.json
```

这些命令不发模型请求；证据必须符合对应格式，已有且内容不同的输出会被拒绝。报告保留其原有版本和实验边界，不能作为当前宿主的新验收结果。

固定 Codex 版本的参考程序、参考向量和媒体重建脚本继续保留。版本值表示算法或语料的来源，不应批量替换成当前 Pi 版本。

## Reference

测试分组、独立宿主验收与共享 fixture 的组织方式参考 [t3code 的固定版本](https://github.com/pingdotgg/t3code/tree/1702d55214bdbae12278462e572b35e7c0eb4a46)。本仓库保留 pnpm、Vitest 3 和现有单包结构，没有引入 Vite+、monorepo 或远程缓存。
