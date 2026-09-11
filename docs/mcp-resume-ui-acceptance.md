# MCP resume UI acceptance

## Result

本次实现限定为 MCP 插件。未修改 Pi、dispatcher、工具命名或权限匹配，没有私有 UI patch、完整 schema 缓存或永久工具目录。

Pi 0.85.1 的真实 CLI/PTY 已验证离线冷恢复、进程内恢复、首次 import、reload、fork、clone、tree、取消切换、跨 cwd 的不受信任项目，以及内存 session 的 clone 和空 fork。基线既包含合成旧历史，也包含真实本地 stdio MCP 调用后再离线恢复的会话。基线恢复显示默认工具名和 JSON；实现后显示自定义 MCP 行。

生产实现只用公开 Pi API。宿主测试使用真实 extension loader、AgentSession registry 方法和 ToolExecutionComponent；其中受控 registry 测试使用内部方法，不是生产依赖，也不替代 PTY。

## Environment

- Node `v22.22.2`，pnpm `11.9.0`，macOS。
- 仓库依赖 Pi `0.84.3`。默认 Vitest 和全仓 check 使用此版本。
- 目标宿主为本机 Pi `0.85.1`。PTY 启动前验证目标 package version；真实 loader 测试通过 `PI_MCP_TEST_PI_ROOT` 切换目标，版本不符直接失败。
- `PI_MCP_TEST_PI_ROOT` 指向本机安装包根目录，不是仓库 `node_modules`。例如本次路径：

```text
/Users/wangxuyang/Library/pnpm/store/v11/links/@earendil-works/pi-coding-agent/0.85.1/4011d0a1b084fee9580232c1f0d858a8429fe70851ed74fe182409e63aa52ab9/node_modules/@earendil-works/pi-coding-agent
```

所有 fixture 的 HOME、agent directory、TMPDIR、cache 和合成会话均在仓库 `.tmp`。没有读取或改写真实用户 session，没有在真实 `~/.pi` 创建 handoff。使用英文新增产品提示已获用户批准。

## Implementation

- `history.ts` 一次遍历全部 message entries，去重调用名及结果名。优先采用与全名一致的非空 MCP details；没有可靠分界或不同分支存在冲突时使用 fullName。连续、前置、重叠的 `__` 不会导致合法名字静默消失。
- 目标 JSONL 使用普通只读文件描述符和公开 `parseSessionEntries()`。不调用 `SessionManager.open()`。检测 parser 跳过的损坏 JSON 行；不迁移、不补换行、不重写原文件。
- `history-tool.ts` 不引用 manager。占位只有空对象参数 schema、空 description、共用 renderer；不带 prompt metadata。execute 无条件抛出 history-only 错误。
- Factory 消费 handoff 并注册占位，不调用未绑定的 action API。冷启动在 session_start 注册历史并禁用占位，然后才开始连接，包括 `PI_SUBAGENT=1` 路径。
- resume/import 在 awaited shutdown 阶段读取 targetSessionFile；fork/clone/reload 使用当前 getEntries 超集。new/quit 清除交接。任何显示错误均不能跳过 MCP cleanup 和 diagnostics.close。
- Live 注册状态与占位分离。在线 discovery 同名替换为当前 schema。当前 live catalog 与 online active 状态分离，离线自动停用，已排队的 live execute 引用仍可进入 manager 原有安全重连路径。目录删除才撤销旧执行资格。用户手动禁用的实时工具在重复 discovery、离线恢复和目录重加后保持禁用；自动离线暂停的工具可恢复启用。其他扩展 active tools 不变。

## Handoff safety

路径为 `getAgentDir()/mcp-history/<pid>-<process-start-hash>.json`。启动 hash 来自 Node `performance.timeOrigin`，不通过持久全局变量或环境继承维持 registry。仅支持内置 CLI 的单 runtime-host 生命周期。

