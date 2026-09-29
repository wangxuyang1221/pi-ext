# Session resume fixes todo

## Understanding

修复两项已复现的问题：大会话经 `/resume` 恢复后 MCP 历史样式退化，以及存在压缩历史和中途系统更新时 codex-compact 误报 `history_prefix_mismatch`。保留已经完成的 MCP 渲染缓存优化，不改变 goal 调度行为。

## User Visible Changes

- 先启动 `pi`，再通过 `/resume` 选择超过 64 MiB 的有效历史会话时，历史 MCP 调用仍使用自定义样式，不因文件总大小退化为默认样式。
- 已有压缩历史的会话恢复后，即使 MCP 工具顺序变化产生系统提示更新，普通输入和 goal 续跑也能通过正确的历史前缀校验，不再因此中止请求。
- 真正不匹配的历史仍须中止请求。工具执行、历史内容、goal 状态与调度，以及现有预览和展开行为保持不变。

## Evidence

- MCP：实际会话文件超过 64 MiB；`extensions/mcp/src/history.ts` 的 `readHistoryIdentities()` 只读调用直接报出 `Unsafe or oversized MCP history file`。`/resume` 无法提前交接工具身份，而 Pi 在新会话的 `session_start` 前绘制历史，导致历史组件没有自定义 renderer。
- Codex：`extensions/codex-compact/src/index.ts` 在 `context` 钩子中删除 `compactionSummary`。Pi 的 `restoreSystemMessages()` 因消息列表变化，将中途系统更新合并到开头；codex-compact 的分支重建仍保留原位置，两者不一致。
- 使用实际会话、Pi 0.87.1 和实际 codex-compact 代码离线复现：预期 2923 项，实际 2922 项；第 2921 项预期为系统更新，实际为用户消息。实际请求钩子产生相同错误与诊断位置。
- 未加载 goal 插件，将历史 goal 续跑提示替换为普通用户消息后仍在同一位置失败。保留同一处理函数、改由 `context_with_system` 调用后，2923 项全部匹配。这是修复方向的证据，尚不等于全部路径已通过验收。
- 本地诊断脚本与结果：`.scratch/history-prefix-diagnosis/replay.mjs`、`replay.log`。它们依赖个人环境，只用于诊断，不作为可提交的测试 fixture。
- 性能保护依据及已有工具见 [MCP render cache todo](mcp-render-cache-todo.md)。此前的小会话恢复测试未覆盖本轮两个触发条件。

## Todo

### 1. Locate

- [x] 核对 MCP 历史读取、交接和注册的完整生命周期，确定大文件、大单条图片记录、损坏 JSONL 和读取期间文件变化的处理策略；选择不累计整份会话内容、能在首次历史绘制前完成注册的实现。明确解析缓冲与工具身份结果各自的资源边界，不仅提高原有总文件大小上限。

### 2. Implement

- [x] 修改 `extensions/mcp/src/history.ts`、交接及注册相关代码，让大会话恢复成功且首次历史绘制即使用正确 renderer；只保留必要工具身份，保留文件类型、符号链接、身份合法性和数量限制等安全检查，失败不发布不完整交接数据。读取不得进入逐帧绘制或每次模型请求路径；按下述资源和响应性标准验收。
- [x] 修改 `extensions/codex-compact/src/index.ts` 的上下文处理，使用 `context_with_system` 等符合完整历史契约的路径，保留初始系统消息、中途系统更新及工具声明的顺序；覆盖有效、无效和旁路检查点以及模型切换路径，不重复插入系统消息。保留严格前缀校验和已有请求内复用，不额外重扫、复制或序列化整个历史来掩盖不匹配。

### 3. Deliver

- [x] 更新受影响的使用说明和本清单中的验收结果，说明支持范围、资源限制和仍未验证的场景；保留可复跑的合成用例，不提交个人会话、工具输出、图片或加密历史数据。

## How To Test

### Red first

