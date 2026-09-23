# Dynamic metadata execution todo

## Understanding

原动态目录改造已交付为 `98cb4e8`；本轮接续修复两个过渡状态回归，并新增用户手动设置版本的 `/codex-metadata`。完整设计唯一来源为 [implementation design](codex-compact-dynamic-metadata.md)，本轮依据 D6.2、D10 和下面 F1–F5、H13–H15 执行。T1–T6 及原 Results 保留为先前交付记录，不代表新增范围已完成。

## User Visible Changes

- 在账号及配置的客户端版本可见范围内，新增模型可自动获得 hash；不需要编辑插件模型表。模型选择动作本身不查询目录，首次实际请求可能等待一次目录 GET，随后使用缓存。
- 目录不可用、缺少对应模型或使用自定义代理时，hash 为未知，不因此阻止对话或强制压缩；上下文容量检查继续执行。离线冷启动下，旧静态表曾覆盖的模型也可能没有 hash，旧 checkpoint 已记录的 hash 仍保留。
- 可在已有配置中设置 `metadataClientVersion`，默认 `0.156.0`。目录受客户端版本门槛影响，仍可能需要更新该配置或扩展默认值；不要求安装 Codex CLI，不自动升级 Pi 或注册模型。
- 恢复会话后，同 hash 的 B→C 候选不再遮蔽历史 A→C 的必要过渡；从历史恢复的过渡超窗失败后，追加 error/aborted assistant 也不会让下一次请求跳过过渡。
- 用户可通过 `/codex-metadata` 查看实际版本和来源，使用 `version <版本>` 保存全局覆盖，或 `reset` 删除全局覆盖。项目优先级保留，结果会显示项目覆盖；成功保存后下一次请求使用新配置，进行中的请求不受影响。

追加变化已获用户授权；具体内部策略由 expert 设计。不包含提交、发布或代理对真实外部配置的修改；实现和测试命令时使用仓库内隔离配置。运行产品后，用户显式执行 version/reset 才写全局配置。

## Todo

### 1. Implement

- [x] T1：按 D2–D4 改造 `config.ts`、`capabilities.ts`，移除静态模型表，建立配置校验、严格目录解析与不可变 O(1) hash 快照；满足 H1、H2 的行为和成本条件。
- [x] T2：按 D4–D5 新增 `src/model-metadata.ts`，通过宿主认证查询官方目录，落实身份隔离、4-scope 内存上限、300 秒 TTL、30 秒退避、共享请求和取消；满足 H3–H6、H10 的功能、资源和请求次数条件。
- [x] T3：按 D3、D6.4 修改 `remote-compaction.ts` 的显式 hash 输入，生成 checkpoint 时只使用本次值，保持直接调用兼容；满足 H7，不改会话格式或远端压缩算法。
- [x] T4：按 D6 修改 `session-coordinator.ts`，选择阶段记录候选，请求及恢复入口取得一次快照，覆盖清单中的全部 hash 使用点和 factory 参数；满足 H8、H10–H11，并保持连续压缩和失败恢复契约。
- [x] T5：按 D7 在 `index.ts` 创建、注入和清理 store，接通 Pi-triggered 压缩快照，迁移对应 fixture 与调用方；满足 H9–H11 的真实生产路径及加载验收。

### 2. Deliver

- [x] T6：按 D9 更新 README 和 UPSTREAM，准确说明版本门槛、目录缺失和验证边界；完成 H12 后记录实际结果，确认无任务进程或临时资源遗留，交付本地改动和未覆盖项。

### 3. Follow-up implementation

- [x] F1：按 D6.2 重排候选解析及无有效 transition 时的历史回退；先完成局部 pending 赋值，map 写回留给 F2；满足 H13 R1/R3 和一次 resolver、一次必要历史恢复的成本约束。
- [x] F2：按 D6.2 保存历史恢复出的 PendingSelection，保留成功、失败及生命周期清理语义；满足 H13 R2/R3，超窗重试不跳过过渡、不增加重复解析。
- [x] F3：按 D10.2–D10.3 扩展 config.ts 的版本校验、带来源查询及单字段全局更新；满足 H14 的字段保留、原子写入、信任和错误边界，无网络及额外请求路径开销。
- [x] F4：按 D10.1–D10.2 新增 metadata-command.ts 并在 index.ts 注册，适配现有 fake ExtensionAPI；满足 H14 的真实注册 handler 到配置到 provider hook 路径，零命令网络调用、保留运行中快照。
- [x] F5：按 D10.4 更新 README 的 Codex Compact 节及 UPSTREAM 本地差异说明，完成 H15 后填写追加验收记录，交付实际结果和未覆盖范围。

## How To Test

H1–H12 的先前执行结果保留在原 Results 中；H13–H15 为本轮新增要求，尚未执行，不能以原型或旧基线替代。按对应 Todo 先写能因旧行为失败的测试，确认 Red 后实现到 Green，再在保护测试下重构。已有通过的回归只需验证保持，不人为改坏它来制造 Red。功能和性能条件均通过才能勾选 Todo。

### H1. Configuration

位置：`extensions/codex-compact/__tests__/config.test.ts`，在 T1 前编写。