- Payload 仅有 `version`、`createdAt`、`identities`。Identity 仅有 fullName 和可选 serverName/toolName。额外字段、错误版本、早于当前进程启动的 payload 和不匹配身份直接拒绝。
- 专用目录要求当前 UID、0700 私密权限，拒绝 symlink。文件要求当前 UID、私密权限、单一硬链接、普通文件；读取使用 O_NOFOLLOW。原子写采用独占临时文件和 rename，finally 删除临时文件，消费后删除正式文件。
- 一分钟只用于已退出进程的孤立文件清理资格。不会按时间过期当前交接，也不会删除仍存活进程的文件；较长 project-trust 等待不会让交接失效。真实双进程及模拟一小时等待均有测试。
- 无完整 schema、参数、结果、description、配置、命令或凭据进入交接。

### Limits

| Boundary | Value | Basis |
| --- | --- | --- |
| 完整工具名字 | 1024 UTF-8 bytes | 与现有工具全名诊断上限对齐，超限拒绝而非截断注册 |
| 去重 identity | 4096 | 已测量 4096 个工具的真实冷启动、factory 注册与交接；4097 明确拒绝 |
| 单次目标 JSONL | 64 MiB | 覆盖本次约 32 MiB 大结果负载，同时限制同步读取与解析内存；打开后先检查大小 |
| Handoff | 8 MiB | 不因较多长名字无限扩大元数据文件，序列化后再次检查 |
| 残留目录扫描 | 8192 entries | 限制异常目录对 factory 的阻塞；超限诊断降级 |

这些是实现安全上限，不是用户给定的性能预算。超限会提示部分历史可能使用默认样式，原 session 不变。POSIX 权限与 macOS 路径已经验证；Windows 未验证。

## Red and green evidence

以下命令均为实际运行。新增模块最初的 import-not-found 只说明入口尚未实现，不作为行为 Red；随后记录了可执行测试的行为失败。

| Round | Command suffix after `pnpm exec vitest run` | Red | Green |
| --- | --- | --- | --- |
| Identity | `extensions/mcp/__tests__/history.test.ts` | 空实现返回 `[]`，应有三个去重身份 | 全部分支、缺失 details、确认身份通过 |
| Name safety | 同上 | 控制字符/超长名字未拒绝，冲突分支最后值覆盖身份 | 上限与冲突降级通过 |
| Read-only JSONL | 同上 | 只读读取函数尚不存在 | 无末尾换行及 v1 数据字节不变，损坏行诊断通过 |
| Delimiters | 同上 | `mcp__server____tool` 被静默忽略 | 保留 fullName，通过 |
| Empty details | 同上 | 空 server 被错误确认并显示为空身份 | 忽略不可靠 details，通过 |
| Handoff | `extensions/mcp/__tests__/history-handoff.test.ts` | publish 空实现未生成可消费文件 | 同启动实例一次交接及消费删除通过 |
| Handoff safety | 同上 | 错误版本、额外字段、权限异常未拒绝 | 白名单、权限、symlink、失败清理通过 |
| Stale cleanup | 同上 | 过期中断写临时文件未清理 | 孤立文件清理通过 |
| Long wait | 同上 | 别的实例按 TTL 删掉仍在等待的活进程文件 | 存活探测及无当前交接截止时间通过 |
| Placeholder | `extensions/mcp/__tests__/history-tool.test.ts` | 全名被显示为 `Called / mcp__a__b__c` | 通用全名行及拒绝 execute 通过 |
| Lifecycle | `extensions/mcp/__tests__/index.test.ts` | 冷恢复和下一 factory 均缺少 renderer | 预注册、后台启动窗口和 live 替换通过 |
| Live reconnect | 同上 | 离线后已排队 live 引用提前抛 unavailable | 保留 manager 安全重连入口，删除 catalog 后拒绝通过 |
| User activation | 同上 | 手动 inactive 的工具离线恢复后被重新启用 | 保留用户选择，仅恢复自动暂停的工具通过 |
| Registry refresh | 同上 | schema 更新的 registerTool 刷新 allowlist，覆盖用户禁用选择 | 注册前记录选择，注册后不重复观察被刷新状态，通过 |

