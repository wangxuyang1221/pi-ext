# Goal integration todo

## Understanding

完成 [Implementation level #10](https://github.com/wangxuyang1221/adventure/issues/10) 的 V1 至 V5 最终工作区集成验收，交付可安装包、复现入口和逐项证据，等待协调者独立验收。依据 [spec #3](https://github.com/wangxuyang1221/adventure/issues/3) 全文与 C11/C12/C13，不提交、推送、部署或写 GitHub。

## User visible changes

- goal、codex-ui 和直接 subagent 无预期的运行行为变化，不增加功能或改变状态语义。
- 安装包补齐 #8/#9/#10 验收报告与 OpenAI NOTICE；README提供已验证的本地解包安装流程，metadata明确混合许可证。

## Todo

### 1. Locate

- [x] 核验 HEAD 与 #9 的134文件检查点，记录实际运行版本及固定 Pi 文档差异。
- [x] 对照 spec、README、许可和既有测试入口，列出本轮复验及复用边界。

### 2. Implement

- [x] 在隔离目录执行双版本 SDK、PTY、tmux 验收，补齐跨恢复、预算、中断与内容继承的组合证据。
- [x] 打包并通过两版本 Pi 实际安装、发现和加载发布入口，核验 goal/codex-ui/subagent 与 Apache-2.0 归属。
- [x] 修正文档中的过时状态或范围，明确受控 provider 与真实服务的证据区别；本轮未发现需修改生产语义或交回 #9 的缺陷。

### 3. Deliver

- [x] 运行完整 pnpm run check 与 git diff --check，归档每项结果、未执行项及 V1 至 V5 回写建议。
- [x] 核验本轮进程退出及监听释放，生成带副本与 SHA-256 的可恢复 manifest，保留全部已有改动和证据。

## How to test

| ID | This run | Pass criteria |
| --- | --- | --- |
| V1 | 两版本原生 InteractiveMode PTY 调度矩阵，包含 C11/C12、真实运行 Esc/pause、弹窗取消、steer/follow-up、其他扩展交错、重试与压缩 | 对最终源码重新运行；失效请求不发出，文字可找回，历史与目标保留；仅 retry 等待取消可 blocked，其余真实中断 paused；无重复自动调用 |
| V2 | 两版本原生 Codex adapter 离线 SSE、预算 SDK/PTY、真实 tmux direct child budget/duplicate/late/pending | 非缓存 input+output，创建基线与去重；软收尾后计实际超额；根替换隔离；C13 无孙代理；显式关闭成功且报告检查点不重收 |
| V3 | 两版本存储/生命周期 SDK 与异常退出进程回归，新增组合运行 | 首回复前恢复唯一接管；写入/镜像失败、锁、tree/fork/clone/reload 隔离；继承内容与预算快照独立，不凭旧 context 续跑 |
| V4 | 全部 goal 单测、双版本 Unicode SDK、默认 UI/codex-ui 各两阶段 PTY | 4000 Unicode 工具边界、安全拒绝、原生粘贴读取桩与真实 UI 流程、源删除后附件仍可读，原有 editor/footer 身份不替换 |
| V5 | pnpm pack；两版本 Pi 在隔离 HOME 实际 install 本地解包目录并从 manifest 加载；完整 check 与差异检查 | 包含七扩展入口、goal 所需产物/许可/归属；goal/codex-ui/subagent 实际可用；准确记录默认跳过项与受控模型限制 |

每次运行使用新的仓库内 evidence/HOME/agent/session/TMPDIR，不复用 gate 文件，不读取真实剪贴板或真实 session。进程由测试驱动记录并关闭，不停止其他会话进程。

## Performance constraints

不新增执行路径或自行设性能阈值。复验正文1 MiB、32图、单图20 MiB防御边界及工具4000 Unicode不变；状态渲染不读附件。成功旧内容包继续保留，增长和备份限制写入文档。计费重复读取不得增加 token，预算不强杀运行中的模型或子代理。

## Notes

- 起点 HEAD 为 3972c9e1b6693021fd79d99a0acb19fb62f0260d 加未提交 #4 至 #9 和研究/测试产物。#9 manifest 后协调者只更新 docs/goal-ui-acceptance.md，允许此单文件指纹不同。
- 旧报告只用于定位。本轮重跑结果单独标记；提示文本和受控模型遵从不构成真实模型可靠性或形式证明。
- 无付费在线调用、其他 provider 兼容、孙代理、断电零丢失或外部注册表发布验收。
