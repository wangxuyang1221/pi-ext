# Dynamic Codex compaction metadata

## Status and Goal

状态：动态目录实现已提交为 `98cb4e810678ce0551aa3f7bac9b16c65675d101`，位于 `feat/codex-compact-dynamic-metadata`。本次追加设计涵盖 D6.2 的两个过渡状态回归修复，以及 D10 的手动版本 slash command，二者均尚未实现。原改造基线为 `6cd56605ddb33650c1674d1c34fcbfb206294985`，Pi 依赖保持 `0.87.0`。本文是完整设计的唯一来源；执行清单与验收标准唯一来源为 [execution todo](codex-compact-dynamic-metadata-todo.md)。

目标：将 `codex-compact` 的逐模型静态 `comp_hash` 表替换为真实 Codex 模型目录查询。模型出现在当前账号、当前客户端版本可见的目录后，插件无需增加模型表项即可取得它的 hash。本次不升级 Pi，不修改模型注册、上下文窗口或压缩协议。

用户已要求修复两个回归，并同意通过 slash command 手动维护目录客户端版本。默认版本保持 `0.156.0`，不自动追踪最新发布版本。本文的具体实现选择由 expert 作出，不能把每项内部决定写成用户逐项指定。当前会话交付止于设计、Todo 和 handoff，不启动 worker，不实现生产代码。

## Evidence

已完成的本地原型位于 `prototypes/codex-model-metadata/`，该目录被 Git 忽略，仅在当前工作区存在。其 README、`results/client-0.154.0.json`、`results/client-0.156.0.json` 提供复现方法和筛选后的证据。核心结论在此保留，即使原型未复制到其他工作区，也不需要重新推断：

- 2026-09-23，以当前 Pi OAuth 凭证，经真实 `ModelRuntime` / `ModelRegistry` 请求 `https://chatgpt.com/backend-api/codex/models?client_version=0.154.0`，返回 7 个模型；`0.156.0` 返回 9 个模型。两次响应的所有模型都有字符串 `comp_hash`。
- `0.156.0` 返回 `gpt-6-astra/sol/luna = "3000"`、`gpt-5.6-sol/terra/luna = "3000"`、`gpt-5.5 = "2911"`，另有 `gpt-reserve` 和 `codex-auto-review`。`0.154.0` 没有 Sol/Luna。不能据此推断其他账号或未来响应。
- 静态表没有 GPT-6 条目，原型无需补表就取得上述 GPT-6 hash。目录没有返回静态表中的 `gpt-5.4`、`gpt-5.4-mini`，说明不能假定目录包含所有历史模型。
- 每次进程内第二次读取都命中缓存，GET 数为 1，查询前后 Pi 认证文件字节相同。未进行真实压缩或模型切换推理。
- 原型 7 项检查通过；同一代码基线 `pnpm run check` 通过，2484 项测试通过、12 项按原配置跳过。该结果是改动前基线，不是未来实现的验收结果。
- 本机实际版本为 Node.js 22.22.2、pnpm 11.9.0、Pi 0.87.0、Codex CLI 0.156.0。生产方案不依赖安装 Codex CLI。

上游依据：

- [Codex ModelInfo](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/protocol/src/openai_models.rs)：`comp_hash: Option<String>`，注释为 `Opaque identifier for compaction-compatible model configurations.`，即标识压缩兼容模型配置的不透明标识符。不要解释为内容校验和、窗口大小或客户端加密格式转换。
- [Codex models endpoint](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/codex-api/src/endpoint/models.rs)：GET `models`，查询参数 `client_version`，响应 `{ models: [...] }`。
- [Codex models manager](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/models-manager/src/manager.rs)：默认目录缓存 TTL 为 300 秒。
- Pi 0.87.0 实际安装源码 `node_modules/@earendil-works/pi-ai/dist/types.d.ts` 的 `Model` 无 hash 字段；`pi-coding-agent/dist/core/model-registry.js#getApiKeyAndHeaders` 是扩展现有认证入口。该方法不接收 AbortSignal，宿主 OAuth 刷新由宿主管理。

## Working Agreement

- worker 只做本地实现与验证；不升级依赖，不提交、推送、创建 PR、合并或发布。D10 授权实现“用户执行命令后保存全局配置”的产品行为，不授权代理在开发或验收时修改用户真实全局配置；测试必须隔离到仓库内目录。
- 改 `src/` 和对应 `__tests__/`，`dist/` 只由构建生成。默认主代理独立完成，不启动 subagent。
- 创建、修改文字产物前读取 `docs/agents/repository-language-policy.md`；中文正文，英文标题、源码注释、测试名及产品提示。
- 工作目录外的写入或其他副作用依用户全局规则先说明并等待“同意”。必要依赖安装按用户例外处理。测试临时目录放到仓库内。
- 网络发现仅 GET 官方模型目录，不发送对话；正式验收不要求发起付费推理或真实压缩请求。凭证、账户 ID、请求头和完整响应不得落盘或进入日志。
- 未列入范围的公共接口、行为改变或与实测不符的数据必须反馈 expert；可继续不依赖该问题的工作。

