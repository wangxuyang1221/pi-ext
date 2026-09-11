# MCP resume UI todo

## Understanding

在 MCP 插件内修复会话恢复后的历史工具 UI，不修改上游 Pi。采用历史渲染占位预注册、短寿命生命周期交接和 live 工具同名替换，依据 [调研报告](mcp-resume-ui-api-research.md)。

已按 How To Test 推进实现与验收。具体 Red/Green、真实宿主结果、性能代价及未验证平台见 [验收记录](mcp-resume-ui-acceptance.md)。

## User Visible Changes

- 冷恢复及进程内 resume/import/fork/clone/reload 后，历史 MCP 调用保持自定义样式；服务器离线或工具已删除也能显示，不依赖重新连接成功。
- 工具名字、参数 schema 和权限匹配方式保持不变。历史占位不向模型提供执行能力，真实工具仅按当前配置和可用状态启用。
- 无法读取历史、交接失败或触发安全上限时，明确提示显示降级；不修改原始会话、不绕过 host 工具过滤，也不影响 MCP 资源清理。

## Todo

### 1. Establish the test host

- [x] 复用或扩展 MCP CLI/PTY fixture，固定并核验 Pi `0.85.1`，隔离 agent directory、HOME、缓存和临时文件到仓库内；支持 session replacement 和离线服务器场景，记录并清理测试进程。

### 2. Implement rendering bootstrap

- [x] 实现历史 identity 采集与校验：读取全部分支的 message entries，从调用名字及结果 details 提取显示信息；目标 JSONL 只读，歧义名字使用安全的完整名字显示，不推断执行路由。
- [x] 实现历史占位定义并复用现有 MCP renderer：不携带旧 schema 或 prompt metadata，execute 始终拒绝；将占位与 live 工具的 signature/可用状态分开管理，避免去重阻止同名替换。
- [x] 实现进程级短寿命 handoff：仅保存版本和显示 identity，采用启动实例隔离、私有目录、原子写入、容量校验、消费删除及残留清理；不建立永续全局工具目录。
- [x] 接入 factory、`session_start` 和 `session_shutdown`：冷启动直接扫描历史；resume/import 交接目标文件 identity；fork/clone/reload 交接当前历史 identity 超集；new 清空、quit 清理，且交接失败不能跳过原有 shutdown cleanup。
- [x] 协调工具启用状态：连接前移除非 live 占位，discovery 后以真实定义同名替换并显式协调 activation；离线、删除和后台重连时保留 renderer，但不赋予占位执行能力，不改其他扩展的工具状态。

### 3. Deliver

- [x] 补充异常降级诊断和部署说明，说明首次从旧实现热加载时的重启恢复方式、host 工具过滤及跨 cwd 安装范围；编写具体产品提示前确认其语言。
- [x] 记录功能、CLI/PTY 和性能验收结果，运行 `pnpm run check`；本任务改动限定于相关源码、测试及文档，`dist/` 仅由构建生成，已确认测试进程退出、端口释放及临时交接文件清理。未创建 commit。

## How To Test

### Baseline and test isolation

- 实现前，在相同 Pi `0.85.1` fixture 中保存当前失败基线：执行一次 MCP 调用，切换并恢复该会话，历史行出现默认工具全名、JSON 参数及默认 shell。
- 对新增行为先写失败测试，再实现。宿主级测试使用真实 registry、extension loader 和工具行组件；CLI/PTY 测试验证完整生命周期，不能仅用 mock 的 `session_start` 代替 resume。
- 当前仓库依赖为 Pi `0.84.3`，单独标注其测试结果；不得把该版本测试通过当成 `0.85.1` 的验收。fixture 启动时校验实际版本。

### Identity and rendering

- 全部分支、compaction 保留的原始消息、无结果的调用、错误结果、缺失 details、名字含 `__`：需要显示的名字均获得 renderer，歧义信息不被猜测；随后 `/tree` 切换到旧分支仍保持样式。
- 超长名字、控制字符、非 MCP 名字、损坏 JSONL：不注册非 MCP 工具，不产生终端控制序列注入，不静默截断后声称完全恢复。
- 扫描前后比较原始会话文件字节；无结尾换行、旧格式等输入也不得被插件重写。
- 历史占位渲染覆盖成功、失败、展开/折叠及不同终端宽度，复用 renderer 后不回归现有 MCP 展示。

