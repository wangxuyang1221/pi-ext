# Skill label product implementation

## Result

接手 `00264bf`，在 `adventure/skill-mentions` 实现 #15 的输入标签、成功快照正文、cube/command 偏好及两宿主适配。正式 skill-mentions 测试 **345/345**，连同 codex-ui **580/580**；离线真实 CLI 的 native/Codex × regular/fullscreen 四组均通过。全仓 check 仍因既有 MCP 缺文件失败，不称全仓通过。

本报告交协调者验收，不填写 #15 Acceptance、不关闭 Issue，不修改 Map、Spec、#12 或 progress。物理 IME、完整扩展组合及最终整体安装验收仍归 #16；本轮的隔离安装只用于验证 #15 真实入口。

## Implementation

- `extensions/skill-mentions/src/labels.ts`：严格复用 #14 `findReferences`，分离原文范围与按 grapheme 的显示布局。cube U+F01A7、command U+2318 均使用 RGB 141/249/253、正常字重；无新增背景或隐藏原文标记。
- `label-editor.ts`：组合原 editor 的公开接口，不替换已有实例方法或 prototype。底层始终是原生原文；原生 `getExpandedText` 是提交来源，没有 pending/native 双状态。整体删除按实际有效原生步骤计数；journal 按动作顺序/身份保存，不按相同文本查找。
- 原生内部步骤同步完成后才合并通知消费者，一次逻辑动作一次 onChange；通知前完成记账，允许同步重入。处理 word coalescing、无效移动、history、jump、原生补全、重叠键位优先级、backslash Enter 的两个快照及无文本变化的 skill 补全。后者并入前一原文动作，不出现只撤销视觉转换的步骤。
- `editor-surface.ts` 与 `extensions/codex-ui/src/components.ts`：独立投影坐标和宿主装饰。菜单高度通过已知未换行正文行数与公开 render 行数求得，不匹配边框字符串。Codex 原有背景、prompt、callbacks 和原生菜单继续工作；native 使用受保护的公开 subclass 渲染钩子保留工作状态边框。
- 超过一行的名称完整跨行；超过整个输入视口的单个标签可独立分页/滚轮查看中间行，源光标保持标签边界，普通编辑重新跟随光标。fullscreen 的普通 PageUp/PageDown 仍归宿主会话滚动，默认 Ctrl+PageUp/Ctrl+PageDown 才送到 editor。没有拦截并吞掉宿主滚动键。
- `draft-handoff.ts`：原生 paste ID 对应观测到的源内容。reload 以 TUI 对象身份一次性交接 source-only 数据，消费者读取后删除；不传递 editor、provider、回调或 undo journal。扩展移除时先通过公开 `setEditorText` 交出展开原文，避免宿主只复制 marker 字面量。这里不使用 setText 执行标签删除。
- `index.ts`：live Markdown transformer 由对应 user 组件捕获，绑定该请求成功快照；恢复时解码该消息自己的版本化封装。不是按相同任务文本关联。普通 slash、卡片与图片协议未改。
- `label-preference.ts`：`/skill-label-icon cube|command`，原子临时文件加 rename 持久化到 agent 目录的 `skill-mentions.json`。保存失败保留当前模式；参数、读取、写入故障英文提示，不假装保存成功。没有写入本机日常 Pi 配置或安装字体。

## Source basis

依赖固定 Pi **0.86.0**，Node **22.22.2**、pnpm **11.9.0**。本轮未暴露 Context7 工具，不把此前 Context7 main 文档冒充版本依据。已完整读取相关本机 Pi 文档与引用，实际语义核对安装源码/声明；版本来源沿用[固定 commit 散列核验](skill-label-native-undo-source.json)。

关键官方源码：[Editor](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/tui/src/components/editor.ts)、[UndoStack](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/tui/src/undo-stack.ts)、[fullscreen dispatch](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/tui/src/tui-alt-screen.ts)。产品没有读取 private undo/layout 字段，源码审查不等于产品访问私有状态。

## Spec matrix

