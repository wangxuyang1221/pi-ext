# Product regression fix plan

本文件保留九扩展验证中五项产品问题的修复设计和反例要求。实施进度见 [待办清单](verification-fix-todo.md)，宿主补丁的实际接口与安装边界见 [补丁说明](pi-session-summary-patch.md)。原始复现和证据位于 `.tmp/parallel-verification-TXdlMV/VERIFICATION.md`；以下待定位描述记录方案形成时的状态。

## MCP progress deadline

问题已定位到 [client.ts](../extensions/mcp/src/client.ts) 的 invokeTool。只传 resetTimeoutOnProgress 不够：已安装 MCP SDK 1.29.0 只有在 options.onprogress 存在时才生成 progressToken、注册 handler，并在合法 progress 到达后重置软计时器。

修复时，当 maxRequestTimeout 大于 requestTimeout、启用 progress 延期时，同时传入 onprogress 回调。若当前产品没有进度展示需求，回调只负责启用 SDK 协议，不另建计时器。继续保留外层硬 deadline、AbortSignal、transport 关闭和默认不重放行为。

验收使用 本地失败 SSE 驱动 `.tmp/parallel-verification-TXdlMV/mcp/.tmp/test-results/drivers/protocol.mjs` 提炼正式协议测试：

- 软截止 150ms、硬截止 1000ms，服务每 50ms 发送合法 progress，600ms 完成；确认请求带 token、生产 manager 成功。
- 连续 progress 也不能越过硬截止；超时后服务收到取消且 call 次数为 1。
- 无 progress、未知 token 和停止发送 progress 均不能无限延长；用户取消立即终止、不重放。

普通 fast mock 的 callTool 参数断言不足以验收，须保留真实 transport。无需更改用户配置格式或输出文案。

## Goal account limits

问题已定位到 [quota.ts](../extensions/goal/src/quota.ts)：当前 Pi 1.4.0 Codex adapter 添加 `Codex error:` 前缀，原分类器未剥离。修复为按已核验的包装层逐层标准化，再执行现有精确代码集合、明确文本或 JSON envelope 匹配。限制处理层数，保留原始错误供现有诊断链使用；不要用 contains("quota") 等宽泛匹配。

验收须覆盖两个精确代码 usage_limit_reached/insufficient_quota、Codex 前缀、compaction/summary 外层包装与 JSON 错误。裸 429、rate_limit、鉴权/网络失败、含糊 billing、任意句子提到 quota 均不得转为 usage_limited。

用 installed native adapter 解析合成 SSE，再通过真实 Goal SDK 验证：active 和在途 budget_limited 都能被明确账户额度错误终止为 usage_limited；目标、累计统计不丢失；显式 resume 才继续。普通错误仍保持现有 active→blocked、budget_limited 不覆盖规则。恢复确认接受后的原 restore-runtime 状态断言应通过。

## Search reference scope

问题已定位到 [ref-store.ts](../extensions/codex-search/src/ref-store.ts) 和 [index.ts](../extensions/codex-search/src/index.ts)：磁盘文件与持久化队列按 sessionDir 共用，实际请求却发送当前 sessionId。

将存储身份改为 `(sessionDir, sessionId)`。每次工具执行开始时一次性捕获这两个值，同时用于存储和请求 body.id，防止异步期间切换会话造成混用。建议存储在该目录下按 sessionId 安全编码或散列得到的独立文件，文件中保存格式版本和原 sessionId，并校验身份。队列也按同一文件隔离；load 清空旧内存 map，写入采用同目录临时文件再原子替换。

旧文件没有 session 归属，不能把其中引用自动授予当前会话。保留旧文件，忽略其无归属映射，提示重新 open；不要猜测迁移。相同 session 冷恢复可继续使用其新格式引用；新 session、fork、clone 都须重新建立页面引用。直接输入已有 refId 的兼容行为单列，不顺带改变其契约。

