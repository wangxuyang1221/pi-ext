---
name: verify-pi-text-regions
description: "Verify Pi 1.4.0 text-region refresh through real regular/fullscreen TUI journeys. Use for region API, Working/footer lifecycle, fallback, CPU budget, or patched/original installation changes."
---

# Verify Pi text regions

先读 [feature map](features/README.md)，选择本次涉及的全部入口。这个 skill 验证 [文本区域能力](../../../docs/pi-text-region-refresh.md) 和 [生产 Working/速率](../../../docs/codex-working-rate.md)，不新增产品 extension。旧 codex-ui 全功能验证由 [verify-pi-codex-ui](../verify-pi-codex-ui/SKILL.md) 负责。

## Launch

所有命令从当前 checkout 根目录执行。这里是短命 CLI，Launch 先构建，每次 Drive 再创建独立 PTY。不会保留共享服务，也不使用全局 `pi`。

```bash
pwd
node --version
pnpm_config_verify_deps_before_run=false pnpm --version
```

依赖缺失时按仓库 [Testing](../../../docs/testing.md#setup) 执行 `pnpm_config_verify_deps_before_run=false pnpm install --frozen-lockfile --ignore-scripts`，随后运行 `pnpm_config_verify_deps_before_run=false pnpm run hooks:install` 和 `pnpm_config_verify_deps_before_run=false pnpm run hooks:check`。保留锁文件、workspace 和 patches；不执行依赖构建脚本。pnpm 11 若仅因 ignore-scripts 的严格构建提示失败，记录错误后在同命令加 `--config.strict-dep-builds=false`。初次安装若涉及工作区外 hooks 配置，遵守当前会话授权。Python 使用 `conda run -n codex-py312 python`，依赖为 Python 3.12、pyte 0.8.2。

```bash
pnpm_config_verify_deps_before_run=false pnpm run build
mkdir -p .tmp
RUN="$(mktemp -d "$PWD/.tmp/verify-text-regions-XXXXXX")"
export RUN
node .cursor/skills/verify-pi-text-regions/scripts/doctor.mjs > "$RUN/doctor.json"
```

保留 RUN 的实际绝对路径；后续新 shell 用该值恢复，不能拿旧运行目录充当新运行。

Drive 的证据子目录必须尚不存在。PTY 驱动从空的 `runtime/home`、`agent`、`workspace` 创建所需设置、主题和 offline provider 计划，关闭缓存预热、版本检查和遥测，过滤凭据环境。初始没有历史、auth 或用户文件。首次 trust 提示由真实按键确认。示例 ready 为同一完整帧出现 `Region demo` 和 `Controlled example`；Working ready 为公开 `start` 事件及生产 `Goal:` footer。PID 已存在不代表 ready。不要同时启动会清理 dist 的构建或其他 UI 检查。

## Doctor

任何启动、画面、CPU 或安装异常，先运行只读 doctor，再查本次证据。默认检查当前仓库，安装旅程按其 feature 传入本次消费目录。

```bash
node .cursor/skills/verify-pi-text-regions/scripts/doctor.mjs
```

要求退出码 0、`ok=true`、实际 Pi 1.4.0、符合 package.json 的 Node/pnpm、Python/pyte、构建文件，以及 `regionApi.regular/fullscreen=true`。`--original` 要求两项均为 false，不接受混用。输出实际 CLI 路径及哈希、已解析包目录、extension 路径及哈希、revision 和 patch/lock 哈希。doctor 不安装、不构建、不创建运行数据，不读取远程凭据；它证明入口和前置条件，不证明应用已 ready 或 dist 与源码同步，后者靠 Launch 的成功构建及安装字节比对。

短命 PTY 的存活身份来自该次 `instance.json` 和 `events.jsonl` 中的 PID/session；结合 `ps -p <pid> -o pid=,pgid=,command=` 查实际进程。运行中还没有 `summary.json` 是正常的。不要接管其他任务的 PTY，也不要以相同版本号判断它属于自己。

## Drive

最小完整自证选生产 Working 旅程，含真实权限、shell 文件、取消、retry、compaction、模式切换、new/reload/quit：

```bash
conda run -n codex-py312 python scripts/local-refresh-pty.py "$RUN/working-regular" --working --cli "$PWD/node_modules/.bin/pi" > "$RUN/working-regular.log" 2>&1
```

按 [Working and lifecycle](features/working.md) 核对动作及副作用后执行 Cleanup。其他入口按 feature 文件运行。所有 PTY 证据目录用独立名字；失败重跑加新后缀，保留失败原件。不要在失败后只执行下一步并报告整组成功。

## Evidence

每个入口记录命令、开始/结束时间、外层命令退出码、feature ID、doctor 和 revision。PTY 的 `instance.json` 保存实际命令、PID、runtime 和空目录起点；`actions.json` 保存输入及 ANSI 字节位置，`terminal.ansi` 保存原始输出，`screens.json` 保存单元格状态/光标/颜色及完整帧标记，`events.jsonl` 保存公开会话/工具事件，`summary.json` 保存断言、CLI 退出码和清理状态。`artifacts/` 保留实际 workspace、设置和 session 文件，失败也保留已有结果。

外部 provider 和摘要通过既有生产接口替换；权限、输入、shell、取消、retry、compaction 和退出均走宿主。检查真实生成文件和取消后缺失的文件，不能只读终态截图。faux 速率证明事件到生产采样/显示的链路，不证明远程网络或模型准确 tokenizer。示例 `101 t/s` 类值是演示值。CPU 数据须新跑，协议和预算见 [performance](features/performance.md)。

物理终端像素、真实拖选、系统剪贴板和图片像素按 [interaction boundaries](features/interactions.md) 独立记录 `passed / failed / unverified`。pyte 和复制 callback 都不等于系统剪贴板。未满足前置条件必须写明缺项、尝试命令和可续验步骤；本关自证不代替 #66。

## Cleanup

每次成功、失败或可处理取消后都检查，不等整组结束。驱动先 `/quit`；失败时只 TERM 自己的进程组，5 秒后仍不退出才 KILL。保存证据后仅在进程组为空时删除本次 `runtime`。进程或清理状态不明时保留 runtime 并报告失败。

```bash
node --input-type=module - "$RUN/working-regular" <<'JS'
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const root = process.argv[2];
const summary = JSON.parse(readFileSync(`${root}/summary.json`));
const rows = execFileSync('ps', ['-axo', 'pid=,pgid=,stat='], {encoding:'utf8'}).trim().split('\n').map(line => line.trim().split(/\s+/));
assert(!rows.some(([pid, group, state]) => (pid === String(summary.pid) || group === String(summary.pid)) && !state.startsWith('Z')));
const ports = spawnSync('lsof', ['-nP', '-a', '-p', String(summary.pid), '-iTCP', '-sTCP:LISTEN'], {encoding:'utf8'});
assert.equal(ports.status, 1, `Listener query failed or found listeners: ${ports.stderr}${ports.stdout}`);
assert(summary.cleanup.processGroupEmpty && summary.cleanup.runtimeRemoved);
assert(!existsSync(`${root}/runtime`));
for (const name of ['instance.json','summary.json','terminal.ansi','actions.json','screens.json','events.jsonl','artifacts']) assert(existsSync(`${root}/${name}`), name);
console.log(JSON.stringify({pid:summary.pid, processGroupEmpty:true, listeners:[], runtimeRemoved:true, evidenceRetained:true}));
JS
```

对其他入口把参数换成其目录，保存输出到 RUN 的清理日志。`lsof` 不存在或执行错误不等于无监听。强杀导致 summary 缺失时，从 `instance.json` 取 PID/runtime，先核对 `ps` 身份及进程组，再只清理该实例；保留 ANSI/日志和失败现场，无法核对则停在未完成状态。不要按名称 kill、删除整个 `.tmp` 或动用户原型。安装消费目录与 CPU JSON 属于留证，不随 PTY runtime 删除；不删除任何旧证据。

## Helpers

- [doctor.mjs](scripts/doctor.mjs)：`node .cursor/skills/verify-pi-text-regions/scripts/doctor.mjs [--project <consumer-root>] [--original] [--extension <installed-index.js>]`，只读；带可执行权限，也可直接调用。
- [local-refresh-pty.py](../../../scripts/local-refresh-pty.py)：`conda run -n codex-py312 python scripts/local-refresh-pty.py <new-evidence-dir> --cli <bin> [--mode regular|fullscreen] [--original] [--kitty] [--working] [--extension <index.js>]`。复用现有 PTY；Python 直接执行的 shebang 也固定 Conda 环境。
- [local-refresh-install.mjs](../../../scripts/local-refresh-install.mjs)：`pnpm_config_verify_deps_before_run=false node scripts/local-refresh-install.mjs --pack`，生成本次安装根和 machine-readable 路径，见 [installation](features/installation.md)。
- [local-refresh-cpu.mjs](../../../scripts/local-refresh-cpu.mjs)：`node --expose-gc scripts/local-refresh-cpu.mjs --baseline=<original-pi-tui>`，完整参数与批次见 [performance](features/performance.md)。

没有常驻新服务或第二套 PTY。维护入口为 `/maintain-verification-skill`；本场 #65 已安排维护旧 codex-ui skill，#66 再独立验证新旧入口。