- 先核对并调整旧测试中“超过 64 MiB 必须失败”的过时预期；保留独立的安全拒绝测试，不能删除大小断言后就视为问题解决。
- MCP：用测试生成的有效 JSONL 构造低于、跨过原 64 MiB 边界以及约 120 MiB 的会话，包含大图片记录和多次出现的同名 MCP 工具。旧实现应在大会话恢复用例失败。
- Codex：用合成数据组合 Pi 压缩摘要、有效 Codex 检查点、中途系统提示或工具声明更新，以及新的用户输入。必须经过真实 Pi `ExtensionRunner.emitContext()`、生产 codex-compact 钩子和实际 Responses 转换，再比较请求与分支重建；不能直接提供已经过滤好的中间数组。旧实现应因缺失中途系统项而失败。
- 对照无中途更新、无压缩摘要、没有有效检查点的会话，确认触发条件；主动制造真实前缀差异，确认仍中止而不是容错放行。

### MCP lifecycle and safety

- 扩展现有 `resume-ui-host.py`：先打开空白 Pi，再通过实际会话切换接口恢复大会话。断言首次历史绘制已使用自定义样式，不依赖后续连接成功、滚动或手动刷新补救；同时覆盖恢复时 MCP 服务离线。
- 由本地 MCP 测试服务产生真实调用结果，经客户端、会话持久化、切换交接、工具注册和 Pi 历史组件进入终端。历史体积可用合成图片记录补足，但不能用预注册 renderer 绕过待验证的交接过程。
- 回归直接指定会话启动、`/reload`、`/fork`、取消切换和重复切换；检查交接文件清理，历史展示注册不能意外激活离线工具。
- 覆盖损坏 JSONL、非法工具身份、身份数量上限、符号链接、非普通文件及读取失败；新增的流式或异步读取路径必须保持资源关闭和失败后的可恢复性。

### Codex and goal integration

- 通过同一生产处理函数验证系统文本更新和工具声明更新；同时保护初始系统提示、模型切换、检查点无效或旁路、失败重试及图片内容处理，不只验证成功路径的一次数组相等。
- 在隔离的 Pi 宿主、goal 存储和合成会话中运行实际 goal 注册与续跑逻辑，覆盖恢复后第一次请求成功、工具完成后下一轮出现系统更新、随后继续执行，以及中断后普通用户输入和手动 goal 续跑。
- 请求经过生产上下文钩子、真实 provider 序列化及 `before_provider_request` 校验。只在网络发送边界替换为本地可控响应；确认不存在意外中止、重复续跑或新增历史改写。此验收不宣称已验证远端 OpenAI 服务。
- 宿主覆盖仓库依赖 Pi 0.87.0 和实际安装的 Pi 0.87.1，分别记录版本。核对实际 goal worktree 与主仓库的区别，不能默认所有插件来自同一分支。

### Performance

- 对历史扫描，输入大小记为 N、最大单条记录为 L、不同工具身份结果大小为 K。允许为校验有效 JSONL 做 O(N) 读取；解析中间缓冲不得随总文件大小累计，按所选策略约束为固定块缓冲加单条记录所需空间，工具身份结果允许 O(K)。不能同时保留整份文本、行数组和解析后的全部消息。
- 使用约 32、65、120 MiB 的合成历史比较恢复耗时、事件循环响应与峰值内存；分别固定 K 和 L 增长 N，以及固定 N 增长单条图片记录，区分宿主保存完整会话的必要成本与插件新增的扫描缓冲。绝对时间和内存阈值在 Locate 阶段根据候选实现成本确定，不能用首次实现结果直接作为合格线。
- 为扫描次数写确定性断言：一次恢复不得反复扫描同一历史，连接回调、后续绘制和后续请求不得触发额外全文件读取；Codex 修复不得增加每请求的完整历史转换次数。读取期间要让出事件循环，避免把大文件读取变成明显的同步停顿。
- 复跑现有缓存基准：50、500、2000 条记录预热后连续 100 次绘制，不增加昂贵布局调用；500 条记录的组件热路径 p95 不超过 5 ms。在相同环境复跑 PTY 等待和持续输出场景，输入回显 p95 小于 50 ms。沿用原清单的测量定义与依据，不以组件基准代替端到端验证。

