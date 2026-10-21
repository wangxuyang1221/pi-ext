# Pi model catalog maintenance and upgrade requirements

## Scope and evidence

核验日期为 2026-10-14 UTC。本调查针对 Pi coding agent 的模型目录，不把模型目录更新和模型推理协议实现混为一谈。

- 安装版为 `@earendil-works/pi-coding-agent@0.87.1`，其实际解析的 `@earendil-works/pi-ai` 也为 `0.87.1`。核验了本机包的 `package.json`、完整 `README.md`、`docs/models.md`、`docs/custom-provider.md`、`docs/configuration.md`、`docs/llama-cpp.md`，以及相关编译后的运行时代码。官方版本源码见 [v0.87.1][installed-package]。
- 当前上游固定在提交 [`aa9cf15be4fd9b7a362404b39bfdcc04b083ad29`][upstream-commit]，提交时间为 `2026-10-14T11:55:26Z`。该提交的 coding-agent 和 pi-ai 包版本字段均为 `1.2.0`。这是源码版本，不代表已核验注册表最新发布版本。[上游包配置][current-package]
- Context7 查询使用 `/earendil-works/pi/v0.87.1`，随后回到官方源码核验。下面的判断以固定版本源码和实际 HTTP 响应为依据，不依赖搜索摘要。

## Version boundaries

官方 [0.80.8 发布说明][release-0808] 明确把 live catalog refresh、`models-store.json`、per-provider pi.dev overlay 和 `pi update --models` 列为新增能力，并说明强制刷新不更新 Pi 或扩展。对应 tag 的 [CHANGELOG][changelog-0808] 标注发布日期为 `2026-07-16`。因此不能把本调查的动态刷新结论直接套到更早版本；`MINIMUM_PI_VERSION = 0.80.7` 是目录数据兼容门槛，不是该 CLI 命令的首次发布版本。

本仓库 [package.json](../package.json) 的 `peerDependencies` 和 `devDependencies` 将 pi-ai、coding-agent、pi-tui 都固定到 `0.99.1`，仓库 `node_modules/@earendil-works/pi-coding-agent/package.json` 也实际为 `0.99.1`。这与任务指定的外部安装版 `0.87.1` 是两套独立核验对象，不能把后者写成本仓库当前依赖。

补查 `v0.99.1` 官方源码确认，该版仍有四小时 freshness 窗口、ETag 检查、仅接受较新 `Last-Modified` 的覆盖条件、启动后台刷新和显式创建阶段联网开关，并发送 `types=chat,image,classifier`。OpenRouter 在该版仍使用普通 `withRemoteCatalog`，不是下面描述的当前 main 个性化目录分支。[0.99.1 远程目录][remote-0991]、[0.99.1 ModelRuntime][runtime-0991]、[0.99.1 交互模式][interactive-0991]

## Answer

厂商新增模型时，Pi 用户不一定要升级。安装版 0.87.1 已支持从 pi.dev 拉取新的模型目录，覆盖包内模型元数据；`pi update --models` 可以强制刷新，而不升级 Pi 或扩展。[0.87.1 模型文档][models-doc]、[刷新命令实现][update-command]

但不能承诺厂商发布后立刻可用。模型需要进入 Pi 的生成来源，通过筛选和兼容性处理，再发布到 pi.dev。用户还需要能联网，并具备该 provider 的可用认证。新模型如果要求旧客户端没有实现的协议或请求行为，仅更新目录不能解决。[生成脚本][generator-old]、[认证与刷新调度][models-runtime]、[目录兼容协议][catalog-protocol]

| 情况 | 是否必须升级 Pi | 可行操作与依据 |
| --- | --- | --- |
| 已支持厂商新增模型，仍使用现有协议，pi.dev 已收录 | 通常不用 | `pi update --models`，随后打开 `/model`。[远程目录][remote-old] |
| 模型尚未进入目录，但实际端点支持 Pi 已实现的 API | 不必等官方发布 | 在 `models.json` 的 `models` 中手动增加模型，并填写正确的元数据。[模型配置][models-doc] |
| 全新厂商使用已有兼容协议 | 通常不用 | 在 `models.json` 配置 provider、端点、认证和模型。[模型配置][models-doc] |
| 厂商需要特殊发现、认证或流协议 | 不一定必须升级，但 JSON 不够 | 使用适配当前 Pi API 的 provider 扩展，必要时实现自定义流。[扩展文档][provider-doc] |
| 新模型需要旧 Pi 缺失的协议实现或新客户端行为 | 可能必须升级 | 升级到包含实现的版本，或编写能在旧版本运行的完整适配扩展。远程 JSON 不会安装协议代码。[扩展文档][provider-doc]、[目录发布门槛][catalog-publisher] |

