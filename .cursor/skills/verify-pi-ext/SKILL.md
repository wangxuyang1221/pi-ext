---
name: verify-pi-ext
description: "Verify all pi-ext extensions through the real Pi CLI, PTY and local protocol fixtures. Use for cross-extension changes or to select an extension-specific verification journey."
---

# Verify Pi extensions

先读取 [共享运行说明](README.md)，再选择对应行为索引。覆盖五个发布扩展、源码形式的 codex-search，以及独立的文本区域宿主补丁验证。

## Launch

已有匹配依赖和 dist 时从 doctor 开始。禁止安装或构建的任务，先在共享说明中选择 prebuilt 入口；下面两条准备命令仅在需要准备环境时运行。

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run metadata
```

每次 drive 独立启动并退出，没有需要常驻的服务。

## Doctor

`pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor` 检查安装版本、构建入口、Python 与验证锁。

## Drive

- [verify-pi-codex-compact](../verify-pi-codex-compact/SKILL.md)：4 组核心行为。
- [verify-pi-openai-fast-mode](../verify-pi-openai-fast-mode/SKILL.md)：2 组核心行为。
- [verify-pi-mcp](../verify-pi-mcp/SKILL.md)：5 组核心行为。
- [verify-pi-codex-ui](../verify-pi-codex-ui/SKILL.md)：5 组核心行为。
- [verify-pi-skill-mentions](../verify-pi-skill-mentions/SKILL.md)：5 组核心行为。
- [verify-pi-codex-search](../verify-pi-codex-search/SKILL.md)：4 组本地行为及独立联网验收。
- [verify-pi-text-regions](../verify-pi-text-regions/SKILL.md)：原版/补丁版安装、区域交互、Working、性能及物理终端边界；使用该 skill 自己的 Launch/Doctor。

六个扩展的覆盖清单见 [机器可读索引](features.json)，文本区域补丁见其独立 feature map。`references` 表示复用已有 ID 的验收分支，不重复定义行为。每条子行为分别记录状态；一次 smoke 仅证明该旅程。

## Evidence

每次结果写入 `.tmp/test-results/verify-<case>-<id>/`，至少保留 command、版本、退出码、清理结果和日志。详细标准见共享说明。

生成时的实际运行范围和限制见 [实跑记录](PROOF.md)。

## Cleanup

helper 自动清理；交互时先 `/quit`。确认 `summary.json` 中 `cleanup: removed` 且证据仍在。

## Helpers

入口为 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs`，支持 `doctor`、`run <case>`、`tui <extension>`。全部可用 case 与调用方式见 [共享说明](README.md)。后续用 `/maintain-verification-skill` 维护索引。
