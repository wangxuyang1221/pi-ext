# Independent Fast implementation evidence

## Scope

本记录对应 [Implementation #37](https://github.com/wangxuyang1221/pi-ext/issues/37)，实现不带 `agent_type` 的独立 Fast。角色扫描、角色参数合并和目录公布仍由 #38 负责。

环境为 macOS、Node.js v22.22.2、pnpm 11.9.0、Pi 0.87.0。依赖通过 `pnpm install --frozen-lockfile --ignore-scripts` 安装。所有测试数据、缓存、日志和 tmux socket 位于本 worktree；未使用真实用户 Pi 配置或凭证。

## Implementation

- `subagent_spawn.fast` 接受布尔值；显式 false 保留，省略时通过 `pi-fast-mode:get-state` 读取 root 当前开关。请求携带 `promises`，调用方等待注册的响应；没有 Fast 扩展时按关闭处理，多实例响应明确报错。模型校验和开关解析均在调用 manager、预留名额前完成。
- manager 在现有 `PI_SUBAGENT_LAUNCH` 中传递本次 `fast`，并保存到 launch metadata。没有加入新 CLI flag，也不跨扩展导入源码。
- Fast 扩展用 `pi-fast-mode-session` custom entry 保存 `{ sessionId, enabled }`。恢复时采用同一 session 最后的布尔值，只有没有保存值时才读取 launch 初值。保存的 false 与 true 都能在缺少 launch 环境时识别为 child 会话。
- child 加载、`/fast`、reload、恢复和 shutdown 均不调用共享配置保存路径。root 的配置加载、`--fast`、`/fast` 和 shutdown 持久化保持原行为。Fast provider 匹配和明确拒绝处理代码未改变。
- 每次缺省 spawn 查询开关一次；显式值不查询。会话 entry 在加载时反向扫描一次，命令和 provider 请求不重新扫描。测试对查询次数和加载后的 20 次请求作了断言。

## Primary interface evidence

Context7 的 [Pi extensions 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) 确认 `appendEntry`、`sessionManager.getEntries()` 和 `pi.events` 契约。Context7 没有提供 0.87.0 固定版本，因此同时核验了本地安装的 0.87.0 发布源码：

- `dist/core/session-manager.js` 的 `_persist` 对已 flushed 的空 session 文件立即追加 custom entry，即使还没有 assistant；manager 保留原有预创建空文件路径。
- `dist/core/event-bus.js` 的 emit 不等待 listener 返回值；本实现显式等待请求中的 promises。
- `dist/api/openai-codex-responses.js` 实际 SSE 请求 body 使用 zstd 压缩。fixture 在 fetch 边界按 `Content-Encoding` 解压后记录 JSON，没有用 CLI 参数或 footer 推断请求。

## Red and green

每轮先运行新增行为测试，确认失败来自尚未实现的行为，然后修改源码。原始失败记录见 [Red logs](fast-implementation/tdd-red.log)。

| Behavior | Red | Green |
| --- | --- | --- |
| child 初值 true/false 在首次回复前保存且不写共享配置 | custom entry 为 undefined | child-session + extension，24 tests 通过 |
| `/fast off` 后 reload/resume 保留 false，缺少 launch 不退回共享路径 | reload 后实际 payload 仍为 priority | Fast 全套，69 tests 通过 |
| spawn 显式值与继承 | 缺省参数没有解析成 true | tools，31 tests 通过 |
| 读取实际开关，模型不匹配时仍可继承 true | 事件返回 false | 相关 Fast 与 subagent 测试通过 |
| true/false 经生产入口进入 launch metadata | metadata.fast 为 undefined | Fast + tools + index，共 115 tests 通过 |

补充的异步响应、重复 owner、请求阶段扫描次数检查也通过。测试设施联调中的 source-loader alias、zstd、root UI binding 和 tmux 按键问题没有计作产品 Red。既有 tmux 测试曾因长 worktree 路径超过 macOS socket 上限失败；仅缩短测试临时目录前缀后，原 6 项断言全部通过。

## Real host and child verification

[fast-production.test.ts](../../../extensions/subagent/__tests__/fast-production.test.ts) 使用真实 root `createAgentSession` JSON host。离线模型通过实际 tool call 调用 `subagent_spawn`，经过生产工具、manager、隔离 tmux、Pi CLI 和完整发布包启动 child。child 是真实交互 TUI；`/fast`、`/reload` 和 `/quit` 通过 tmux 输入并使用 Pi 的 Alt+Enter 提交。

[fast-provider.ts](../../../extensions/subagent/__tests__/fixtures/fast-provider.ts) 只替换 provider 的认证返回和 HTTP transport。Codex 请求构造器、Fast hook、zstd 编码与 SSE 解析仍使用 Pi 0.87.0 实现。固定 SSE 返回只控制测试回复与错误，不替换 spawn 参数传递、child 生命周期、持久化或 Fast 注入。测试验证的是实际出站字段，不代表服务端最终调度或计费等级。

全部 HTTP JSON body 保存在 [requests.json](fast-implementation/requests.json)，`requests` 按 root 和 child a/b/c/d 分类。`service_tier` 缺失表示扩展没有请求 priority。

| Scenario | Actual request |
| --- | --- |
| root off，child a 显式 on | root 无 tier；a 为 priority |
| a 首次 assistant 前 `/fast off`，launch 初值仍为 true | session 文件已保存 false；reload 后 a 无 tier |
| root on，child b 显式 off | root 为 priority；b 无 tier |
| root on，child c 省略 fast | c 为 priority |
| root 随后 off，b `/fast on` | b、c 为 priority；a 无 tier；共享配置保持 root off |
| b 返回 unsupported_service_tier | 当前请求失败，不自动重放；下一请求无 tier |
| sibling c 在 b 拒绝后继续请求 | c 仍为 priority |
| c 返回普通参数错误后重试 | 两次均为 priority |
| root off，后续 child d 省略 fast | d 无 tier |
| 已退出的 a、c 会话不带 launch 环境恢复 | a 无 tier，c 为 priority；恢复及 shutdown 均不改共享文件 |

还检查了 child 初值 custom entry 在 assistant 之前落盘，a 的 true→false 切换在没有 assistant 时已写入文件，child 请求工具没有 `subagent_*`，custom entry 不进入模型上下文。真实 Pi/child 的共享配置与角色哨兵文件在各阶段逐字节比较，生命周期检查点列在 requests.json 中。

原有 [host-compatibility.test.ts](../../../extensions/openai-fast-mode/__tests__/host-compatibility.test.ts) 同时验证真实 host 的规范化 Codex 请求及明确拒绝后的状态变化。Fast 单元回归覆盖 openai 本地名单匹配/不匹配、其他 provider、其他 Codex 模型、限流、网络错误、普通参数错误、模糊错误、root `--fast` 和 `/fast` 持久化。

## Commands and results

下面命令均从本 worktree 运行。默认 `pnpm run check` 会跳过通过环境开关控制的生产集成，实际 child 验收使用单独命令开启，不能把默认 check 的结果当作 child 验收。

```sh
TMPDIR="$PWD/.scratch/tmp" XDG_CACHE_HOME="$PWD/.scratch/cache" PI_OFFLINE=1 pnpm run check
TMPDIR="$PWD/.scratch/tmp" PI_OFFLINE=1 pnpm exec vitest run extensions/subagent/__tests__/runtime-integration.test.ts
TMPDIR="$PWD/.scratch/tmp" PI_OFFLINE=1 PI_SUBAGENT_ISOLATED_INTEGRATION=1 PI_SUBAGENT_FIXTURE_DIST=1 pnpm exec vitest run extensions/subagent/__tests__/production-integration.test.ts
PI_SUBAGENT_ISOLATED_INTEGRATION=1 PI_FAST_EVIDENCE=adventure/32/evidence/fast-implementation/requests.json TMPDIR="$PWD/.scratch/tmp" PI_OFFLINE=1 pnpm exec vitest run extensions/subagent/__tests__/fast-production.test.ts extensions/openai-fast-mode/__tests__/host-compatibility.test.ts
```

- [check.log](fast-implementation/check.log)：类型检查通过；167 files、2,548 tests 通过，13 tests 由既有环境开关跳过；构建和发布包校验通过。
- [runtime-integration.log](fast-implementation/runtime-integration.log)：6 tests 通过，包含 fish、新旧 tmux server 身份与死 pane 清理。
- [production-integration.log](fast-implementation/production-integration.log)：10 tests 通过，包含 source/发布包启动、延迟握手、fish、认证环境/落盘优先级与缺失凭证。此命令使用发布后的 dist 入口，dist 由构建生成。
- [fast-production.log](fast-implementation/fast-production.log)：真实独立 Fast 场景及 2 项原有 host 场景通过。

## Cleanup and boundaries

真实 child 测试用 `/quit` 执行 shutdown 后验证 PID 退出。finally 关闭隔离 tmux server，轮询已记录 PID 全部退出，并验证 socket 无法列出 session。requests.json 和生产回归日志记录每轮清理结果。测试没有打开 HTTP 监听端口，HTTP fixture 在进程内返回固定响应；所有临时场景目录均在测试结束时删除。

本关不实现或宣布角色文件功能通过。角色哨兵只证明 child 没有修改文件；目录解析、description 可见范围和角色 fast 合并仍由 #38 验收。没有在线 provider 请求，也不验证服务端实际 Fast 调度。
