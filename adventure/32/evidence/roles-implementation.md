# Role implementation evidence

## Scope

本记录对应 [Implementation #38](https://github.com/wangxuyang1221/pi-ext/issues/38)，完成 [Spec #33](https://github.com/wangxuyang1221/pi-ext/issues/33) 的角色配置和整体验收。独立 Fast 的实现与已验收事实沿用 [#37 证据](fast-implementation.md)，本关补充角色接入后的实际组合路径，并运行完整回归。

环境为 macOS、Node.js v22.22.2、pnpm 11.9.0、Pi 0.87.0、jsonc-parser 3.3.1。未安装额外依赖。测试 HOME、TMPDIR、XDG 目录、tmux socket、会话和模型记录均位于本 worktree，未读取真实用户凭证。

## Implementation

- [roles.ts](../../../extensions/subagent/src/roles.ts) 仅扫描用户 agent directory 下一级 `agents/*.jsonc`。支持注释、末尾逗号和四字段全省略，拒绝非对象、未知字段、无效字段类型及无效 model 格式。错误逐文件记录，目录缺失视为空目录；其他目录读取错误也作为 root 诊断返回。
- [index.ts](../../../extensions/subagent/src/index.ts) 只在 root 创建角色快照。合法角色 map 同时交给工具说明和 spawn，诊断在 root 的 session_start 提示。Pi reload 重新加载扩展，替换整个快照；没有 watcher，也不在 spawn 时读取文件。
- [tools.ts](../../../extensions/subagent/src/tools.ts) 新增 `agent_type`，三个运行参数按显式值、角色值、当前 root 设置取值。使用 nullish 合并保留 false；类型查找及最终模型注册表验证先于 manager.spawn。只有 task、cwd 和已解析的运行设置交给 manager，不传 description 或 agent_type。
- child 的 model、thinking、fast 继续使用已有 launch metadata 与会话机制。本关没有改变身份、随机显示名、容量、认证或生命周期实现，也未改动 Fast 产品源码。
- [README](../../../README.md) 说明角色目录、字段、调用优先级、错误隔离及 reload 行为。

快照加载成本是一次目录读取和每个候选文件一次内容读取；排序用于稳定目录输出。每次 spawn 是一次 map 查找、一次最终模型注册表查找，仅缺省 Fast 时查询 root 状态。真实场景在修改、删除和改坏文件后仍使用旧值，新增文件在 reload 前仍拒绝，能够检出每次 spawn 重读目录或文件的实现。

## Interface verification

Context7 查询 `/earendil-works/pi` 的[官方扩展文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)，确认 registerTool 与 reload 接口。该来源没有 0.87.0 固定版本，本关复核安装版本的 `dist/core/extensions/loader.js`、`dist/core/agent-session.js` 和 `dist/config.js`：工具按名称注册；reload 先 shutdown，再重新加载资源及构建 runtime，最后发 session_start；默认 agent directory 为 `~/.pi/agent`，支持 `PI_CODING_AGENT_DIR`。

Context7 未找到匹配 jsonc-parser 的条目，改用本地安装的官方 3.3.1 发布包 `lib/umd/main.d.ts` 与实现核验 parse、ParseError、printParseErrorCode 和 allowTrailingComma。解析器会容错返回值，因此本实现显式拒绝 errors 非空的文件。

实际 HTTP fixture 使用 Pi 0.87.0 的 `openai-codex-responses.js`。本关发现原 fixture 把 streamSimple 直接交给 stream，导致 reasoning 映射丢失，已让两种入口分别调用 Pi 对应原生函数；`simple-options.js` 确认 fetch 与 payload hook 继续传递。只替换认证返回和离线 HTTP transport，model/thinking/Fast 请求构造、zstd 编码、SSE 解析均由 Pi 执行。

## Red and green

[Red 日志](roles-implementation/tdd-red.log) 保留实施顺序，未将夹具联调失败计作产品 Red。

| Behavior | Red | Green |
| --- | --- | --- |
| JSONC 角色与空对象加载 | 加载结果为空，缺少 worker 和 empty | loader 首轮 1 test 通过 |
| 缺失目录与文件级隔离、旧快照不污染 | 缺失 agents 目录抛出 ENOENT，普通启动无法继续 | loader 2 tests 通过，覆盖九种错误文件与合法文件共存 |
| 工具目录、角色默认与显式覆盖 | spawn 工具说明没有 worker/description | tools 32 tests 通过，断言 manager 只收到解析参数，Fast 查询次数正确 |
| root 真实目录接入与错误提示 | root 工具说明缺少加载文件的 description | index、tools、roles 共 50 tests 通过 |

后续补充默认 HOME 路径、未知类型/最终模型拒绝和 child 不调用 loader 的回归，最终 [定向测试](roles-implementation/targeted.log) 为 51 tests 通过。默认目录和自定义 `~/agent` 分别有入口测试。其他直接通过的补充断言不宣称曾出现产品 Red。

真实夹具联调中修正了三项测试设置：ManagedAgent.model 是字符串、场景同时保留三个 child 时需将测试容量设为 4、streamSimple 需保留 Pi reasoning 映射。没有为了通过测试修改产品容量或削弱请求断言。

## Real root and child evidence

[fast-production.test.ts](../../../extensions/subagent/__tests__/fast-production.test.ts) 沿用 #37 的真实 root createAgentSession、工具调用、manager、隔离 tmux、Pi CLI 和完整发布包 child。root 调用由离线模型的实际 tool call 产生，root reload 调用 Pi 的原生 reload；child 的 `/fast`、`/reload`、`/quit` 经 tmux 交互输入。测试没有用工具注册 mock 代替此链路。

[requests.json](roles-implementation/requests.json) 保存 60 个实际 HTTP JSON body，包含 root 与 11 个 child，并保存 root reload 前后工具目录、child 初始及 reload 工具信息、13 个共享文件检查点、7 次错误调用和清理记录。模型请求中缺少 service_tier 表示未请求 priority，不代表服务端已验证模型能力或实际调度等级。

| Scenario | Observed result |
| --- | --- |
| root off，worker 默认 model/高 thinking/Fast on | a 请求 role-fixture、high、priority |
| root on，worker 显式 model/低 thinking/Fast false | b 请求 fast-fixture、low，无 service_tier |
| 空角色的字段继承 | c 请求 root 当时的 fast-fixture、medium、priority；后续 d 继承 root off |
| worker 文件改值，removed 删除，damaged 改坏，added 新增，但尚未 reload | 工具目录保持旧 description；worker/removed/damaged 仍按旧快照成功启动，added 拒绝 |
| root reload 后 | 工具说明使用新 description，added 出现，removed/damaged 消失；后续 worker 使用新 model、low、Fast off，added 使用 Fast on |
| root on，角色显式 Fast false | role-false-over-root-on 实际请求无 service_tier |
| 已有 child 经 root reload | a launch metadata 不变，请求仍是旧 role-fixture/high；c 仍请求 priority |
| missing、broken、project-only、unknown-model 及 reload 后 removed/damaged | 明确错误；root children 和 reservations 逐项相等，没有分配或启动 child |
| 同目录合法、错误文件与普通启动 | 启动及 reload 都提示文件名/原因；合法角色和普通 spawn 成功，项目 `.pi/agents` 不参与加载 |
| child 初始启动和 `/reload` | getAllTools 无 subagent 编排工具；所有 child HTTP 请求均无 agent_type、角色描述、角色目录或 Fast custom entry |
| 首次 assistant 前切换 Fast | a 初值 true 及切换 false 均已写入会话；child reload 保留 false，launch true 不覆盖 |
| child 切换、退出、无 launch 恢复 | b 切换不影响 root/sibling；a 恢复 false，c 恢复 true；共享配置及全部角色文件逐字节不变 |
| Codex 明确拒绝与其他错误 | b 当前失败不重放，之后不注入；c 不受影响，普通参数错误后仍注入 |

文件检查点同时比较 agents 目录文件名集合和每个文件内容，并检查项目角色哨兵，防止漏检删除文件被重新创建。测试主动改动的角色内容会更新对应预期，child 生命周期不能额外改写这些内容。

## Full Spec acceptance matrix

| Spec acceptance | Evidence and result |
| --- | --- |
| 用户 worker、自定义 agent directory、排除项目角色 | 入口默认/自定义测试和真实 worker/project-only 场景，通过 |
| 四字段选填，model/thinking 缺省继承 | loader 空对象、工具合并、真实 empty 请求，通过 |
| 显式覆盖含 false，文件不改写 | 真实 b 和全部文件检查点，通过 |
| root 可见合法角色与 description，child 不注入 | rootCatalog、beforeReloadCatalog、afterReloadCatalog 与全部 child payload，通过 |
| 新增修改删除只在 reload 生效，已有 child 不变 | 真实快照场景与旧 child metadata/model/reasoning/Fast，通过 |
| 错误隔离与提示，改坏不沿用旧配置 | loader 九种错误、真实 broken/damaged 通知及拒绝，通过 |
| 类型/最终模型启动前拒绝，不消耗资源 | 真实 rejections 的 children/reservations 相等和工具单测，通过 |
| child 启动/reload 无编排工具、目录、description | 实际 child 工具记录与请求全文断言，入口 spy 确认不调用 loader，通过 |
| 父 off 子 on、父 on 子 off 的实际请求 | a/b、角色 false 场景及 #37 兼容证据，通过 |
| 缺省继承 root 当时开关，随后父子/sibling 独立 | c/d、root 切换和 child b 切换，通过 |
| 首次回复前保存，reload/resume 保留最终开关 | 实际 a 初次 hold、reload，a/c 无 launch 恢复，通过 |
| 全生命周期共享配置/角色文件不变，root 持久化保留 | 文件检查点及 Fast 全套回归，通过 |
| Fast 匹配、明确拒绝、非支持错误、模型及代理隔离 | 实际 b/c 请求、2 项 host 回归与 #37/Fast 全套单测，通过 |

Deferred verification 中的配置加载→spawn、root/child 边界、生命周期与完整回归均已覆盖。身份、随机显示名、容量及认证同时由既有 subagent 回归和下面生产门控验证；本关没有改写这些实现。

## Commands and results

所有命令从本 worktree 运行。先创建 `.scratch/home`、`.scratch/tmp`、`.scratch/config`、`.scratch/data`、`.scratch/cache`，各命令均使用以下环境：

```sh
export HOME="$PWD/.scratch/home"
export TMPDIR="$PWD/.scratch/tmp"
export XDG_CONFIG_HOME="$PWD/.scratch/config"
export XDG_DATA_HOME="$PWD/.scratch/data"
export XDG_CACHE_HOME="$PWD/.scratch/cache"
export PI_OFFLINE=1
pnpm run check
pnpm exec vitest run extensions/subagent/__tests__/runtime-integration.test.ts
PI_SUBAGENT_ISOLATED_INTEGRATION=1 PI_SUBAGENT_FIXTURE_DIST=1 pnpm exec vitest run extensions/subagent/__tests__/production-integration.test.ts
PI_SUBAGENT_ISOLATED_INTEGRATION=1 PI_FAST_EVIDENCE=adventure/32/evidence/roles-implementation/requests.json pnpm exec vitest run extensions/subagent/__tests__/fast-production.test.ts extensions/openai-fast-mode/__tests__/host-compatibility.test.ts
```

- [check.log](roles-implementation/check.log)：类型检查通过；168 files、2,554 tests 通过，13 个门控测试默认跳过；构建及发布包检查通过。验证了 8 个扩展入口、1 个 theme 入口、13 个 MCP 模块及发布排除边界。dist 全部由构建生成。
- [runtime-integration.log](roles-implementation/runtime-integration.log)：6 tests 通过，包含 fish、tmux 重启/重命名、活/死 pane 清理。
- [production-integration.log](roles-implementation/production-integration.log)：10 tests 通过，覆盖发布入口、完整包、延迟握手、fish、认证环境/落盘优先级和缺失凭证。
- [fast-production.log](roles-implementation/fast-production.log)：角色/Fast 真实组合及 2 个既有真实 host 场景，共 3 tests 通过。
- `git diff --check` 通过。

默认 check 中的两个旧门控 `integration.test.ts`、`isolated-integration.test.ts` 未另外启动；本关使用更完整的 production-integration 和 fast-production 链路。没有在线 provider 请求，不验证服务端 Fast 实际调度或计费；不新增 provider 支持，不验证项目级角色或 Codex 角色兼容，这些均不在 Spec 范围。

## Cleanup

每个真实 child 都通过 `/quit` 正常退出，finally 关闭本任务的隔离 tmux server，检查记录的 PID 全部退出、socket 无法列出 session，再删除临时场景。production 日志每个场景都有清理记录；requests.json 的 cleanup 记录角色组合的全部 PID、空 livePids 和 socketUnavailable=true。

本轮未创建 HTTP 监听端口，离线 fetch 在进程内返回 SSE。最终核对本任务记录的进程已退出，没有遗留 `.sa-*` 或 `.subagent-*` 场景目录；未操作既有用户进程。测试缓存与本关日志保留在 worktree 中，供复查。
