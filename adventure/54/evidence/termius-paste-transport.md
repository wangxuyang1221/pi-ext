# Termius paste transport diagnosis

## Result

Termius 9.41.1 的本次原生粘贴将受控剪贴板样本中的 LF 转为 CR。此前两次三行 composer 复制的 REJECTED 不能单独证明产品复制有错；当时 raw 接收器按 LF 匹配，而终端传来的多行字节可能为 CR。产品多行选择尚须独立重验，不能用本诊断替代。

用户另已确认联网验证目标为 Pi 的 `openai-codex/gpt-6-luna`、thinking `medium`，不设费用上限。当前 Pi 可用列表没有最初指定的 `gpt-6.1-luna`；改用 `gpt-6-luna` 是用户的明确选择。验证者仍为独立 `gpt-6.1-sol/high`。本轮没有发远程模型请求。

## Controlled experiment

原始根 `.tmp/termius-paste-diagnosis-66/`。预先创建两份24字节样本：`T66_PASTE_A\nT66_PASTE_B\n` 和对应 CR 版本，仅以 pbcopy 写入 LF 版本，不读取原剪贴板。

在自己的 Termius Local Terminal (1) 中，通过未修改的 `adventure/54/experiments/selection-copy/receiver.py` 接收实际 `super+v`、Ctrl+D：

- LF 预期：exit1、REJECTED，没有实际文件。
- CR 预期：exit0、MATCH，实际文件与预先定义的 CR 文件完全一致。
- 两次 termios 前后相同。没有调用产品复制、clipboard getter，或在两次粘贴之间用 app.paste 改写剪贴板；没有归一化实际接收数据。

这是一项粘贴通道对照，不是 Pi 复制验收。接收器维持严格相等且只保存已知样本的规则，无需改代码。验证说明新增校准步骤，源文本、传输预期及实际原始字节分别保留；不能据此宣称剪贴板原始 LF/CR 字节得到证明。旧 `/copy` 证据的完整性应结合其接收终端模式审查，不能因最终文本等于预期就推断通道没有转换。

## Control and cleanup

首次探针后，截图仍停在旧画面，但只读进程检查证明命令已进入自己的 shell 并启动接收器。主代理没有在画面不确定时粘贴，发 Ctrl+C 正常取消，exit2；原生 Window Zoom 后截图显示真实命令及取消结果。随后两次正式对照都有 READY 截图。首次取消的 exit 文件被同一 LF 启动脚本复用；取消事实保留于 CUA 工具记录和后续截图，没有将其算作正式对照。

自己的接收器、wrapper、shell 和 login 均已退出，无监听。Window Zoom 恢复原尺寸，自己的 Local Terminal (1) 已关闭，原标签保留。未操作远程标签、用户原型或全局 Pi。截图和只读 doctor 保留；实际匹配文件仅含预先指定样本。

## Independent evidence review

主代理重新核对 `e5ef3a8` 的49份来源、399份artifact哈希，以及四份实际匹配文件；共享启动修复的独立实机证据成立。58个记录PID重新检查已退出、无监听。完整索引与本次动作见 [JSON](termius-paste-transport.json)。

下一独立任务按更新后的校准说明重验完整三行选择，完成已授权联网旅程，并精确报告滚动、默认搜索键、图片能力及 Write/Edit await 边界。未取得新的独立结论前，不升级完整 feature ID，也不关闭 #66、Map、Spec。