## D1. Behavior and Compatibility

1. 删除生产 `CODEX_COMPACTION_HASHES` 及单参数 `compactionHash(model)`。生产代码不再按模型 ID、名称前缀、家族或代际推测 hash，也不把任意 `model.compHash` 属性当作可信元数据。
2. 精确模型 ID 在当前目录中对应两个非空 hash 且值不同，才通过 hash 路径触发过渡压缩。相同或任一未知时，不因 hash 触发。窗口缩小仍走既有 `isModelDownshift` 和 `shouldAutoCompact`。
3. 元数据认证失败、HTTP 错误、网络错误、超时、无效目录或容量限制产生“未知”，不进入压缩错误报告、失败用户标记或 `ctx.abort()`。用户或生命周期取消仍中止当前操作，不吞成成功或未知。
4. 移除静态表后，离线冷启动及目录缺失的旧模型可能不再得到之前表内的 hash。这是明确的行为变化，不保留冻结名单兜底。旧 checkpoint 已保存的 hash 继续作为历史事实使用。
5. hash 只影响压缩决策和 checkpoint 的可选 `compHash`。不把目录中的 `context_window`、提示词、名称等写回 Pi 模型，不替用户注册新模型。Pi 自身支持哪些模型仍由宿主决定。
6. 仅支持默认官方 Codex 地址的元数据发现。自定义代理地址不额外发起目录 GET，hash 未知；它原有的远程压缩请求路径不改。不要为了让测试通过而把测试域名加进生产允许列表。
7. 目录查询失败不新增通知或后台刷新定时任务；D10 的显式用户命令可以显示结果和错误。目录不可用时的行为和边界写入 README。此任务不提供“所有未来模型均无需维护”或“跨模型质量已验证”的承诺。

## D2. Client Version and Configuration

在既有 `pi-codex-compact.json` 中新增可选字符串 `metadataClientVersion`。默认值唯一地定义为 `DEFAULT_METADATA_CLIENT_VERSION = "0.156.0"`，位于 `config.ts`。该值是本次验证过的模型目录客户端版本，不是 Pi 版本，也不改变既有压缩算法的来源基线。

沿用 `loadConfig(cwd, trusted)` 的全局和受信任项目合并规则：有效项目值覆盖全局值，全局值覆盖默认值。不可信项目的配置不读取。合法值为长度不超过 32 的稳定三段十进制版本，正则 `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`；不接受前缀、预发布标识、空白或查询参数。普通配置读取中的非法值按既有 parseConfig 风格忽略，不遮盖其他层有效配置，不新增报错流程；显式命令的输入错误和状态诊断按 D10 处理。

类型增加 `metadataClientVersion?: string`，保留现有部分配置调用方的源兼容。`DEFAULT_CONFIG` 包含默认值；index 的生产 resolver 使用 `loadConfig(...).metadataClientVersion ?? DEFAULT_METADATA_CLIENT_VERSION`，不在其他模块复制字面量。

本轮选择：不执行 `codex --version`，不读取其他应用的缓存，不增加 GitHub/npm 的在线版本查询，不伪造未来客户端版本。理由是已有版本和端点经过实测，附加服务依赖与任意新协议自动采用都不是替换模型表所必需。上游再次提高门槛时，可配置一个已核验的版本，或随扩展兼容性更新默认版本；仍无需逐个增加 hash。README 必须明确这个限制。

## D3. Modules and Interfaces

修改或新增以下文件，其他生产模块不重构：

| File | Responsibility |
| --- | --- |
| `extensions/codex-compact/src/capabilities.ts` | 移除静态表；定义只读 hash 快照、空快照、目录解析与精确查找，不访问网络或文件 |
| `extensions/codex-compact/src/model-metadata.ts` | 新增官方目录请求、认证隔离、内存缓存、并发合并、取消和容量限制 |
| `extensions/codex-compact/src/config.ts` | D2 字段、校验和默认值；D10 带来源查询及单字段全局更新 |
| `extensions/codex-compact/src/metadata-command.ts` | D10 新增：命令解析、注册与结果展示；复用 config 的状态读取与全局字段更新，不访问元数据 store |
| `extensions/codex-compact/src/session-coordinator.ts` | 注入快照 resolver；选择时只记候选，请求时判断；每操作固定快照；所有 hash 使用点迁移 |
| `extensions/codex-compact/src/remote-compaction.ts` | 接收显式可选 `compHash`，不访问元数据；从该值生成 checkpoint 明细 |
| `extensions/codex-compact/src/index.ts` | 创建 store、生命周期接线、配置与 resolver 注入、手动压缩快照取得、注册 D10 命令 |
| 对应测试及 `__tests__/fixtures/compaction-metadata.ts` | 合成元数据，禁止依赖当日在线目录；完整清单见 Todo |
| `README.md` 的 Codex Compact 节、`extensions/codex-compact/UPSTREAM.md` | 用户行为、配置、版本边界、上游定义与新本地差异 |

