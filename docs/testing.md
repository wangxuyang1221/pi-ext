# Testing

本文说明开发时选择哪组测试、各组覆盖什么，以及如何判断结果和清理是否完整。日常修改运行 `pnpm run check`；涉及 tmux、终端交互或宿主用量记账时，再运行对应的 Unix 验收入口。

## Setup

使用 Node.js 22.19+ 和 `package.json` 中指定的 pnpm 版本。Pi 相关依赖固定为 1.4.0，真实宿主检查使用仓库安装的 CLI，不使用全局 `pi`。

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
```

`check` 依次校验脚本入口与本地文档链接，再执行构建、扩展类型检查、搜索扩展类型检查、所有 TS 测试及夹具类型检查、离线测试、发布包检查和八个扩展的源码及 dist 加载检查。测试夹具引用了 `dist/` 中的模块，因此必须先构建，确保全新检出也能通过检查。`dist/` 由构建生成，不要手动修改。

`tsconfig.tests.json` 检查 `extensions/**/__tests__/**/*.ts` 和 `test-support/**/*.ts`，包含独立运行的宿主夹具。它同时读取被测试引用的 JavaScript 类型，但不对整个 JavaScript 脚本库启用 `checkJs`。Vitest 执行通过不能替代这一类型检查。

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

入口为每条命令设置 10 分钟上限，组内不自动重试。普通 Vitest wrapper 与 Unix 宿主入口拥有各自的进程组，正常退出或可处理的取消后检查进程停止，再删除隔离目录；无法确认清理时保留目录并失败。Windows 普通测试使用 Job Object。

PTY 子会话和私有 tmux server 仍由夹具负责清理。操作系统强杀、CI 强制终止或脱离进程组的进程不在 wrapper 的完整回收保证内。排查失败时查看夹具记录的 PID、socket 和端口，只清理该次运行明确拥有的资源，不使用全局 `killall` 或默认 tmux server。

单独的 skill 安装验收把合成证据保存在 `adventure/evidence/skill-install-*`；CI 使用 `ci-skill-install-*` 前缀。日志、临时目录和测试夹具不进入发布包。缺少前置条件、跳过、部分续跑、取消或未验证清理都不能记录为完整通过。

## CI

`.github/workflows/ci.yml` 保留 Linux、macOS、Windows 的 `check` 矩阵。Ubuntu 另跑 tmux、accounting、PTY 三个独立 job，以及 Python 评分与 skill 安装 job。每个 job 有超时，同一分支的新运行会取消旧运行；失败时仍上传日志，保留 7 天。性能基准与联网验收不进入默认 CI。

CI 配置与本机验证是两类证据。本机通过不代表 Linux 或 Windows 已实跑；合并前查看远端对应 job 的结果。

## Maintained acceptance fixtures

工具状态 PTY 驱动维护在 `extensions/codex-ui/__tests__/fixtures/tool-status/`；搜索驱动维护在 `extensions/codex-search/__tests__/fixtures/search-ui/`。它们加载当前生产 renderer，模型响应和外部工具结果使用离线 fixture。`tool-status:check` 和 `web-search:check` 是对应入口，均由 Unix PTY 组调用。

`pnpm run codemode:check` 覆盖生产调用树、真实 QuickJS、本地 MCP、普通与全屏 PTY，以及缓存预算和性能；不依赖视觉原型。Goal footer 使用 `goal:footer:check` 和正式 presentation 测试。

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
