# Text region example

用户通过正式示例观察两个独立动态文本区。`Region demo` 位于输入附近，footer 显示受控速率；原版保留相同显示，只缺 CPU 优化。

## Sub-features

- `region-independent`：动画、footer 单独与同帧更新。
- `region-edit`：更新时保留中文草稿、插入位置和历史。
- `region-lifecycle`：高度、主题、renderer、移除/替换、new/reload/quit 后没有旧显示复活。
- `region-original`：缺少 API 时正常显示及交互。

## How to get to it (user POV)

在独立 Pi 中加载 `examples/text-region.ts`，普通和全屏均可。输入 `/region-demo pause` 暂停自动推进，然后用 `/region-demo animation`、`footer`、`both` 控制两区。`start` 恢复自动动画，`height` 切换行数，`stop` 移除。输入 prompt 生成历史，`/settings` 的 `TUI mode` 切换 renderer，`/new` 新会话，`/fixture-reload` 在验证夹具中调用实际 reload，`/quit` 退出。示例不是生产 Working 入口。

## Driving it with local-refresh-pty

Preconditions:

- [Launch/Doctor](../SKILL.md) 通过；RUN 为本次目录。CLI 默认仓库 bin，安装入口按 [installation](installation.md) 替换。

- **Start both modes.** 顺序执行 `conda run -n codex-py312 python scripts/local-refresh-pty.py "$RUN/regions-regular" --cli "$PWD/node_modules/.bin/pi"` 和 `conda run -n codex-py312 python scripts/local-refresh-pty.py "$RUN/regions-fullscreen" --cli "$PWD/node_modules/.bin/pi" --mode fullscreen`。ready 同时出现 `Region demo`、`Controlled example` 和 `region API`，80ms 动画与 footer 前进。
- **Drive independent updates.** 驱动发送 pause→animation→footer→both。核对 `actions.json` 的顺序与 `summary.checks` 的 independent/same-frame 断言；动画只加一、footer 只加一、both 同时加一。
- **Edit and grow history.** 输入 `draft-中文-abc`、左移两格、插入 `X`。公开 editor 事件应为 `draft-中文-aXbc`。随后真实提交七次 prompt，`Response 0` 到 `Response 6` 形成超过视口的历史，screens 保留草稿/光标/历史结果。
- **Change and dispose.** 同一旅程执行 height、resize、theme、`/settings` 双向切换、stop/start、`/new`、reload 和 `/quit`。核对设置副本 `tuiMode`、start/shutdown 事件、移除后无旧行、重新挂载继续推进；CLI 退出码 0 且进程组空。
- **Prove fallback.** 按 installation 获得新原版 CLI，上述两命令换成 `--cli "$ORIGINAL_CLI" --original` 并使用新的目录。挂载处显示 `normal fallback`；保留相同动作结果，不能推断原版也有局部优化。
- **Supplement mechanism contracts.** `pnpm_config_verify_deps_before_run=false pnpm test test-support/__tests__/local-refresh.test.ts` 核对正常请求优先、同帧合并、失效句柄、异常帧和真实布局输出/光标等价；这些内部契约是用户旅程补证。

## Gotchas

示例速率是受控整数，不是生产采样。首次 trust 提示须先处理；半个 synchronized frame 不能用作终态。全屏与普通的主/备用屏由现有 DualScreen 模拟。命令参数只传最后一个词，如 `/region-demo height`，不要重复启动带原型 F 键的本地实验。失败按主 skill 清理，不删失败证据。