接口声明如下；可调整局部参数命名，不能改变其责任和含义：

```ts
type CompactionHashSnapshot = Readonly<{
  status: "available" | "unavailable" | "unsupported";
  hashFor(model: Model<any>): string | undefined;
}>;

function parseCompactionCatalog(value: unknown): ReadonlyMap<string, string | undefined>;
function createCompactionHashSnapshot(
  catalog: ReadonlyMap<string, string | undefined>,
  modelBaseUrl: string,
): CompactionHashSnapshot;
function emptyCompactionHashSnapshot(
  status: "unavailable" | "unsupported",
): CompactionHashSnapshot;

type ResolveCompactionHashes = (
  ctx: ExtensionContext,
  currentModel: Model<any>,
  signal?: AbortSignal,
) => Promise<CompactionHashSnapshot>;

type ModelMetadataStore = {
  resolve(params: {
    ctx: Pick<ExtensionContext, "modelRegistry">;
    model: Model<any>;
    clientVersion: string;
    signal?: AbortSignal;
  }): Promise<CompactionHashSnapshot>;
  cancelPending(): void;
  clear(): void;
};

function createModelMetadataStore(deps?: {
  fetch?: typeof globalThis.fetch;
  now?: () => number; // Monotonic milliseconds; default performance.now.
}): ModelMetadataStore;
```

`SessionCoordinatorDeps` 新增必填 `resolveCompactionHashes: ResolveCompactionHashes`，由 index 注入。测试的 coordinator factory 必须显式注入 fixture resolver，不通过默认静态名单维持旧测试。

`CheckpointFactory` 的参数新增必填 `compactionHashes: CompactionHashSnapshot`；index 内部 `createCheckpoint` 的参数同步包含它。`NativeCheckpointRequest` 新增可选 `compHash?: string`；index 从传入快照取实际用于压缩的模型 hash，传给 `createNativeCheckpoint`。直接调用低层 factory 的已有脚本可不传，结果省略 `compHash`，其压缩行为不变。不要让低层 factory 创建第二个 store 或另查一次目录。

快照只暴露方法，不暴露内部可变 Map。已返回快照在缓存刷新或 clear 后仍保持原值。空快照对所有模型返回 undefined。`hashFor` 再检查 `provider === "openai-codex"` 和 `api === "openai-codex-responses"`，并按下节的地址约束限定可查模型，之后用 Map 按完整 `model.id` 取值。

`parseCompactionCatalog` 对 D4 的无效输入抛固定类别错误，不带原始字段内容。`createCompactionHashSnapshot` 在构建时复制 Map，避免上游持有者修改它；命中缓存和 hashFor 时不再复制。空快照可复用冻结的 singleton。这里列出的函数放在 capabilities.ts，network store 只消费这些函数。

## D4. Authentication, Endpoint, and Parsing

元数据请求先排除非 Codex 模型，再调用当前 `ctx.modelRegistry.getApiKeyAndHeaders(model)`，不读 `auth.json`，不实现 token 刷新，不保存凭证。认证解析失败或缺少 API key 返回 unavailable。方法内部错误只能转换为固定内部类别，禁止传播或记录可能携带凭证的原始错误正文。

认证入口没有可取消参数：调用方取消时停止等待并丢弃迟到认证结果，不得随后启动 GET。已由宿主启动的 OAuth 刷新归宿主管理，不能宣称本扩展可强制停止它。对迟到 Promise 安装 rejection handler；等待监听器在所有出口移除。

有效请求地址使用 `auth.baseUrl ?? model.baseUrl`，缺省取现有官方默认值。允许 `https://chatgpt.com/backend-api`、其 `/codex` 或 `/codex/responses` 形式及尾部斜杠；不允许其他 origin、用户名密码、查询或 fragment。统一请求 `https://chatgpt.com/backend-api/codex/models`，用 URLSearchParams 设置 `client_version`。不跟随重定向，`redirect: "error"`。

已有 `buildCodexHeaders` 可复用来派生 Bearer 与 account header。GET 设置 `Accept: application/json`，移除 `OpenAI-Beta`、`x-codex-beta-features`、`x-codex-turn-state`、`session-id`、`x-client-request-id`、`content-type`，不携带请求体；originator 和 user-agent 保留 Pi 身份，不冒充 Codex CLI。若 token 不能解析账号，返回 unavailable，不自行寻找其他凭证。

快照限定到本次认证请求模型的配置地址：规范化当前 `model.baseUrl` 作为 `modelBaseUrl`，缺省按官方地址。`hashFor(otherModel)` 仅当 otherModel 的规范化配置地址与该值一致时查询。`auth.baseUrl` 另外必须满足官方地址白名单。这样同一 provider 下的其他代理模型不会借用官方目录的 hash；等价的三个官方 URL 形式视作同址。