| Contract | Evidence | Result / boundary |
| --- | --- | --- |
| 菜单、手写分隔、完整粘贴、历史末尾成标 | `label-editor.test.ts`、`label-surface.test.ts`、既有 input/history 测试；四组 CLI 的手写/paste/Tab/Enter | 通过；手写完整名称途中不锁定，确认同文补全没有独立视觉 undo |
| 代码、转义、未知、右侧标点与句点例外 | `labels.test.ts` 复用正式 parser，原 references/flow 回归；CLI 全标点及 Unicode 矩阵 | 通过；不复制探针语法 |
| 两宿主、两图标、RGB/正常字重/无新背景 | surface 四组合；CLI 对 input 和发送后 body 每个图标/名称单元核验 `fg=8df9fd`、非 bold、背景等于邻接宿主单元 | 通过；没有字体自动检测，物理字形/IME 最终人工验收归 #16 |
| 整体左右、Backspace/Delete、undo/连续 undo | editor/surface；CLI 双方向删除、F8 自定义 undo | 通过；重复相同文本按动作身份，不按文本找记录 |
| grapheme、无效动作、原生 coalescing | `$𠮷`、no-op arrow、失败 jump、history、backslash Enter；64/256/1024 名称 | 通过；不按 UTF-16 长度计步 |
| 自定义键位、宿主拦截、按词删除和 kill ring | Ctrl+X/Ctrl+Z 单元键位、F1/F2 鼠标定位、重叠 Ctrl+W 优先级、shortcut 重入；CLI F8/F4/F3 | 通过已列键位；不篡改全局键位，不把按词删除冒充 Backspace |
| 同步 getter、onChange/onSubmit、重入、外部编辑器 | editor 回调序列与同栈 Delete→Enter；CLI 同次 PTY write 的 Delete+Enter、真实 Ctrl+G 外部 Node 编辑进程 | 通过；外部编辑器收到 `$` 原文，无 ANSI/图标 |
| 完整跨行、宽窄、真正 resize、上下与视口 | surface 8/16/80/120 列、1024 字符逐行覆盖、精确上下游标；CLI ioctl/SIGWINCH 120→16→120、245 字符标签分页 | 通过；不是把 SDK render(width) 称作真实 resize |
| 鼠标吸附、滚轮、菜单定位/取消/旧回调 | surface 点击和 wheel；原生 provider 取消/释放后迟到 Promise；fullscreen 两宿主真实 SGR 点击；CLI multiline 菜单 | 通过；regular 本来使用终端选区、不分发应用鼠标定位 |
| 大粘贴混排、删除/undo/展开提交 | 多 paste ID 删除/重编号/undo、reload/remove/re-enable；CLI folded paste + 可见标签与内部引用激活 | 通过；块内不单独绘制标签；canonical getter 仍来自 native |
| 原文出口：模型/队列/历史/JSONL/图片 | flow、lifecycle、history；CLI provider users 与 JSONL 相等，逐 user 检查无图标/ANSI，follow-up 队列原文 | 通过；屏幕选区复制仍是显示字形，不新增原文复制能力 |
| 正文仅成功快照、同文不同成功集 | label-body 两次同文删除 alpha 文件；live/rebuild/静默失败；CLI 不可读 beta | 通过；未读成功项仍 `$`，无读取错误提示 |
| steer/followUp、同文/图片与消费时版本 | lifecycle 四种队列用例新增标签数量断言；CLI 延迟消费时修改 skill 文件 | 通过；不在入队时读取或固定快照 |
| reload/resume/tree/fork/压缩/孤立卡片 | lifecycle 新增 label 断言并保留读取 spy、分支、孤立、缺卡、图片和压缩测试；CLI 真正退出/重启恢复 | 通过；user 被压缩替代后不重新注入旧快照 |
| cube/command 持久化及失败 | preference/body 测试；CLI 切换、四次 reload、进程重启后仍为 command | 通过；损坏 JSON/非法值/目录读写错误/参数错误不虚报成功 |
| 资源更新、安装顺序、重复 reload、卸载 | names 变更先于下一 input 生效；SDK native/Codex before/after、三次 reload；真实禁用/恢复 factory | 通过；不多重包裹，不承诺任意第三方覆盖 factory |
| 原生 slash、卡片、公开 callbacks | 既有 flow/history/visibility/codex-ui；四组 CLI slash 调用、F3 展开原生卡片 | 通过；卡片不美化，原协议不变 |
| 性能、记录生命周期、极端资源边界 | 下文性能、真实 SDK reload WeakRef 与既有 650 MiB 证据 | 测量规模通过正确性断言；资源取舍已接受，OOM 未验证 |
| 物理 IME、完整当前扩展组合 | 未执行本关最终整体验收 | 明确归 #16，不冒称通过 |

