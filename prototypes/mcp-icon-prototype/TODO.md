# MCP Prefix Rollout

## User Visible Changes

- 所有 MCP 工具调用前缀统一为 `⌁`，不再按工具名区分搜索图标 `⌕` 和圆点 `⏺`。新调用和历史记录采用同一规则，包括无法拆分的历史工具名。
- 前缀等待及运行中使用 warning 黄色，成功使用 muted 灰色，普通失败使用 error 红色。保留现有中断、超时的 warning 黄色告警语义。只改变前缀，不改变标题文字、服务名、结果正文及 diff 的颜色。
- 图标后保留一个空格，MCP 标题与 `@ Read`、`$ Bash`、`~ Edit/Write` 的起始列对齐。不额外右移标题，不改变行距、结果缩进或其他工具图标。

## Todo

- [x] 在 `extensions/mcp/src/renderers.ts` 中直接实现统一的 `⌁` 和前缀配色，删除仅用于选图标、选成功色的工具名拆分及 search 判断。新调用与 `history-tool.ts` 恢复的调用继续共用渲染器；保留状态识别、组件复用、宽度截断和缓存失效行为。图标和颜色选择为常量与标量分支，不引入原型的 theme Proxy、名称扫描、计时器或额外重绘。
- [x] 为 `prototypes/mcp-icon-prototype/` 增加明确的正式实现验收入口，例如 `--production`，直接使用当前生产渲染器，不做图标或颜色替换。保留离线模型/MCP fixture、受限的真实文件操作、Bash 固定输出及混合工具场景，用于确认正式实现与用户选定的原型一致，并在原型 README 说明入口及证据范围。

## How To Test

- 先写失败测试，再实现：覆盖搜索与非搜索工具、包含 `search` 的服务名、明确及有歧义的历史 fullName。无论名称如何，标题都以 `⌁ ` 开始；等待/运行黄色、成功灰色、普通失败红色，中断/超时仍黄色。验证结果正文中的符号和颜色不受影响。
- 修正失效预期：核对 `extensions/mcp/__tests__/renderers.test.ts`、`integration.test.ts`、`tool-summary-host.test.ts`，以及 `extensions/codex-ui/__tests__/tool-prefix.test.ts`、`tool-status.test.ts` 中旧图标和绿色成功前缀断言。同步修正 `prototypes/tool-status-prototype/smoke.py` 的生产模式识别规则。只改 MCP 的预期，不批量替换其他工具或固定历史基线原型的符号。
- 对齐及布局：在普通和全屏宿主中混合展示 Read、Bash、Edit、Write 与 MCP 成功/失败调用，断言标题起始列一致。覆盖 48 列、常规宽度、极窄宽度、长参数、详情展开/收起及重播；不溢出、不增加空格、不使用光标位移转义。终端字体的实际字形仍由人工观察确认。
- 状态及恢复：生产模式验证参数生成、执行、完成后的图标与颜色转换，并回归主题切换、reload 和历史会话恢复。历史工具必须经过 `history-tool.ts` 的生产注册及渲染路径，不能只给独立渲染器传一个历史名字就视为恢复验收完成。
- 成本约束：本次标记选择只依赖固定字符和已有状态，不再解析工具名。审查确保不新增按名称长度增长的图标选择逻辑，不新增代理包装、缓存或轮询；运行既有渲染缓存测试，保证相同内容/宽度/状态的重绘仍复用布局，状态或主题变化正确更新。
- 跨组件证据范围：混合原型由 faux provider 生成调用，经过真实 Pi 工具生命周期、codex-ui/MCP 生产渲染器到终端；MCP 执行结果和 Bash 输出为 fixture，文件操作发生在隔离 workspace。该验收证明展示与对齐，不证明 MCP 网络连接或真实服务执行。实际 MCP 注册到 renderer 的接线由现有 integration/host 测试补验。
- 最终验证：运行相关单元测试、新增正式实现入口的普通/全屏 PTY smoke check、`pnpm run tool-status:check` 和 `pnpm run check`。全部通过后才能完成对应 Todo；保留失败原因及重跑结果，停止本次启动的进程并确认测试监听端口释放。

## Verification Results

- Red → Green：工具前缀测试先因生产仍返回 `⌕` 失败，统一生产图标及成功色后通过；`--production` PTY 验收先因缺少入口失败，接入不包装 theme 的正式路径后通过。
- 相关 renderer、状态、integration、host 和历史注册测试通过。渲染缓存回归覆盖 50/500/2000 行及每组 100 次重复绘制，无新增布局、分段或样式计算；生产变更仅删除名称分类并替换图标和成功色，没有新增缓存、代理或计时器。
- `pnpm exec node --test prototypes/mcp-icon-prototype/variant.test.mjs prototypes/mcp-icon-prototype/native-fixtures.test.mjs`：14 项通过，包含直接使用生产渲染器的测试。
- `prototypes/mcp-icon-prototype/smoke.py --production` 及 `--production --fullscreen`：通过。标题起始列、黄色运行/灰色成功/红色失败、展开/收起、48 列重播及隔离文件操作均符合预期。原型默认、`--both`、`--command`、`--chevron` 对照回归也通过。
- `pnpm run tool-status:check`：五组生产宿主场景通过，包括普通/全屏、低功耗、MCP 独立加载、重启、主题切换、成功/失败和中断/超时。
- `extensions/mcp/__tests__/resume-ui-host.py`：实际 MCP 扩展的冷恢复、reload、resume、import、分支切换、clone、fork、跨 cwd 恢复通过。`--live` 的本地 stdio MCP 调用后离线恢复通过，子进程已退出、交接文件已清理；不代表远端业务服务验收。
- `pnpm run check`：2658 项通过、13 项跳过，类型检查、构建、发布包及 source/dist 宿主加载检查通过。日志位于 `.tmp/mcp-rollout-check.log`；工具状态验收日志位于 `.tmp/mcp-rollout-status-check.log`。
- 测试启动的进程已退出，测试清理检查通过；未停止用户自己打开的原型会话。

## Notes

- 用户已选择 `⌁` 方案，正式实现和验收入口均已完成，未创建提交或发布。
- 不迁移原型的 theme Proxy，不手工修改 `dist/`；生产变更位于 `src/` 及对应 `__tests__/`，生成产物通过构建更新。
- 不改 MCP 连接、重试、权限、工具执行和历史身份判定逻辑，不改 `/mcp` 服务列表及启动状态指示符。
- 保留现有原型目录供对照，不在本任务中删除旧候选、创建提交或发布。
