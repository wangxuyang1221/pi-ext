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
- provider request 自主压缩时在编辑器上方显示动画 widget；overflow recovery 复用同一实例，session、分支或模型切换时清理。
- 在 Pi 提交 compaction entry 后验证 Codex Compact V2 来源；将结果通知延迟到原生 compaction 卡片重建后显示，并保持远程失败 fail closed。
- 非 Codex 模型遇到既有 V2 checkpoint 时回放原始分支，避免把 V2 marker 当作可用文本摘要。
- 连续压缩的 overflow recovery 保留已准备的 encrypted checkpoint；session 或模型切换会中止仍在进行的 Pi-triggered 远程请求。

同步上游时应以该 commit 为共同基线，只移植明确需要的后续改动，避免覆盖本仓库的 UI ownership、provenance、上下文完整性和 fail-closed 行为。
