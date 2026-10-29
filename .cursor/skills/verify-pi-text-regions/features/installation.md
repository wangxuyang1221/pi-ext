# Installation and fallback

用户可显式选择仓库固定 Pi 1.4.0 补丁宿主，也可在未补丁宿主加载正式包。原版保留 Working、速率和交互，缺少的仅是局部 CPU 优化；全局 Pi 独立。

## Sub-features

- `install-patched`：新消费目录冻结安装应用两个 pnpm patches，真实 CLI 可加载。
- `install-original`：同锁定依赖去掉 patch，能力缺失且正常回退。
- `install-published`：当前发布包安装后生产入口和构建 JS 字节一致。
- `install-isolation`：全局入口/文件保持原样，consumer 不自动继承 patchedDependencies。

## How to get to it (user POV)

仓库用户从锁文件及 pnpm-workspace.yaml 安装，显式运行 `node_modules/.bin/pi`；外部用户安装 pi-ext 包并加载其 codex-ui。需要补丁的 consumer 自己配置固定 patch，不因安装 pi-ext 自动获得宿主 API。

## Driving it with local-refresh-install

Preconditions:

- Launch 构建成功；pnpm store 已有锁定依赖。离线 miss 先记录缺包，按当前授权安装必要依赖，不默默换版本或运行依赖构建脚本。
- 本次 RUN 内保存全局 Pi 入口的只读路径/文件哈希快照。可用 `command -v pi` 定位，再对其真实目标读取 sha256；入口不存在则记 absent。不要调用全局安装/升级。

```bash
pnpm_config_verify_deps_before_run=false node scripts/local-refresh-install.mjs --pack > "$RUN/installation.json" 2> "$RUN/installation.stderr"
INSTALL="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).root)' "$RUN/installation.json")"
PATCHED_CLI="$INSTALL/patched/node_modules/.bin/pi"
ORIGINAL_CLI="$INSTALL/original/node_modules/.bin/pi"
node .cursor/skills/verify-pi-text-regions/scripts/doctor.mjs --project "$INSTALL/patched" --extension "$INSTALL/patched/node_modules/pi-ext/extensions/codex-ui/dist/index.js" > "$RUN/doctor-patched.json"
node .cursor/skills/verify-pi-text-regions/scripts/doctor.mjs --project "$INSTALL/original" --original --extension "$INSTALL/original/node_modules/pi-ext/extensions/codex-ui/dist/index.js" > "$RUN/doctor-original.json"
```

- **Install and inspect.** helper 创建新的 `.tmp/local-refresh-install-*`，复制清单/锁/patch，分别 `--frozen-lockfile --ignore-scripts --offline`。原版只去 patch 映射，依赖版本相同。核对两个 `lockUnchanged=true`、probe true/false；`--pack` 真实打包，再安装 tarball、再次冻结、逐字节比对七个生产 JS，要求 `publishedFilesMatch` 与 `publishedFrozenLockUnchanged`。保存 tarball SHA-256、安装日志、所有退出码。
- **Drive installed production.** 顺序跑四个入口，每次保留 stdout/stderr 和退出码，任何失败先 doctor 再 Cleanup：

```bash
for kind in patched original; do
  for mode in regular fullscreen; do
    extra=()
    if [ "$kind" = original ]; then extra=(--original); fi
    conda run -n codex-py312 python scripts/local-refresh-pty.py "$RUN/published-$kind-$mode" --working --mode "$mode" --cli "$INSTALL/$kind/node_modules/.bin/pi" --extension "$INSTALL/$kind/node_modules/pi-ext/extensions/codex-ui/dist/index.js" "${extra[@]}" > "$RUN/published-$kind-$mode.log" 2>&1
    printf '%s\n' "$?" > "$RUN/published-$kind-$mode.exit"
  done
done
```

- **Drive example compatibility.** 按 [regions](regions.md) 对两个新 CLI 的 regular/fullscreen 各运行一次；原版加 `--original`。示例不在发布包内，所以此项使用仓库示例，不能记为发布包示例测试。图片协议补证按 interactions。
- **Audit isolation.** 再次只读检查全局入口、目标文件哈希与原快照一致。安装目录保留自己的 HOME/cache/tmp，所有路径都从本次 JSON 导出；未创建全局设置，不更改默认 `pi`。
- **Cleanup.** 按主 skill 检查四个 PTY runtime 与 PID/进程组/监听；安装是短命同步命令，记录外层 PID/退出码，检查没有残留。本次安装根、日志、包和锁留作证据，不删其他安装目录。失败发生在 installation.json 输出前时，根据本次创建时间和日志确认唯一新根，保留它并报告失败，不借旧 installation.json 补位。

## Gotchas

`strict-dep-builds=false` 仅处理 pnpm 11 忽略构建脚本的提示，不授权执行依赖脚本。helper 的 pack 会运行仓库 prepack 构建，不能并发运行 PTY/其他构建。consumer 安装包不会自动继承 repo 的 patchedDependencies；原版 probe=false 是预期。doctor 检查包目录 API，真正 bin 是否进入补丁 runtime 由示例 `region API` 及实际 PTY 行为补证。CPU 的候选来自仓库而非安装目录，测前比较哈希。
