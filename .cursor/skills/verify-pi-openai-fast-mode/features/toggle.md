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

## Driving it with Pi PTY

Preconditions:

- 已完成 [Launch 与 Doctor](../SKILL.md)，没有其他运行占用验证锁。
- fast footer 只表示请求 priority，不证明服务端使用了 priority 或响应更快。

1. 运行 `pnpm exec node .cursor/skills/verify-pi-openai-fast-mode/scripts/verify.mjs full`。操作顺序、隔离种子和断言见 [request journey](../scripts/README.md)。保存输出的 evidence 目录。
2. 在 journey 的 root、root-restarted、root-restarted-off、novel-combination 和 project-scope 中逐项核对下表；summary 必须通过且清理完成。
3. 需要快速定位四种命令时，另运行共享 `run fast`。其结果仅补充命令和配置证据。以下定向测试用于定位边界。

| IDs | Required observation |
| --- | --- |
| fast-bare / fast-toggle | bare 从 false 到 true，toggle 从 true 到 false，读回配置并发送后续匹配请求 |
| fast-on / fast-off | 两种命令落盘 true/false，后续请求与状态一致 |
| fast-flag | 空配置 `--fast` 落盘 true，首个请求带 priority |
| fast-persist | 同一 agent 目录先 true 再 false，各冷启动新进程并发送请求 |
| fast-scope | 显式仓库扩展写 user 路径；生产 dist 复制到项目 `.pi` 后写 project 路径；user 配置字节不变 |

```bash
pnpm test extensions/openai-fast-mode/__tests__/commands.test.ts extensions/openai-fast-mode/__tests__/config.test.ts extensions/openai-fast-mode/__tests__/host-compatibility.test.ts
```

证据必须同时写明本次运行实际覆盖哪些 ID，以及剩余 ID 的状态。

## Gotchas

项目分支验证资源位置决定配置路径，不扩张为 registry 安装流程。画面与配置之外，逐项检查 request builder 的字段；footer 不能证明服务质量。

验收依据为 [commands.test.ts](../../../../extensions/openai-fast-mode/__tests__/commands.test.ts)、[config.test.ts](../../../../extensions/openai-fast-mode/__tests__/config.test.ts)、[host-compatibility.test.ts](../../../../extensions/openai-fast-mode/__tests__/host-compatibility.test.ts) 和 [仓库说明](../../../../README.md)。失败后先检查 summary 的清理结果，再启动下一次；证据不随 scratch 删除。