- 默认取得 `0.156.0`；全局合法值及受信任项目合法值按优先级合并。使用仓库内隔离目录，不写真实 `~/.pi`。
- 不可信项目内容不读取；项目非法值不覆盖有效全局值；全局非法值回退默认。
- 非法输入覆盖数字、null、空字符串、前后空白、`v0.156.0`、`0.156.0-beta`、`0.156.0?x=y`、首段/次段前导零、超过 32 字符。既有三个压缩配置字段测试不变。

### H2. Catalog and Snapshot

位置：重写 `__tests__/capabilities.test.ts`，在 T1 前编写。移除“只采用冻结表”“builtin 自带 hash”的旧预期；这些预期不再代表需求。

- fixture 使用任意名字 `model-a/model-b/model-c/future-model`；a/b hash 相同而窗口字段不同，c hash 不同。精确查找返回原字符串，窗口字段不影响比较。
- 缺失、null、空、全空白 hash 为 undefined；数字 hash、过长 hash、重复 slug、非法顶层、超过 4096 项、非法 slug 使整个目录不可用。4096 项及 256 单元边界合法。
- `future-model` 无代码名单也可被读取；`namespace/future-model` 和 `future-model-variant` 不继承其 hash；伪造 `model.compHash` 不生效。非 Codex provider/API 或其他配置地址不能借用快照。
- 构建完成后改动输入 fixture 不改变快照；构建下一份目录不改变旧快照；外部拿不到可变 Map。只保留 ID/hash，描述、提示词、context_window 不进入快照。
- Map 按 ID 建索引，不允许 `.find()` 或全数组扫描用于每次 hashFor。对 10、1000、4096 项目录分别构建，再执行 10000 次查询，fetch/body 消费计数不变；检查实现没有随每次 lookup 复制目录。这是确定性成本和代码结构验收，不设机器耗时阈值。

### H3. Authentication and HTTP

位置：新增 `__tests__/model-metadata.test.ts`，在 T2 前编写。用真实 store，仅替代 `ctx.modelRegistry.getApiKeyAndHeaders` 的认证返回与 fetch 传输。所有 token 都是合成 JWT，测试不得读取真实认证。

- 官方三种 baseUrl 形式及尾部斜杠归一为同一 models URL，使用配置版本。断言 GET、无 body、`redirect: error`、JSON accept、Bearer/account header 来自模拟的宿主认证；不带 Responses beta、turn-state 或 session 头。
- `auth.baseUrl` 优先于 model.baseUrl。有效地址非官方、含 query/fragment/用户名密码则 0 GET，不向另一个地址发送凭证；非 Codex 模型连认证也不调用。
- 认证缺失、返回 ok=false、抛错、JWT 缺账号，均返回 unavailable；无新日志、通知、ctx.abort 或文件写入。原始错误含合成 secret 时，返回值和 diagnostics 均不得包含它。
- 401、403、429、500、重定向、网络失败、无效 JSON/schema 均为发现失败。错误 body 可设置为含 secret，断言不读取其正文；没有第二次自动请求，也不调用压缩重试器。
- response body 超 8 MiB 且没有/谎报 Content-Length：读到超过限额即 cancel，不 JSON.parse 全部正文。覆盖恰好上限以及网络只回头部、不结束 body 的情况；后者由 3000ms timeout 取消。

### H4. Cache and Discovery

同一测试文件，使用注入单调时钟与可控 fetch。网络数据以合法响应生成，不能直接写 store 私有字段。

- 先返回旧目录，再返回包含 `future-model` 的新目录。在 `t=0` 首次 GET；`t=299999` 已知模型命中缓存；`t=300000` 刷新并发现新模型，无任何模型表修改。
- 成功后未知当前模型在 `t=1..29999` 不触发 GET；`t=30000` 只额外刷新一次。100 个不同未知 ID 在同一窗口内不产生 100 个请求或 cache entry。
- 新目录删除旧模型时，查找变成未知，不与旧目录合并。当前缺失模型不能按前缀猜值。
- 一次失败后至 `retryAt-1` 均不请求，`retryAt` 允许一次请求。首次失败没有 hash；过期缓存刷新失败不使用过期 hash；因未知模型刷新失败时，仍在 300 秒以内的旧 snapshot 可继续使用其他已知值。
- 100 个相同 scope 的并发 resolve 只调用一次 fetch；新鲜缓存下 100 次已知 resolve 仍只有首次 1 GET 和 1 次 body 消费。宿主认证每次入口解析属于约定成本，不误判为应缓存凭证。
- 修改 token、账号、配置地址或 clientVersion 后不复用其他 scope 的 hash。实现允许最多 4 entry；第 5 个淘汰 idle LRU；4 个全部 pending 时第 5 个返回 unavailable、fetch 总数保持 4。完成一个后新 scope 可进入。

### H5. Cancellation and Late Results

同一测试文件，采用延迟认证 Promise、延迟 fetch、可观察 AbortSignal 与可控 body reader。

