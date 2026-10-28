# Search configuration and enabled tools

验证 codex-search 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `search-settings`：交互菜单修改配置。
- `search-status`：status 展示有效来源。
- `search-reset`：reset 确认与取消。
- `search-scope`：项目信任限制作用域。
- `search-env`：环境变量覆盖配置。
- `search-enabled`：按开关注册可执行工具。

## How to get to it (user POV)

/codex-search-settings；/codex-search-settings status；/codex-search-settings reset。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- codex-search 不在 package.json 的 pi.extensions 中。使用 -e extensions/codex-search/src/index.ts；不得把八扩展发布包检查当作搜索已打包。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run search`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-search`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 隔离 TUI 打开 settings，修改模型、默认项和作用域，status 核对来源；reset 分别取消与确认。检查主 responses 工具 codex_search 与可选 standalone codex_standalone_web 的注册，未知工具名/配置给出错误。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/codex-search/__tests__/config.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

search smoke 主要是结果显示，不覆盖设置菜单。settings 可能读取模型目录，缺少授权账号时仅核对本地配置分支并记录联网部分 blocked。

验收依据为 [config.test.ts](../../../../extensions/codex-search/__tests__/config.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
