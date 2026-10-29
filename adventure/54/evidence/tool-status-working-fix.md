# Tool status verification repair

## Scope

#65 维护代理按目录边界报告共享工具状态驱动漂移，未修改目标 skill 以外文件。主代理以 Astra high 和 ub-mode 修复 `extensions/codex-ui/__tests__/fixtures/tool-status/`；产品行为、宿主补丁和维护代理目录均未修改。修复期间维护代理已确认暂停 PTY、构建和检查，仅继续整理其文档。

## Failure and expected behavior

原失败证据 `.tmp/test-results/verify-tool-status-SsPXWo/` 的 `view()==frozen` 要求整个屏幕不变，与任务期间持续 Working 动画冲突。工具卡自身应静止，Working 应持续更新，两个要求同时成立。

新断言固定最新 held 区域的完整单元格，包括文字、位置、前景/背景及样式。对 regular/fullscreen 的 error/interrupted/timeout 各采样 15 帧，卡片必须全部相同，同时至少出现五种 spinner 帧及两种反光颜色，spinner 始终为 accent 青色。原有运行/成功/错误/中断/超时的颜色断言继续保留。

MCP-only 入口本来不加载 codex-ui，所以不要求新增 Working。仍检查其 held 卡片整行文字、位置和样式固定，及原有黄色状态标记。首轮修复误对该入口要求新 Working，失败已保留，随后按入口真实加载范围修正。

## Verification

原始修复证据位于 `.tmp/tool-status-working-fix/`。5项快速 Python 行为测试覆盖动画/速率变化不影响静态区域、文字/颜色/样式/位置变化可检测、缺失或颠倒边界必须失败，以及取最新 held 卡片。先用旧的整屏采样实现得到预期行为红灯，再改为区域采样；最早模块尚不存在的导入失败单独记录，不算有效红灯。

质量工具对逐字节相同的 scratch helper 执行：coverage 100%、CRAP 4，9/9变异 killed。首轮5个存活变异暴露最新区域和颜色精确值断言不足，补充反例后全部被行为断言杀死。dryer覆盖helper及共享smoke，结果另存；旧smoke函数仅记录圈复杂度，不宣称整个旧驱动全覆盖。Python顶层PTY流程由真实三个入口验证，不能把helper变异结果推成整个驱动变异覆盖。

首轮完整旅程 `.tmp/test-results/verify-tool-status-JHslNu/` 的普通与全屏通过，MCP-only失败；doctor与清理记录保留。最终完整三入口见 `.tmp/test-results/verify-tool-status-MOEJZz/`，regular/fullscreen/MCP-only全部通过，均包含restart恢复；正常退出0、共享scratch移除且groupStopped。两种codex-ui模式共6组held状态各保留15个动画样本，已重读核对转圈、灰度与accent。完整 `pnpm run check` 退出0，204文件/2951测试通过，八扩展source/dist加载0错误。5项Python辅助测试单独执行，不计入2951。

## Action log

1. 读取维护代理失败、doctor及清理证据，重放原始ANSI，确认静态卡片与Working分别存在；协调暂停新live驱动。
2. 读取ub-mode、语言和提交政策、共享fixture及三个入口加载范围；不修改产品或维护目录。
3. 写静态区域/动态状态采样测试，保留有效红灯，再局部修改驱动；保留所有颜色断言并单独检验Working推进。
4. 运行三项质量工具，初次LCOV文件名未被crapper识别而得到无效0%报告；改为coverage/lcov.info后核实100%。依据存活变异补足反例，最终9/9 killed。
5. 质量工具首次以错误相对路径读取smoke得到空分析；保留无效日志，改为逐字节相同的scratch文件后重跑，dryer无0.8重复，旧smoke函数最高圈复杂度7。
6. 首轮真实旅程暴露MCP-only不加载codex-ui的差异，保留失败、先doctor，再按正确入口条件重跑完整三入口。

## Cleanup

本修复仅启动自己的短命命令与共享tool-status隔离实例。`cleanup.json` 核对13个旅程相关PID及组均无存活，监听查询为空；完整check的PID也退出且无监听。变异worker目录为空，失败及成功原始证据、质量报告均保留。用户原型、全局Pi和旧证据均保留；维护代理未提交改动不纳入本次提交。

7. 最终三入口通过后运行完整check、核对样本及PID清理；仅提交本修复文件，将结果交维护代理继续独立复验。