- 预先取消：0 认证/0 GET；认证期间取消：调用者结束，稍后释放认证 Promise 也不启动 GET；宿主认证 Promise 迟到 reject 不产生 unhandled rejection。
- 未传 caller signal 的 resolve 仍在等待认证时，调用 clear/cancelPending 也立即解除等待；此后新 resolve 使用新生命周期 signal，不能被旧认证结果污染。
- 两个等待者共享 GET：取消第一个，其 Promise 取消，第二个仍得到结果；取消最后一个时底层 signal aborted。外部取消不创建 30 秒失败退避。
- 取消唯一冷查询后，同一 scope 立即重试可以启动新 GET；旧 Promise 迟到完成不得恢复旧 attempt 时钟或清除新 pending。
- 超时属于发现失败并退避；明确的外部取消向上抛取消，不返回 available/unknown 冒充正常完成。
- cancelPending 后已有成功缓存仍可使用，但进行中的结果不能发布；clear 后所有缓存消失。即使 mock fetch 在 abort 后仍 resolve，旧结果不能覆盖新的 scope 或新 pending。
- 多次 resolve/cancel/clear 后没有残留 listener、timeout 或未处理 Promise。用 fake timers 检查不遗留 store 所创建的定时器；不要把宿主所有 timer 计为本模块资源。

### H6. Real Pi Auth Seam

可复用原型的证据，但生产测试需要自己的合成输入。`model-metadata.test.ts` 中至少一项用真实 Pi `ModelRuntime`、`ModelRegistry`，注入只读内存 CredentialStore，返回有效的合成 OAuth token；仅 fetch 被替代。

断言目录认证确由 `getApiKeyAndHeaders` 产生；使用 fake fetch 阻断所有非 models 请求。过期 token 场景让只读 store.modify 拒绝，验证 unavailable 且不执行测试环境 OAuth 网络刷新。该边界用于验证扩展调用宿主认证，不要求生产凭证库为只读。

### H7. Explicit Checkpoint Hash

位置：`__tests__/native-compaction.test.ts` 中现有 createNativeCheckpoint 场景，必要时新增 `__tests__/remote-compaction.test.ts`，在 T3 前编写。

- 在合法 SSE fixture 下，传入 opaque hash 原样出现在 `details.compHash`；不传则省略，即使模型名字曾在旧静态表中也不能补值。
- 显式空白 hash 或绕过类型检查的非法值被省略，不 trim 出一个新 hash。
- 传入 hash 不进入 Responses 请求 body，不改变模型、reasoning、Fast Mode、工具或 turn-state；factory 不额外查询 models。
- 保留 version 2 parser 已有 compHash 字符串及缺失值测试；不增加数据迁移。
- 现有直接调用 factory 的测试和脚本仍可编译运行。它们未请求元数据时省略 hash 是设计行为，不允许在底层加隐式网络查询恢复旧字段。

### H8. Coordinator Behavior

位置：`__tests__/session-coordinator.test.ts`，在 T4 前编写。统一 fixture 放 `__tests__/fixtures/compaction-metadata.ts`；可以显式映射现有测试的旧/新模型到不同 opaque hash，但只能存在于测试目录，不能把它作为 production fallback。新增 resolver 注入，所有直接 createSessionCoordinator 调用均适配。

- 已知 hash 不同、相同、任一未知各覆盖；contextWindow 相同的不同 hash 仍触发一次过渡压缩，相同 hash 的窗口缩小仍仅在原阈值满足时触发。
- selectModel 不调用 resolver、不认证、不 GET；A→B→C 后一次请求仅处理 A→C，A→B→A 不因中间选择压缩。未解析或最终无须处理的候选，不制造缺 requestInput/context-recovery 错误。
- prepareRequest 每入口只调用一次 resolver。让 resolver 下一次返回不同 hash，验证当前请求即使连续压缩、内部递归、旧模型失败后新模型重试，也只使用第一份快照，所有 factory 参数与 rebind 目标值一致。
- resume 无 model-change 的 previous-assistant 恢复、旧 checkpoint modelKey 不在 registry、旧模型不在目录、同 modelKey 的服务端 hash 更新分别覆盖。checkpoint 自带 hash 不被目录缺失覆盖；不同的当前已知 hash 仍走现有恢复。
- 目录 unavailable 时普通请求不新增失败标记、不调用 ctx.abort；阈值自动压缩继续可运行。无新 checkpoint 时旧 compHash 原样保留；未知状态下真正创建的新 checkpoint 省略 hash。
- resolve 期间 generation、sessionId、ctx.model 或 signal 改变时，结束旧操作且不创建/追加 checkpoint。恢复公开入口同样保护。目录刷新不改变已在运行的旧快照。
- 保留并执行旧模型优先、eligible fallback、远端超窗拒绝、原始历史不丢失、失败请求隔离、checkpoint bypass、当前 user 去重与 receipt 的既有回归，不借本次重构调整错误规则。

### H9. Extension Integration

位置：`__tests__/index.test.ts`、`__tests__/request-lifecycle.test.ts`、`__tests__/responses-parity.test.ts`，在 T5 前编写。

至少一个验收场景按以下完整路径构造：真实 `SessionManager.inMemory` 追加历史、用户 draft、context edit；使用 Pi `convertToLlm(sm.buildSessionProjection().messages)` 和原生 `streamSimple` 的 onPayload 捕获请求，再交给真实 extension 注册的 `before_provider_request`。fetch 按 URL 和 method 路由：models GET 返回合成目录，Responses POST 返回合成压缩 SSE。保留真实解析、缓存、协调器、输入保留和 checkpoint 保存，不 mock resolver 或 createCheckpoint。