### Final validation

- 先运行两个扩展的针对性测试，再执行适用的真实宿主恢复、goal 续跑和性能测试，最后运行 `pnpm run check`。
- Python 驱动使用 `conda run -n codex-py312 python`；构建、类型检查、测试及包校验使用仓库规定的 pnpm。`dist/` 只通过构建生成。
- 功能、安全与性能均通过后才勾选对应实现项；记录命令、版本、结果和证据边界。结束前停止本任务启动的宿主与 MCP 测试服务，确认监听端口释放。

## Verification Results

2026-09-29 完成两项修复。环境为 Node.js 22.22.2、pnpm 11.9.0；仓库 Pi 依赖为 0.87.0，另行验证了已安装的 Pi 0.87.1。未操作原会话进程，也未修改安装路径、配置或 goal worktree。

### Implementation and red/green evidence

- MCP 读取改为异步 64 KiB 分块、逐条 JSONL 解码，不保留整份文件或全部消息；单条记录上限为 64 MiB，身份数量和名称限制保持原值。跨记录冲突信息保留在同一个有界收集器中。会话切换等待扫描和交接发布完成，factory 消费身份后才进入首次历史绘制。
- 解析资源上限从整份文件转为单条记录。JSON.parse 单条记录仍是同步操作，超大单条记录不能获得普通小记录同等的响应性；文件总大小不再是拒绝条件。记录上限、普通文件和符号链接检查、前后 stat 一致性检查，以及 finally 关闭句柄保留了独立的资源与安全边界。
- Red：65 MiB 合成会话在旧实现上报 `Unsafe or oversized MCP history file`；改为增量扫描后通过，并确认扫描期间定时器可以运行。额外覆盖 UTF-8 跨块、CRLF、空行、损坏或非对象 JSON、记录超限、非普通文件、符号链接，以及增长、截短、同尺寸重写和注入读取错误后的句柄关闭。
- Red：真实 Pi 事件分发加 provider 序列化的用例在旧钩子上缺失 `Updated system prompt section`；迁移到 `context_with_system` 后通过。额外发现并修复了无效检查点回放旧格式分支时可能丢失开头 system baseline 的问题，该边界也先失败后通过。
- Codex 保留请求前严格校验，没有修改协调器的历史转换次数、失败重试或检查点写入规则。有效检查点仍只过滤 Pi 摘要；需要完整分支回放时保留宿主已有的开头系统消息。

### Host and goal acceptance

- Pi 0.87.0、0.87.1 均通过 120 MiB 的空白启动后恢复测试，第一次绘制就出现 MCP 自定义样式，不依赖缩放补救；并回归 reload、再次 resume、import、取消切换、分支导航、clone、fork 和跨 cwd 信任边界。
- 两个版本均通过本地 stdio MCP 真实调用后转离线并恢复 120 MiB 会话的测试。模型端仍为离线 fixture，但 MCP 结果确实经过服务、客户端、持久化、交接和宿主组件；大图片体积由离开当前分支的合成记录补足。所有测试子进程退出，交接文件无残留。
- `resume-runtime.test.ts` 使用实际 Pi AgentSession、goal 存储、生产工具执行与 Codex 请求处理，覆盖 goal 恢复、中断后的普通用户输入及中断后的 goal 恢复。每例完成三次请求，中途动态注册新工具，最后通过 `update_goal` 完成；每次序列化历史均匹配分支重建，准备后的请求保留加密检查点，无重复执行或额外续跑。
- 上述三例分别通过 Pi 0.87.0，以及 Pi 0.87.1 加实际 `.scratch/worktrees/goal-tool-ui/extensions/goal/dist/index.js`。仅模型目录、测试凭据和 HTTP 响应被替换，不调用远端 OpenAI，也不宣称验证了远端服务。
- 原会话只读核验：异步扫描成功提取 13 个工具身份，耗时约 133 ms；原失败位置的 2923 项，以及本次读取时最新分支的 2927 项，均与实际宿主上下文转换逐项匹配，事件处理无错误。没有修改原会话来取得这些结果。

