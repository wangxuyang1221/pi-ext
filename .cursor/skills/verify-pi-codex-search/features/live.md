# Manual live acceptance

此分支由已有授权账号的操作者手动执行，会使用真实远端服务并可能产生用量。自动本地验收不读取用户凭据、不复制 auth 文件，也不发远端或付费请求。没有执行本节时，以下七个 ID 的远端分支保持 unverified，整体 ID 不能仅凭本地通过改为 passed。

## Prepare

由操作者使用已登录的 Pi 环境加载 `-e extensions/codex-search/src/index.ts`。先在 `/codex-search-settings status` 确认 baseUrl 为预期真实服务，使用菜单启用 standalone，记录模型、freshness、context 与时间。保留工具参数和经过脱敏的结果、来源、会话关联；证据中不包含 token、Cookie、Authorization 或账号标识。不要把本地 loopback fixture 配置用于此分支。

## Drive

| ID | 操作与通过条件 |
| --- | --- |
| `search-responses` | 用 codex_search 查询两条含当前日期的可核查问题。检查每条回答的来源能打开，答案与来源正文一致；分别用 live/indexed/cached 记录实际行为，不由本地参数断言推导时效性。 |
| `search-standalone` | 用 codex_standalone_web 执行一次真实网页动作，核对工具返回内容与实际页面一致，并记录服务端拒绝或限制。 |
| `search-open` | 打开操作者选定的公开文档 URL，记录结果中真实 refId、页面标题和正文片段。 |
| `search-find` | 在同一已打开 URL 中查找页面确实存在的词，核对命中位置与页面正文；再查一个不存在的词，确认结果不会编造命中。 |
| `search-click` | 使用该页面结果实际列出的 link id 点击，核对目标 URL 与页面链接一致。 |
| `search-screenshot` | 打开真实可截图文档，使用同一 URL 与合法 pageno，检查返回图像确为该页；记录图像或服务限制，不能把返回文本当成截图通过。 |
| `search-lookups` | finance/weather/sports/time 各执行一次，记录参数、数据时间、时区及来源；与对应权威来源核对，不能仅检查命令发送成功。 |

先完成 open，再复用该次返回引用进行 find/click/screenshot。每次 standalone 调用只提交一个动作，包括存在词和不存在词的 find 也要分开。保留每次调用与结果的对应关系。若服务不支持页面类型、账号不具权限或数据不可核对，写明具体原因并记录 blocked/unverified；不要降低通过条件。

## Bounded SDK driver

需要可重复的真实工具调用时，使用 `scripts/live.mjs`。先取得现有 Pi 账号及请求额度授权，再运行 Doctor。驱动只复制该账号的 openai-codex 凭据到仓库 `.tmp/` 下的独立运行目录，固定使用 `gpt-5.6-sol`、SSE、关闭宿主重试和模型目录联网。账号不可用或模型不可用时停止，不替换账号。

创建新的 `.tmp/<本次运行>/`，在其内写预算文件，字段为 `requests`、`maxRequests`、`deadline` 和 `allowedOrigins`。`requests` 必须包含本次此前已经使用的请求；`maxRequests` 不得超过授权额度或 40；`deadline` 是未来的 Unix 毫秒时间；当前服务允许来源为 `https://chatgpt.com`、`https://auth.openai.com`。不要覆盖已有预算来重置计数。

```bash
LIVE_VERIFY_STATE="$PWD/.tmp/<本次运行>/budget.json" pnpm exec node .cursor/skills/verify-pi-codex-search/scripts/live.mjs .tmp/<本次运行>/search --authorized-live
```

看到 `ready: true` 后，通过 stdin 逐行提交 JSON。每条使用唯一 label，等待该条 evidence 返回并核对结果后再提交下一条；远端失败后先重跑 Doctor。此入口不获取共享验证锁，必须由单个协调者串行驱动。

```json
{"label":"open","tool":"codex_standalone_web","args":{"urls":["https://docs.python.org/3/library/json.html"],"search_context_size":"medium"}}
{"label":"find","tool":"codex_standalone_web","args":{"find":[{"url":"https://docs.python.org/3/library/json.html","pattern":"JSONDecodeError"}],"search_context_size":"medium"}}
{"quit":true}
```

`live-network.mjs` 对当前 Node fetch 计数，包含认证刷新、模型请求及失败请求，拒绝非允许来源、重定向和超额请求，禁用 WebSocket。计数只约束加载该模块的进程，其他入口若发真实请求仍须共用预算，不能据此宣称整机流量受控。

每条结果写入 `<label>.json`，工具返回成功只代表调用结果可供审查，不等于页面、图像或数据正确。退出提交 `quit` 或 EOF，SIGINT/SIGTERM 也执行清理。核对 `summary.json` 无 failure/cleanupError、`cleanup=removed`、`credentialsRemoved=true`，并确认记录的 PID 退出、预算锁释放。仅保留脱敏结果、设置和会话，认证、缓存及 refs 随 runtime 删除。不可处理的强制终止后须核对本次 PID，再删除其 runtime，不能留下 auth。

## Report

每个 ID 分别报告 local-contract 与 remote-service 状态。远端证据包括 query/action、运行时间、模型与设置、可核查来源、脱敏结果和失败原因。

设置菜单会立即写配置并 reload。执行前记录本次允许修改的配置路径和原始字节，结束后按操作者约定恢复；优先使用专用隔离配置。页面动作还会写入该 session 的独立 refs 文件，清理时核对其归属，只处理本次创建的 session、refs 和临时文件，保留脱敏证据。
