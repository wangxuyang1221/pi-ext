# Handoff

> 用户已对当前安装组合明确表示“验收通过”。本冒险交付完成，保留分支和正在使用的worktree；不创建PR、合并或部署。最终状态与证据见下文。历史过程可查本文件Git历史和各Issue历次Acceptance。

## Handoff Position

类型：`continuation`

定位：reader 完整接管原会话的主线工作。

## Current Goal or Problem

为Pi实现行内`$skill`选择与激活，交付右侧标点激活、输入框与成功快照正文标签、整体编辑、cube/command切换及持久偏好。用户已完成本次交付确认，没有待派发实施任务。

- [Map #1](https://github.com/wangxuyang1221/pi-ext/issues/1)与[Spec #2](https://github.com/wangxuyang1221/pi-ext/issues/2)是地图和完整规格入口。
- [#14标点](https://github.com/wangxuyang1221/pi-ext/issues/14)、[#15标签](https://github.com/wangxuyang1221/pi-ext/issues/15)、[#16整体验收](https://github.com/wangxuyang1221/pi-ext/issues/16)保存执行及历次返工验收。
- 最终产品为`7eb5143ca777530ec482dbd1714b284cecbec828`，后续提交仅整理交付记录。

## Evolution

旧#8/#9/#10实现输入、快照和恢复。本轮#5/#11/#12/#13补充句读、原型样式、完整标签编辑及宿主契约，用户审核#14/#15/#16三关。

#14提交`d8a6a40`实现右侧标点，补全仍双侧空白。#15遇到原生逐字删除的paste快照放大，#12重开。按词删除污染kill ring，setText破坏paste，直接补全有异步时序问题。pending/native双状态实验虽有局部低成本证据，用户最终选择原生同步删除及分组undo并接受成本，未采用异步事务。容量与释放证据`594f120`支持恢复实施。

`184a7e7`交付完整标签，`d8cae5f`修复两处测试fixture类型。#16完成八组安装/扩展组合PTY，等待实际终端观察。用户随后发现标签留白与原型不符，以及新skill搭配旧Codex UI时输入框样式变化。`7eb5143`只修留白和受影响投影坐标；用户另行批准单独加载冒险版Codex UI，其他扩展保持原样，之后明确“验收通过”。不是通过修代码兼容旧Codex UI解决第二项，而是采用配套新版宿主。

## Agreed Decisions and Constraints

- 冒险worktree为`/Users/wangxuyang/Code/t3code/pi-ext-skill-mentions`，分支`adventure/skill-mentions`。不改main，不自动建PR/合并/部署。远端分支不自动删除。
- 日常Pi依赖该worktree的skill和Codex UI编译入口，不能当临时目录删除。dist只通过构建生成。
- 用户确认新增产品文案用英文；其他文档正文、Issue和commit用中文，标题/小节及代码注释/测试名遵循仓库语言政策。
- 原文/范围/投影分离，公开API，不补丁Pi既有实例/prototype。底层原文仍为`$skill`，图标和三个显示空格不进入模型、队列、历史或外部编辑器。输入标签只表示识别，正文仅显示成功快照。
- 两种图标为cube U+F01A7及command U+2318，#8DF9FD、正常字重、继承背景。恢复原型的前导、图标名称间及尾随三个显示空格，保留源文本已有空格。超长名称完整跨行，保留大粘贴折叠，左右/删除/undo整体操作。
- 用户接受同步原生删除快照的时间/内存放大，不接受内容损坏、错误undo、旧文发送或kill ring污染。原128MiB代理门槛已撤销，不重复询问，不宣称极端OOM安全。
- 不修无关旧缺文件，不删测试或降低门槛。没有更改字体、终端设置或输入法。

## Established Facts and Required Context

### Product and evidence

Node22.22.2、pnpm11.9.0、Pi0.86.0。版本依据为安装包和固定官方源码`ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`，不把Context7 main当作该版本保证。

- [最终报告](evidence/skill-final-acceptance.md)：Spec矩阵、实际产物/安装、八组真实PTY与扩展组合、用户最终确认及适用边界。再次交付或处理回归时先读此文。
- [留白返工](evidence/skill-label-spacing-repair.md)：最新产品三轮Red/Green、显示空格与原文坐标/鼠标命中修复。594项相关回归、全skill测试严格tsc通过；两宿主fullscreen真实PTY各7组通过。协调者检查diff并独立36项通过。
- [标签原交付](evidence/skill-label-product-implementation.md)：正式标签、同步操作、成功快照正文、持久偏好、生命周期及完整功能矩阵。源代码在`extensions/skill-mentions/src/`，Codex配套接缝在`extensions/codex-ui/src/components.ts`。
- [标点交付](evidence/skill-punctuation-implementation.md)、[fixture类型返工](evidence/skill-label-fixture-type-repair.md)：各自范围及历史日志。
- [原生undo收尾](evidence/skill-label-native-undo-closeout.md)：无应用级数量/字节上限，64/256/1024名称及累计1349步恢复；按实际native步骤而非UTF-16长度分组。10MiB paste配64字符名称约650MiB额外heap的历史成本已接受。正常提交清栈，setText空文本不清栈；可达快照不被GC，RSS不保证立即下降。
- [异步候选](evidence/skill-label-serial-supplement.md)与[首轮反例](evidence/skill-label-implementation-blocker.md)只用于追溯放弃路线，不能当作当前设计。

最终check为typecheck通过、2312 passed/5 skipped，仍因既有MCP suite缺`prototypes/mcp-status-ui-prototype/src/codex-startup.js`失败。独立build通过，package:check仍缺旧`docs/goal-descendant-acceptance.md`，没有宣称全仓通过。原八组安装PTY属于其记录版本，留白修复单独补验受影响范围，不伪称全部组合在最新提交重跑。

用户“验收通过”作为实际体验及最终交付确认。没有收到终端型号、字体、输入法和四模式逐项记录，不伪造代理执行了物理IME检查，也不把PTY UTF-8注入等同实际候选窗口观察。

### Current installation

用户明确同意后，仅修改`~/.pi/agent/settings.json`的Codex UI来源，配置其他字段已对照备份验证未变：

1. 单独加载冒险`extensions/codex-ui/dist/index.js`。
2. 原main包仍加载其他扩展及主题，使用`extensions: ["-extensions/codex-ui/dist/index.js"]`禁用旧Codex UI，避免重复。
3. 原main codex-search源码入口和冒险skill dist入口均保留。

备份为`~/.pi/agent/settings.json.before-adventure-codex-ui-20260921-160216.bak`。新版入口及renderProjectedLines/renderSourceSurface已核验。旧Codex UI缺接口时会回退普通边框，这个旧组合兼容限制仍存在，不宣称已经修复。后续回滚前应先比较配置，避免覆盖用户新增设置；外部修改仍需授权。

### Cleanup

任务测试进程和监听端口均已清理，详见最终报告和[留白清理](evidence/skill-label-spacing-cleanup.json)。保留日常加载的worktree及配置备份，不卸载已批准入口。

旧`.tmp/skill-ui-prototype-GG4yw8`已缺失，消失时间/原因未明；此前保留声明已更正，不重建空目录冒充恢复。原型可复现源码保留在`adventure/experiments/skill-mention-ui/`。不把缺失临时目录当作交付产物。

## Current Assumptions

无待用户确认的设计假设。用户确认的是当前配套安装组合；未推定兼容旧Codex UI、任意第三方宿主或无限输入规模。

## Continuation Point

冒险已获用户最终确认，收尾后关闭#15/#16及Map/Spec。无需继续实施、追问同一验收或重复测试。主代理释放已完成worker，结果已在远端报告与Issues保存。

未来若有新回归，先读Map、Spec、最终报告和受影响实现，再重开对应关卡；沿用已接受成本和当前安装事实，不自动回退全局配置。不得自动删除冒险分支或worktree，不创建PR/合并/部署。需要迁移日常安装时另行取得用户同意，并先安排资料及入口迁移。