## How the catalog is maintained

### Generation sources

0.87.1 的 `packages/ai/scripts/generate-models.ts` 汇总以下来源。[生成入口][generator-old]

- `https://models.dev/api.json`，用于 Anthropic、OpenAI、Google、Groq、Cerebras 等 provider。多数分支只收录 `tool_call === true` 的模型。
- `https://openrouter.ai/api/v1/models`，收录支持工具的路由模型。
- Vercel AI Gateway 的模型端点。
- Radius 的公开目录，认证后的客户端还可以在运行时获得覆盖数据。
- NVIDIA NIM 的实时模型 ID 列表，用于校正对应来源。

生成器还包含人工补充、排除项、价格修正、上下文限制和协议兼容标记。重叠来源优先采用 models.dev 数据。因此目录不是所有厂商 `/models` 的原样集合，厂商新增 ID 也不保证自动进入 Pi。[0.87.1 生成脚本][generator-old]

当前上游仍采用这套来源，并扩展了 image 和 classifier 目录。例如 OpenRouter 按输出类型抓取，另有 models.dev decision 数据及显式维护的 classifier 模型。当前聊天目录仍进行工具能力筛选。[当前生成脚本][generator-current]

### Bundled data and package releases

生成器产出 provider 模型模块、`models.generated.ts`、provider JSON 数据和带 `generatedAt` 的 manifest。0.87.1 的 `providers/all` 导入生成后的模型表，并明确构造内置 provider 列表；它不是每次 `getModels()` 都向厂商查询。[内置 provider 集合][builtin-providers]、[生成脚本][generator-old]

pi-ai 的 `build` 和 `prepublishOnly` 包含模型生成。当前发布脚本会重新生成模型、检查数据、构建和测试，再提交 release tag。tag 发布工作流随后构建、检查发布包并发布到 npm。这条路径更新包内模型快照及协议实现。[0.87.1 pi-ai 包脚本][ai-package-old]、[当前 release 脚本][release-script]、[当前发布工作流][release-workflow]

### Catalog publication without a Pi release

模型目录另有独立的 `Publish Model Catalog` 工作流，0.87.1 已存在，当前上游仍在维护。它运行严格 JSON 生成和校验，再通过发布脚本上传到 Cloudflare R2。[0.87.1 工作流][catalog-workflow-old]、[当前工作流][catalog-workflow]

当前工作流支持 main 的成功 CI、定时触发和人工触发。定时生产发布安排在工作日 Vienna 时间 `10:17`、`12:17`、`14:17`；其他自动发布受到工作日 `10:00` 至 `15:00` 的窗口限制，显式人工发布可绕过窗口。这是代码配置，不保证每次任务都成功，也不能当成厂商上新后的可用时间承诺。[当前工作流][catalog-workflow]

发布器先上传不可变 revision 文件，再更新 `models/v1/index.json`。相同内容无需重复上传；index 维护版本门槛到 revision 的映射。因此目录能独立于 Pi 包发布更新。[目录发布器][catalog-publisher]

## Runtime updates and discovery

### Behavior verified in 0.87.1

`ModelRuntime.create()` 为内置 provider 添加 pi.dev 远程覆盖层，Radius 使用自己的 provider 行为。默认缓存是 agent 目录内的 `models-store.json`，它和用户编辑的 `models.json` 不是同一文件。[ModelRuntime][runtime-old]

普通 provider 的刷新逻辑如下。[远程目录实现][remote-old]

1. 先恢复本地缓存，离线也能使用。
2. 允许联网时请求 `https://pi.dev/api/models/providers/<provider-id>`，发送包含 Pi 版本的 `User-Agent`。
3. 常规成功检查具有四小时 freshness 窗口，用 ETag 做条件请求。四小时是刷新时的跳过条件，不代表存在每四小时自动唤醒的定时器。
4. 仅当远程 `Last-Modified` 晚于包内 `generatedAt` 时采用覆盖。同 ID 替换元数据，新增 ID 加入；普通覆盖层保留包内未被覆盖的模型，不通过目录删除包内模型。
5. 网络失败不清空已有快照。304 更新检查时间，404 或 501 有单独的回退处理。

刷新由具体入口触发。0.87.1 交互模式在启动后发起后台刷新，模型选择器也会调用刷新协调器；`PI_OFFLINE` 禁止常规网络刷新。`ModelRuntime.create()` 本身只有在 `allowModelNetwork === true` 时才允许创建阶段联网，不能把交互 CLI 行为直接套到所有 SDK 调用。[交互启动][interactive-old]、[选择器][selector-old]、[ModelRuntime][runtime-old]

`pi update --models` 明确传入 `allowNetwork: true` 和 `force: true`，绕过四小时窗口，并设置 15 秒整体超时。这个管理命令显式请求网络，不能用它做离线验证。[命令实现][update-command]