- 使用两个相同窗口的模型对象，其中一个 ID 改为静态表从未包含的 `future-model`。目录 hash 不同时发生一次 transition；把目录改为相同时，独立 extension instance 中不发生 hash transition。观察 POST 使用模型、appendEntry 的 hash、最终 payload 的完整当前 user 和历史均符合预期。
- 同一实例的后续已知请求命中缓存；GET 不得带 input 或 tools，POST 不得带 metadataClientVersion 或目录字段。
- Pi-triggered manual、threshold、overflow 分支取得快照后保存 hash；metadata GET 失败时仍能完成原本允许的压缩。目录失败不产生 compaction failed 通知；真正 Responses 失败继续遵守原规则。
- 模型选择只取消进行中的元数据请求并保留已完成缓存；session_start/shutdown/tree 清空缓存。迟到 GET 不得追加 checkpoint、显示成功通知、重置新会话的 UI，或让旧请求通过。
- 现有 request-lifecycle 测试的 fake baseUrl 原来是 example.test，依赖 hash transition 的用例须改用官方目标并路由 fake fetch；其他自定义地址用例按未知 hash 验收。不得全局注入静态 hash 以掩盖接线。

### H10. Repeated Compaction and Cost Regression

继续运行 `persists the edited request through two compactions with history size %i` 的 0、100、100000 字符组。输入仍由真实 SessionManager 投影和 provider onPayload 产生。将原先 `compactionHash(builtin)` 的预期改成显式 metadata fixture 的不同 hash，保持中间约束、只保留一次完整 user、两次压缩顺序及恢复后投影的原断言。

为同一路径增加 resolver 只调用 1 次的断言；生产 index 集成场景增加 models GET 只调用 1 次的断言。测试不能先手工构造最终 checkpoint，再声称覆盖了 metadata 到 checkpoint 的路径。目录的大小扩展不应增加历史投影次数，保留已有投影计数测试。

### H11. Loading and Boundary Checks

- 执行 `extensions/codex-compact/__tests__/host-compatibility.test.ts` 的真实 DefaultResourceLoader 路径，确认新增模块从源代码和生成产物均可加载。
- 使用 `rg -n 'CODEX_COMPACTION_HASHES|compactionHash\(' extensions/codex-compact/src` 检查固定表及旧调用已删除。新增 hash 来源只有快照、明确 factory 参数或已持久化的 checkpoint。
- 检查 `model-metadata.ts` 没有文件写入、命令执行、Codex CLI 依赖、后台 interval、第三方目录请求或永久持有明文凭证。
- 检查 createNativeCheckpoint 的 auth/网络重试边界、Fast Mode、reasoning clamp、64k 保留预算及 turn-state 未发生无关修改。

### H12. Final Verification and Record

先按 Todo 对应文件执行目标测试，例如：

```sh
pnpm exec vitest run extensions/codex-compact/__tests__/config.test.ts extensions/codex-compact/__tests__/capabilities.test.ts extensions/codex-compact/__tests__/model-metadata.test.ts
pnpm exec vitest run extensions/codex-compact/__tests__/session-coordinator.test.ts extensions/codex-compact/__tests__/native-compaction.test.ts extensions/codex-compact/__tests__/index.test.ts extensions/codex-compact/__tests__/request-lifecycle.test.ts extensions/codex-compact/__tests__/responses-parity.test.ts extensions/codex-compact/__tests__/host-compatibility.test.ts
```

若新增独立 `remote-compaction.test.ts`，纳入第二条命令。最终在仓库内准备独立临时目录后执行：

```sh
mkdir -p .tmp/codex-metadata-check
TMPDIR="$PWD/.tmp/codex-metadata-check" pnpm run check
```

预期类型检查、测试、构建及发布包检查全部通过。检查本任务进程退出及监听端口释放，再删除本任务创建的临时目录；不要清除其他任务的目录。记录实际测试数量、跳过项、Red/Green 证据和关键 HTTP/资源计数。只运行必要测试，已通过且未受后续修改影响的目标验证无需反复执行。

不把真实在线推理或付费压缩列为完成条件。本次原型已证明端点和当前账号能取得字段，生产接线由上述真实宿主加 HTTP fixture 验收。若确需在线复验，只重跑现有只读原型，说明这是独立探针结果，不能冒充生产协调器在线验证；不修改全局认证或自动刷新 token。

### Results

执行环境：Node.js `22.22.2`、pnpm `11.9.0`、Pi `0.87.0`。所有目录和认证测试使用合成输入。以下文件位置均在 `extensions/codex-compact/__tests__/` 下。