目录以一次 GET 读取，不在同一次 resolve 内自动重试。总 HTTP 时间上限 3000ms，包括读取响应体；该值不包含宿主认证耗时。body 采用流式累计上限 8 MiB，达到上限再多一个字节即取消 reader，返回 unavailable；不能只依赖 Content-Length。非 2xx 不读取或记录错误正文，取消 body 后按失败处理。

解析规则：顶层必须是对象且 `models` 是数组，最多 4096 项；每项必须是对象，`slug` 为非空、无首尾空白、最长 256 个 UTF-16 单元的字符串；重复 slug 使整个响应无效。`comp_hash` 缺失、null、空或纯空白视为未知；其他类型、超过 256 个 UTF-16 单元的字符串使响应无效。非空 hash 作为不透明原字符串保存，不 trim、不转数字、不比较大小。只构建 `Map<slug, hash | undefined>`，丢弃其他字段，不能将 `context_window`、描述或模型指令缓存到插件状态。

这些长度和数量是本扩展的资源边界，不是对服务端完整 schema 的宣称。真实目录超出时本次发现降级为未知；worker 不可偷偷放宽到无界。

## D5. Cache, Concurrency, and Lifetime

每个 extension instance 创建一个 store。仅内存缓存，不写全局路径、项目路径或 session。不设置后台 interval，不读取其他应用缓存。

每个 scope 的 key 是 provider、API、规范化配置地址、有效目录地址、客户端版本及认证指纹的组合。认证指纹以 SHA-256 编码 API key 和最终账号 header，使用结构化编码避免连接歧义；不要保留它们的原文用于 cache key，不输出指纹。每次 resolve 都经宿主重新解析认证后选择 scope，以识别账号或 token 变化。原始请求头只被进行中的请求持有，结束后释放。

最多 4 个 scope entry，包含有 pending 请求的 entry。容量满时淘汰最久未使用的非 pending entry；全是 pending 时新 scope 返回 unavailable，不启动第 5 个请求。返回的不可变快照可以被活动操作持有，这部分空间是请求契约需要的，不计入可淘汰缓存。

entry 保留 `snapshot?`、`fetchedAt?`、`lastAttemptAt?`、`retryAt?`、`lastUsedAt`、`pending?`。使用单调时钟。成功目录 TTL 为 300000ms，按成功完成时刻计；成功替换整个 Map，不把旧目录已删除的模型合并回来。

执行顺序固定为：

1. 已取消立即退出。解析认证并选择 scope，检查生命周期 epoch 未变化。
2. 同 scope 已有 pending 则订阅同一 Promise。不要发起重复 GET。
3. 有未过期 snapshot，且当前模型有 hash，则立即返回 snapshot。`hashFor` 和返回命中快照都不复制整个 Map。
4. 对不存在或没有 hash 的当前模型，若距离上次 GET 启动不足 30000ms，返回仍新鲜的 snapshot，或 unavailable。负缓存按整个 scope 限流，不为每个未知模型创建一个 entry。
5. 网络失败后的 `retryAt` 未到，不请求；仍新鲜的旧 snapshot 可以继续使用，已过期的绝不继续参与 hash 判断。
6. 其他情况启动一次 GET；成功保存新 snapshot；失败设置 `retryAt = 完成时刻 + 30000ms`，返回仍新鲜的旧 snapshot 或 unavailable。首次无缓存失败同样遵守退避。

正常已知模型过期后首次读取会刷新；连续未知模型最多每 30 秒启动一次额外刷新。没有自动重试和按错误类别放宽限制的分支。HTTP 401/403/429/5xx、无效 JSON/schema、超时均使用同一发现退避；认证失败因尚未建立可靠 scope 不缓存，交由宿主认证层处理。

共享请求要区分调用者取消和生产者生命周期：每个等待者有独立 abort listener；一个等待者退出不影响其余等待者，最后一个等待者取消则 abort GET。内部 HTTP timeout 是发现失败；外部 signal 取消向调用者抛取消，不计为目录网络失败退避。所有监听器与 timeout 在完成后释放。publish 前检查 pending 身份、store epoch 和 controller 未 abort，即使 transport 忽略 abort，迟到响应也不能写缓存。旧 pending 的 finally 不得删除新的 pending。

最后一个等待者外部取消、cancelPending 或 clear 取消请求时，恢复该 entry 启动本次请求前的 `lastAttemptAt/retryAt`，不让一次已取消的冷查询导致接下来 30 秒无法查询；该恢复也必须检查 pending 身份。单个等待者退出但仍有其他等待者时，不恢复正在进行的 attempt 状态。

`cancelPending()` 中止所有进行中的元数据读取、递增 epoch、解除等待，但保留已完成且仍可按 TTL 使用的 snapshot。`clear()` 在此基础上清空所有 entry。两者都不触发 HTTP 或文件写入。