`Models.refresh()` 先恢复缓存，再解析认证。没有可用 credential 的 provider 不执行网络阶段。因此没有认证的 provider 不会因为运行一次强制刷新就获得完整远程目录。[pi-ai 刷新实现][models-runtime]

### What automatic discovery means

普通内置 provider 更新的是 Pi 托管的目录，不是对每家厂商统一执行实时模型发现。内置 provider 列表仍由客户端代码决定；远程目录不会自动生成一个未知厂商的认证和协议适配器。[内置 provider 集合][builtin-providers]、[ModelRuntime][runtime-old]

真正的动态发现可以由 provider 的 `refreshModels` 实现。0.87.1 已有该扩展接口，llama.cpp router 集成会读取服务端的模型状态；兼容端点如 Ollama、LM Studio 则在文档中要求通过 `models.json` 配置，不能推断它们会自动枚举全部模型。[扩展接口][provider-doc]、[llama.cpp 文档][llama-doc]

当前上游新增一个值得区分的行为。OpenRouter 使用 `withPersonalizedCatalog()`，拿 pi.dev 与包内目录的合集向 `/models/user` 查询账号允许的模型及限制、价格，并保存个性化结果。它不是直接把账号接口返回的所有未知 ID 都加入目录，也不沿用普通覆盖层的四小时检查窗口。0.87.1 的 `ModelRuntime` 对 OpenRouter 没有这个特殊分支。[当前运行时][runtime-current]、[当前远程包装器][remote-current]、[OpenRouter 实现][openrouter-current]

## Configuration and extension escape hatches

`<agent-dir>/models.json` 默认是 `~/.pi/agent/models.json`。打开 `/model` 会重读它。`providers.<name>.models` 增加或替换同 ID 模型；`modelOverrides` 修改已有模型元数据，未知 override ID 会被忽略。因此增加新模型应使用 `models`，不是只写 `modelOverrides`。[配置位置][configuration-doc]、[模型文档][models-doc]

模型 ID 存在不等于推理可用。应核实 API 类型、端点、账号权限、输入能力、上下文窗口、输出限制、价格和 reasoning 行为。配置中的 `compat` 应对应真实服务差异，不能只凭厂商宣称 OpenAI-compatible 就启用标记。[模型文档][models-doc]、[扩展文档][provider-doc]

扩展通过 `pi.registerProvider()` 注册完整 `Provider` 或旧式 `ProviderConfig`。静态端点调整、动态发现、OAuth 和自定义流均有对应接口。完整 provider 的 `refreshModels` 用 `context.publish()` 发布状态；旧式回调返回模型列表。是否持久化由 provider 决定。扩展是可信代码，具有读取认证和请求数据的能力。[扩展文档][provider-doc]

## Compatibility limits and live verification

当前目录协议按 Pi 版本选择兼容 revision。客户端 `User-Agent` 会引导服务端跳转到带 `pi-version` 的 URL，服务端选择 `minimumPiVersion <= 客户端版本` 的最高门槛目录。没有版本的请求得到默认目录，所以直接打开网页或普通 curl 的结果未必等同于旧 Pi 实际收到的结果。[协议源码][catalog-protocol]

0.87.1 和当前发布器的 `MINIMUM_PI_VERSION` 均为 `0.80.7`，源码注释要求在生成数据需要旧客户端缺失的行为时才提高门槛。当前客户端还发送 `?types=chat,image,classifier`；协议为没有该参数的旧客户端保留 chat-only 表示。这些兼容机制保护旧客户端，但不是永远兼容所有未来模型的承诺。[发布器][catalog-publisher]、[当前远程客户端][remote-current]、[协议源码][catalog-protocol]

在 `2026-10-14T12:19:20Z` 对官方 OpenAI catalog 进行了只读 HTTP 验证。请求带 `User-Agent: pi/0.87.1`，结果为以下响应。这证实安装版版本号在调查时能得到当天发布的远程目录，不需要先升级包。

```text
GET https://pi.dev/api/models/providers/openai
User-Agent: pi/0.87.1
307 Location: https://pi.dev/api/models/providers/openai?pi-version=0.87.1

200 OK
Last-Modified: Wed, 14 Oct 2026 10:20:29 GMT
x-pi-model-catalog-minimum-version: 0.80.7
x-pi-model-catalog-revision: sha256-ce8d8e2e9ed63a46c680497adc258ae62cc552d084c3f15235896c971afc6fb1
```