| Check | Actual result and evidence |
| --- | --- |
| H1 | `config.test.ts` 5 项通过。默认值、有效版本优先级、不可信项目和非法版本在仓库内临时目录验证；原有配置断言保留。 |
| H2 | `capabilities.test.ts` 3 项通过。精确 ID、未知和非法字段、4096 项及 256 单元边界、输入 Map 修改后快照不变；10、1000、4096 项目录各做 10000 次查找。生产 `hashFor` 使用 Map `.get()`，没有逐次扫描或复制目录。 |
| H3 | `model-metadata.test.ts` 覆盖官方地址归一、宿主认证头、非 Codex 和非官方地址零 GET、非 2xx 不读正文、重定向、无效 JSON/schema、8 MiB 边界及 3 秒 body 超时。GET 计数和 headers 均由合成 fetch 断言。 |
| H4 | 同文件用可控单调时钟验证 300 秒 TTL、30 秒未知/失败限流、旧目录删除模型、过期失败不借用旧 hash、100 并发只发 1 GET、100 次缓存读取零新增 GET、token/账号/版本隔离、4 个 pending scope 容量及 idle LRU 淘汰。 |
| H5 | 同文件验证预取消、认证等待时取消和迟到 reject、共享 GET 独立取消、最后一个等待者取消后的立即重试、clear/cancelPending、忽略迟到响应，以及超时后没有剩余 store timer。`index.test.ts` 另验证模型切换后的迟到目录不能追加 checkpoint 或通知。 |
| H6 | 同文件使用真实 Pi `ModelRuntime` 和 `ModelRegistry`、只读内存 CredentialStore、合成 OAuth token；有效认证发 1 次 fixture GET，过期凭证返回 unavailable 且 GET 数不增加。 |
| H7 | `native-compaction.test.ts` 验证显式 opaque hash 原样保存且不进入 POST body；省略、空白或运行时非法值均不保存。旧 V2 parser 和直接调用 factory 的回归通过。 |
| H8 | `session-coordinator.test.ts` 78 项通过，包括选择候选、同/异/未知 hash、旧 checkpoint、失败恢复、信号/会话/generation 变化及连续压缩；`responses-parity.test.ts` 28 项通过。 |
| H9 | `index.test.ts` 91 项与 `request-lifecycle.test.ts` 8 项通过。真实 SessionManager 投影经 `streamSimple` onPayload 和注册的 hook，通过路由 GET/POST fixture 验证静态表外 `future-model` 的不同/相同 hash、缓存、checkpoint 和当前 user；manual/threshold/overflow 均保存快照 hash，GET 失败仍允许远端压缩。 |
| H10 | `session-coordinator.test.ts` 的 0、100、100000 字符三组连续压缩均通过；每次 `prepareRequest` 的 resolver 调用数为 1，两次 checkpoint 收到同一快照，输入投影次数保留原上限。`index.test.ts` 的后续已知请求不增加 models GET。 |
| H11 | `host-compatibility.test.ts` 的 Pi `DefaultResourceLoader` 源码加载通过；最终构建和发布包检查通过。`rg -n 'CODEX_COMPACTION_HASHES\|compactionHash\(' extensions/codex-compact/src` 无匹配。`model-metadata.ts` 无文件读写、命令执行、后台 interval 或 CLI 依赖。 |
| H12 | H12 列出的 9 个 codex-compact 测试文件加 `goal` 集成文件的目标测试通过；最终 `TMPDIR="$PWD/.tmp/codex-metadata-check" pnpm run check` 退出码 0，164 个测试文件通过、3 个跳过，2528 项测试通过、12 项跳过；类型检查、构建和发布包校验通过。 |

Red/Green 记录：T1 新测试首次运行时配置默认值与目录解析共 3 项按预期失败，加入实现后通过；T2 新测试首次因 `model-metadata.ts` 不存在而失败，生产模块完成后通过；T3 的显式 hash 用例首次因旧 `compactionHash` 路径失败，改为显式参数后通过。T4/T5 的新增场景在接线后编写并运行，未保留“实现前 Red”的证据；已有回归验证保持通过。首次完整 `pnpm run check` 因 `goal` 两个直接调用协调器的测试缺少新 resolver 而失败，补合成 fixture 后复跑通过。该顺序与本 Todo 要求的 T4/T5 先 Red 再实现不一致，不能写成已执行该过程。

清理：检查结束后只删除了本任务创建的 `.tmp/codex-metadata-check`；`pgrep -fl '[v]itest'` 无残留进程。本任务没有启动监听服务或占用端口。

未覆盖：未发送真实付费推理或压缩请求，未验证 Pi `0.87.1`，也未验证其他账号或未来目录返回。此前只读在线原型结果属于独立证据，不充当本次生产接线的在线验收。

### H13. Transition regression repair

设计依据为 implementation design 的 D6.2。下列用例是 F1/F2 的验收标准，尚未实现或执行。

#### Setup and evidence boundary

在 `extensions/codex-compact/__tests__/session-coordinator.test.ts` 增补测试，沿用该文件的 fixture 和辅助函数。所有回归测试调用真实 createSessionCoordinator/prepareRequest，不测试转录出来的决策逻辑，不直接读写私有 pending map。

A = model("old")，B = model("new")，C = model("gpt-5.6-terra")；三者均为 openai-codex、openai-codex-responses、窗口 100000。使用现有 fixtureSnapshot，显式核对 A=2911、B=C=3000。shouldAutoCompact 固定 false，避免自动压缩掩盖缺失的过渡。ctx registry 可找到 A/B/C；如设置 ctx.model，应随真实选择更新，不能让测试意外失败于 ensureCurrent。

用 SessionEntry 数组构造 user、带 provider/api/model 的成功 assistant、model_change 和后续 user；为条目设置稳定且唯一 ID。每次请求从当时 branch 调用真实 effectiveInputForBranch 生成 requestInput。createCheckpoint 和 resolver 用 spy 替代外部传输，appendCheckpoint 写回同一 branch，appendCheckpointBypass 写入或计数以便断言。使用 createSessionCoordinator 直接注入带 spy 的依赖即可，不必为此改生产接口或全局 fixture。

