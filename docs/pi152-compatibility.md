# Stock Pi 1.5.2 compatibility

## Scope

原版 Pi `1.5.2` 的兼容范围是 `codex-ui`、`codex-compact`、`openai-fast-mode`、`mcp`、`skill-mentions` 和 `themes/codex-pi.json`。根开发环境仍固定在 `1.4.0`，保留现有可选补丁。包仍发布五个扩展入口。使用 `pi config` 选择上述五个扩展，或逐个用 `-e` 加载构建入口。

三个 Pi peer 依赖接受 `1.4.0 || 1.5.2`。不要把此范围理解成八个发布入口都已通过新宿主验收，也不要将根开发依赖整体升级后套用旧补丁。

## Stock behavior

| Component | Retained behavior | Stock limitation |
| --- | --- | --- |
| codex-ui | 编辑器、工具显示、codemode 调用树和 inspector、Working 与接收速率、主题 | 没有 `registerTextRegion` 时使用普通 `requestRender`；缺少局部刷新优化，无 CPU 性能承诺 |
| skill-mentions | `$skill` 补全、提交快照、历史卡片、旧会话恢复和继续对话 | 没有摘要 transformer 时，resume 列表可能显示协议封套，搜索会命中保存的技能正文；不会改写历史以模拟投影 |
| codex-compact | checkpoint 的构造、取消、保存与恢复流程 | 离线 SSE 只证明客户端行为，不证明线上 checkpoint 接受性与摘要质量 |
| openai-fast-mode | 根会话开关、请求 priority 字段、明确拒绝后的普通重试和持久化 | 现有模型名单保持不变；本地请求证据不证明服务端采用 priority、速度或计费 |
| mcp | 本插件配置、本地协议、工具调用和历史恢复 | 替代内置 MCP；其他扩展通过宿主 MCP registry 注册的 server 仍不由本插件连接 |

codemode 的嵌套工具优先使用父 renderer 提供的 `keyText/keyHint`。独立 inspector 使用宿主交给自定义 UI 的 keybindings；旧宿主也使用该实例的 keybindings；reload 后配置晚于历史行到达时，下一次绘制会更新提示及其缓存，避免读取另一份宿主的全局快捷键状态。

## Isolated verification

从仓库根目录执行，使用 `package.json` 指定的 pnpm 和 Node。Python 驱动使用 Conda `codex-py312`，需要 pyte。

```bash
pnpm run pi152:verify prepare
pnpm run pi152:verify build
pnpm run pi152:verify types
pnpm run pi152:verify inspect
pnpm run pi152:verify run node test-support/pi152/load.mjs
pnpm run pi152:verify run pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
```

`prepare` 在 `.tmp/pi152-adaptation/runtime` 创建验证副本及独立 node_modules。这是源码验证副本，不是独立 Git checkout。它仅复制范围内生产源码，另外复制共享脚本和测试夹具，不复制根 node_modules、补丁配置或根锁。每次 prepare 保留独立 node_modules 和 `.tmp` 验收证据，清除其余旧副本内容，再复制当前源码、主题及夹具，随后必须重新 build。运行旅程时不要同时 prepare/build。`test-support/pi152/pnpm-lock.yaml` 是独立锁，以 `pnpm install --frozen-lockfile --ignore-scripts` 安装。锁最初沿用根锁中已存在的间接依赖版本，再解析官方 Pi `1.5.2` 包，避免浮动 AWS 依赖选中 registry 尚未提供的版本。

`host-proof.json` 记录四个 Pi 包的绝对目录、版本、入口和 manifest 的 SHA-256。入口拒绝工作区外的宿主路径和 pnpm patch hash。源码从副本路径加载，不会从原仓库源码路径解析旧依赖。两种 build 入口都会复制并校验 compact 的 WASM 和配套资源。`load.mjs` 同时检查五扩展 source/dist、主题、内置 MCP 替代及 codemode 保留，并实际调用编译产物中的 XML、原始图片和音频解码入口。运行命令过滤凭据环境；HOME、agentDir、cache、temp、session 和证据都在仓库 `.tmp`。

## User journeys

每条旅程串行执行。先阅读 [共享验证说明](../.cursor/skills/verify-pi-ext/README.md) 和对应扩展 feature，按其清理标准审查结果。以下命令中的驱动与根基线共用，只有安装包树、源码路径和证据目录属于验证副本。

```bash
pnpm run pi152:verify run pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run codex-ui
pnpm run pi152:verify run pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run codex-ui-fullscreen
pnpm run pi152:verify run pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs journey codex-ui --recipe .cursor/skills/verify-pi-ext/recipes/pi152-codemode.json
pnpm run pi152:verify run conda run --no-capture-output -n codex-py312 python extensions/codex-ui/__tests__/codemode-pty.py --custom-keys
pnpm run pi152:verify run conda run --no-capture-output -n codex-py312 python extensions/codex-ui/__tests__/codemode-pty.py --custom-keys --fullscreen
pnpm run pi152:verify run pnpm exec node extensions/skill-mentions/__tests__/journeys.mjs combination-prebuilt
pnpm run pi152:verify run pnpm exec node extensions/skill-mentions/__tests__/journeys.mjs combination-prebuilt .tmp/skills-stock-regular combined
pnpm run pi152:verify run pnpm exec node extensions/skill-mentions/__tests__/journeys.mjs resume-stock
pnpm run pi152:verify run pnpm exec node .cursor/skills/verify-pi-openai-fast-mode/scripts/verify.mjs root
pnpm run pi152:verify run conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-codex-compact/scripts/compact-pty.py .tmp/compact-stock-proof combination
pnpm run pi152:verify run conda run --no-capture-output -n codex-py312 python .cursor/skills/verify-pi-codex-compact/scripts/compact-pty.py .tmp/compact-stock-navigation navigation
pnpm run pi152:verify run conda run --no-capture-output -n codex-py312 python extensions/mcp/__tests__/verification-journeys.py combination
pnpm run pi152:verify run conda run --no-capture-output -n codex-py312 python extensions/mcp/__tests__/verification-journeys.py history
```

`resume-stock` 保留原有四种编辑器/终端组合及真实菜单、会话身份、历史字节和后续请求检查，另断言原版封套显示和技能正文搜索降级。要求摘要补丁的 `resume` 入口继续用于根补丁基线。Fast 的 `root` 模式覆盖根会话完整请求旅程及项目配置及同一根会话冷恢复。

`pi152-codemode.json` 使用真实 CLI 同时加载五扩展和内置 codemode，执行嵌套 read/bash/edit/write、核对文件字节，再以 F3 展开并打开 inspector 三个 tab。复制 recipe 到验证副本的 `.tmp`，在 `cliArgs` 加入 `--tui-mode`、`fullscreen` 即可复验全屏入口；recipe 路径由验证副本解析。共享 `journey` 结束后仍须审查 `journey.json` 和画面，并记录 verdict。

驱动输出的 `.tmp` 路径位于验证副本内。命令退出码、逐项断言、ANSI、session、PID 和本地服务端口清理都需保留；缺分支时仍按 feature 标为 unverified。线上模型服务、真实服务端 priority、系统剪贴板和物理终端外观需单独验收。根仓库最终仍运行 `pnpm run check`，其结果只代表原有开发基线及既有回归范围。