store 保有一个生命周期 AbortController；每个 resolve 从入口起同时观察调用者 signal 与当时的生命周期 signal，覆盖尚在等待宿主认证、还未建立 cache entry 的阶段。cancelPending/clear abort 旧 controller 后立即换新 controller，新 resolve 不继承已取消的 signal。外部认证本体仍按 D4 归宿主管理，但该旧 resolve 必须立即停止等待。

## D6. Coordinator Integration

### D6.1. Model selection

保持 `selectModel(event, ctx): Promise<void>`。不访问网络、不获取认证。保留 generation 增加和既有进行中流程失效处理。

`pendingBySession` 改为保存 `PendingSelection = { previousModel, targetModelKey }`。两个模型都是 Codex 时记录候选，尚不决定 reason；若已有候选，则保留最早 `previousModel`，只更新目标。选回最早 previousModel 的 `modelKey` 则清除候选；切到/来自非 Codex 或缺少 previousModel 则按现状清除。因此 A→B→C 且没有请求，只处理 A→C；A→B→A 不因中间选择而压缩。

新增纯函数 `transitionForSelection(selection, currentModel, hashes)`，hash 不同优先返回 reason=`hash`，否则窗口缩小返回 `downshift`，否则无 transition。结果使用单独的 `PendingTransition` 类型，reason 必填。保留候选和已解析 transition 的区别，不能让 unresolved 候选触发缺少 requestInput 的错误或 context-recovery。

### D6.2. Request preparation

`prepareRequest` 在第一次 await 前捕获 sessionId、generation、targetModelKey、requestInput 和操作 signal。通过 deps resolver 取得一次 immutable hash snapshot，随后核验 signal、sessionId、generation、模型仍匹配，才进入现有历史投影。非 Codex 直接使用空快照，不请求元数据。

在内部 `RequestContinuity` 加入 `compactionHashes`；`prepareRequestInternal` 的所有递归、等待 transition/automatic 后的重入、`recoverCurrentModelInternal` 和 checkpoint factory 都传递同一快照，不能从会变化的全局 store 同步读 hash，也不能在循环里再次 resolve。

本次修复只修改 `prepareRequestInternal` 读取 selection 到 requestInput 检查之间的衔接。最终执行顺序如下，不能以“有候选”代替“有有效 transition”：

1. 从 pendingBySession 读取 selection，从现有 snapshot 读取 checkpoint。
2. 若 checkpoint valid 且已属于当前模型，删除并清空 selection。此规则优先于目标一致性检查。
3. 若剩余 selection.targetModelKey 与当前模型不符，抛原文 `The pending Codex model transition targets a different model.`，不得用历史恢复掩盖此错误。
4. 用本次 hashes 调用 transitionForSelection，得到可重新赋值的 pending。selection 存在但 pending 不存在时删除候选。
5. 仅当 pending 不存在且 checkpoint.status 严格为 `none`，调用一次 pendingTransitionFromBranch，将结果赋给 pending。若恢复成功，将 `{ previousModel: pending.previousModel, targetModelKey: pending.targetModelKey }` 写入 pendingBySession。
6. 然后执行原 requestInput 缺失检查，historyModel 使用最终 pending.previousModel；checkpointModelKey 及后续历史投影、压缩与恢复流程保留。

map 仍只保存 PendingSelection，不保存 reason 或 hash 快照。恢复结果在后续异步操作前写入，超窗失败不丢失过渡；下次请求用当次快照重新判定 reason。成功、明确 bypass、无需过渡、回到最初模型、离开 Codex 和 clear 的已有清理规则不变。不要在 catch/finally 统一删除 pending。

`pendingTransitionFromBranch` 继续使用已有 model-change / previous-assistant 规则；不改“当前模型选择后出现任意 assistant 则停止恢复”的条件。第二条回归通过保存跨请求状态修复，不扩大历史扫描语义。checkpoint 为 valid、invalid、bypassed 等非 none 状态时不进入新增回退。已有 checkpoint 的历史 hash 以其自带值为准。

以上处理块同步执行，不增加 await、resolver、认证或网络调用。每次内部准备只在无有效 transition 且无 checkpoint 时调用该 helper 一次，成本为现有 O(n) 分支扫描及 slice，不新增第二遍恢复扫描、额外投影或常驻历史副本。每个 session 最多保留一个候选。连续请求、clear、取消、generation 和 transition promise 规则保持。

修复依据：`98cb4e8` 中先检查 selection 是否存在，再删除无效候选，导致 B→C 同 hash 遮蔽历史 A→C；历史恢复只赋局部变量，导致超窗失败后遇到 error/aborted assistant 无法再恢复。基线 `6cd5660` 在 selectModel 阶段排除无效候选，并保存恢复结果。两个回归已通过真实 coordinator 加合成外部结果复现；测试输入和独立复核边界见 Todo 的 H13。不新增“历史很短就跳过 hash transition”的规则。

`recoverCurrentModel` 的公开包装同样在入口捕获状态、resolve 一次并核验后调用 internal。internal 被 prepareRequest 调用时只消费传入快照，不能重复 resolve。`prepareCompaction` 本身不判断 hash，保持它等待既有 transition 并生成完整压缩输入的行为，不为它单独发目录请求。