验收保留 本地跨会话失败证明 `.tmp/parallel-verification-TXdlMV/codex-search/.tmp/test-results/codex-search-audit/session-boundary-proof.json`：A open 得引用，B 对同 URL 的 find/click/screenshot 在本地拒绝且没有发请求；B open 后仅用 B 引用；切回/冷恢复 A 仍使用 A 引用。另覆盖同会话并行 open 不丢映射、不同会话并发写互不污染、旧文件不被采纳、文件损坏有明确错误，以及 A 请求在切换至 B 后才返回仍只保存到 A。

## Goal streaming escape

现象已三次复现；精确根因尚未确认，不应直接删掉防旧事件的判断。[scheduler.ts](../extensions/goal/src/scheduler.ts) 的 agent_end 先检查最后 assistant、bound ticket 和 responseOrigin，再处理 aborted；agent_settled 当前主要处理 lastFailure，最后清除 bound。需先在本地失败旅程记录 message_start/message_end/agent_end/agent_settled 的顺序、assistant 时间戳、scheduleId、runGeneration、signal 身份和快照版本，确定取消为何未到达持久化暂停分支。

建议将取消处理绑定到本次有效运行的 ticket 和 signal，而非只依赖最后 assistant 的时间戳。agent_end 与最终 settled 共用幂等停止逻辑，确保在清除 bound 前提交 paused。仍需满足同一 ownerSessionId、goalId、generation、runGeneration；忽略内部 stale-work cancellation、已换目标/会话的旧事件。重试等待 Esc 继续按契约 blocked，已 budget_limited/complete/usage_limited 的优先级保持，关闭普通对话框也不能暂停。

验收以未改断言的 acceptance-tui-driver stream-interrupt 为准：首次 settled 已 paused、目标身份/累计值保留、没有自动新请求；显式 resume 后才继续。重复运行并覆盖工具中断、重试等待、对话框取消、goal 编辑/替换、会话切换、混合用户队列和预算耗尽与取消同时发生。用真实 PTY 及 SDK 事件测试共同验证，不以最终 complete 掩盖中间状态错误。

## Skill mentions resume preview

问题已定位：扩展把 snapshot envelope 存入 user 正文，Pi 的 session-manager 直接取 firstMessage，选择器使用 name ?? firstMessage；Markdown transformer 只影响正文。Pi 1.4.0 已公开 API 中有 Markdown/entry renderer 和 setSessionName，没有会话列表摘要转换接口。

建议补宿主通用的会话预览转换接口，再由 skill-mentions 注册严格的 snapshot 解码投影：有效 envelope 只返回原 task，不返回 skill body。显式 session name 仍优先；损坏或未知协议保持原文，读取不执行 skill、不联网、不重写历史。列表的可读摘要与文本检索应使用一致的转换结果。扩展未加载时保持宿主原行为。

这一方案需要 Pi 上游接口或仓库内可复现的固定版本依赖补丁，不能直接改 node_modules。先以当前依赖做一个最小接口原型，验证选择器枚举历史时扩展已注册，再决定补丁落点；若注册时序不支持，先调整宿主生命周期。不要用自动 setSessionName 作为默认修复：那会改变 unnamed/named 筛选语义，并且无法自然修复尚未打开的旧会话。

验收使用已有真实 /new → /resume 失败旅程：未命名旧会话列表显示原 task，连续两次打开一致；删除 skill 文件后仍显示原 task，选择后卡片和模型快照不变。覆盖用户自定义名称、长/中文/多行 task、多个同文会话、损坏 envelope、native/Codex 普通及 fullscreen、关闭扩展时的行为。首次打开选择器就应正确，不能依赖先进入每个旧会话完成重命名或迁移。

## Delivery checks

每项实现只修改 src、对应测试及必要文档，dist 通过 build 生成。先复现原失败，再验证针对性修复和上述反例，最后运行 pnpm run check。跨层方案的额外范围需体现在最终 diff，尤其是宿主依赖补丁。真实远程质量、额度或计费不由本地固定响应证明。