此边界覆盖真实历史扫描、输入投影、失败分类、重试、状态保存和 checkpoint 重放；目录内容、远端响应及 Pi 追加失败 assistant 由 fixture 提供。测试通过不能称为在线服务或完整宿主事件循环验收。现有 index/request-lifecycle 测试由最终 check 一并运行。

#### R1. Candidate fallback

在 F1 修改前先编写并运行失败测试：branch 顺序为旧 user、A 成功 assistant、选择 B、选择 C、新 user。使用新 coordinator 表示会话恢复后无内存 pending，仅向它发送 B→C 的 selectModel 事件，再 prepareRequest(C)。

断言选择时 resolver 未调用；请求调用 resolver 一次；createCheckpoint 恰好一次且 model 为 A；压缩输入含旧历史且不含新 user；追加的 checkpoint modelKey 为 C、compHash 为 3000；返回值含新压缩项及仅一份完整新 user。修复前应失败于压缩未发生，不能以 setup 或 import 失败作为 Red 证据。

增加无 B→C 事件的对照，使用相同 branch 和新 coordinator，预期同样使用 A。另做同 hash 无历史差异的对照，把历史 assistant 改为 B，仍执行 B→C 选择，预期 createCheckpoint 为 0。不得把修复变成所有模型切换都压缩。

#### R2. Recovered transition survives failure

F1 后、F2 前编写跨请求测试，以 `error` 和 `aborted` 参数化：branch 为旧 user、A 成功 assistant、选择 B、首次请求 user；新 coordinator 没有 selectModel 事件或 checkpoint。createCheckpoint 前两次都抛普通 Error("context_length_exceeded")，不添加 retryWithCurrentModel 字段。

第一次 prepareRequest(B) 应调用 A、B 各一次并拒绝，没有 checkpoint 或 bypass。随后在同一 branch 追加 B 的失败 assistant，stopReason 为参数值，再追加第二个 user；使用同一个 coordinator 和相同 hashes。让后续 createCheckpoint 仍抛相同错误，第二次也必须拒绝，总调用顺序为 A、B、A、B，总 resolver 次数为 2，仍无 checkpoint/bypass。修复前第二次会放行且调用数停在 2，作为 Red 证据。

再将 factory 改为成功，追加新 user 并执行第三次请求：恰好新增一次 A 压缩，checkpoint 绑定 B/3000，当前 user 完整保留一次。随后在该 checkpoint 后追加新 user，再请求 B，应不新增过渡压缩。每次公开请求只新增一次 resolver 调用。

#### R3. Priority and existing contracts

新增或复用能精确覆盖以下输入的保护测试；不能只按测试名称推断已覆盖：

- 已有属于 C 的 valid checkpoint、compHash 3000，内存候选目标为 B，当前请求 C：先清理候选，正常重放 C checkpoint，不抛目标不一致、不压缩。ctx.model 为 C 或不设置。
- 没有 checkpoint 时保留目标 B 的候选，却请求 C：抛原文 `The pending Codex model transition targets a different model.`，不压缩、不追加 checkpoint，不能先清理候选再历史回退。
- 已有 hash 相同/未知、downshift 仅阈值满足才压缩、无 model_change 的历史恢复、非超窗 bypass、清理/模型变化/取消、连续压缩和 user 去重测试全部保持通过。无有效过渡且无 checkpoint 的空 branch，在 requestInput 缺失时不因候选本身新增错误，复用既有场景；必要时补该边界。

#### Commands and completion

先按 R1、R2 时机分别保存 Red/Green 结果。每个 Red 都应是目标行为断言失败；通过后不再为凑记录反复运行。目标测试命令：

```sh
pnpm exec vitest run extensions/codex-compact/__tests__/session-coordinator.test.ts
```

完成功能和文档修改后执行完整检查。临时目录必须是本任务专用；若同名目录已存在，另选唯一名称，避免误删其他任务内容。

```sh
mkdir -p .tmp/codex-transition-review-check
TMPDIR="$PWD/.tmp/codex-transition-review-check" pnpm run check
git diff --check
git status --short
```

所有类型检查、测试、构建和发布包检查应通过。代码审查设计 D6.2 的成本和状态约束，确认修复未增加 resolver/网络调用点、未修改历史 helper、未新增自动 latest 发现或改变默认版本。D10 只提供手动配置入口。记录实际测试数、跳过项、命令退出状态和仍未覆盖范围到本文件的追加验收记录；然后勾选满足完成条件的 F 项。验证后只清理本任务临时目录和进程。

无需真实付费推理、真实压缩或访问凭证，也无需重跑先前动态目录探针。若测试出现与设计冲突的路径，按 handoff 的 Continuation Point 回传证据，不通过放松断言、改 helper 或扩大 scope 自行决定行为。

### H14. Manual version command

设计依据：implementation design D10。F3 前在 `config.test.ts` 写字段更新和来源查询失败测试；F4 前在新增 `metadata-command.test.ts` 写命令注册/解析测试，在 `index.test.ts` 写配置到下一次 provider 请求的接线测试。新导出尚不存在造成的 import 失败可记录为搭建阶段，行为 Red 必须在最小可加载接口下失败于目标断言，不能仅用 import 错误证明功能回归覆盖。

