# Codemode UI prototype

## Question

同一组 codemode 调用，在六种终端布局下，哪种最方便查看执行过程、结果和异常？通过切换布局、展开工具行、重放状态和打开检查面板进行比较。六个变体共用真实执行记录，不用不同数据制造视觉差异。

## Run

在仓库根目录运行，需要项目依赖已经安装。已验证 Node.js 22.22.2、pnpm 11.9.0、Pi 1.3.0。

```sh
pnpm run prototype:codemode-ui
```

默认打开混合方案，自动播放一次“脚本完成，但内部 Bash 失败”的场景。无需 API key、登录或后台服务。

```sh
# Fullscreen terminal
pnpm run prototype:codemode-ui --fullscreen

# Start with a particular layout
pnpm run prototype:codemode-ui --layout 3
```

### Controls

| 操作 | 行为 |
| --- | --- |
| `/layout 1` | 紧凑摘要卡；展开后显示内部调用和部分脚本 |
| `/layout 2` | 调用树；按照实际开始顺序排列，展开后显示原有工具 renderer |
| `/layout 3` | 平铺工具流；直接展示原有 Read/Bash/Edit 内容 |
| `/layout 4` | 时间线摘要；使用 `/inspect` 打开检查面板 |
| `/layout 5` | 结果优先；修改 diff 和警告常驻，其他调用默认折叠 |
| `/layout 6` | 混合方案；摘要收起态、调用树展开态、警告常驻 |
| `Ctrl+O` | 使用 Pi 原生工具展开/收起操作，作用于所有工具行 |
| `/inspect` | 检查最近一次 codemode 执行；所有布局都可使用 |
| `Tab` | 检查面板内切换 Calls / Script / Output |
| `↑` / `↓` | 检查面板内选择子调用 |
| `PageUp` / `PageDown` | 检查面板内滚动详情 |
| `Esc` | 关闭检查面板 |
| `/theme light` / `/theme codex-pi` | 切换主题 |
| `/guide` | 查看操作提示 |
| `/quit` | 退出并删除本次隔离工作区 |

`/layout` 会重绘本次会话所有 codemode 行，便于用完全相同的执行数据比较方案。检查面板在宽终端左右分栏，窄终端显示当前调用详情；窗口带边框，与背景对话区分。

### Scenarios

| 命令 | 执行及观察点 |
| --- | --- |
| `/play success` | 并行读两个文件，真实修改临时文件，Bash fixture 成功 |
| `/play partial` | Bash fixture 失败，由脚本捕获；父调用显示 Script completed，内部警告仍显示 |
| `/play error` | 文件修改后，脚本抛异常；父调用显示 Script failed，已完成修改不会回滚 |
| `/play running` | Bash fixture 挂起；观察父调用和内部调用的运行态 |
| `/finish` | 释放挂起 fixture，让真实脚本继续并正常结束 |
| `/stop` | 通过 Pi 中断真实执行器；显示 Interrupted，随后可再次播放 |
| `/play many` | 真实并行执行 24 次 Read；观察折叠、列表高度和检查面板 |
| `/play empty` | 脚本返回文本，不调用其他工具 |

每次重放前重置隔离工作区里的文件。普通文本输入和用户 Shell 命令不能执行任务；只接受固定场景。

## Landing Map

- Target: Pi 1.3.0 的 codemode 工具行，使用 `registerToolRenderer` 接入；检查面板使用 `ctx.ui.custom`。
- Context: 真实 Pi InteractiveMode、当前 codex-ui、codex-pi 主题、编辑器、普通 Read 行。内部 Read/Bash/Edit 复用 codex-ui 当前源码中的 renderer，包括真实 Edit diff。
- Contract: 内置 codemode 执行器、`tool_execution_*` 的 `parentToolCallId`、工具结果中的 `details.calls`、原生展开状态。执行事件决定顺序、时间和状态；不从 JavaScript 源码猜测执行图。

## Real System and Fixtures

真实运行的部分：

- `createCodemodeExtension({ models: false })` 及 QuickJS 执行器。
- Pi 的工具参数校验、嵌套调用事件、真实父调用成功/失败/中断。
- SDK 会话、InteractiveMode、主题、编辑器及工具展开。
- 从本仓库 `extensions/codex-ui/src/` 编译的代码，不修改生产实现。
- 临时工作区内的 Read/Edit，以及 Edit 结果中的 diff。

Fixture / approximation：

- 离线 faux provider 发送预定义调用，不调用真实聊天模型。
- Bash 的输出、延迟和失败为固定 fixture，不启动 shell、测试命令或子服务。
- 文件是临时 `package.json` 和 `配置.ts`，并非仓库实际文件。
- 方案 3 在父 renderer 内平铺原有子组件，不把子调用伪装成独立会话消息。
- 方案 4 使用实际观察到的开始时间和耗时列表，不提供依赖图或甘特图。
- 场景不包含真实 MCP、图片生成、分类器调用、权限交互或超时。

