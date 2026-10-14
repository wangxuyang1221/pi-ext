# Tool Prefix Rollout

## User Visible Changes

- 将已确认原型 `node prototypes/tool-icon-prototype/demo.mjs --symbols` 的工具前缀用于正式界面：Bash 使用 `$`，Read 使用 `@`，Edit/Write 使用 `~`，搜索使用 `⌕`。保留工具名、参数、输出和分组布局。
- 成功前缀使用主题 `muted`，当前为灰色 `#85858a`；等待、运行、中断和超时使用 `warning`；失败使用 `error`。仅调整工具前缀，不改变 diff、错误正文和全局 success 颜色。
- 保留现有执行状态判定、展开收起和低功耗模式行为，不增加图标动画。

## Todo

- [x] 核对 codex-ui、MCP 及其他 extension 的工具标题渲染入口，列明单条、分组、低功耗和历史恢复路径；区分工具前缀与 agent、goal 等非工具状态标识。确认搜索工具的分类依据，并列出非搜索 MCP、其他工具的未决映射，不将所有 MCP 一律替换为放大镜。
- [x] 在 `extensions/codex-ui/src/tool-status.ts` 及相应渲染器中实现已确认的图标分类和状态色；覆盖 Bash、Read、Edit、Write 的标题和分组成员。使用常量及直接映射，不在每次渲染中扫描工具注册表、不增加计时器。
- [x] 在 MCP 搜索工具的正式渲染路径接入 `⌕` 和相同状态色，沿用现有参数、结果、失败和取消判定；未确认分类的工具保持原样。若其他 extension 提供已确认类别的工具渲染，按同一规则接入，不改变非工具 UI。
- [x] 更新原型说明及相关使用文档，标明正式实现与原型的对应关系；原型保留作对照，不把运行时源码替换带入正式实现。仅修改源码与对应测试，由构建生成 `dist/`。

## How To Test

- 目标行为：在实施前为工具类别与 pending、running、completed、failed、interrupted、timed_out 的组合写失败用例，核对符号和主题 token；错误正文、diff 颜色及状态判定保持不变。
- 生产路径：使用真实 Pi InteractiveMode 加载正式扩展，让脚本化模型生成工具调用，经原有执行事件、状态处理、单条及分组渲染器显示结果。复用 `prototypes/tool-status-prototype` 的隔离环境；模型、Bash 输出和 MCP 响应可以是 fixture，但不得直接注入最终标题或跳过正式渲染器。此验证不证明真实 MCP 服务的网络行为。
- 回归：修正现有测试中圆点、成功亮绿等已失效预期；覆盖自动播放、成功、失败、中断、超时、展开收起、低功耗、普通及全屏模式、窄窗口、主题切换和历史恢复。使用实际终端观察 `⌕` 字形、宽度及标题对齐。
- 性能验收：通过渲染路径检查确认每个前缀只进行常量级分类及着色，无新增 I/O、全量工具扫描、计时器或刷新请求；复用静态等待场景，确认工具无更新时不会因图标产生持续重绘。
- 最终验证：执行 `pnpm run check`；更新并运行 `pnpm run tool-status:check` 的正式路径检查。原型的 `--symbols` smoke 只能作为设计对照，不能代替正式实现验收。记录实际通过、跳过和受阻项目。

## Notes

- 正式实现已完成。codex-search 的普通搜索也使用 `⌕`；独立浏览器操作 UI 保持原样。
- `pnpm run check` 通过：2654 个测试通过、13 个跳过。`pnpm run tool-status:check` 的五组正式 PTY 场景全部通过；`pnpm run web-search:check` 的普通及全屏重启场景通过。对照原型 `--symbols` 播放及原型单元测试通过。
- 新增图标/状态矩阵及 MCP 分类边界测试先失败，正式实现后通过。已有无计时器、输出缓存与重复渲染测试通过。终端外观已在原型阶段由用户确认；正式验收验证的是终端字符、颜色和布局，不替代用户字体的像素级检查。
- 原型中的 MCP fixture 是搜索工具；非搜索 MCP、subagent 等其他工具的图标需要另行确定，不默认沿用 `⌕`。
- agent 在线标识、goal 进度及其他非工具状态 UI 不在本次改动范围。