### Lifecycle and execution

- 冷启动 resume/session/continue：`session_start` 注册历史定义先于初始历史行创建，服务器离线也使用自定义样式。
- 进程内 resume 及首次 import：shutdown 提取目标 identity，新 factory 先注册、Pi 后创建历史行；import 在 before-switch 时目标文件不存在也能成功。
- fork/clone/reload、新 session、内存 session、未落盘空 fork、切换取消：覆盖对应交接与清理路径，不误用上个目标的数据。
- 实际调用占位必须拒绝，断言网络调用和服务器进程启动次数为零。包含 `PI_SUBAGENT=1` 后台连接窗口及占位被外部重新激活的情况。
- inactive 定义仍可渲染；同名 live 替换使用当前 schema，按策略显式激活；删除或离线后不再开放旧调用能力。其他扩展的 active tools 不变。
- 跨 cwd 时仅在新 runtime 按 trust 读取 MCP 配置；旧 runtime 扫描历史不得启动目标项目命令。显式工具过滤不能被占位绕过。
- 交接失败、超限及损坏数据时给出降级诊断，MCP cleanup 仍执行。首次从没有交接 hook 的旧实例热加载后，重启并冷恢复能够建立 renderer。

### Handoff and performance

- 两个 Pi 进程、PID 复用模拟、旧版本数据、写入中断、过期残留、文件权限异常及 symlink：不会消费其他启动实例的数据，不留下可被当成完整交接的半写文件。
- 检查交接文件只含显示 identity 和格式元数据，不含参数、结果、schema、description、配置或凭证；正常消费/退出后文件删除。
- 实现前建立性能基线，实施后在相同 Node/Pi 版本与负载下重复测量历史提取、factory 预注册和恢复的耗时、峰值内存及交接字节数。使用小会话、多分支长会话、大结果但少量工具名、较多不同工具名等合成负载，不复制真实会话正文进 fixture。
- 确定性断言：扫描不进入 renderCall/renderResult 或 token 更新热路径；同一采集阶段不按工具重复读取整份 JSONL；预注册按去重后的名字进行；连续切换不累积永久目录；显示恢复不新增 MCP 网络请求。
- 容量边界在实现时依据现有常量和基线确定并记录，测试边界内及超限输入。当前没有用户指定的延迟或内存预算，不预设毫秒阈值；验收记录前后差异，出现额外整份读取、重复扫描或资源持续增长时不得以功能通过替代性能验收。

### Final verification

- 运行 MCP 定向测试：`pnpm exec vitest run extensions/mcp/__tests__`。
- 运行新增或扩展的真实 CLI/PTY fixture，记录命令、Pi 版本和各场景结果。
- 运行 `pnpm run check`，完成类型检查、全仓测试、构建和发布包校验；区分本任务失败与既有工作区问题。
- 检查 git diff，不覆盖当前 codex-ui 等已有改动；确认所有本任务进程、监听端口和临时文件均已清理。

## Notes

- 本清单不包含上游 Pi 修改、完整 schema 缓存、统一 `mcp_call` dispatcher、私有 TUI patch 或自动 reload 循环。
- 默认支持用户级安装的 Pi 内置 CLI。项目内安装跨 cwd 后不再加载、host 明确排除 definition、自定义 SDK host 多 runtime 和 RPC 客户端 UI 不在自动恢复保证内。
- 手动 repair 命令是可选扩展，本次不纳入实施；正常恢复通过生命周期自动完成，首次部署使用重启后冷恢复。
- 生产 handoff 位于 Pi agent directory 的 `mcp-history`。本次只在仓库内隔离目录运行；没有获得或使用真实用户目录写权限。活进程交接不按时间过期，一分钟只作为已退出进程孤立残留的清理资格。
- 全仓 Pi 依赖仍为 0.84.3，0.85.1 使用独立、明确校验版本的宿主入口。未新增产品配置。新增英文产品提示已获用户确认。