所有布局只显示已观察到的调用数，不显示预估百分比。子调用原始结果与脚本输出分开，检查面板的 Output 展示完整父工具文本；工具行摘要去掉 Pi 的固定执行头，只预览脚本输出。

## Isolation and Cleanup

启动器在仓库 `.tmp/codemode-ui-*/` 下创建独立 HOME、agent 配置、session、临时目录和工作区，退出后删除。它把当前 codex-ui 源码编译到该目录，不手工改动 `dist/`。

不读取用户认证，不加载全局 extensions、skills、MCP 或项目指令。模型目录使用内存存储，网络刷新关闭，`fetch` 被拒绝并统计尝试次数。只允许固定脚本、固定 Read 路径和固定 Edit 参数。禁用非 fixture 写入及 Shell 执行。没有监听端口。

原型未接入生产入口；新增仓库级文件仅为 `.gitignore` 中的原型白名单和 `package.json` 中的运行/检查脚本。清理时删除本目录以及这两处入口即可。

## Verification

```sh
pnpm run prototype:codemode-ui:check
pnpm run check
```

原型检查包括：

1. Node 测试：混合方案常驻异常、六种布局差异、1/24/40/80/120 列宽约束、检查面板三个视图、嵌套调用顺序、历史缺失标记、临时 ID 去重、多行错误不能破坏终端行。
2. 真实 SDK / QuickJS smoke：success、partial、error、many、empty，确认实际产生的调用数及父子状态，确认脚本失败后临时文件的改动仍存在。
3. Python PTY smoke：普通/全屏两种模式，切换全部六种布局，原生展开并检查 diff，操作检查面板、调整到 40/80/120 列、切换主题、中断和重新播放、释放挂起调用、退出后检查工作区清理。

PTY 检查使用 `conda run -n codex-py312 python`，依赖 `pyte`。截图是解析实际 ANSI 后的终端文本，保存在 `.tmp/codemode-ui-regular-screens.json` 和 `.tmp/codemode-ui-fullscreen-screens.json`，不是模拟 HTML。

本轮已通过以上全部检查，以及仓库要求的 `pnpm run check`。检查日志保存在 `.tmp/codemode-ui-prototype-check.log` 和 `.tmp/codemode-ui-repo-check.log`。

## Findings and Limits

已验证的技术判断：

- 可以只替换 codemode renderer，保留真实执行器和现有 codex-ui。
- 真实子调用事件支持稳定开始顺序、原始结果及异常提示；`details.calls` 可补充终态元数据。
- Pi 会先发布 `parent/?` 临时调用记录，再替换为正式 ID。直接按 ID 累加会制造重复调用，原型忽略这些临时记录。
- 父脚本正常结束不代表每个子调用成功；混合方案收起时仍能展示被脚本捕获的失败。
- 直接把多行错误塞进一条 TUI 返回行会破坏重绘；原型将摘要错误折成单行，详情保留换行。
- 真实 Edit renderer 可以在调用树和结果视图中复用，不需要另造 diff 样式。

尚未验证：

- 哪个方案更适合日常使用，仍需用户实际比较。
- 正式会话恢复、分支切换、compaction、大量历史行和长时间运行。缺少历史原始子结果时会明确标记 incomplete，但这里只对 fallback 做了单元验证，不声称完成恢复集成。
- 自定义快捷键、低功耗模式、权限批准、真实 MCP 及多层嵌套。原型只处理本任务需要的一级子调用。
- 临时状态存储没有生产级容量淘汰。长输出预览有行数限制，完整 fixture 内容可在检查面板滚动；不验证超大输出文件读取。
- 六个布局不保存偏好到全局配置，不接管生产 codemode UI。

## Reuse and Reimplementation

可参考或复用的部分：`src/model.mjs` 中的父子状态分离和临时 ID 去重、`src/renderers.mjs` 中的六种布局及响应式检查面板、fixture 场景和回归测试。

正式实现应迁入 `extensions/codex-ui/src/`，使用项目类型、keybinding、缓存和生命周期约定；重新设计 renderer 适配器、会话恢复和容量管理。`src/runtime.mjs` 的离线工具代理、固定参数 gate、faux provider 和启动器只供原型使用，不应移入生产。

## References

实现依据为安装的 Pi 1.3.0 官方文档及声明文件：`docs/sdk.md`、`docs/extensions.md`、`docs/tui.md`、`docs/codemode.md`，以及 `examples/sdk/14-codemode-mcp.ts`。Context7 已按 `/earendil-works/pi/v1.3.0` 核对 renderer 和嵌套调用接口。