### Performance acceptance

- 新增可重复基准 `extensions/mcp/__tests__/history-scan-benchmark.mjs`，每个规模使用独立 Node 进程，区分扫描新增峰值与宿主持有会话的成本。缓冲通过固定读取块及单条记录上限约束；身份收集结果只随不同工具数量增长。
- 基准时间上限根据独立 JSON 解码校准成本、逐块异步调度余量和固定启动余量计算，不以扫描实现的实测结果反推。内存上限为 64 MiB GC 余量加单条记录大小的六倍，覆盖分块、合并缓冲、UTF-8 解码及 JSON 字符串的临时空间；不按总文件大小放宽。

| 合成历史 | 扫描耗时 | 新增峰值 RSS | 定时器运行次数 |
| --- | ---: | ---: | ---: |
| 32 MiB，1 MiB/条 | 22.6 ms | 23.4 MiB | 22 |
| 65 MiB，1 MiB/条 | 51.2 ms | 27.6 MiB | 52 |
| 120 MiB，1 MiB/条 | 88.3 ms | 40.4 MiB | 88 |
| 128 MiB，32 MiB/条 | 129.0 ms | 141.2 MiB | 48 |

- Pi 0.87.1 中 120 MiB 会话从空白恢复约 0.65 s；整个宿主峰值约 552 MiB，包含 Pi 对完整会话的保存，不能与表内扫描新增峰值混为一谈。
- 500 条 MCP 历史组件热路径 p95：100 列 0.049 ms、160 列 0.020 ms，均低于 5 ms。50、500、2000 条记录的确定性缓存测试继续通过。
- Pi 0.87.1 实际 PTY 输入回显 p95：等待时 11.464 ms，持续输出时 11.677 ms，均低于 50 ms；Pi 0.87.0 同样通过。未降低刷新率或缩短预览换取结果。

### Reproduction commands

```bash
pnpm exec vitest run extensions/mcp/__tests__/history.test.ts extensions/codex-compact/__tests__/index.test.ts extensions/codex-compact/__tests__/resume-runtime.test.ts
pnpm run check
node extensions/mcp/__tests__/history-scan-benchmark.mjs --check
node extensions/mcp/__tests__/render-benchmark.mjs --check
conda run -n codex-py312 python extensions/mcp/__tests__/render-input-host.py --check
conda run -n codex-py312 python extensions/mcp/__tests__/resume-ui-host.py --pi-root "$PWD/node_modules/@earendil-works/pi-coding-agent" --pi-version 0.87.0 --cold-mode blank --history-mib 120
conda run -n codex-py312 python extensions/mcp/__tests__/resume-ui-host.py --pi-root "$PWD/node_modules/@earendil-works/pi-coding-agent" --pi-version 0.87.0 --live --history-mib 120
# Optional installed host / goal branch overrides for the runtime test.
PI_CODEX_TEST_PI_ROOT=<pi-package-directory> PI_GOAL_TEST_ENTRY=<goal-dist-index.js> pnpm exec vitest run extensions/codex-compact/__tests__/resume-runtime.test.ts
```

`pnpm run check` 通过类型检查、173 个测试文件、2617 个测试、构建和发布包校验；4 个测试文件及 13 个测试按既有条件跳过。`git diff --check` 通过。原始日志保存在 `.scratch/history-prefix-diagnosis/`，不作为发布产物。

## Notes

- 两项修复已实现并构建；用户正在运行的 Pi 仍需在合适时机重新加载代码。原会话的在线续跑和体感复测尚未执行，上述原会话验证仅为只读离线检查。
- 保留既有 MCP 渲染缓存优化；不修改 goal 调度或工具 UI，不升级 Pi，不改变用户的插件安装路径和分支。
- 原会话、配置和 goal 存储仅作只读核验。需要在原进程安装诊断、重载插件、重启或执行副作用操作时另行确认。
- 不删除历史、强制重压缩、丢弃图片、关闭前缀校验或放宽真实不匹配的处理来绕过问题。与本次无关的工作区改动保持不动。
