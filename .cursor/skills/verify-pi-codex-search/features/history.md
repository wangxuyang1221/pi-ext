# Search history across resume and reload

## Sub-features

| ID | 可观察结果 |
| --- | --- |
| `search-resume` | 原生 /resume 搜索并选择 A，历史卡片恢复，继续动作复用 A 引用；退出后新进程 --session 仍成立。 |
| `search-reload` | 生产调用形成的成功、错误、超时、取消和 standalone 卡片在 /reload 后保留，后续动作成功。 |
| `search-disabled-history` | 菜单关闭搜索后 active tools 排除两项工具，reload 和禁用状态冷启动仍展示旧卡片。 |
| `search-theme` | 原生 /settings 通过方向键选 light，settings.json 的 theme=light，历史诊断保留。 |
| `search-fullscreen` | fullscreen 中执行生产工具、原生恢复选择器和进程冷恢复。 |

## Drive

完成 [Launch 与 Doctor](../SKILL.md) 后运行：

```bash
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run search-history
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run search-production-fullscreen
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run search-resume
```

`search-history` 在正常 150×65 全屏终端先执行完整生产本地旅程，再冷恢复 A。它打开 `/settings`，输入 Theme 后 Enter，按 Down 直到画面选中行明确为 light，再 Enter、Esc；以 `settings-light.json` 核对保存值。旧卡片超出视口时发送真实 PageUp 查找 timeout/interrupted 卡片，逐页保存画面，再用 PageDown 返回最新消息。随后关闭搜索、确认宿主 active tools、reload 并再次冷启动，重复滚动核对历史。不能用主题菜单输入 light 后卡片还在，代替主题选择成功的断言。

`search-production-fullscreen` 执行同样的生产请求与原生恢复链。`search-resume` 是预置历史的 regular/fullscreen/disabled 补充检查，通过 `/fixture-resume` 调用 ctx.switchSession，不能单独证明原生选择器或本次发生过真实搜索。

检查 journey.json 的原生选择器、冷恢复、light 与禁用画面，以及 terminal-*.ansi、events.jsonl、sessions 和配置副本。`pnpm test extensions/codex-search/__tests__/history-renderers.test.ts` 补充历史 renderer 边界。
