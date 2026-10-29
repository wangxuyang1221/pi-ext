# Implementation slices

Status：Accepted。用户已认可前三关，并追加开发完成后的验证系统建设、维护和独立验收要求。以下后三关落实该补充指令，无需再审核同一范围。lowpower 移除 #60 已独立交付。

共同规格与预算见 [Spec #55](https://github.com/wangxuyang1221/pi-ext/issues/55)。依据为 [CPU 调查](evidence/render-cpu.md)、[统计来源](evidence/token-rate-sources.md)、[已确认原型](evidence/old-codex-working-prototype.md) 和 [生命周期证据](evidence/working-lifecycle.md)。

1. 普通模式可用的动画与 footer 局部刷新机制，原版正常回退。
2. 同一机制支持全屏及模式切换，保持布局、选择和复制正确。
3. codex-ui 正式接入已确认的 Working 与真实估算速率，验收组合后的 CPU 与完整用户流程。
4. 使用 create-verification-skill 为新增局部刷新能力建立并实跑验证系统。
5. 使用 maintain-verification-skill 升级现有 verify-pi-codex-ui，覆盖全部 feature。
6. 独立验证 subagent 调用新旧验证 skill 完成最终验收，修复并重验所有发现的问题。

前三关开发依次实施，随后依次创建验证 skill、维护现有验证 skill、由独立 subagent 最终验证。所有关卡沿用同一 worktree。编码 worker 固定 gpt-6-astra / high；验证及只读源代码审查 subagent 固定 gpt-6.1-sol / high。发现产品问题先退出 skill 维护阶段，由编码 worker 修复，再由验证 subagent 重验，全部完成后才交付。

## Slice 1: Local refresh in regular mode

- goal: 扩展在仓库补丁版 Pi 的普通模式中，可分别更新 Working 类文本动画和 footer 速率，降低它们带来的额外 CPU；未补丁宿主仍正常显示。
- in_scope: 正式可选宿主 API 与类型、区域注册/请求/释放契约、真实组件几何与失效、合并调度和正常请求优先、普通模式保留帧；固定版本的 pnpm 补丁及加载入口；经过真实 widget/footer factory 的可运行示例、CPU 基准和文档。必要时小范围调整 coding-agent，保持已有摘要补丁。全屏在本关正常回退。
- out_of_scope: 全屏局部优化、正式 Working 与 token 采样接入、正文增量渲染、任意复杂组件自动优化、全局 Pi 改动。
- dependencies: none。
- acceptance: 普通模式真实扩展入口中，动画、footer-only 和同帧多目标输出正确；正常请求交错、尺寸/行数/主题变化、卸载/reload/停止、overlay 等回退与生命周期通过。200/1000 对真实消息组件动态帧 CPU 中位数至少下降 30%；0/200/1000 对历史的正常更新及未接入路径额外 CPU 不超过 max(10%, 0.1ms/帧)。沿用 Spec 的同内容/帧数/频率、预热和多批轮换测量，不放宽预算。通过真实 PTY、干净冻结安装、仓库 bin 实际加载、原版能力降级及 pnpm run check。
- boundaries: API 不暴露私有坐标或硬编码行号；状态不随帧数无限增长，资源有明确所有者与释放方式。稳定 TUI 引用不能永久绑定旧 renderer。全屏正式增强由 Slice 2 承担，但本关全屏回退必须可用。示例允许受控数值，不能冒充已接入真实模型速率。

## Slice 2: Local refresh in fullscreen mode

- goal: 相同扩展调用方式在全屏降低动画/footer 的额外 CPU，模式切换后显示与交互保持正确。
- in_scope: 全屏区域几何、保留帧及布局元数据同步；窗口变化、滚动、选择/复制、搜索、overlay、图片等快路径资格及回退；renderer 切换、会话和 reload 隔离；全屏预算及两模式机制组合验收。
- out_of_scope: 正文持续输出优化、正式 Working/采样接入、任意复杂交互组件局部渲染承诺、默认 UI 重设计。
- dependencies: Slice 1，沿用其公共契约。
- acceptance: 真实全屏 widget/footer 通过正式 API 更新独立及同帧目标；无旧选择/复制内容、错位点击、滚动或光标错误。全屏 200/1000 对历史动态帧 CPU 至少下降 30%，0/200/1000 正常路径额外 CPU 不超过 max(10%, 0.1ms/帧)，并复验普通模式预算。真实 PTY 覆盖模式切换、草稿/光标、历史增长、复杂视图回退、卸载/reload/会话切换/停止；原版降级、干净冻结安装及 pnpm run check 通过。
- boundaries: 不能仅改屏幕字符串而留下旧布局元数据，不靠降帧或少显示内容达标。模式切换后句柄对应当前 renderer，失效句柄不能写入旧画面；公共行为必须改变时先回到规划及审核。此关仅完成机制，正式 UI 和统计组合由 Slice 3 验收。

## Slice 3: Working animation and live token rate

- goal: codex-ui 在任务期间实际显示用户确认的青色十帧转圈、Working 反光与计时，footer 右侧显示真实事件驱动的约两秒估算速率，并通过完整 CPU 与用户流程验收。
- in_scope: 生产组件与 footer 布局接入；共享动画调度和局部刷新请求；增量统计正文、可见思考、工具参数；估算方法与精度说明；任务/响应状态、取消完成、重试、自动压缩、等待输入、会话/reload/shutdown 隔离；原版回退、正式文档及整体验收。吸收原型中已验证的样式和 /quit 修复要求，不导入原型演示控制。
- out_of_scope: 输入、工具结果及未传出的隐藏思考计数；模型服务端真实吞吐测量；正文渲染优化；恢复 lowpower 模式；标题动画重设计；PR、合并或部署。
- dependencies: Slice 1 and Slice 2。
- acceptance: 从真实 provider 事件契约经生产采样、组件到两种 TUI，正文/思考/工具参数分片、完整补齐、共享 partial 和不同事件形态无重复计数；计数不依赖分片数量，采样与存储有界。约两秒无输出显示 -- t/s，运行有数据带 ≈，任务结束隐藏；响应重置不提前结束 Working，工具/重试/自动压缩/等待输入不断动画，取消完成后释放。实际 PTY 覆盖输入、宿主 /quit、窄屏、权限对话框、展开/overlay、会话切换及迟到回调；原版保留功能并缺失仅局部优化。以相同生产组件、事件、内容和帧数比较正常刷新与局部刷新，连同采样开销仍满足 Spec 全部 CPU 预算，不能只引用前两关示例。编码 worker 对照 Spec 完成开发阶段的组合验证、干净安装/打包入口、两模式与原版验收、pnpm run check 和资源清理；后续验证系统及独立最终验收由 Slice 4–6 完成。
- boundaries: 单调时钟、固定约两秒分母、增量有界时间桶；不反复扫描完整响应或历史，不把片段数当 token，不用最终 usage 替换短窗口。任务生命周期与响应采样状态分开；终止、替换和迟到事件不能复活过期显示。不降低原型既定动画频率或隐藏内容取得 CPU 结果。32/40/100 列沿用原型布局，更极端宽度安全截断；对话框拥有原有焦点和遮挡优先级。验收证据不足时返回相应关卡，不能宣称完整交付。

## Slice 4: Verification skill for local refresh

- goal: 新增局部刷新能力具备可由陌生代理按说明实际运行的项目级验证系统。
- in_scope: 开发完成后完整使用 create-verification-skill，调查最终代码与宿主/扩展入口，创建 .cursor/skills/verify-<actual-capability>/，包含 Launch/Doctor/Drive/Evidence/Cleanup/Helpers、feature map 及必要可执行驱动。复用已有真实 PTY/离线 provider/CPU 工具边界，避免重复框架。
- out_of_scope: 为匹配“新 extension”字样而无必要新增产品扩展；修改既定产品行为；创建 PR。实际 skill 名称按最终交付命名。
- dependencies: Slice 3。
- acceptance: 使用生成 skill 自身步骤从空数据目录启动，doctor、至少一项 mapped feature、保留行为及副作用证据、清理并确认 evidence 仍存在。映射普通/全屏、原版兼容、生命周期/交互回退与 CPU 预算的独立入口，完整覆盖由 Slice 6 执行。所有脚本可执行且调用方式明确；pnpm run check 通过。
- boundaries: 编码 worker 为 gpt-6-astra / high；完整读取用户指定的 create-verification-skill 及引用。只有测试外部系统的既有隔离边界允许替身；不能用内部 setter 冒充真实用户路径。资源仅清理自己启动的 PID/目录。

## Slice 5: Maintain codex-ui verification

- goal: verify-pi-codex-ui 的索引、说明和驱动覆盖当前正式 Working/速率及既有全部 feature，均有源码和 live 证据。
- in_scope: 完整使用 maintain-verification-skill；逐 feature 并行只读源代码审查，维护协调者串行实际驱动，修复 skill 自身目录中的描述、索引和 harness 漂移；新增实际有源代码依据的功能入口。
- out_of_scope: 在维护阶段修改产品代码，削弱验收以掩盖回归；创建 PR。共享目录修改如确有必要另交编码修复阶段。
- dependencies: Slice 4。
- acceptance: 每个 feature file 都有源码总结与至少一次 live 验证；每次实例 doctor，失败后恢复已知状态或重启；harness 修复后实跑，最终清理而不删证据。报告 clean/changed/blocked 及具体覆盖。用户既有不创建 PR 约定覆盖 skill 的 changed 建 PR 步骤，改为提交推送冒险分支。
- boundaries: 维护/验证协调者及源代码审查 subagent 均为 gpt-6.1-sol / high。维护 task 明确允许 skill 所要求的一文件一个只读 subagent，子代理不运行应用、不编辑、不再委派。简洁运行笔记留 scratch，不提交。产品回归交编码 worker 修复后再继续受影响维护验证。

## Slice 6: Independent final verification

- goal: 独立验证 subagent 按已生成/升级的 skill 证明整场功能和 CPU 目标满足 Spec，全部问题修复并重验后交付。
- in_scope: 新上下文的 gpt-6.1-sol / high subagent 完整读取并实际调用新能力验证 skill 和 verify-pi-codex-ui；检查全部 feature/入口、CPU、安装/打包/原版回退、两 renderer、真实事件组合与资源清理；核验已有证据不足部分，不以阅读脚本代替运行。
- out_of_scope: 降低预算、遗漏功能后宣称全过，创建 PR、合并或部署。
- dependencies: Slice 5。
- acceptance: 全部 Spec 验收项有与最终提交对应的证据，发现问题由 gpt-6-astra / high worker 修复，再发起新的 gpt-6.1-sol / high 验证任务；最终 pnpm run check、skill 驱动、CPU 预算和本任务清理通过。不可验证项必须精确报告，不能自行豁免为已完成；真正外部阻塞才向用户报告。
- boundaries: 最终验证由独立 subagent 完成，不能由编码者自测替代。协调者核对证据来源和覆盖，全部完成前不提交最终交付确认。Map/Spec 在用户接受最终交付前保持 open。
