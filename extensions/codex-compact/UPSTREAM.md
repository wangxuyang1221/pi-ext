# Upstream provenance

本扩展基于 [`@yeungkc/pi-codex-compact`](https://github.com/YeungKC/pi-codex-compact) 修改并整合到 `pi-ext`。

## Import baseline

- npm version: `0.0.6`
- upstream commit: `53630cd9b937a8a4873271e20188c3f18819ca6a`
- upstream license: MIT, Copyright (c) 2025 YeungKC

## Local changes

- 将上游根目录源码迁入 `extensions/codex-compact/src/`，测试迁入 `extensions/codex-compact/__tests__/`。
- 将内部相对导入调整为本仓库 NodeNext 构建使用的 `.js` 后缀。
- Pi 发起压缩时复用 Pi 原生进行中 UI，不再显示第二套扩展 footer 状态。
- provider request 自主压缩时在编辑器上方显示动画 widget；每次操作结束时只清理自身展示，session、分支或模型切换后，旧操作不得清理或中止新请求。
- 在 Pi 提交 compaction entry 后验证 Codex Compact V2 来源；将结果通知延迟到原生 compaction 卡片重建后显示，并保持远程失败 fail closed。
- 非 Codex 模型遇到既有 V2 checkpoint 时回放原始分支，避免把 V2 marker 当作可用文本摘要。
- 远端压缩自身超窗时直接失败，保留历史与原 encrypted checkpoint，不进入尾部恢复或额外压缩；诊断沿用原始错误分类，`recoveryAttempted` 为 `false`。这不移除网络重试、模型切换或 Pi 普通请求超窗后发起压缩的流程。session 或模型切换会中止仍在进行的 Pi-triggered 远程请求；旧操作结束不得释放新操作的占用状态。

同步上游时应以该 commit 为共同基线，只移植明确需要的后续改动，避免覆盖本仓库的 UI ownership、provenance、上下文完整性和 fail-closed 行为。

## Pi request compatibility

请求转换以 Pi `0.87.0` 为当前核验基线。`src/native-compaction.ts` 复用公开的 transcript 归一化、提示更新渲染和工具状态解析，保留局部消息转换以处理 checkpoint 边界。先重建完整历史中的工具状态与消息位置，再取 checkpoint 后的输出，避免把紧邻 checkpoint 的 system 更新误当作开头提示。旧 `addedToolNames` 按目标版本宿主语义处理，不额外生成宿主已不再发送的工具加载项。

`src/pi-responses.ts` 通过包 `exports` 解析公开的 Responses 工具转换函数，复用 grammar 和 strict schema 处理。Node 的解析用于避开 Pi 文件扩展加载器对 `pi-ai/*` 的前缀别名，不修改宿主或挂接其内部方法。该适配绑定当前依赖版本，真实 `DefaultResourceLoader` 测试覆盖全部八个扩展的源码加载，集成生命周期检查覆盖构建产物加载。

`responses-parity.test.ts` 使用目标版本原生 converter 和 `streamSimple` 的实际网络前 payload 对照，覆盖 system sections、工具新增/移除、tool search、constrained sampling、checkpoint 后连续请求及失败重试。失败继续保留严格前缀校验，诊断只新增错误类别与首个不一致位置，不保存私有内容。

Pi 的 `getAllTools()` 可能缺少 wire grammar 格式；扩展结合 transcript 工具声明与观察到的请求恢复格式。thinking 通过公开的 `clampThinkingLevel` 按实际压缩模型归一化；`off` 按 0.87.0 发送对应 effort，默认 `none`，不支持的模型则省略。

turn-state 保留到下一条实际投递的 user message，工具循环和无新用户消息的重试不重置。queued follow-up 排队时不重置，交付时重置；steering 实际交付也作为用户边界。Pi 公共 message 事件不区分这两种直接交付来源，这里明确采用 Pi 的消息边界，不宣称与 Codex 内部 TurnContext 的 steering 生命周期完全相同。会话切换、关闭和空闲 `agent_settled` 释放当前状态；远端压缩的迟到响应不能写入新轮次。

## Codex algorithm provenance

本次将部分算法移植自 [OpenAI Codex 0.154.0](https://github.com/openai/codex/tree/6b9826e3aa83b1a5947db50f4332cb9c65f1b340)，commit `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`，Apache-2.0，Copyright 2025 OpenAI。许可证与归属见 `CODEX-LICENSE`、`NOTICE`，原插件的 MIT 许可证保持不变。

- `codex-rs/utils/string/src/truncate.rs`：UTF-8 字节预算和首尾保留截断，TypeScript 实现在 `src/token-estimation.ts`。
- `codex-rs/core/src/context_manager/history.rs`：加密项与图片的近似 token 计算，以及服务端 usage 加未覆盖项目的计数方式，适配到 `src/native-compaction.ts`、`src/token-estimation.ts`、`src/usage-accounting.ts`。多媒体已接入同版本 Rust 解码器并通过完整 estimator 差分，contextual user 边界适配在 `src/turn-boundary.ts`。
- `codex-rs/core/src/compact_remote_v2_attempt.rs`：裁剪后仍发送远端请求，不把本地估算当作精确的超窗拒绝依据。
- `codex-rs/core/src/compact_remote_v2.rs` 与 `compact_remote_v2_images.rs`：保留消息时计入图片成本、原子保留或删除图片及相邻标签。

`src/media/` 将 Codex 所用的 image 0.25.9 与 Symphonia 0.6.0 编译成无 host import 的 WebAssembly，执行完整图片解码和音频时长探测，不读取远程 URL。Node 运行无需 Rust。macOS TIFF 和 Windows BMP 的额外支持与 CLI 依赖特性统一结果保持一致。模块及第三方源代码、许可证、版本和校验和随包发布；Symphonia 的 MPL-2.0 不能被本扩展的 MIT/Apache-2.0 归属替代，详见 `src/media/README.md`。

`codex-rs/core/src/context/contextual_user_message.rs`、`codex-rs/context-fragments/src/fragment.rs` 及对应 fragment 实现提供特殊轮次规则。`src/media/src/context.rs` 用 quick-xml 0.41.0 保留 hook 解析语义，用 serde_json 1.0.149 校验 inter-agent JSON 和 AgentPath；只判断能否反序列化，不执行这些内容。

`codex-rs/protocol/src/models.rs` 的有效 ResponseItem 字段、默认值、序列化省略规则被适配为 `src/response-item-estimation.ts`，只影响估算视图，不改写实际请求。移除了超窗时只压缩最新 user turn 的恢复方式，改为明确失败且不提交新 checkpoint。请求适配层刷新当前系统指令，默认有效窗口为原始窗口的 95%，可通过 `effectiveContextWindowPercent` 覆盖。没有修改 Pi 上游，也没有增加分段压缩。当前请求指纹保护只覆盖可见 payload；Pi 未暴露完整服务端 reasoning 能力标记及后续扩展的最终 payload。默认质量测试及显式历史报告重建见 [质量报告脚本](../../scripts/codex-compact-quality-development-report.mjs)；合成 fixture 不代表在线质量结论。

基础参考向量由 `scripts/codex-compact-reference.mjs` 生成。完整参考程序由 `scripts/codex-compact-full-reference.mjs` 构建，编译原版 protocol/utility crates 和未修改的 estimator 函数；`scripts/codex-compact-full-vectors.mjs` 生成逐项与历史聚合向量。来源、输入及产物 SHA-256 保存在测试 fixture 中。当前 276 项参考向量覆盖字段默认值、数字、媒体、饱和计数、请求包装和特殊轮次边界；真实 183 项历史的逐项、总量和 usage 增量也一致。Pi 的无 type 简写消息保留实际包装计数，完整 tools/system HTTP 包装与 Codex 的 canonical history 另行区分，不宣称未公开的服务端 tokenization 已被本地精确复现。

## Model catalog metadata

压缩算法仍以上述 Codex `0.154.0` 为来源基线；模型目录请求的默认 `client_version` 单独采用已通过真实只读查询验证的 `0.156.0`，可通过 `metadataClientVersion` 覆盖。这不表示压缩算法或 Pi 依赖已升级到 Codex `0.156.0`。

`src/capabilities.ts` 不再维护逐模型 `comp_hash` 表。`src/model-metadata.ts` 经 Pi `ModelRegistry.getApiKeyAndHeaders` 读取认证，只向官方 [models endpoint](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/codex-api/src/endpoint/models.rs) 发 GET。`comp_hash` 依照上游 [ModelInfo 定义](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/protocol/src/openai_models.rs) 是标识压缩兼容模型配置的不透明字符串。进程内目录缓存 TTL 为 300 秒，与上游 [models manager](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/models-manager/src/manager.rs) 的默认值一致；30 秒失败和未知模型限流、4 个认证 scope 上限、8 MiB 响应上限及 3 秒 HTTP 上限是本扩展的本地边界。目录缺失或请求失败时不猜 hash，旧 checkpoint 自带的 hash 保留。
