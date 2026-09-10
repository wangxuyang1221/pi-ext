# Goal attachments and UI todo

## Understanding

实施 [#9](https://github.com/wangxuyang1221/adventure/issues/9)，遵守 [#3](https://github.com/wangxuyang1221/adventure/issues/3) 的入口、附件与持久化规则。基准为 `3972c9e1b6693021fd79d99a0acb19fb62f0260d` 加已验收 #4 至 #8 工作区。保留既有改动，不写 GitHub、不提交、不实施 #10。

## User Visible Changes

- TUI 超过4000 Unicode字符的目标保存为插件文件短引用，`/goal edit` 重开后还原正文；工具仍拒绝4001字符，不增加控制词。文件资源防护为正文1 MiB、每目标32图、单图20 MiB，超限拒绝本次操作并保留旧目标。
- 只识别 Pi 原生临时图片路径并逐项请用户选择是否持久复制。不读取剪贴板、不静默读取任意路径。复制后的附件不依赖临时源文件。
- 原生摘要、确认和编辑对话框保留；目标状态通过 `setStatus` 同时进入 codex-ui 与 Pi 默认 footer，不安装或替换 editor/footer。

## Todo

### 1. Locate
- [x] 读取指定 skills、语言策略、#1/#3/#9 与 #8 检查点和验收报告。
- [x] 完成固定版本 Pi 文档、相关示例及双版本图片路径源码核验，定位存储、命令和 codex-ui 状态接口。

### 2. Implement
- [x] 添加不可变目标内容包与受控引用校验，保存长文本和显式确认的图片，失败仅清理当前未提交包。
- [x] 接入原生编辑、附件选择与状态显示，保持既有预算、归属、控制词及调度规则。
- [x] 补齐真实双版本 SDK/TUI 附件和 UI 夹具，离线核验加载与未加载 codex-ui。

### 3. Deliver
- [x] 执行完整检查、diff 检查，保存验收报告、可恢复 manifest 和进程清理证据。

## How To Test

每个行为先运行失败测试，再最小实现并跑相关回归。第一轮验证长文本物化与实例重建后反解；后续分别验证显式图片复制、临时源消失、恶意路径、符号链接、引用伪造、失败保留其他记录、编辑状态与计费不变。

- 4000 与4001个 Unicode code points，包括非 BMP 字符。工具 schema 和执行层均不放宽。
- 附件选择取消、不选、同一路径重复、临时源缺失、源/目标目录符号链接和路径遍历。未确认前不读文件内容。
- 新包写盘失败及权威记录提交失败不删除已有包；不确定提交保留新包而非冒险删除。
- 原生 TUI 创建长目标、暂停、退出重开、编辑保存，图片源删除后通过原生 read 读取保存附件。真实0.84.3/0.85.1分别运行 codex-ui 和默认 UI，记录可见状态及原 editor/footer 保持证据。
- 资源成本随正文和明确附件数线性增长，文件读取设边界，不扫描历史内容包。状态渲染不读长文件，不新增轮询或模型请求。代表性长正文及附件测量保留实际规模与结果，不编造耗时阈值。
- 最终 `pnpm run check` 与 `git diff --check`。所有测试 HOME、agent、session、TMPDIR 均置于仓库内，禁真实剪贴板与付费请求；记录并清理启动进程，确认监听释放。

## Notes

完成记录见 [Goal attachments and UI acceptance](goal-ui-acceptance.md)。最终check919通过、2默认跳过；双版本真实PTY各含默认UI和codex-ui的创建/重开两进程。全部结果待协调者验收，未写GitHub或实施#10。

Context7 选择 `/earendil-works/pi`，返回 main 文档而非固定版本。实现依据本地实际0.84.3及0.85.1发布包源码与文档，两版本运行证据另行记录。成功提交的不可变包不在编辑或 clear 时自动删除，避免损坏继承快照和历史引用；本关只清理当前失败且确认未提交的包。