#### H14.1. Isolated files and preservation

使用仓库 `.tmp/` 下 mkdtemp 的独立 agent/project 目录，临时设置并恢复 `PI_CODING_AGENT_DIR`，按既有 config 测试方式隔离。不并行运行共享环境变量的测试。测试结束清理本次目录；不得读写真实 agent 配置。

- global/project/default 的有效版本与来源路径必须和 `loadConfig` 一致。项目只有在 trusted=true 时读取，使用文件读调用 spy 证明 trusted=false 连项目读取也没有发生。项目合法覆盖、非法字段、无效 JSON、无法读取分别验证优先级和安全警告；普通 loadConfig 的容错行为保持。
- 对一次 loadConfig 和一次状态查询分别计数，每个允许读取的配置文件至多一次 read/parse；禁止状态查询先 loadConfig 再重复读文件。写入命令的更新和写后状态查询分阶段计数，允许写后重新读取一次状态。
- version 仅修改 metadataClientVersion；原三个压缩字段、未知字段和嵌套数据保持相同。reset 仅删除此属性。重新读取文件和 loadConfig 验证保存结果，不能只断言 writer 被调用。
- 文件缺失时 version 创建文件，0600；reset 不创建文件或父目录。相同字符串设置和无字段 reset 保留原字节，不发生临时文件写入或 rename。普通文件替换后权限位保留。
- 无效 JSON、数组/null/标量根节点、非 ENOENT 读取失败、目录或符号链接目标均拒绝写入，原内容/链接保持，错误不含原配置内容。合法对象中的非法版本字段可被设置替换或 reset 删除。
- 注入临时文件写入失败、rename 失败，检查原文件字节完全不变、临时文件和句柄被清理、错误反馈出现而成功反馈不出现。优先局部 mock Node fs 的目标操作，保留其余真实磁盘过程；不用 chmod 假装所有运行身份都会得到 EACCES。另验证清理失败会报告，不能漏报残留。
- 同一实例连续发起两次更新，最终版本为后一次，第一次写入前已存在的其他字段不丢失。以最终文件内容和临时文件计数验收；不声称覆盖另一个进程并发编辑。

#### H14.2. Command behavior and cost

捕获真实 registerMetadataCommand 注册的 handler，使用真实 config helper 和隔离文件；替代 ui.notify、stderr 和传输以观察副作用。调用前后核对文件、有效配置及计数。

- 无参数：显示有效版本、来源及路径，全局目标路径、用法；无写入、认证、HTTP、sendMessage、模型变更或 checkpoint。
- `version 0.157.0`：写全局，成功消息含保存值、全局路径、有效值与来源。存在项目 `0.158.0` 时保持项目文件字节不变，并显示项目仍覆盖。reset 在有项目覆盖时同样显示仍为项目值；无项目覆盖时回到默认值。
- `reset` 无字段为成功无操作。空白分隔合法；`version` 缺值、额外 token、未知子命令、`latest`、预发布和 D2 非法版本均显示用法/错误，零写入。确认没有读取真实 token 或尝试在线验证指定版本。
- hasUI=true 使用 notify；hasUI=false 输出 stderr，stdout 0 次，既不启动模型轮次也不追加会话消息。错误只显示受控类别/路径，放入配置的合成 secret 不得出现在日志。
- 注入 notify 抛错：向 stderr 输出一次原结果，已经保存的版本保持，不重写、不回滚、不把 UI 错误转为写入失败。stderr 也抛错时 handler 安全结束；反馈通道异常不得影响正在运行的请求。
- 用文件写入/rename spy 验证每个有变化的成功修改恰好一次替换，无变化 0 次；同一命令不得循环写入或重复保存全部配置。每个命令网络和认证调用数均为 0。

#### H14.3. Registered extension and request integration

`index.test.ts` 的 installExtension 及 `request-lifecycle.test.ts` 的 fake API 增加 registerCommand 捕获/空实现，生产调用不可写成可选 registerCommand。至少一个测试从真实 codexCompactionExtension 注册出的 `codex-metadata` handler 开始，保留真实 config 文件读写、真实 metadata store、coordinator 和 provider hook；只替代认证返回、远端 fetch、宿主 UI/持久化适配。沿用现有 SessionManager 投影和 streamSimple onPayload 捕获请求的模式。测试中原 configOverride 必须 unset，不能让 mocked loadConfig 返回固定值绕过命令写入。

1. 在隔离全局配置中从默认版本发起 before_provider_request，让模型目录 GET 用可控 Promise 暂停，记录 query=0.156.0。目录/历史构造 A→B 不同 hash，使后续压缩会创建 checkpoint。
2. 请求暂停期间调用注册的 `version 0.157.0`。文件保存后，确认没有新 GET/认证调用、没有 abort 原请求、没有清除候选或 checkpoint。释放第一份目录 fixture，A=2911、B=3000。完成第一请求，压缩按旧快照执行，保存的 B checkpoint hash 仍为 3000，当前 user 保留一次。
3. 下一次请求目录 query 为 0.157.0，fixture 令 B=4000；断言后续决策和新 checkpoint 使用 4000。两次公共请求各按现有缓存规则至多一次 GET，命令本身不计入。这个测试同时防止命令粗暴 clear/cancel store 或覆盖运行中快照。
4. 在另一实例设置可信项目覆盖，先让该项目版本产生有效目录缓存，再通过命令改全局值；下一次请求有效版本不变、复用目录缓存，不为无效的全局修改新增 GET。验证提示准确说明项目覆盖。