### D6.3. Hash usage inventory

以下所有位置必须使用当前操作快照，不能漏掉恢复或错误分支：

- `needsTransitionCompaction` 改为接受快照的纯比较，或合并到 `transitionForSelection`。
- `pendingTransitionFromBranch` 的前后模型比较。
- `runTransition` 的相同模型重试判断、所有 `deps.createCheckpoint` 参数、最终 `rebindCheckpoint` 的目标 hash。
- `recoverCurrentModelInternal` 的 currentHash、旧模型不可解析时的 factory 和 rebind。
- `prepareRequestInternal` 的 context-recovery factory、重试判断、rebind、恢复后 checkpoint hash gate，以及 automatic factory。
- index 的 Pi-triggered manual/threshold/overflow factory。

不改变 `hashesDiffer` 的双已知且不同规则，也不改变 `shouldRetryWithCurrentModel`、旧模型优先压缩、合格失败后新模型重试、远端超窗不丢历史、当前 user 保留和连续压缩 receipt 的既有算法。

### D6.4. Checkpoint persistence

`NativeCompactionDetails` 继续 version 2，`compHash` 继续是可选字符串；parser 和旧会话兼容规则不变。`createNativeCheckpoint` 只保存本次显式传入的已知 `compHash`，未知则省略，禁止带入旧 checkpoint 的 hash 冒充新结果。

低层 factory 对显式值仅在它是非空且非纯空白字符串时原样保存；undefined、空白或运行时非法类型均省略。不在写出时 trim 或转数字。目录严格校验仍在 D4，不因这个兼容入口放宽在线 schema。

恢复时，旧 checkpoint 的 `details.compHash` 是历史事实，即使旧模型已不在在线目录或 registry 中，也不得覆盖。它与当前模型快照 hash 比较；不同走已有恢复路径，未知仍按当前缺失值语义处理。若本次没有真正生成新 checkpoint，不改写旧明细。

过渡压缩正常使用 previousModel 生成结果，随后 `rebindCheckpoint` 仍记录 targetModelKey 和目标快照 hash；这是既有协调器行为，本次只换数据来源，不重新解释加密内容。

## D7. Extension Lifecycle

index 在 extension instance 内创建 store，向 coordinator 注入 resolver 闭包。resolver 每次按 ctx.cwd 和信任状态读取既有配置，并调用 store.resolve。配置读取保持原有 loadConfig 规则，本次不加文件监视或另建配置缓存。

index 的 `createCheckpoint` 接收 factory 参数中的快照，从快照读取 params.model 的 hash，传给 `createNativeCheckpoint`；不用 `ctx.model` 代替实际压缩模型。

`session_before_compact` 先沿用现有 `prepareCompaction` 取得输入，然后在已有 operationSignal 下 resolve 快照。resolve 后立即检查 lifecycleGeneration 与 signal，再调用 createCheckpoint。无 hash 不阻断手动压缩；用户取消或模型变化则继续返回 `{ cancel: true }`。目录失败不得显示“压缩失败”通知。

在已有 `clearTransient` 中调用 store.clear；覆盖 session_start、session_shutdown、session_tree，继承原有其他清理。`model_select` 的同步失效阶段调用 store.cancelPending，保留新鲜缓存供下一个请求使用；该调用在 coordinator.selectModel 之前。不要在 metadata clear 内调用 ctx.abort，是否取消旧 provider request 继续由现有 index 生命周期负责。

## D8. Costs and Acceptance Basis

当前同步静态表 lookup 为 O(1)，引入网络后主要风险是逐请求 GET、未知模型导致请求风暴、反复解析完整目录、异步边界破坏生命周期、缓存跨账号复用，以及无界响应/缓存。设计选择有界内存 Map 与按需加载，不增加磁盘同步或后台任务。

- 一次成功读取构建 O(M) Map，后续 hashFor O(1)。HTTP body 的读取和 JSON 解码 O(B)，中间 body 有 8 MiB 上限；缓存只保留最多 4×4096 个 ID/hash。活动操作持有的旧不可变快照属于保持操作一致性所需空间。
- 同 scope 并发调用只进行一次 GET；认证解析每个入口一次用于确认账号，宿主可能自行缓存或刷新。相同 scope 的新鲜已知模型请求不增加 GET，不重新解析目录，不复制 Map。
- 300 秒 TTL 来自 Codex 基线；30 秒未知/失败退避是 expert 对交互请求风暴的限制，每分钟每 scope 额外刷新最多约 2 次。3 秒 GET 上限保证目录故障不会无限延迟请求，不声称覆盖宿主认证刷新时间。
- 选择模型不触发网络；每次 prepareRequest 最多 resolve 一次，即使内部递归或连续压缩。正常 endpoint GET 不触发 Responses 重试器。

