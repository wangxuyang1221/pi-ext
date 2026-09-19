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

## Codex algorithm provenance

本次将部分算法移植自 [OpenAI Codex 0.154.0](https://github.com/openai/codex/tree/6b9826e3aa83b1a5947db50f4332cb9c65f1b340)，commit `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`，Apache-2.0，Copyright 2025 OpenAI。许可证与归属见 `CODEX-LICENSE`、`NOTICE`，原插件的 MIT 许可证保持不变。

- `codex-rs/utils/string/src/truncate.rs`：UTF-8 字节预算和首尾保留截断，TypeScript 实现在 `src/token-estimation.ts`。
- `codex-rs/core/src/context_manager/history.rs`：加密项与图片的近似 token 计算，以及服务端 usage 加未覆盖项目的计数方式，适配到 `src/native-compaction.ts`、`src/token-estimation.ts`、`src/usage-accounting.ts`。多媒体已接入同版本 Rust 解码器并通过完整 estimator 差分，contextual user 边界适配在 `src/turn-boundary.ts`。
- `codex-rs/core/src/compact_remote_v2_attempt.rs`：裁剪后仍发送远端请求，不把本地估算当作精确的超窗拒绝依据。
- `codex-rs/core/src/compact_remote_v2.rs` 与 `compact_remote_v2_images.rs`：保留消息时计入图片成本、原子保留或删除图片及相邻标签。

`src/media/` 将 Codex 所用的 image 0.25.9 与 Symphonia 0.6.0 编译成无 host import 的 WebAssembly，执行完整图片解码和音频时长探测，不读取远程 URL。Node 运行无需 Rust。macOS TIFF 和 Windows BMP 的额外支持与 CLI 依赖特性统一结果保持一致。模块及第三方源代码、许可证、版本和校验和随包发布；Symphonia 的 MPL-2.0 不能被本扩展的 MIT/Apache-2.0 归属替代，详见 `src/media/README.md`。

`codex-rs/core/src/context/contextual_user_message.rs`、`codex-rs/context-fragments/src/fragment.rs` 及对应 fragment 实现提供特殊轮次规则。`src/media/src/context.rs` 用 quick-xml 0.41.0 保留 hook 解析语义，用 serde_json 1.0.149 校验 inter-agent JSON 和 AgentPath；只判断能否反序列化，不执行这些内容。

`codex-rs/protocol/src/models.rs` 的有效 ResponseItem 字段、默认值、序列化省略规则被适配为 `src/response-item-estimation.ts`，只影响估算视图，不改写实际请求。移除了超窗时只压缩最新 user turn 的恢复方式，改为明确失败且不提交新 checkpoint。请求适配层刷新当前系统指令，默认有效窗口为原始窗口的 95%，可通过 `effectiveContextWindowPercent` 覆盖。没有修改 Pi 上游，也没有增加分段压缩。当前请求指纹保护只覆盖可见 payload；Pi 未暴露完整服务端 reasoning 能力标记及后续扩展的最终 payload。实测与剩余工作见 `docs/codex-compact-accounting.md`。

基础参考向量由 `scripts/codex-compact-reference.mjs` 生成。完整参考程序由 `scripts/codex-compact-full-reference.mjs` 构建，编译原版 protocol/utility crates 和未修改的 estimator 函数；`scripts/codex-compact-full-vectors.mjs` 生成逐项与历史聚合向量。来源、输入及产物 SHA-256 保存在测试 fixture 中。当前 276 项参考向量覆盖字段默认值、数字、媒体、饱和计数、请求包装和特殊轮次边界；真实 183 项历史的逐项、总量和 usage 增量也一致。Pi 的无 type 简写消息保留实际包装计数，完整 tools/system HTTP 包装与 Codex 的 canonical history 另行区分，不宣称未公开的服务端 tokenization 已被本地精确复现。