## Red and green

本轮失败记录没有删除，历史 128 MiB 失败与异步候选也保留。以下是正式实现过程中修复的反例，不是重开已接受的成本问题：

| Failure | Fix / passing evidence |
| --- | --- |
| [range/history 初始失败](skill-label-product-editor-history-group-red.log) | 区分首次 history push 与后续浏览，no-op 移动仍打断 word coalescing；正式 345 项通过 |
| [backslash Enter](skill-label-product-native-red.log) | 两个原生 snapshot 合为一个逻辑动作，不消耗较早标签 undo |
| [重叠自定义删除键](skill-label-product-key-priority-red.log) | 遵守 kill/char action 的原生优先级；组内复用实际有效输入键，不盲用配置列表首项 |
| [真实 CLI 删除→绘制→undo 崩溃](skill-label-product-pty-native-cache-red.json) 与[正式复现](skill-label-product-cache-red.log) | 没有标签时清投影 cache key；undo 重建布局，不对空 visual 求游标 |
| [failed jump](skill-label-product-jump-red.log) | 即使找不到字符，原生 jump 仍打断输入合并；旁路状态同步跟踪 |
| [资源更新](skill-label-product-resources-red.log) | 下一 input 前刷新已发现名称，undo 不复活已移除标签 |
| [F1/F2](skill-label-product-function-keys-red.log) | 公开配置键序列编码支持功能键，不吞鼠标定位 |
| [无文本变化补全](skill-label-product-visual-undo-red.log) | native no-op completion snapshot 合入此前原文动作；单次 undo 撤掉手写输入 |
| [高于视口的名称](skill-label-product-viewport-red.log) | 独立分页/滚轮浏览，surface 四组合逐项覆盖全部 1024 字符行；真实 CLI 245 字符也通过 |
| [folded paste reload](skill-label-product-preference-reload-red.log) | 按 TUI 身份传递 source-only parts；真实 replace factory 后保留 folded/raw 两种正文 |

还保留测试入口错误：第一次 pnpm 命令多传 `--`；Ctrl+Z 在真实宿主优先触发 suspend，改用不冲突的 F8；fullscreen 普通 PageUp 被宿主 transcript 消费，最终使用其已有 Ctrl+PageUp editor 绑定。后两项没有通过覆盖宿主快捷键“修复”。初始化主题、Promise 尚未开始及 fixture 动态启停的测试设置错误没有冒充产品 Red。

## CLI and artifact evidence

最终命令：

```bash
TMPDIR="$PWD/.tmp/skill-label-product" pnpm run skill-mentions:acceptance \
  --evidence-prefix=skill-label-product-verified \
  native codex native-fullscreen codex-fullscreen
```

[实际运行日志](skill-label-product-cli-verified.log)、[产物清单/散列](skill-label-product-verified-artifact.json)。使用真实 prepack build、tarball、隔离 pnpm 安装、`pi install`、编译入口及 OS PTY；faux provider 完全离线，未调用真实 provider/MCP/子代理。

| Mode | Checks | Requests | Reaped CLI PIDs | Detail |
| --- | ---: | ---: | --- | --- |
| native regular | 23 | 30 | 77409、91514 | [JSON](skill-label-product-verified-pty-native.json) |
| Codex regular | 23 | 30 | 92383、7466 | [JSON](skill-label-product-verified-pty-codex.json) |
| native fullscreen | 24 | 30 | 7764、20975 | [JSON](skill-label-product-verified-pty-native-fullscreen.json) |
| Codex fullscreen | 24 | 30 | 22068、37036 | [JSON](skill-label-product-verified-pty-codex-fullscreen.json) |

每组含真正退出并启动第二个 CLI，删除源文件后恢复快照及历史。中文输入是 PTY UTF-8 字节注入，不是物理输入法组合态验收。

## Performance and lifetime

执行前 #15 Execution 已声明：5 次预热、20 次采样，100 KiB 常规草稿，64/256/1024 名称，10/100/1000 标签，8/16/80/120 列；小 paste 配超长名称，至多 1 MiB 配 64 名称，禁止破坏性 OOM。没有重新引入旧 128 MiB 阻塞门槛。