验收使用调用次数、可控时钟、可控 Promise、body 上限、listener/abort 观察和状态不变断言，不用一次实测耗时作为性能阈值。具体负载、输入与预期在 Todo 的 How To Test 中唯一维护。

## D9. Documentation and Delivery

README 更新范围仅 Codex Compact 节，说明自动 hash 来源、版本默认与覆盖示例、离线及旧模型缺失处理、官方地址范围、模型注册仍由 Pi 负责。UPSTREAM 区分保持不变的 0.154.0 算法基线与经真实目录验证采用的 `metadataClientVersion=0.156.0`；不能改写成已整体升级到 Codex 0.156.0。

不修改历史设计文件以伪造旧验收事实。旧 `docs/codex-compact-request-continuity-fix.md` 提到的 builtin/static hash 前提视为当时测试基线；本次相应测试改用显式目录 fixture，并在本次验收记录说明。原型保留为证据，不直接复制到生产目录，不默认删除。

worker 交付代码、对应测试、更新后的 README/UPSTREAM，以及 Todo 中的实际验证记录。没有通过或未执行的验证不能勾选；发现反证时按 handoff 的回传约定处理。

## D10. Manual metadata version command

### D10.1. User contract

新增 `/codex-metadata`，独立于 `/compact`。命令可在当前未选择 Codex 模型时使用，只管理目录查询的客户端版本，不更改模型、不发起压缩、不判断某版本是否为官方最新版。

| Invocation | Result |
| --- | --- |
| `/codex-metadata` | 只读显示有效版本、来源 default/global/project，以及来源文件路径；始终显示全局目标文件路径。显示可用的设置和 reset 用法。 |
| `/codex-metadata version 0.156.0` | 只修改全局配置的 metadataClientVersion，输出保存值、目标路径和重新读取的当前有效版本及来源。 |
| `/codex-metadata reset` | 只删除全局 metadataClientVersion 字段，保留文件及其他字段；显示重新计算的有效版本和来源。若可信项目仍有合法覆盖，仍以项目版本为准，不声称已恢复内置版本。 |

参数先 trim，再按空白切分；只接受无参数、恰好 `version <version>` 或恰好 `reset`，关键字大小写敏感。版本复用 D2 校验，`latest`、预发布、额外参数、缺失版本、`--project` 等均报用法错误且零文件写入。不提供隐式 project 写入、交互式输入、在线版本验证或版本自动补全。

全局目标为 `join(getAgentDir(), "pi-codex-compact.json")`，不能硬编码 HOME。项目配置仍只在 `ctx.isProjectTrusted()` 为 true 时读取；不可信时连项目文件都不探测。有效项目版本遮蔽全局值时，设置/reset 的结果明确包含 `Project override remains active: <version> (<path>).`。用户如需移除此覆盖，自行编辑显示的项目文件；本命令不替其改项目。

命令成功保存返回后，新开始的请求使用新配置，无需 reload。正在进行的请求及其重试继续使用原快照；不取消请求、不清 coordinator、不 clear/cancel 元数据 store。缓存本来按版本隔离，设置到新版本后下次请求按现有规则取目录；设置回仍有有效缓存的旧版本允许命中。项目覆盖导致有效版本未变时，也不强制刷新。命令本身零认证、零 HTTP、零模型/会话变更。

### D10.2. Structure and read semantics

在 `config.ts` 增加共享的版本校验函数、带来源的只读状态函数、全局字段更新函数；`loadConfig(cwd, trusted)` 的签名和容错行为不变。建议接口如下，允许局部命名调整，语义不得改变：

```ts
function isMetadataClientVersion(value: unknown): value is string;
type MetadataVersionStatus = {
  version: string;
  source: "default" | "global" | "project";
  sourcePath?: string;
  globalPath: string;
  warnings: string[];
};
function getMetadataVersionStatus(cwd: string, trusted: boolean): MetadataVersionStatus;
function updateGlobalMetadataClientVersion(version: string | undefined): void;
function registerMetadataCommand(pi: Pick<ExtensionAPI, "registerCommand">): void;
```

undefined 表示 reset；更新函数自身也校验 version，不能只依赖命令解析。状态读取和 loadConfig 共用文件解析与字段校验，确保状态显示的版本与请求路径实际使用值一致。正常 JSON 对象中的非法 metadataClientVersion 仍忽略，显示来自下一优先级的有效值；命令状态可附警告说明哪个文件的版本字段被忽略。文件 ENOENT 为未配置；无效 JSON、非对象根节点或其他读取错误，状态展示安全的路径及错误类别警告，按既有读取语义回退；普通请求不因此增加通知。sourcePath 仅 default 来源可省略。

`metadata-command.ts` 负责参数解析、调用这些函数、生成英文反馈并注册一个命令；`index.ts` 初始化时无条件调用 registerMetadataCommand。模块不持有 store，不添加新的依赖。命令 handler 虽按 Pi API 返回 Promise，但配置读取和更新过程同步完成，不等待远端、agent idle 或其他异步操作。

