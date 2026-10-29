# Manual terminal boundaries

本说明供 #66 在真实终端补验，不能由 pyte 结果替代。先记录终端名称/版本、系统、字体、尺寸、图片协议、可操作权限和剪贴板授权。缺任何对应前置条件，写 `unverified` 和原因，保留下面的续验入口。不能未经同意修改全局终端设置或系统剪贴板。

## Isolated launch

先执行主 skill 的 Launch/Doctor，恢复本次 RUN。以下创建本次专用目录，不复用用户配置。普通模式先运行，结束清理后用新的 `manual-fullscreen` 重复。

```bash
MANUAL="$RUN/manual-regular"
export MANUAL
mkdir -p "$MANUAL/runtime/home" "$MANUAL/runtime/agent" "$MANUAL/runtime/workspace" "$MANUAL/runtime/tmp" "$MANUAL/artifacts"
node --input-type=module - <<'JS'
import { writeFileSync } from 'node:fs';
writeFileSync(`${process.env.MANUAL}/runtime/agent/settings.json`, JSON.stringify({quietStartup:true, fullscreenCopyOnSelect:false, cacheWarming:'off', compaction:{enabled:false}, retry:{enabled:false}}));
JS
REPO="$PWD"
export REPO
```

在可交互的真实终端窗口执行下列命令。记录该窗口，不用后台管道代替物理终端。`sh` 记录自身 PID 后 exec 实际 CLI；它可能共享终端 shell 的进程组，人工清理只能针对这个已核实的 PID，不能 kill 整个终端进程组。

```bash
(cd "$MANUAL/runtime/workspace" && env -i PATH="$PATH" LANG="${LANG:-en_US.UTF-8}" TERM="${TERM:-xterm-256color}" COLORTERM=truecolor HOME="$MANUAL/runtime/home" TMPDIR="$MANUAL/runtime/tmp" PI_CODING_AGENT_DIR="$MANUAL/runtime/agent" PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 LOCAL_REFRESH_EVIDENCE="$MANUAL" MANUAL="$MANUAL" REPO="$REPO" sh -c 'echo $$ > "$MANUAL/pid"; exec "$REPO/node_modules/.bin/pi" --no-extensions --no-skills --no-prompt-templates --no-themes -e "$REPO/examples/text-region.ts" -e "$REPO/test-support/fixtures/local-refresh/provider.ts" --provider faux --model faux-1 --tui-mode regular')
```

全屏把最后 `regular` 改为 `fullscreen`；两次分别记录准确命令和退出码。图片验收在实际支持 Kitty 的终端，显式保留其已知 `TERM_PROGRAM`，不要在不支持的终端假装支持。原版改成本次安装所得 ORIGINAL_CLI，记录 `normal fallback`。生产 Working 的物理外观另用新的 `MANUAL="$RUN/manual-working-regular"`，重跑上方 mkdir 与 settings 初始化，然后执行下面准备命令。

```bash
mkdir -p "$MANUAL/runtime/agent/themes"
cp themes/codex-pi.json "$MANUAL/runtime/agent/themes/codex-pi.json"
node --input-type=module - <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
const file=`${process.env.MANUAL}/runtime/agent/settings.json`;
writeFileSync(file,JSON.stringify({...JSON.parse(readFileSync(file)),theme:'codex-pi'}));
writeFileSync(`${process.env.MANUAL}/plan.json`,JSON.stringify({kind:'stream',id:'manual-stream'}));
JS
(cd "$MANUAL/runtime/workspace" && env -i PATH="$PATH" LANG="${LANG:-en_US.UTF-8}" TERM="${TERM:-xterm-256color}" COLORTERM=truecolor HOME="$MANUAL/runtime/home" TMPDIR="$MANUAL/runtime/tmp" PI_CODING_AGENT_DIR="$MANUAL/runtime/agent" PI_PERMISSIONS_MODE=default PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 LOCAL_REFRESH_EVIDENCE="$MANUAL" MANUAL="$MANUAL" REPO="$REPO" sh -c 'echo $$ > "$MANUAL/pid"; exec "$REPO/node_modules/.bin/pi" --no-extensions --no-skills --no-context-files --no-prompt-templates -e "$REPO/extensions/codex-ui/dist/index.js" -e "$REPO/extensions/permissions/dist/index.js" -e "$REPO/test-support/fixtures/local-refresh/working-provider.ts" --provider faux --model faux-1 --tui-mode regular')
```

提交 `Generate visible thinking and text`，观察生产 spinner/反光/计时/速率与 goal 行，再 Esc 等待真正结束、`/quit`。全屏另用新目录，将最后模式改成 fullscreen。此处只验证物理显示，完整权限/retry/compaction 仍走 Working 自动旅程。

## Actions and evidence

1. 等真实画面同时有 Region demo 和 Controlled example。记录屏幕与终端版本，观察至少一个完整动画周期。输入中文草稿、移光标中间插入字符，调整 120/40/32 列，检查错行、抖动、输入遮挡。
2. 按 regions feature 提交七次 prompt。普通模式用终端滚动和选择；全屏用键盘/鼠标滚动，Ctrl+Shift+F 搜索。F7 overlay 后 q 关闭，焦点和草稿保持。选择静态与更新后的动态文本，记录选区前后截图。
3. 仅在剪贴板已获授权时执行系统复制，再粘贴到本次 workspace 文件。保存实际粘贴字节和目标截图，比对最新文字、中文、空格及换行。报告使用终端选择还是宿主 copy-on-select；后者如需启用，只改本次 agent settings，重新启动本次实例。普通/全屏分别验证，不以 callback 代替。
4. `/fixture-image` 后观察真实图片像素及周围动态行，放大截图核对 1×1 像素，不只记录协议。`/fixture-image off` 后无残影。终端不支持图片时只验证文本降级，图片像素保持 unverified。
5. `/settings` 切换模式，stop/start、`/new`、reload，再 `/quit`。记录动作时间、截图路径、事件文件和实际设置。每个入口单独给出结果及缺项。远程 provider 需另走有授权凭据的独立会话，不复用 faux 的结论。

## Cleanup

正常 `/quit` 后核对 pid 文件对应 PID 已退出、没有监听，保存 settings/session/workspace 到本次 artifacts，删除这一次 `runtime`。失败时先 doctor 和 `ps -p <pid> -o pid=,pgid=,command=` 核对身份，仅 TERM 该 PID，必要时核实后 KILL。进程未清理时保留 runtime 并报告失败。保留截图、粘贴文件、事件、退出码和清理记录。不要停止用户终端、旧原型或其他进程组。
