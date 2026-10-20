# MCP Icon Prototype

## Question

在真实 Pi 工具记录中，MCP 使用 `⌁`，与 `@ Read`、`$ Bash`、`~ Edit/Write` 放在同一段记录里是否协调？打开后观察交错排列的原生工具与 MCP 调用，比较等待、成功、失败状态，并展开详情或缩窄终端检查。

本轮默认展示 `⌁`，内部名称为 `wave`。图标与标题之间保留一个空格，标题起始列与其他工具保持一致，不增加缩进、不使用光标偏移。观察它是否比 `⌘` 更轻巧，以及是否容易与 Edit/Write 的 `~` 混淆。MCP 前缀沿用运行中黄色、成功灰色、失败红色；原生工具不改图标和颜色。旧候选只保留为手动对照入口。

## Run

在仓库根目录执行：

```bash
pnpm exec node prototypes/mcp-icon-prototype/demo.mjs
```

启动后自动交错播放 Read、Exa 搜索、Bash、Edit、Chrome DevTools 列表、Write、MultiFetch 失败。所有调用均离线，MCP 标题统一为 `⌁`。

- `/icons` 或 `/icons wave`：重播 `⌁` 与原生工具。
- `/icons command`：切回 `⌘` 作对照，保留一个空格。
- `/icons chevron`：将 MCP 切回 `»`，仍包含原生工具对照。
- `/icons 3`：查看旧候选 `⇄`。
- `/icons 4`：查看旧候选 `::`。
- `/icons both`：重播 `⇄` 和 `::` 两个旧候选，原生工具在第一组出现。
- `Ctrl+O`：展开或收起结果。
- `Escape`：中断当前播放。
- `/quit`：退出并清理临时 workspace。

数字 `3`、`4` 是第一轮原型保留的旧入口，不对应本轮候选编号。预览本轮的 `⌁` 请直接用 `/icons`。

可用独立入口和全屏模式：

```bash
pnpm exec node prototypes/mcp-icon-prototype/demo.mjs --wave
pnpm exec node prototypes/mcp-icon-prototype/demo.mjs --command
pnpm exec node prototypes/mcp-icon-prototype/demo.mjs --chevron
pnpm exec node prototypes/mcp-icon-prototype/demo.mjs --both
pnpm exec node prototypes/mcp-icon-prototype/demo.mjs --fullscreen
```

需要本仓库依赖。已验证 Node.js 22.22.2、pnpm 11.9.0、Pi 0.99.1。

## Production Verification

正式实现已采用 `⌁`。使用以下入口直接编译并加载当前生产源码，不通过 theme Proxy 替换图标或颜色：

```bash
pnpm exec node prototypes/mcp-icon-prototype/demo.mjs --production
pnpm exec node prototypes/mcp-icon-prototype/demo.mjs --production --fullscreen
```

生产模式只允许默认方案或 `--wave`，会拒绝其他候选；`/icons` 重播真实生产渲染路径。Read/Edit/Write 的隔离操作和 Bash/MCP 的 fixture 保持不变。历史恢复、主题切换和中断/超时的补验使用 `pnpm run tool-status:check` 及 MCP history host 测试，不由这个混合演示替代。

## Landing Map

- Target：`extensions/mcp/src/renderers.ts` 中 `formatMcpCallLine()` 的调用标题前缀。
- Context：真实 Pi `InteractiveMode`、codex-ui 编辑器和页脚、codex-pi 主题，以及 Read、Bash、Edit、Write 的真实标题、内容预览和 diff。原生工具与 MCP 交错出现，不另画一套模拟界面。
- Contract：沿用 `renderCall`、`renderResult`、共享状态和组件缓存。图标必须在标题测量与截断之前替换，支持不同宽度及展开状态。

## Real Code and Fixtures

`prepare.mjs` 将源码编译到仓库内的隔离 `.tmp/mcp-icon-*` 目录，不修改正式源码或手工改动 `dist/`。`--production` 完全使用当前 `extensions/codex-ui/src/` 和 `extensions/mcp/src/`。默认对照模式仅将 MCP 的 `renderers.ts` 固定到评审基线提交 `2499697d35c583f7f9d4ed1571efdcf2ebce3e7b`，其余模块仍取当前源码；这样生产源码统一图标后，旧候选仍能按原有分类和颜色重播。对照模式依赖本地 Git 中存在该提交，不用于证明当前生产实现正确。

默认对照模式的 `variant.mjs` 仅包装传给调用标题渲染器的 theme，将独立的 `⌕` 和 `⏺` 替换为指定图标。`⌁`、`⌘` 和 `»` 变体将成功前缀的 success 色映射到 muted，搜索和非搜索成功统一为灰色。标题、参数摘要、结果内容和截断仍由当前生产渲染器生成。结果渲染器收到原始 theme，不替换正文符号或颜色。

`runtime.mjs` 复用真实 Pi 宿主，通过 faux provider 生成固定调用，通过离线 MCP fixture 提供延迟、进度、结果或错误。未加载 MCP 连接 runtime，不连接真实 MCP 服务，不调用模型 API。禁用用户 Shell、网络 fetch、自动压缩与用户资源发现。会话、配置和临时文件只写入仓库内的隔离目录，退出时由启动器删除。

