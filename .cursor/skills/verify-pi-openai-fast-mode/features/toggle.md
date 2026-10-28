# Root Fast Mode controls

验证 openai-fast-mode 的此组用户行为，以下每个 ID 都是独立验收项。

## Sub-features

- `fast-bare`：无参数切换开关。
- `fast-on`：显式启用。
- `fast-off`：显式关闭。
- `fast-toggle`：toggle 切换。
- `fast-flag`：启动 --fast 启用并保存。
- `fast-persist`：重开读取持久开关。
- `fast-scope`：全局和项目安装分别定位配置。

## How to get to it (user POV)

/fast；/fast on；/fast off；/fast toggle；启动 --fast。

## Driving it with Pi PTY and host fixtures

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- fast footer 只表示请求 priority，不证明服务端使用了 priority 或响应更快。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs run fast`。保存返回的 evidence 路径并核对退出码。
2. 需要交互补充时，在工具 PTY 中运行 `pnpm exec node .cursor/skills/verify-pi-ext/scripts/verify.mjs tui openai-fast-mode`，按上面的真实入口输入命令或按键。该会话使用离线 faux provider；仅支持配置和明示的 WRITE_PROOF 工具场景。需要特定模型响应、历史或网络的步骤按下方 Gotchas 报告前置条件，不把 faux 回复当该功能成功。
3. 依次切换四种命令，每次从 agent/extensions/pi-openai-fast-mode/config.json 读回 enabled；重开隔离会话检查保存值。启动 --fast 后检查落盘开关，项目安装情形检查 .pi/pi-openai-fast-mode/config.json。
4. 对照以下已有定向测试定位边界。它们是补充证据，不替代步骤 3 的动作、画面和副作用。

```bash
pnpm test extensions/openai-fast-mode/__tests__/commands.test.ts extensions/openai-fast-mode/__tests__/config.test.ts extensions/openai-fast-mode/__tests__/host-compatibility.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

自动脚本覆盖四种命令和落盘。启动 flag、重启及项目安装分支需补跑。faux 模型不显示 fast，不以 footer 作为开关的唯一证据。

验收依据为 [commands.test.ts](../../../../extensions/openai-fast-mode/__tests__/commands.test.ts)、[config.test.ts](../../../../extensions/openai-fast-mode/__tests__/config.test.ts)、[host-compatibility.test.ts](../../../../extensions/openai-fast-mode/__tests__/host-compatibility.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