原有 renderer 和真实工具行测试同步通过。补充的 target source、new/quit、取消切换、trust 和异常 cleanup 测试在现有实现上直接通过，未虚构 Red。

## CLI and host verification

```bash
# 指向已安装且版本为 0.85.1 的 Pi package root。
export PI_MCP_TEST_PI_ROOT=/absolute/path/to/pi-coding-agent

pnpm exec vitest run extensions/mcp/__tests__/history-host.test.ts
conda run -n codex-py312 python extensions/mcp/__tests__/resume-ui-host.py --pi-root "$PI_MCP_TEST_PI_ROOT" --baseline
conda run -n codex-py312 python extensions/mcp/__tests__/resume-ui-host.py --pi-root "$PI_MCP_TEST_PI_ROOT"
conda run -n codex-py312 python extensions/mcp/__tests__/resume-ui-host.py --pi-root "$PI_MCP_TEST_PI_ROOT" --cold-mode continue
conda run -n codex-py312 python extensions/mcp/__tests__/resume-ui-host.py --pi-root "$PI_MCP_TEST_PI_ROOT" --cold-mode resume
conda run -n codex-py312 python extensions/mcp/__tests__/resume-ui-host.py --pi-root "$PI_MCP_TEST_PI_ROOT" --live --baseline
conda run -n codex-py312 python extensions/mcp/__tests__/resume-ui-host.py --pi-root "$PI_MCP_TEST_PI_ROOT" --live
conda run -n codex-py312 python extensions/mcp/__tests__/resume-ui-host.py --pi-root "$PI_MCP_TEST_PI_ROOT" --memory
```

全部通过。进程内 resume/fork/clone/tree 由 fixture command 调用公开 ExtensionCommandContext，进入真实 CLI 的会话切换和重绘路径；import/reload 使用内置命令。冷 `--resume` 使用真实选择器。不是 mock session_start。

PTY 只在切换完成后重新调整终端宽度，并断言最后一次重绘输出，旧行输出不能充当恢复成功。离线分支含错误结果及歧义工具名；取消切换没有 handoff 文件。跨 cwd 测试拒绝目标项目 trust，项目配置中的 sentinel 写入命令未执行。最初 fixture 误用 `--approve` 会绕过 trust，已移除并重测。

Live fixture 使用合成本地模型流与真实 stdio MCP server。仅发生一个成功 tool_result，details.mcp 为 true；随后清空 MCP 配置、切换到新 session，再恢复旧会话，不会新增工具请求。服务器子进程在退出前检查已消失。内存 fixture 从 `--no-session` 执行真实 MCP 调用，再 clone，随后 fork 到首条用户输入前的空历史。

真实 loader/registry 测试验证了 inactive definition 保留 renderer、同名 replacement 不自动激活、显式 activation，以及 host exclusion 真正删除 definition。占位在外部重新激活后仍拒绝执行。行测试覆盖成功/失败、展开/折叠、1/24/60/120 列。

## Performance

```bash
PI_MCP_TEST_PI_ROOT="$PI_MCP_TEST_PI_ROOT" node --expose-gc extensions/mcp/__tests__/fixtures/history-benchmark.mjs --baseline
PI_MCP_TEST_PI_ROOT="$PI_MCP_TEST_PI_ROOT" node --expose-gc extensions/mcp/__tests__/fixtures/history-benchmark.mjs
conda run -n codex-py312 python extensions/mcp/__tests__/resume-ui-host.py --pi-root "$PI_MCP_TEST_PI_ROOT" --repeat 10 --baseline
conda run -n codex-py312 python extensions/mcp/__tests__/resume-ui-host.py --pi-root "$PI_MCP_TEST_PI_ROOT" --repeat 10
```