[最终测量](skill-label-product-performance-final.json)运行正式 dist，而不是探针。布局样本为约 100 KiB 原文、8 字符名称 × 10/100/1000，四种列宽。完整重新布局中位 **30.81–34.24 ms**，观测最大 **43.85 ms**；重复 render 仍调用宿主公开渲染，中位约 **23–24 ms**、最大 **32.78 ms**。没有每帧读取 skill 文件。[优化前记录](skill-label-product-performance-before.json)保留：每个 ASCII 单词创建 ICU iterator 导致约 124–133 ms 中位；加入 ASCII 单元快路径后降低，Unicode 仍按 grapheme 分段。

| Folded paste / name | Delete median / maximum | Observed extra heap | Correctness |
| --- | --- | --- | --- |
| 1 KiB / 64 | 1.53 / 1.68 ms | 约 0.91 MiB | 每轮一次 undo 完整恢复 |
| 1 KiB / 256 | 8.60 / 9.20 ms | 约 6.54 MiB | 同上 |
| 1 KiB / 1024 | 97.42 / 98.24 ms | 约 15.46 MiB | 同上，无栈容量截断 |
| 100 KiB / 64 | 1.65 / 1.94 ms | 约 8.22 MiB | 同上 |
| 1 MiB / 64 | 7.91 / 8.16 ms | 约 67.16 MiB | 同上 |

这些是操作边界采样，不是绝对分配峰值、所有负载的 SLA 或峰值内存上限。正常提交后的 GC heap 约 30–31 MiB；RSS 未同步返还，不能据此宣称资源恒定。

[真实 SDK reload 内存证据](skill-label-product-reload-memory-final.json)：native、Codex before、Codex after 各三次实际 runtime reload，32 KiB paste 与已删除标签；去掉测试 fixture 仅为清理而保留的旧 editor 引用后，九个退休 editor 的 WeakRef 全部为 undefined，同时新 editor 的展开原文和折叠 marker 均正确。不是仅对局部变量执行 `undefined` 的 inert editor 实验；也不是 PTY 内部强制 GC。

正常 submit 清 native undo；setText 不清栈；扩展释放自身引用不代表能强行回收其他插件持有的 editor。无消费者时暂存的 reload 数据只含源字符串、以 TUI 为 WeakMap key，每 TUI 至多一份；没有 editor/回调/journal。极端连续编辑、10 MiB × 1024 等组合、内存耗尽中途恢复仍未测试。复用[此前约 650 MiB 成本](skill-label-native-undo-closeout.md)，不宣称无限内存安全。

## Repository checks

| Check | Result |
| --- | --- |
| [skill-mentions 正式测试](skill-label-product-skill-tests-final.log) | 16 files、345 passed |
| [skill-mentions + codex-ui](skill-label-product-formal-final.log) | 44 files、580 passed；未新增 skip 或删除原有测试 |
| [typecheck](skill-label-product-typecheck-final.log) | 退出 0 |
| [pnpm run check](skill-label-product-check-final.log) | typecheck 通过；2298 passed / 5 skipped，1 个既有 MCP suite 失败 |
| [独立 build](skill-label-product-build.log) | 退出 0，dist 仅构建生成 |
| [全部八个构建入口 import](skill-label-product-built-entries.log) | 退出 0 |
| [package:check](skill-label-product-package-check.log) | 退出 1，既有 `docs/goal-descendant-acceptance.md` 缺失 |
| tarball / 隔离安装 / 四组真实 CLI | 最终通过，见上一节；不把它等同全仓 package:check 通过 |

MCP 仍缺 `prototypes/mcp-status-ui-prototype/src/codex-startup.js`。没有修复无关 18 个缺失文件、跳过测试或降低门槛。只有测试执行子进程清除四个 `PI_SUBAGENT*` 环境标记，没有修改全局环境。

## Cleanup and continuation

清理与进程核对见[记录](skill-label-product-cleanup.json)。测试的安装 HOME、agent、session、临时目录均在本 worktree 内；CLI、性能和 SDK 子进程已结束，没有本任务监听端口。只删除本轮 fixture/缓存及 quality 测试 stderr 临时文件，不删除 worktree。

旧 `.tmp/skill-ui-prototype-GG4yw8` 仍不存在；此前“不存在”的更正继续有效，本轮未重建空目录，也不声称已保留。没有修改全局 Pi、终端或字体。

提交推送后由协调者核对 #15 Delivery/Verification 与本矩阵并填写 Acceptance。worker 不自行推进 #16。
