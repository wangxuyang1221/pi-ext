# Upstream provenance

本扩展基于 [`pi-openai-fast-mode`](https://github.com/johncmunson/pi-openai-fast-mode) 修改并整合到 `pi-ext`。

## Import baseline

- npm version: `0.3.0`
- upstream commit: `9b284561ae3e424aa5a070a6ff6da7167965a3bd`
- upstream license: MIT, Copyright (c) 2026 John Munson

## Local changes

- 将上游源码迁入 `extensions/openai-fast-mode/src/`，测试迁入 `extensions/openai-fast-mode/__tests__/`。
- 将内部相对导入调整为本仓库 NodeNext 构建使用的 `.js` 后缀。
- 使用 `setStatus("pi-openai-fast-mode", "fast")` 发布可组合的 footer 状态，不再创建独占的 below-editor widget。
- 每次更新状态时清理旧版 `pi-openai-fast-mode` widget，支持从 0.3.0 平滑迁移。
- 保留原有 `/fast`、`--fast`、payload 注入和配置路径，现有用户及项目配置无需迁移。

同步上游时应以该 commit 为共同基线，只移植明确需要的后续改动，避免覆盖本仓库的 footer 协作协议和配置兼容行为。
