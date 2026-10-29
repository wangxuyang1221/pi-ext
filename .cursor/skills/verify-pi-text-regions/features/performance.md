# Performance

用户在相同历史和界面内容下持续看到 Working 与速率，局部动态帧减少 Pi 进程 CPU；正常正文更新和未使用 API 的路径也要满足额外成本预算。

## Sub-features

- `cpu-dynamic`：200/1000 对历史动态帧，每帧 CPU 中位数至少下降 30%。
- `cpu-normal`：0/200/1000 对正常内容更新和未用 API，额外中位数 ≤ `max(基线10%, 0.1ms/帧)`。
- `cpu-native`：生产 32ms 原生调度独立补测，不能混入同步样本。
- `cpu-equivalence`：相同内容/帧数/主题/尺寸，原始 user/system、输出/光标/布局等价和来源哈希可复核。

## How to get to it (user POV)

先用 Working feature 证明提交 prompt 后的真实显示。CPU 入口随后以相同的生产 Working、CodexFooter、TokenRate、真实 AgentSession 上下文和 UserMessageComponent/AssistantMessageComponent 历史，比较原版普通刷新与补丁局部刷新。它是测量入口，不把内部请求方法冒充用户操作，也不替代 PTY。

## Driving it with local-refresh-cpu

Preconditions:

- 完成 Launch 和 [installation](installation.md)，本次 `INSTALL` 与 `BASELINE_TUI` 来自新安装 JSON。当前 checkout 与安装补丁哈希一致；CPU 候选从当前仓库 node_modules 加载，不是从 `PATCHED_CLI` 加载。
- doctor 当前仓库及原版均通过。无本任务并行构建/测试/CPU 负载。记录 Node、平台、CPU 型号、revision、dirty diff 和时间。

```bash
BASELINE_TUI="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).projects.original.tui)' "$RUN/installation.json")"
mkdir -p "$RUN/cpu"
for round in 1 2 3; do
  for mode in regular fullscreen; do
    if node --expose-gc scripts/local-refresh-cpu.mjs --baseline="$BASELINE_TUI" --mode="$mode" > "$RUN/cpu/$mode-$round.json" 2> "$RUN/cpu/$mode-$round.stderr"; then
      printf '0\n' > "$RUN/cpu/$mode-$round.exit"
    else
      printf '%s\n' "$?" > "$RUN/cpu/$mode-$round.exit"
    fi
  done
done
for mode in regular fullscreen; do
  if node --expose-gc scripts/local-refresh-cpu.mjs --baseline="$BASELINE_TUI" --mode="$mode" --interval=32 --pairs=200,1000 --workloads=animation-and-rate --frames=40 --samples=3 > "$RUN/cpu/$mode-native.json" 2> "$RUN/cpu/$mode-native.stderr"; then
    printf '0\n' > "$RUN/cpu/$mode-native.exit"
  else
    printf '%s\n' "$?" > "$RUN/cpu/$mode-native.exit"
  fi
done
```

- **Synchronous protocol.** 默认 120×40、codex-pi/truecolor、0/200/1000 对；每场景 50 帧预热及等价检查，每轮 7×320 帧、批次交替先后，三轮两模式共六份结果。每份九场景，三轮共 54 个预算判断；动态 0 对也按额外成本容差记录。每批两路径的 userMs、systemMs、cpuMsPerFrame、wallMsPerFrame、bytes 均保留。
- **Native protocol.** 两份补测各两场景，50 帧预热、每项 3×40，32ms 真正宿主 timer。四个动态预算判断，与同步绝对 CPU 分开报告。
- **Inspect every sample.** 核对八份文件和退出码，失败不可隐藏。重算 `(userMs+systemMs)/framesPerSample`，对七个样本取中位数，再逐场景算降幅/额外值；三轮每轮均满足原预算。原生用三个样本单独算。每批两路径 bytes 相等，脚本预热逐帧及每批末帧断言输出、光标一致，全屏额外核对 layout 节点、clip 和 scrollContentLines。不是对所有正式帧逐帧截图的证明。
- **Freeze identity.** 比较八份 `sources` 哈希及 doctor 的 patch/lock、实际 dist；保存运行命令、环境、失败样本和整个 JSON。源文件变化后旧轮次不能拼接成最终三轮。机制 #61/#62 的旧报告不含最终生产上下文/采样成本，不能代替本入口的新运行。
- **Cleanup.** CPU 释放 session、footer、handles、timer，exit 删除自己的 `.tmp/working-cpu-*`。从每份 JSON 的 pid 查进程/监听，保留 CPU JSON/stderr/exit；异常没有 JSON 时按启动命令记录的 PID 排查。预算失败保持失败，不调低帧率、少内容、删历史或挑最好一次。

## Gotchas

同步驱动执行真实 queued frame，以隔离 renderer CPU，不把 renderNow 当局部帧。CPU 不包含远程推理或终端程序自身。数据中的 32ms step 与实际 interval=0/32 是不同字段；不能因为同步测量更快宣称原生动画频率提高。三轮在不同负载下都超预算属于待修复，噪声解释必须伴随全部原始样本，不能改预算。缺 baseline、原版误带 patch 或 build 缺失时先 doctor。
