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

先完成 open，再复用该次返回引用进行 find/click/screenshot。保留每次调用与结果的对应关系。若服务不支持页面类型、账号不具权限或数据不可核对，写明具体原因并记录 blocked/unverified；不要降低通过条件。

## Report

每个 ID 分别报告 local-contract 与 remote-service 状态。远端证据包括 query/action、运行时间、模型与设置、可核查来源、脱敏结果和失败原因。联网后的清理只涉及本次显式创建的会话或临时文件，按操作者约定保留证据。