基准使用相同 Node/Pi、合成负载和真实 loader，每负载丢弃首次样本后取五次中位数。Baseline 从 `git show HEAD:extensions/mcp/src/index.ts` 读取旧实现。旧插件没有历史提取工作，基线提取约 0.002 ms 仅是空路径计时，不代表旧方案成功恢复显示。Factory 数字包含真实模块加载，不能解释为 registerTool 的纯耗时。

| Load | Session bytes | Distinct tools | Extraction after ms | Factory before / after ms | Handoff bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small | 4,729 | 4 | 0.314 | 26.837 / 38.112 | 362 |
| Branches, 10,000 entries | 2,417,889 | 200 | 13.072 | 26.895 / 38.215 | 16,034 |
| Large results | 33,580,689 | 4 | 18.919 | 26.430 / 38.810 | 362 |
| Many tools | 1,000,189 | 4096 | 6.793 | 26.690 / 44.478 | 337,802 |

基准全进程峰值 RSS 为基线 345,952 KiB、实现后 449,472 KiB，包含负载构造与 JSON 字符串。大结果负载采样 RSS 为 285,081,600 / 355,385,344 bytes，表明整文件读取和 JSON 解析有可见内存成本，不能称为零成本。该负载只有四个工具，handoff 仍为 362 bytes，没有结果正文缓存。当前没有约定内存或耗时预算，64 MiB 是拒绝上限而非性能承诺。

真实 CLI 的小会话首次对照中，冷恢复 1.027 / 1.051 s，reload 0.437 / 0.439 s，resume 0.443 / 0.461 s，import 0.886 / 0.876 s。PTY 的计时包含固定 0.3 s 接收等待，适合比较同一 fixture，不是精确的宿主内部延迟。

最终连续十次真实 reload 的文件描述符始终为 17，handoff 文件始终为零。RSS 基线从 219,024 升至 223,136 KiB，实现从 223,632 升至 228,624 KiB，均包含宿主加载与 GC 波动，不能据此声称完全没有内存增长。该轮基线 reload 为 0.440–0.468 s，实现为 0.415–0.459 s。另做 100 次纯交接后目录为空，实现 GC 后 RSS 从 287,326,208 到 287,424,512 bytes，没有永久工具目录累积。

额外运行 `resume-ui-host.py --extra-tools 4094 --baseline` 与相同命令去掉 `--baseline`，合计 4096 个历史工具的真实冷启动为 1.032 / 3.516 s，峰值 RSS 为 230,277,120 / 336,461,824 bytes。大量工具在冷 session_start 中逐个调用公开 registerTool 会触发宿主 registry 更新，成本明显高于 factory 预注册。未引入私有批量注册绕过该成本。

采集只发生在 lifecycle，不在 renderer 或 token-update 路径。每阶段只读取目标 JSONL 一次，按去重后的工具名注册。

## Process and cleanup verification

```bash
# 先构建 MCP dist；该脚本只检验进程隔离与文件协议，不是另一个 Pi 版本验收。
node extensions/mcp/__tests__/fixtures/history-process-smoke.mjs
```

真实双进程同时在同一个私有目录发布自己的 handoff，消费只得到本进程工具名。把仍存活进程文件的 mtime 改为旧时间，另一进程不能清除它；相同 PID 不同 boot key 不会误消费。首次子进程 57381、57427 和最终复测子进程 20295、20296 均正常退出，目录文件数为零。

PTY 矩阵宿主 PID 51277、52832、53404、54018、54613、56243 均正常退出；真实 MCP 子进程 52936、53519、54134 也已检查不存在。最后一次生产代码修改后，完整切换与十次 reload（20353）、live（20999，MCP 子进程 21013）、内存 session（21042，MCP 子进程 21056）均重测通过并退出；十次 reload 基线（23185）也已退出。4096 工具冷启动对照进程 86554、86855 已退出。PTY 和进程隔离测试没有监听端口。HTTP 原有 fixture 通过其 close/afterEach 关闭本地监听。临时目录由 finally 删除，不遗留正式或临时交接文件。

