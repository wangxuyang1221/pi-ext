# Upstream provenance

## Plugin baseline

本扩展由 [`@yeungkc/pi-codex-compact`](https://github.com/YeungKC/pi-codex-compact) `0.0.6` 导入，固定提交为 `53630cd9b937a8a4873271e20188c3f18819ca6a`。上游采用 MIT，Copyright (c) 2025 YeungKC，许可证保存在本目录 `LICENSE`。

源码维护在 `src/`，测试维护在 `__tests__/`。相对导入采用 NodeNext 的 `.js` 后缀。同步上游时以该提交为共同基线，只移植所需改动，保留本地 UI ownership、checkpoint 来源验证和失败时保留历史的行为。

## Pi compatibility

当前依赖固定为 Pi `1.4.0`。`src/pi-responses.ts` 通过公开 exports 加载 Responses 工具转换函数；声明转换复用 `getResponsesToolSupport()`、`resolveTranscriptTools()` 和 `convertResponsesTools()`。保留逐消息转换，用于记录输出 item 对应的原始消息及 checkpoint 边界。

请求投影校验比较完整 input、instructions 和 tools。支持普通投影，以及能由实际 payload 唯一证明的 hidden/forced 投影；工具移除或重声明后无法证明的隐藏策略、任意 context hook 和后续 handler 改写不属于隐式支持范围。provider 请求之外发起压缩时，使用仍有效的观察快照或 README 中的 `manualProjection` 配置。

checkpoint 后重建边界处仍可用的工具声明，再应用后续更新。该处理不修改 opaque、持久化 checkpoint 或用户来源，不恢复隐藏或已移除的工具。跨模型 thinking 按当前 provider、API 和 model 身份处理。

`responses-parity.test.ts` 对照当前 Pi converter 与网络发送前的 payload；`repair-runtime.test.ts` 通过真实 AgentSession 和 ExtensionRunner 验证压缩、恢复及 hidden/forced hooks。Pi 1.3 合成模型和 session fixture 用于旧会话回归，不作为当前宿主版本或线上质量的证明。

## Local behavior

- Pi 发起的压缩复用原生进行中 UI；provider 请求前的自主压缩使用独立 widget，并按操作身份清理。
- V2 checkpoint 保存可选的 `preservedInputSources`。无法证明旧保留区来源时取消本次压缩，保留旧 checkpoint，不通过放宽前缀校验继续。
- 请求开始时冻结历史、工具、提示词与模型；等待期间证据变化时拒绝提交。失败输入与 payload 成对清理。
- 非 Codex 模型遇到 V2 checkpoint 时回放原始分支，不把加密 marker 当成文本摘要。
- 历史明文的 64k token 上限受剩余窗口约束，不截断本次受保护输入。远端明确超窗时直接失败，不只保留最新 user turn 重试压缩。
- 同一请求的本地容量修复最多一次；不同 hash 的协议迁移及 Pi 自身 overflow retry 分别处理。错误正文有 300 秒总期限和 1 MiB 上限，不完整诊断不能触发模型 fallback。

具体配置、命令和兼容限制见根目录 README。

## Codex algorithm provenance

部分算法来自 [OpenAI Codex 0.154.0](https://github.com/openai/codex/tree/6b9826e3aa83b1a5947db50f4332cb9c65f1b340)，固定提交 `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`，Apache-2.0，Copyright 2025 OpenAI。许可证和归属保存在 `CODEX-LICENSE`、`NOTICE`；原插件的 MIT 许可证保持不变。

| Upstream source | Local implementation |
| --- | --- |
| `utils/string/src/truncate.rs` | `token-estimation.ts` 的 UTF-8 字节预算与首尾截断 |
| `core/src/context_manager/history.rs` | `token-estimation.ts`、`native-compaction.ts`、`usage-accounting.ts` 的近似计数及 usage 增量 |
| `core/src/compact_remote_v2_attempt.rs` | 本地裁剪后仍由远端判断是否超窗 |
| `core/src/compact_remote_v2.rs`、`compact_remote_v2_images.rs` | 保留图片成本及图片与标签的原子处理 |
| `protocol/src/models.rs` | `response-item-estimation.ts` 的估算视图，不改写实际请求 |
| `core/src/context/contextual_user_message.rs`、`context-fragments/` | `turn-boundary.ts` 和媒体模块的特殊轮次解析 |

`src/media/` 将固定版本图片、音频和特殊上下文解析编译为无 host import 的 WebAssembly。普通构建校验并复制源码、产物、manifest、许可证和对应第三方源码；不调用 Rust。维护要求见 `src/media/README.md`，分发后的对应路径为 `dist/media/README.md`。

`scripts/codex-compact-reference.mjs`、`codex-compact-full-reference.mjs` 和 `codex-compact-full-vectors.mjs` 生成固定 Codex 版本的参考程序与向量。媒体 fixture 的输入及来源指纹也纳入验证。差分覆盖本地估算语义，不证明服务端未公开的 tokenization 或真实压缩质量。

## Model catalog metadata

模型目录请求的默认 `client_version` 为 `0.156.0`，可通过 `metadataClientVersion` 覆盖；它与压缩算法来源版本分别维护。`/codex-metadata` 是本地配置命令，不查询在线最新版本。

`src/model-metadata.ts` 使用 Pi 解析的认证，只向官方 Codex models endpoint 发 GET。`comp_hash` 是不透明的压缩兼容标识，不根据模型名称猜测。缓存 TTL 为 300 秒，失败和未知模型限流 30 秒，最多保留 4 个认证 scope，响应上限 8 MiB，HTTP 阶段上限 3 秒。目录不可用时 hash 为未知，旧 checkpoint 已有的 hash 保留。