验证地址为 [带 0.87.1 版本的官方端点][live-catalog]。响应值是调查时的快照，后续会变化。没有发起模型推理请求，因此这里证明的是目录分发兼容，不是所有返回模型都能在该账号和旧协议实现上推理成功。pi.dev 独立仓库的 GitHub API 在本次访问中返回 404，服务端版本选择规则以 Pi 仓库中注明两仓库共享的协议源码及以上实际重定向响应核验。

## Practical recommendation

对 0.87.1 用户，先确认认证并运行 `pi update --models`。模型仍未出现时，区分目录未收录、账号不可用、筛选限制和协议不支持。已有协议可手动配置模型或安装 provider 扩展；只有需要新客户端代码时才把升级当成必要步骤。不要直接编辑安装包内生成文件，也不要把 `models-store.json` 当作手工配置入口。[模型文档][models-doc]、[扩展文档][provider-doc]、[远程目录][remote-old]

本任务只新增研究文档，未修改实现、未运行推理或刷新本地目录命令。主代理运行 `pnpm run check` 通过，2654 项测试通过、13 项跳过；类型检查、构建、发布包与宿主加载校验通过。

## Sources

文中源码链接固定到 `v0.87.1` 或调查时的上游提交；官方目录端点是随发布变化的在线来源。

[installed-package]: https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/package.json
[upstream-commit]: https://github.com/earendil-works/pi/commit/aa9cf15be4fd9b7a362404b39bfdcc04b083ad29
[current-package]: https://github.com/earendil-works/pi/blob/aa9cf15be4fd9b7a362404b39bfdcc04b083ad29/packages/coding-agent/package.json
[models-doc]: https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/models.md
[provider-doc]: https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/custom-provider.md
[configuration-doc]: https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/configuration.md
[llama-doc]: https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/llama-cpp.md
[generator-old]: https://github.com/earendil-works/pi/blob/v0.87.1/packages/ai/scripts/generate-models.ts
[generator-current]: https://github.com/earendil-works/pi/blob/aa9cf15be4fd9b7a362404b39bfdcc04b083ad29/packages/ai/scripts/generate-models.ts
[ai-package-old]: https://github.com/earendil-works/pi/blob/v0.87.1/packages/ai/package.json
[builtin-providers]: https://github.com/earendil-works/pi/blob/v0.87.1/packages/ai/src/providers/all.ts
[release-script]: https://github.com/earendil-works/pi/blob/aa9cf15be4fd9b7a362404b39bfdcc04b083ad29/scripts/release.mjs
[release-workflow]: https://github.com/earendil-works/pi/blob/aa9cf15be4fd9b7a362404b39bfdcc04b083ad29/.github/workflows/build-binaries.yml
[catalog-workflow-old]: https://github.com/earendil-works/pi/blob/v0.87.1/.github/workflows/publish-model-catalog.yml
[catalog-workflow]: https://github.com/earendil-works/pi/blob/aa9cf15be4fd9b7a362404b39bfdcc04b083ad29/.github/workflows/publish-model-catalog.yml
[catalog-publisher]: https://github.com/earendil-works/pi/blob/aa9cf15be4fd9b7a362404b39bfdcc04b083ad29/scripts/publish-model-catalog.mjs
[catalog-protocol]: https://github.com/earendil-works/pi/blob/aa9cf15be4fd9b7a362404b39bfdcc04b083ad29/scripts/model-catalog-protocol.ts
[runtime-old]: https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/core/model-runtime.ts
[remote-old]: https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/core/remote-catalog-provider.ts
[models-runtime]: https://github.com/earendil-works/pi/blob/v0.87.1/packages/ai/src/models.ts
[interactive-old]: https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L1082-L1088
[selector-old]: https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/modes/interactive/components/model-selector.ts
[update-command]: https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/src/package-manager-cli.ts#L583-L607
[runtime-current]: https://github.com/earendil-works/pi/blob/aa9cf15be4fd9b7a362404b39bfdcc04b083ad29/packages/coding-agent/src/core/model-runtime.ts#L217-L239
[remote-current]: https://github.com/earendil-works/pi/blob/aa9cf15be4fd9b7a362404b39bfdcc04b083ad29/packages/coding-agent/src/core/remote-catalog-provider.ts
[openrouter-current]: https://github.com/earendil-works/pi/blob/aa9cf15be4fd9b7a362404b39bfdcc04b083ad29/packages/ai/src/providers/openrouter.ts
[live-catalog]: https://pi.dev/api/models/providers/openai?pi-version=0.87.1
[release-0808]: https://pi.dev/changelog/releases/0.80.8
[changelog-0808]: https://github.com/earendil-works/pi/blob/v0.80.8/packages/coding-agent/CHANGELOG.md
[remote-0991]: https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/remote-catalog-provider.ts
[runtime-0991]: https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/model-runtime.ts
[interactive-0991]: https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/modes/interactive/interactive-mode.ts
