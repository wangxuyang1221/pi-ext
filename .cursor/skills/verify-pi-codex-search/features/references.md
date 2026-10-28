# Follow-up actions and reference limits

验证 codex-search 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `search-open`：打开一个明确 URL。
- `search-click`：按页面 link id 点击。
- `search-find`：在已打开页面内查找。
- `search-reference`：同 URL 复用已保存引用。
- `search-screenshot`：截图指定页面。
- `search-lookups`：金融天气体育时区查询。
- `search-single-action`：每调用一个动作且禁止 low。

## How to get to it (user POV)

codex_standalone_web 的 urls/find/click/screenshot/finance/weather/sports/time。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- codex-search 不在 package.json 的 pi.extensions 中。使用 -e extensions/codex-search/src/index.ts；不得把八扩展发布包检查当作搜索已打包。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run search`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui codex-search`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 先启用 standalone。对 codex_standalone_web 依次提交 {"urls":["https://example.com/docs"]}、{"find":[{"url":"https://example.com/docs","pattern":"API"}]}，click/screenshot 也用同一 URL。检查引用存储与每次一个 action；再分别提交 finance/weather/sports/time，核对 codex.test.ts 中请求格式。low 或多个 action 必须拒绝。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/codex-search/__tests__/codex.test.ts extensions/codex-search/__tests__/session-scope.test.ts extensions/codex-search/__tests__/ref-store.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

search smoke 的展示不能证明后续真实网页 action。没有 fixture 支持的 action 需在授权服务实跑，不能直接调用 ref-store setter 伪造证明。

会话引用回归可运行共享 helper 的 `search-references`。它从生产注册工具发起真实本地 HTTP 请求，验证 A open 后 B 的 find/click/screenshot 在本地拒绝、B 独立 open、A 冷读取及异步切换；会话身份由夹具提供，不等于真实 /fork 或 /clone 旅程。旧无归属文件保留但忽略，直接 refId 输入兼容性保留。远程服务是否接受引用仍未由本地响应证明。

验收依据为 [codex.test.ts](../../../../extensions/codex-search/__tests__/codex.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