## Final checks

首次全仓 check 的 132 个失败集中在 goal root-session 用例，原因是 worker 环境继承 `PI_SUBAGENT_PARENT`；只清除 PI_SUBAGENT 不够。未改 goal 源码。清除 worker/session 环境后，最终全仓类型检查、1115 个测试（87 个文件）、构建和发布包校验均通过，另有两个原有 subagent integration 测试跳过。MCP 定向复测为 18 个文件、253 个测试通过；目标 Pi 0.85.1 的真实 loader/registry 测试另行通过。

```bash
mkdir -p .tmp/mcp-check/{home,tmp,cache,agent}
env -u PI_SUBAGENT -u PI_SUBAGENT_PARENT -u PI_SUBAGENT_LAUNCH \
  -u PI_SUBAGENT_ID -u PI_SUBAGENT_STATE_ROOT -u PI_SESSION_FILE -u PI_SESSION_ID \
  HOME="$PWD/.tmp/mcp-check/home" TMPDIR="$PWD/.tmp/mcp-check/tmp" \
  XDG_CACHE_HOME="$PWD/.tmp/mcp-check/cache" PI_CODING_AGENT_DIR="$PWD/.tmp/mcp-check/agent" \
  JITI_FS_CACHE="$PWD/.tmp/mcp-check/cache" pnpm run check
pnpm exec vitest run extensions/mcp/__tests__
git diff --check
```

已有 codex-ui 改动保留，README 只精准替换过时的 MCP 恢复限制段落。dist 由构建生成，没有手工修改，也没有创建 commit。

## Independent acceptance

Worker 冻结最终修改后，主代理独立复跑 `pnpm run check`。类型检查、1115 个测试、构建和发布包校验全部通过，两个原有测试仍跳过。目标 Pi 0.85.1 的真实 loader 测试也独立通过，没有以 worker 自测代替验收。

主代理复跑七组真实 PTY：默认基线、实现后三次连续 reload、live 基线、live 离线恢复、内存 session、冷 continue 和冷 resume 选择器。恢复、import、reload、fork、clone、tree、取消切换及跨 cwd trust 检查均通过。各组检查实际 handoff 目录为空，宿主和 MCP 子进程退出，没有监听端口。双进程隔离复测的子进程 70152、70153 均退出，残留文件数为零。

独立性能复测中，小会话冷恢复为基线 1.038 s、实现后 1.036 s；实现后三次 reload 为 0.414–0.459 s，文件描述符始终为 17。4096 工具冷启动为 1.040 / 3.380 s，峰值 RSS 为 230,408,192 / 338,460,672 bytes，再次确认边界负载有明显开销。100 次交接后没有文件累积。性能结论仍受前述测量范围限制。

本轮使用仓库内独立临时 HOME、agent directory 和 cache，未改动真实 Pi 配置或用户 session。主代理核对了原有 codex-ui 改动，未覆盖用户工作；没有修改上游源码，也没有创建 commit。

## Deployment and remaining boundaries

首次从不包含交接 hook 的旧实例热加载不能提前补绑已创建的历史行，请重启 Pi 再冷恢复。历史 identity 不依赖服务器在线，旧 schema 不会成为执行兜底。

用户级安装跨 cwd 仍会加载插件；项目级安装在目标 cwd 消失时不保证恢复。Host 明确过滤定义、不加载插件、无写权限、损坏 JSONL、超限或不受支持的文件权限平台会降级。RPC 客户端自己的 UI、同一进程多个独立 SDK runtime、未来 Pi 生命周期版本尚未验收。

崩溃中断使用残留临时文件模拟，未在操作系统 rename 的某个机器指令间强制杀进程。Pi 自身打开/导入 session 可能迁移文件；字节不变的断言只约束插件自己的只读采集。未实际改动真实用户 agent directory，部署权限仍由用户决定。
