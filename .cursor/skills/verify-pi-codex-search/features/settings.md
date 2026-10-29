# Search configuration and enabled tools

## Sub-features

| ID | 可观察结果 |
| --- | --- |
| `search-settings` | 原生菜单切换 model、freshness、context，落盘值与选择一致；选择默认值删除显式字段。 |
| `search-status` | status 同时显示生效值与 home/project/env 来源。 |
| `search-reset` | home、project 的取消保留原字节，确认删除目标；删除 project 保留 home。 |
| `search-scope` | `--no-approve` 忽略 project，菜单只编辑 home；`--approve` 启用 project。 |
| `search-env` | `PI_CODEX_WEB_SEARCH_FRESHNESS=indexed` 覆盖 project/home 的 cached。 |
| `search-enabled` | standalone 单独关闭、开启和总开关关闭、恢复后，宿主 active tools 与配置一致。 |

## Drive

完成 [Launch 与 Doctor](../SKILL.md) 后运行：

```bash
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run search-settings
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run search-production
```

`search-settings` 在真实 CLI 菜单依次操作 freshness → standalone off → context low → standalone on → enabled off/on，核对重新开启 standalone 时 context 恢复 medium。随后分别操作 home/project reset 的取消与确认，再用可信项目和 env 覆盖检查来源。模型列表来自随机 loopback 服务，不依赖真实账号。`search-production` 通过 Model 子菜单选择 auto，再选 `audit-model`，核对删除和写入 model 字段。

检查 `journey.json` 的 actions、screens、checks、processStopped 与 portClosed。删除前配置另存为 `home-before-reset.json`、`project-before-reset.json`；最终配置保存在 `home/.pi/pi-codex-search.json` 和 `workspace/.pi/`。`events.jsonl` 保存宿主 active tools，不能仅凭菜单文本判断注册结果。

排查配置解析边界时运行 `pnpm test extensions/codex-search/__tests__/config.test.ts`。该测试补充配置规则，不替代菜单与文件证据。人工查看菜单可使用共享 `tui codex-search`，其中通用 faux provider 不支持生产搜索动作。
