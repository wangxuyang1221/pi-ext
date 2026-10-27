# Upstream provenance

## Source

- Repository: https://github.com/Leechael/pi-codex-search
- Commit: `976e8683cb5a342a4cf982c0a8a63e8f9b992d44`
- Package version: `0.1.6`
- License: MIT，原始版权声明见同目录 `LICENSE`。

## Local adaptations

运行时代码与单元测试在本仓库维护，使用根目录依赖和测试工具。上游根入口移至 `src/index.ts`，测试迁入 `__tests__/` 并使用 Vitest；未引入独立包的发布配置或在线端到端测试。

当前 renderer 使用两行搜索摘要、首条查询预览、来源计数和展开详情。状态颜色使用主题语义色：运行及部分失败为 warning，成功为 muted，失败为 error。保留真实结果结构、进度、取消和错误分类，避免原型专用的数据结构进入运行时代码。

`SearchAnimations` 为可见的执行中搜索维护最多一个 100ms 刷新计时器，结束、取消和退出时清理。历史工具定义在加载时同步注册，只用于显示；session 初始化再依据配置注册可执行工具，禁用搜索时仍可恢复历史。

## Validation

在仓库根目录执行：

```sh
pnpm test extensions/codex-search/__tests__
pnpm run web-search:check
pnpm run check
```

根 `check` 包含本目录的类型检查和单元测试。`web-search:check` 另外使用 `__tests__/fixtures/search-ui/` 中的生产 renderer 夹具验证普通及全屏 PTY、reload 和进程重启，再执行完整扩展的会话切换验收。夹具替代认证和 HTTP，不访问模型或搜索服务。

## Activation

本目录尚未加入根目录构建、发布和 Pi 扩展加载清单，不会替换已安装的 `npm:pi-codex-search`。测试通过不代表安装主 package 后自动启用搜索扩展。

单独启用本地源码前，应停用原插件，避免 `codex_search`、`codex_standalone_web` 和 `/codex-search-settings` 重名注册。
