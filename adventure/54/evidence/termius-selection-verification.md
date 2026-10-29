# Termius selection verification

## Result

本轮独立 gpt-6.1-sol / high 验证基准为 `ad39016c9c5cfed27ae485d3b24614b6825546c3`，没有委派。累计仍为 **54 passed、0 failed、4 unverified**，新增完整通过 ID 和新增实机通过分支均为 0，整体 `unverified`。

本次 harness 未提供 native app CUA 工具。两次查询完整工具目录均无匹配接口，检查 `tools.mcp__cua_repl__js` 得到 `undefined`。现有 `node_repl` 没有提供文档化的 native app 控制接口。本轮因此未操作 Termius、创建本地标签、启动 Pi 或 tmux，也未读写系统剪贴板。这是当前验证环境缺少工具，不是 Termius 输入故障或产品失败。没有以浏览器、AppleScript、shell UI 自动化或 PTY 字节替代物理操作。

[机器索引](termius-selection-verification.json)列出全部58个ID的累计状态、逐项继承来源及本轮增量，包含37份来源和19份本轮artifact哈希。原始根为 `.tmp/termius-selection-verification-66-20261029-r1`。实机目标尚未完成，交主代理恢复 CUA 能力后继续。

## Scope and preparation

工作区始终为 `/Users/wangxuyang/Code/t3code/pi-ext/.scratch/worktrees/pi-animation`，分支 `adventure/pi-animation`，开始时工作树干净。全部 shell 调用显式指定 workdir。完整读取本 worktree 的 AGENTS、语言政策、提交政策、testing、两个指定验证 skill 及全部指定引用、progress 和两组修复报告及 JSON。读取并应用 unslop、ub-mode 和 write-todo-list；执行计划只写 #66 Execution。

没有修改产品、宿主补丁、共享驱动、断言、CPU预算或Acceptance。按当前任务边界复用已有 build/check/CPU/Working 结果，本轮没有重跑这些矩阵，也没有安装、升级或修改全局配置。

## Independent checks

两个项目 skill 本轮实际调用的只读入口如下。

```bash
node .cursor/skills/verify-pi-text-regions/scripts/doctor.mjs
node .cursor/skills/verify-pi-text-regions/scripts/doctor.mjs --project <CzIw6h-patched> --extension <installed-index.js>
node .cursor/skills/verify-pi-text-regions/scripts/doctor.mjs --project <CzIw6h-original> --extension <installed-index.js> --original
node .cursor/skills/verify-pi-ext/scripts/verify.mjs doctor
```

四个命令均退出0。实际 Node v22.22.2、pnpm 11.9.0、Pi 1.4.0、Python 3.12.13。补丁 regular/fullscreen API 为 true/true，原版为 false/false；旧 skill doctor 的 independentCheckout=true、sharedDependencies=false、lockPresent=false。旧 doctor 的 subagent socket 长度提示针对未运行的 subagent case，不是本轮 tmux 物理路径的探测结果。

消费入口从 `.tmp/local-refresh-install-CzIw6h/installation.json` 读取，未重新安装或打包。两个消费者各32个codex-ui JS与当前dist逐字节相同，64项全部匹配。tarball SHA-256为 `03058ebfa8f11a6f2f554cf93c61919eb40bcc6544382cd8b70305daefdedd0d`；全局Pi入口仍为 `f04afd35fb16a3647b49ebb4bb67cbccba10a64fc6b5d1d5dfdd320e4f4ef331`。既有独立索引31份来源全部匹配，接收器及其测试也与主代理审阅版本一致。

## Receiver verification

先完整审阅 `adventure/54/experiments/selection-copy/receiver.py` 和 `test_receiver.py`，再将两个文件原样复制到本轮 `receiver/`，在该目录执行：

```bash
conda run -n codex-py312 python test_receiver.py
conda run -n codex-py312 python -m coverage combine
conda run -n codex-py312 python -m coverage report -m
conda run -n codex-py312 python -m coverage json -o coverage.json
```

6项PTY自测通过，覆盖Unicode/空格/LF原字节、非样本不回显不保存、前缀拒绝、额外后缀拒绝、重定向stdout时READY可见及取消。接收器输入存储有长度上限，未知输入不输出内容或哈希，只有完全匹配样本时独占创建actual；finally清空输入并恢复termios。没有改动两份源码。

`receiver.py` 源码行覆盖为38/38，两个函数均100%。coverage同时列入未由coverage执行的 `test_receiver.py`，目录总计37%，不能称整个目录100%。本轮未重跑已通过的CRAP、dryer或变异测试，没有新的共享代码需要质量门禁。

这些自测使用合成PTY输入，没有访问系统剪贴板，不能证明真实复制。自测stdout由已完成的工具结果转录到 `receiver/selftest.json`，不是原始重定向日志。测试父子PID没有分别持久化；成功返回包含测试finally中的wait，最终定向进程扫描为空，保留这一证据限制。

## Physical coverage

| Branch | This run | Remaining evidence |
| --- | --- | --- |
| Fullscreen dynamic selection | unverified，未启动 | 隔离copy-on-select、暂停后单次更新、稳定最新帧、真实Copied、receiver实际粘贴 |
| Regular terminal selection | unverified，未启动 | 真实终端选择及复制，与宿主全屏选择分别留证 |
| Physical 32/40 columns | unverified | 只读确认tmux 3.6b；仍需可见左右pane、pane_width、Pi stty和截图 |
| Search alternative key | unverified，未配置 | 隔离公开绑定、物理打开/匹配/关闭；默认Ctrl+Shift+F限制保留 |
| Other regions entrances | unverified，未启动 | patched regular、original regular/fullscreen剩余物理旅程 |
| Composer combinations | unverified | 窄列、全部宽度/主题/会话/拖选组合与实际选区内容 |
| Image pixels | unverified | 实际终端图片能力及像素；既有patched fullscreen文本降级结果保留 |

没有本轮截图、实际Copied反馈、expected/actual粘贴文件、tmux pane或Pi stty证据。未沿用旧PID或截图冒充新证据，也未读取或恢复前轮已删除的非样本内容。用户已有的剪贴板样本写入及粘贴授权持续有效，缺口是CUA工具，不是授权。

四个累计未验证ID仍为 `interaction-physical`、`ui-composer`、`interaction-network` 和 `ui-interrupted`。远程provider未指定模型、凭据和费用范围，未读用户auth或发付费请求；Write/Edit精确filesystem await没有可观察可控制阶段，未采用抢时序或Bash取消豁免。没有verified-unreachable或自行接受缺口。

## Cleanup and continuation

记录的核对wrapper和四个doctor PID为71478、71508、71555、71601、71648，结束后ps均不存在，lsof均退出1且无监听；本轮路径的定向进程扫描为空，receiver临时目录均已回收，验证锁不存在。未创建实机runtime、tmux server/socket、终端标签或常驻服务。消费安装、旧证据及用户原型保留。

下一步在提供native CUA的上下文恢复本任务，优先执行全屏copy-on-select加受限receiver，再做独立tmux可见窄列及剩余物理入口。必须使用新实例/PID/截图，receiver仅在真实Copied后由ASCII键入命令启动，看到CAPTURE READY再实际super+v和Ctrl+D；REJECTED后停止该分支。此处仅提供续验条件，没有将这些步骤记作已执行。

只提交本报告及JSON索引，不push、不创建PR、不修改Map/Spec/Acceptance或关闭Issue。#66 Execution、Delivery和Verification记录本轮结果，最终验收留主代理。
