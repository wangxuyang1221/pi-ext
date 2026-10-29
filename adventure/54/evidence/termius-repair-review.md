# Termius repair review

## Acceptance

主代理核对独立提交 `3aa51a5`，接受两个修复分支：四种宿主/模式的 composer 草稿可读；生产 `/copy` 的四份真实系统粘贴均与191字节原文一致，保留首尾空格及LF。原185字节失败样本也恢复逐字节一致。累计54 passed、0 failed、4 unverified，#66保持开放。

重新计算[独立索引](termius-repair-verification.json)的31份来源和396份artifact哈希，全部一致。来源中17项提供sha256和actualSha256，其余14项仅提供actualSha256，校验按实际字段读取。直接读取四个expected-multi.txt/actual-multi.txt并比较，均为191字节、SHA-256 `2ef7bf731ae44f83a08907826bd2cf5e432a9de44de10789a8676253bb2a75f3`。检查实机草稿截图，浅色字在深灰输入区可读；15个记录实机PID再次读回均不存在。没有重跑已通过的CPU和完整交互矩阵。

## Selection diagnosis

前轮选区复制没有取得有效结果，不能归为已定位产品故障。独立报告说明首次super+c只粘贴了哨兵，随后Ctrl+X没有明确成功反馈，Termius菜单复制后出现非样本内容，相关原始内容已删除，不再读取。

Pi 1.4.0源码核对结果：

- `tui-alt-screen.js` 的鼠标释放在 `copyOnSelect=true` 时调用 `copySelectionToClipboard()`；宿主 `tui-renderer.js` 注入真实 `copyToClipboard`，成功后显示 `Copied!`。
- `interactive-mode.js` 的 `app.message.copy` 使用Ctrl+X，只有当前全屏存在选区且copy-on-select关闭时复制选区。前轮隔离settings确实关闭了copy-on-select；没有成功反馈不足以证明选区复制已执行。
- 搜索默认绑定Ctrl+Shift+F。前轮退出Pi后的按键receiver未包括Pi协议协商，不能据此证明运行中快捷键根因。

可区分的下一步是在新的隔离agent配置启用copy-on-select，观察实际拖选和 `Copied!`，再用受限接收器比对样本。只改隔离配置，不修改宿主或Termius全局设置。搜索可另用隔离keybindings的公开配置测试可传达的替代键；替代键通过不等于默认键通过。真实窄列可尝试独立tmux服务和物理可见分栏，必须记录pane实际宽度并截图，不以单独stty cols伪造窗口变化。

## Sample receiver

[接收器](../experiments/selection-copy/receiver.py)只用于本轮已授权的样本复制验证。它在raw终端模式关闭回显，禁用接收端bracketed-paste包装，读取到Ctrl+D；Ctrl+C取消。输入仅在内存保留最多预期长度加一字节，不输出输入内容或其哈希。只有全部字节与预先准备的样本一致才以独占创建方式写文件，其他情况退出1且不保存内容，取消退出2。结束时清空尚未读取的输入并恢复termios。

```bash
conda run --no-capture-output -n codex-py312 python adventure/54/experiments/selection-copy/receiver.py "$RUN/expected.txt" "$RUN/actual.txt"
```

实际测试时先在自己的空闲本地终端启动receiver并看到 `CAPTURE READY`，再执行真实系统粘贴和Ctrl+D。不要把样本文件重定向到stdin冒充物理粘贴。预期文字必须由测试已知样本和实际选区确定，不能读剪贴板生成。必须先确认宿主 `Copied!`；其后输入命令使用不会覆盖剪贴板的键入方式，不能用app.paste输入启动命令。出现REJECTED只保留失败标记并停止该复制分支，不检查未知内容或重复菜单复制。

自测在 `.tmp/selection-copy-66/` 运行，不使用系统剪贴板。先写PTY测试，确认接收器缺失的红灯；实现后修正测试中与提示词重名的样本文字和macOS内核PENDIN位比较。后者仅忽略内核内部pending-input标记，ECHO/ICANON等用户终端标志仍完整核对。六项PTY检查涵盖Unicode/空格/LF逐字节保存、未知内容不回显不落盘、前缀和额外后缀拒绝、取消，以及重定向stdout时输入前可见READY。所有子进程由测试finally回收。

质量、全量检查及清理结果见[机器索引](termius-repair-review.json)。第一次crapper未找到根目录coverage报告，改为其支持的coverage/lcov.info后读取真实覆盖率；第一次mutator发现READY flush变异存活，补重定向stdout行为检查后重验。保留原始失败日志，不将工具未读到覆盖率解释为产品失败。

## Remaining boundaries

`ui-composer`与`interaction-physical`仍待剩余宽度、拖选实际内容、regions入口、搜索和图片像素。`interaction-network`仍无指定远程模型、凭据和请求费用范围；`ui-interrupted`仍缺Write/Edit真实await可控制的按键阶段。没有接受豁免，也不把本轮接收器自测算为物理复制通过。下一轮只补有新路径的实机分支，不重复已通过的Working、CPU和完整check矩阵。