`native-fixtures.mjs` 只允许脚本预定的调用 ID、工具名、完整参数和 workspace。Read、Edit、Write 使用当前 codex-ui 的真实执行与渲染路径，分别操作隔离目录中的 `src/sample.ts`、`src/config.ts`、`docs/result.md`。每次重播恢复 fixture 初始内容，使 Edit/Write 的 diff 可以重复观察。Bash 保留真实渲染器，但执行返回固定输出，不调用底层 Shell。其他输入和任意路径均被拒绝。

Fixture 是 approximation，不验证服务连接、真实响应时间或实际业务结果。`⌁`、`⌘` 和 `»` 前缀在当前主题下等待和运行使用黄色 `#ffe66d`，成功使用灰色 `#85858a`，失败使用红色 `#ff6b6b`。颜色通过主题语义色获取，不硬编码到渲染器。旧候选仍保留原有的搜索成功灰色、非搜索成功绿色。

## Verification

```bash
pnpm exec node --test prototypes/mcp-icon-prototype/variant.test.mjs prototypes/mcp-icon-prototype/native-fixtures.test.mjs
conda run --no-capture-output -n codex-py312 python prototypes/mcp-icon-prototype/smoke.py --production
conda run --no-capture-output -n codex-py312 python prototypes/mcp-icon-prototype/smoke.py --production --fullscreen
pnpm run tool-status:check
conda run --no-capture-output -n codex-py312 python extensions/mcp/__tests__/resume-ui-host.py
conda run --no-capture-output -n codex-py312 python extensions/mcp/__tests__/resume-ui-host.py --live
conda run --no-capture-output -n codex-py312 python prototypes/mcp-icon-prototype/smoke.py
conda run --no-capture-output -n codex-py312 python prototypes/mcp-icon-prototype/smoke.py --fullscreen
conda run --no-capture-output -n codex-py312 python prototypes/mcp-icon-prototype/smoke.py --both
conda run --no-capture-output -n codex-py312 python prototypes/mcp-icon-prototype/smoke.py --chevron
conda run --no-capture-output -n codex-py312 python prototypes/mcp-icon-prototype/smoke.py --command
pnpm run check
```

已验证：

- 原型图标测试先因缺少变体失败，正式落地的工具前缀测试先因旧搜索图标失败。原型现有 10 项渲染测试通过，包括不包装 theme 的生产模式测试。覆盖搜索、非搜索、含歧义的历史名称、等待、成功、失败、1 至 120 列宽度、正文颜色不变及旧候选不变。
- 原生工具 fixture 的 4 项测试先因所有调用被禁用而失败，接入受限委托后通过。验证固定文件调用可执行、错误调用 ID/路径/workspace 被拒绝，以及 Bash 不调用真实 Shell。
- `--production` 入口测试先因未支持该参数失败，接入后普通和全屏模式均通过。检查各工具标题起始列一致、MCP 状态颜色、原生 `@/$/~` 的黄色运行态及灰色成功态、真实文件修改、详情展开与收起、48 列重播、重播前恢复输入，以及退出清理。
- `pnpm run tool-status:check` 的生产普通/全屏、低功耗、MCP 独立加载与重启验收通过，覆盖成功、失败、中断/超时、主题切换和持久化恢复。
- MCP 的真实历史宿主脚本通过 cold resume、reload、resume、import、分支切换、clone、fork 和跨 cwd 恢复。`--live` 使用本地 stdio MCP fixture 实际完成调用，再离线恢复，验证 `⌁` 经过真实注册、执行与历史渲染路径；不涉及外部业务服务。
- 当前正式落地的 `pnpm run check` 通过，2658 项测试通过、13 项跳过，类型检查、构建、发布包检查及宿主加载检查通过。默认、`--both`、`--command`、`--chevron` 原型对照回归也通过。此前原型开发时出现过一次未改动的 `test-wrapper.test.ts` fixture JSON 读取时序失败，单独及全量重跑已通过；旧日志仍保留于 `.tmp/mcp-icon-check-first.log`，本轮未复现。
- 所有测试子进程已退出。原型不启动服务器、不监听端口。

用户已选择 `⌁`，正式实现保留原有标题宽度与截断计算。PTY 字符检查不验证像素外观。历史恢复、中断/超时由上面的生产宿主检查补验；本地 MCP 通信使用 stdio fixture，未测试真实远端服务或付费模型请求。

Context7 提供邻近版本 0.99.0，未覆盖项目的精确版本 0.99.1。实现接口以本地 0.99.1 SDK 文档、扩展文档、TUI 文档及示例为准，并经真实宿主运行验证。

## Reuse and Cleanup

正式实现已直接修改 MCP 标题图标及前缀颜色，不迁移原型 theme Proxy，不改结果正文的颜色。保留本目录作历史对照和生产验收入口。

本次新增文件全部位于 `prototypes/mcp-icon-prototype/`，并在 `.gitignore` 中增加该目录的跟踪例外。删除该目录及对应例外即可移除原型，没有全局安装或正式入口改动。PTY 检查保留仓库内 `.tmp/mcp-icon-last.ansi` 供排查，本轮全量检查输出在 `.tmp/mcp-rollout-check.log`，工具状态检查输出在 `.tmp/mcp-rollout-status-check.log`，这些诊断文件均可删除。未改动仓库中已有的其他未提交文件。
