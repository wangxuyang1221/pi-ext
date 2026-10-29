# Follow-up actions and reference limits

## Sub-features

| ID | 可观察结果 |
| --- | --- |
| `search-open` | 明确 URL 进入 commands.open，并保存服务返回的引用。 |
| `search-click` | click id 与已保存 refId 一起进入请求。 |
| `search-find` | find pattern 与已保存 refId 一起进入请求。 |
| `search-reference` | A 中相同 URL 复用引用；真实 /new 后拒绝 A 的 URL，恢复 A 后引用可继续使用。 |
| `search-screenshot` | pageno=0 与已保存 refId 一起进入请求。 |
| `search-lookups` | finance/weather/sports/time 的参数逐项进入各自 commands。 |
| `search-single-action` | urls+find 组合和 low context 被拒绝，服务器请求数不增加。 |

## Drive

完成 [Launch 与 Doctor](../SKILL.md) 后运行：

```bash
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run search-production
pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run search-references
```

生产 TUI 旅程先 open `https://example.test/docs`，随后 find API、click id=7、screenshot pageno=0，断言全部复用 turn0view0。四类 lookup 各发送一次。非法组合与 low 调用必须 isError=true，且 requests.json 中没有对应 HTTP。服务只绑定 127.0.0.1 随机端口，fetch 拒绝其他 origin。

旅程接着 `/name Audit history A` → `/new` → find A URL 被拒绝且无 HTTP → `/resume` 搜索并选择 A → find 成功 → `/reload` → `/quit` → 新进程 `--session` → click id=8 成功。会话与引用文件保存在 evidence/sessions，模型实际收到的上下文保存在 events.jsonl，不调用 ref-store setter 制造结果。

`search-references` 补充覆盖 B 独立 open、异步会话切换时归属、冷加载、旧无归属文件忽略、损坏与原子保存。它使用夹具 session identity，不能当作原生 `/fork` 或 `/clone` 的验收；这些入口本次仍为 unverified。

## Remote boundary

`search-open`、`search-click`、`search-find`、`search-screenshot`、`search-lookups` 的远端接受引用与真实数据按 [Manual live acceptance](live.md) 独立执行。合成 HTTP 返回的截图文本不证明真实图像正确性。