以上 HTTP 均为 fixture，不是真实在线版本兼容性验收。用户输入的 0.157.0/0.158.0 仅测试字符串，不表示已验证官方支持这些版本。

### H15. Follow-up final verification

H13 的完整检查安排在 F1–F5 全部完成后统一执行一次即可，不因分章重复运行。实现时先运行相关目标文件：

```sh
pnpm exec vitest run extensions/codex-compact/__tests__/session-coordinator.test.ts
pnpm exec vitest run extensions/codex-compact/__tests__/config.test.ts extensions/codex-compact/__tests__/metadata-command.test.ts extensions/codex-compact/__tests__/index.test.ts extensions/codex-compact/__tests__/request-lifecycle.test.ts
```

最终使用仓库内独立 TMPDIR 执行 `pnpm run check`，并运行 `git diff --check`，检查改动范围和任务临时文件、进程清理。不要重新执行已通过且没有受后续修改影响的目标测试；完整 check 是仓库要求。记录实际数量、跳过项、Red/Green、失败注入、命令零网络计数和集成路径结果。完整检查未通过时 F 项不能全部勾选。

#### Follow-up results

当前只完成设计和交接更新；F1–F5 全部待实现。修复前独立基线 `98cb4e8` 已运行完整 check：2528 通过、12 跳过，类型、构建和包检查通过。该结果不证明 H13/H14 新行为成立。worker 在此补充带代码版本/工作树说明的实际验收记录，不覆盖原 Results。

2026-09-23 文档追加回合再次运行 `TMPDIR="$PWD/.tmp/metadata-command-design-check-20260923" pnpm run check`，退出码 0，164 个测试文件通过、3 个跳过，2528 项通过、12 项跳过，类型检查、构建和发布包检查通过；`git diff --check` 通过。源码及测试仍为 `98cb4e8`，这是文档更新时的基线检查，不是新命令或修复后的验收。本轮未写真实全局配置，检查临时目录已清理，无 vitest 或本任务命名进程残留。

2026-09-23 接续实现验收：HEAD 仍为 `98cb4e8`，源码、测试、README、UPSTREAM 与本 Todo 为未提交工作树改动，未提交、推送或发布。F1 的 R1 测试先在 B→C 同 hash 候选场景失败于压缩调用 0 次，重排候选与恢复顺序后通过；无候选对照及同 hash 无历史差异对照也通过。F2 的 `error`/`aborted` 两例先在第二次请求失败于“本应拒绝却返回 undefined”，写回恢复候选后通过；A、B、A、B 的超窗调用顺序、随后成功的 A 压缩、checkpoint hash 和后续无重复压缩均通过。coordinator 目标文件 84 项通过。

F3 的最小可加载配置 helper 先失败于新配置未创建、损坏目标未拒绝，随后 8 项 config 测试通过。隔离文件测试覆盖默认/全局/可信项目来源、非可信项目零读取、每个允许文件每次调用只读一次、三个压缩字段和未知嵌套字段保留、0600 新文件及旧权限保留、同值/reset 无操作、非法版本和目标拒绝、写入/rename 故障时原文件不变和临时文件清理，以及清理失败报告。F4 的命令注册测试先失败于未注册，随后命令和接线测试通过。真实注册 handler、隔离配置、真实 metadata store 和 provider hook 的集成测试显示：暂停的 `0.156.0` GET 期间执行 `version 0.157.0` 不增加认证/HTTP，也不 abort；原请求 checkpoint 为 3000，下一请求查询 `0.157.0` 并保存 hash 4000。可信项目覆盖 `0.158.0` 时改全局值不增加 GET；命令异常反馈不会回滚已保存文件。目标五个测试文件 195 项通过。上述 GET 和压缩均使用 fixture，没有在线服务、付费推理或真实宿主事件循环验收。

最终执行 `TMPDIR="$PWD/.tmp/codex-transition-finalcheck-ZpD80fe0" pnpm run check` 退出码 0：165 个测试文件通过、3 个跳过，2541 项通过、12 项跳过；类型检查、构建、媒体复制及发布包检查通过。命令空白参数、项目覆盖提示和两个请求的 user 去重断言已包含在这次完整检查中。没有执行真实在线目录查询或付费推理；跨进程并发编辑同一配置文件不保证事务隔离。`git diff --check` 退出码 0。本任务创建的三个完整检查临时目录均已删除；`pgrep` 未发现 vitest、`pnpm run check` 或本任务命名的残留进程。本任务未启动监听服务或占用端口，且未写用户真实全局配置。

## Notes

- 本轮不升级 Pi 0.87.1、不验证其运行兼容性、不添加模型选择器条目。
- 原型文件被 Git 忽略；本文及设计保留核心证据。不要为提交实现而顺带取消整个 prototypes 忽略规则。
- 不采用跨进程磁盘缓存、ETag 协商、自动追踪最新 Codex 版本、强制每次切模型压缩或按模型家族猜 hash；这些均非本任务待办。
