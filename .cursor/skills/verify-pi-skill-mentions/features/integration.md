# Editor combinations and package installation

验证 skill-mentions 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `skill-native`：原生编辑器路径。
- `skill-codex`：CodexEditor 路径。
- `skill-combined`：全包 MCP 组合。
- `skill-fullscreen`：fullscreen 路径。
- `skill-package`：真实 tarball 安装与 dist 比对。

## How to get to it (user POV)

原生/CodexEditor；全包 MCP 组合；普通/fullscreen；安装 tarball。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- skills helper 通过本地 pi install 加载当前 checkout 的 dist，不做 pnpm 发布包安装；发布 tarball 另跑 skill-mentions:acceptance。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run skills`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui skill-mentions`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 先跑当前 checkout native，再运行 pnpm run skill-mentions:acceptance，它实际 pack/install、比对所有 dist，并跑 native/native-fullscreen/codex/combined/combined-fullscreen。保留每个模式 selectedExtensions 和 CLI session 证据。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/skill-mentions/__tests__/package.test.ts extensions/skill-mentions/__tests__/registration.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

安装验收可能访问 registry，且会重新 build；与其他验证串行执行。native helper 不能替代 tarball 或组合模式验收。

验收依据为 [package.test.ts](../../../../extensions/skill-mentions/__tests__/package.test.ts)、[registration.test.ts](../../../../extensions/skill-mentions/__tests__/registration.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