反馈使用 `ctx.ui.notify`；hasUI=false 时通过 stderr 输出同样的安全文本，不能写 stdout、sendMessage 或生成模型轮次。参数/写入错误为 error，状态读取的降级诊断为 warning，正常结果为 info。捕获配置错误后不调用 ctx.abort，不追加 checkpoint、失败标记或会话消息。不要回显整个配置、凭证、原始解析异常或文件内容；仅使用受控错误类别、文件路径和版本信息。ui.notify 抛错时仅尝试向 stderr 输出一次原结果，stderr 也失败则结束反馈；不回滚已保存的文件，不把保存成功误报为写入失败，也不向运行中的请求传播反馈错误。

loadConfig 和状态函数各自在单次调用中对每个允许读取的配置文件至多读取/解析一次，不通过先 loadConfig 再逐层重读来推断来源。更新命令完成写入后允许重新读取一次状态以准确显示生效来源；这些文件操作都在显式命令内，不增加普通请求的文件读取次数。

### D10.3. Write semantics

只在用户显式执行 version/reset 时写入。读取目标文件后直接对原始 JSON 对象增删单一字段，不使用 parseConfig 后的已过滤对象做全量保存，否则会丢失未知字段。其他已知或未知字段、嵌套对象保持语义相同。格式允许统一为两空格缩进和末尾换行。

- ENOENT：version 创建所需全局目录和配置；reset 是无操作，不创建目录或文件。
- 已有合法对象：version 写入合法字符串；reset 删除该自有属性。字段原来非法也允许覆盖或删除。
- 设置到同一字符串，或 reset 时该字段本来不存在：无操作，不重写文件，保留原字节。
- 已有无效 JSON、数组、null、其他非对象根节点或读取失败：拒绝修改并报告错误，不把它当空配置覆盖。状态读取仍按 D10.2 容错，两者不能混用。
- 使用同目录唯一临时文件、排他创建、写入并关闭、rename 替换的顺序，避免写入或 rename 失败破坏原文件。失败时关闭句柄并删除本次临时文件，原文件保持字节不变；若清理失败报告安全的路径和错误类别，不能声称已清理。
- 新文件使用 0600；已有普通文件保留权限位。临时文件独立命名，不能使用固定共享临时路径。目标为符号链接或非普通文件时拒绝修改并说明原因，避免 rename 替换链接本身。新建父目录仅发生在合法 version 请求且目标缺失时。

采用同步 Node 文件 API，与现有小配置的读取方式一致，配置修改在单个 JS 调用栈内完成，同一扩展实例的两次命令按执行顺序生效。不引入进程锁、后台队列或长期缓存；其他进程/外部编辑器同时修改同一文件仍不保证无覆盖，不声称提供跨进程事务。无需引入新包或通用配置框架。

### D10.4. Verification and delivery boundaries

新增 `metadata-command.test.ts`；扩展 `config.test.ts`；`index.test.ts` 和 `request-lifecycle.test.ts` 的 fake ExtensionAPI 补 registerCommand。其他真实加载测试由完整检查验证，不能在生产里用可选调用掩盖不完整的 fake API。来源查询、字段保留、写入失败、注册命令到请求路径和并发快照验收见 Todo H14，成本验收为确定性文件/网络调用计数。

接口依据：Context7 `/earendil-works/pi` 查询了 registerCommand/ExtensionCommandContext，但返回 main 文档，不能认定为 0.87.0 专版。已对照本仓库安装的 `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`：registerCommand 参数、Promise<void> handler、hasUI、ui.notify、isProjectTrusted 均存在。实现形态可参考 `extensions/openai-fast-mode/src/index.ts` 的 `/fast`，其直接全量保存函数不满足本任务的保留未知字段及失败不破坏文件要求，不能原样复用。

README 的 Codex Compact 节增加三种命令、全局写入、项目优先、reset 边界和下一次请求生效示例；UPSTREAM 将其标为本地配置管理功能，不归因于上游 Codex。本轮只修改设计文件；README 产品说明由 worker 随实现更新，避免把尚未实现的命令公布为可用功能。

## Handoff Rehearsal

已按未参与讨论的 worker 视角检查：T1 有字段优先级与纯函数边界；T2 有官方请求和缓存状态规则，包括认证不可取消的宿主限制；T3 明确直接调用方省略 hash 的语义；T4 有全部旧 hash 使用点、候选转 transition 的顺序和快照传递方式；T5 有 manual/automatic 两类入口与生命周期接线；T6 有文档范围和完整验证命令。

追加范围已推演：D6.2 明确无效候选回退和跨请求状态保留；D10 明确命令参数、作用域、读写差异、错误、原子替换、项目覆盖、当前请求快照和测试边界。实施仍需 worker 编写测试证明这些行为成立。若当前依赖接口与所读 Pi 0.87.0 源码不同，或这些状态规则无法同时满足，按交接约定反馈反证，不自行选择另一种行为。
