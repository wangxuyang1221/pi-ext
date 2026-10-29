# Termius composer and copy repairs

## Scope and verdict

修复独立 [Termius 实机补验](termius-recovery-verification.md) 发现的两项失败。代码基准为 `e88fce5788b935bc2f9d7f5a65d30fd5061810c6`，主代理使用 gpt-6-astra/high 在本冒险 worktree 内完成修复。

修复的自动回归通过。物理像素、拖选及生产 `/copy` 的系统粘贴仍须由新的 gpt-6.1-sol/high 独立任务确认。本记录不将先前的两个 failed ID 改判为完整 passed，也不豁免尚未执行的物理、远程 provider 或 Write/Edit 精确 await 分支。

## Behavior

- CodexEditor 的普通与投影渲染使用当前主题的 `text` 前景色。提示符、菜单及光标周围的颜色重置后恢复默认文字色，同时保留嵌套颜色和行外默认样式。前景恢复复用为 `paintForeground`，工具 diff 使用同一规则。
- 在 CodexEditor 提交 `/copy`，从公开 session projection 读取当前分支最近已完成的 assistant 正文，各文本段按原序连接并保留首尾空白。思考和工具参数不进入复制文本，空白或没有正文的回复仍提示无可复制内容。剪贴板写入沿用公开 `copyToClipboard`。
- 编辑器保留原生输入、粘贴、补全、禁用提交和其他命令处理；在原生提交回调边界处理 `/copy`，随后恢复宿主回调。切换会话后，旧异步复制不向新会话显示成功或错误通知。键盘选区复制仍由宿主管理。
- 宿主补丁、版本、锁文件及全局 Pi 均未修改。这两项修复包含在 codex-ui 发布文件中，补丁宿主与原版宿主使用相同实现。

## Regression and quality

原始日志根为 `.tmp/termius-fixes-66`，[机器索引](termius-repairs.json) 保存来源与证据哈希。

- 行为红灯：新增草稿前景断言实际观察到 `default`；提交 `/copy` 的生产编辑器测试没有收到原文复制调用。分别保留 `composer-red.log` 和 `copy-red-behavior.log`。
- 回归覆盖提示符/颜色重置、当前主题变化、空内容与窄宽度、命令菜单、原文多段及 CRLF、分支/context edit、新会话、空 aborted、部分 aborted、无正文、复制错误与过期异步完成；原生 `/quit`、普通输入和提交关闭行为保留。
- `pnpm run check` 最终通过：205 个文件、2958 项测试，八个扩展的源码和 dist 加载均无错误。Python 驱动测试 11 项通过，包含真实 composer 断言的 pyte 单元格拒绝场景。
- 变异结果：复制逻辑 11/11、编辑器相关渲染及输入 19/19、CLI 新颜色断言 10/10 killed。首次投影测试有两个存活点，补齐空输入提示及首行提示符位置后全部检出；没有删除或放宽断言。
- 新增或实质修改的生产函数最高 CRAP 为 9，CLI composer 为 7；对应覆盖率均为 100%。未改逻辑的既有 `fitSegments` 为 12，不把它列为本轮达标函数。dryer 未发现相似度 ≥0.8 的重复候选。
- 真实 CLI 普通与全屏各 139 项断言通过，比先前旅程增加草稿前景检查。证据分别位于 `.tmp/test-results/codex-ui-cli-regular-1793260960719796000` 和 `.tmp/test-results/codex-ui-cli-fullscreen-1793261086664041000`。所有五个进程均有逐进程 doctor，分别正常退出、进程组停止及 scratch 删除。

## CPU evidence

新增编辑器颜色处理的普通渲染补测使用真实旧/新 CodexEditor、相同主题和双行草稿。40/120 列各三轮，每轮 7 个样本、每样本 2000 帧、交替先后，保留 user/system 原值。40 列每帧额外 CPU 中位数为 0.017–0.019 ms，120 列为 0.045–0.052 ms，六项均小于原正常路径 0.1 ms 容差。脚本和全部原始数据位于 `editor-cpu.mjs/json`，该结果不覆盖终端程序自身或远程模型开销。

已有 Working/footer CPU 矩阵的八份来源哈希与八份原始批次文件重新核对一致，未重新运行或改写历史数据。该测量使用简化编辑器，不能代替本次真实 CodexEditor 的补测。新增 `/copy` 只在用户提交命令时读取会话，不在动画帧内计算。

## Failures and corrections

- 初次复制测试引用的相对路径错误，修正后取得预期行为红灯；Pi 的 TypeScript lib 不包含 `findLast`，改用过滤后的数组反转查找。
- 菜单补充测试最初引用未导出的 `getEditorTheme`，随后对 40 列菜单标签作了错误假设。读取原生菜单输出后，使用公开 select-list theme，并准确断言 `copy`、`compact` 两个显示项。原失败日志保留。
- 第一次完整检查拒绝测试 Theme 的对象展开类型；改为在测试 Theme 实例设置方法。下一次完整检查发现 skill-mentions 的四处主题替身缺少公开 `getFgAnsi` 方法，补齐替身后，历史编辑和标签投影定向 17 项及最终全量检查均通过。没有给产品加入静默降级来掩盖不完整测试替身。

## Installation and cleanup

发布安装与最终清理信息见机器索引。本次 `local-refresh-install.mjs --pack` 创建 `.tmp/local-refresh-install-CzIw6h`，原版与补丁均冻结安装成功；两个消费者各 32 个 codex-ui JS 与当前 dist 逐字节一致，包括 `components.js`、`layout.js` 和 `reply-copy.js`。两个 doctor 通过，region API 分别不存在和存在。tarball SHA-256 为 `03058ebfa8f11a6f2f554cf93c61919eb40bcc6544382cd8b70305daefdedd0d`。新的独立任务须从该索引恢复实际入口，不能用旧消费目录证明本次修复。当前尚未对这两个新消费者执行产品旅程，此项交独立复验。

最终核对 20 个已记录测试/测量/安装/质量进程 PID 均已退出，监听查询为空。其中两个 CLI 旅程的 10 个进程组也已停止，运行目录已删除；mutation-workers 为空。保留全部失败日志、成功证据、质量报告、CPU 原始数据和消费安装。全局 Pi 入口哈希前后相同，用户原型及用户终端未改动；本轮主代理未控制 Termius 或读写系统剪贴板。

## Next verification

新独立任务完整读取两个验证 skill 及相关 feature，先核对本次消费发布字节与 doctor，再运行受影响的发布 Working 入口和 Termius 实机补验。系统剪贴板样本覆盖和粘贴授权仍有效。优先确认主题对比度与四种宿主/renderer 入口的精确 `/copy`，随后补剩余拖选、动态文本复制、窄窗口和图片能力；按实际证据逐项记录，失败交主代理修复。
