# Skill Label Fixture Type Repair

## Scope

协调者因#16独立全测试tsc发现两处fixture类型错误，局部重开#15。本轮基准为`a9cbf51318dd56ec1c0f5d18d5dadccc0864f6bd`，分支`adventure/skill-mentions`，接手时工作区干净。

只修改`extensions/skill-mentions/__tests__/label-surface.test.ts`的fixture构造；没有产品src、运行行为、配置或验收范围变更。保留[原失败日志](skill-final-test-types.log)及[最终验收记录](skill-final-acceptance.md#checks)，不覆盖历次Acceptance。

## Repair

- 原`{ fg, getBgAnsi } as Theme`缺少真实类成员，独立tsc报TS2352。改用公开`new Theme(...)`，显式提供前景和背景色表，由构造函数参数类型检查完整性；不增加双重断言、`any`或忽略指令。前景使用终端默认色，背景仍为238。真实Theme会发出前景重置序列；原有布局、宽度、青色及原文断言全部保留并通过。
- 原resize通过`TUI.terminal.columns`赋值，违反Terminal只读getter声明，报TS2540。fixture现在单独持有可变`terminal`对象，再传给TUI；测试改变同一个对象的`columns`，宿主仍能读到实际尺寸更新。不改变生产接口、不补丁实例或prototype。
- 18项label-surface测试未删减、未新增skip，测试名称和断言未放宽。`tsconfig`及产品src均未修改。

## API Basis

环境：Node.js22.22.2、pnpm11.9.0、TypeScript5.9.3、Vitest3.2.4、Pi0.86.0。

Context7工具本轮不可用，采用安装的0.86.0官方文档、声明和实现，并联网核对此前固定的官方commit，不将main当作版本依据：

- 完整读取本机`node_modules/@earendil-works/pi-coding-agent/docs/themes.md`及其内置dark/light主题示例，核对`dist/modes/interactive/theme/theme.d.ts`、`theme.js`的构造函数、颜色映射和`fg/getBgAnsi`。
- [固定官方Theme源码](https://github.com/earendil-works/pi/blob/ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc/packages/coding-agent/src/modes/interactive/theme/theme.ts)：公开构造函数接收完整的必填颜色键；`Theme`含私有状态，两个方法的普通对象并非完整Theme。
- 本机`node_modules/@earendil-works/pi-tui/dist/terminal.d.ts`的`Terminal.columns/rows`为getter。修改fixture所有者持有的可变尺寸对象，不需要对只读宿主接口赋值。

## Checks

独立检查覆盖`extensions/skill-mentions/__tests__/*.ts`全部18个文件，包括16个测试文件以及`lifecycle-fixture.ts`、`pty-fixture.ts`。Red和Green使用完全相同的命令；显式保留仓库ES2022、NodeNext、strict等设置，`skipLibCheck`沿用现有值而非本轮降低门槛：

```bash
pnpm exec tsc --target ES2022 --module NodeNext --moduleResolution NodeNext \
  --strict --esModuleInterop --forceConsistentCasingInFileNames \
  --skipLibCheck --types node --noEmit extensions/skill-mentions/__tests__/*.ts
```

| Check | Result | Evidence |
| --- | --- | --- |
| 独立全测试tsc，修复前 | 退出2，仅复现TS2352、TS2540两处错误 | [Red](skill-label-fixture-types-red.log) |
| 相同独立全测试tsc，修复后 | 退出0，无诊断 | [Green](skill-label-fixture-types-green.log) |
| `pnpm exec vitest run extensions/skill-mentions/__tests__ extensions/codex-ui/__tests__` | 44 files、580 passed；含label-surface的18项 | [Regression](skill-label-fixture-regression.log) |
| `pnpm run check` | typecheck通过；2298 passed、5 skipped；155 files通过、1失败、3跳过，退出1 | [Check](skill-label-fixture-check.log) |
| 短路后独立`pnpm run build` | 退出0，所有编译目标及媒体复制检查通过 | [Build](skill-label-fixture-build.log) |
| 独立`pnpm run package:check` | 退出1，仍缺旧文档 | [Package check](skill-label-fixture-package-check.log) |
| `git diff --check` | 通过 | 提交前检查 |

全仓check仍因既有MCP suite缺少`prototypes/mcp-status-ui-prototype/src/codex-startup.js`失败，package检查仍缺`docs/goal-descendant-acceptance.md`。没有修复无关缺文件、删测试或降低检查门槛，不声称全仓通过。

## Boundaries

本轮未额外运行#15/#16的PTY、安装组合或原标签性能/内存实验；既有回归suite内部的渲染benchmark和进程fixture随要求的测试执行。这次修复没有产品代码变更，不产生新的真实终端、物理IME、字体观察或OOM安全结论；#16既有证据及其人工未验证项保持原状。

## Cleanup

所有检查以前台命令执行并已返回。测试子进程通过`env -u`仅清除四项`PI_SUBAGENT_PARENT/PI_SUBAGENT_LAUNCH/PI_SUBAGENT/PI_SUBAGENT_ID`标记，没有修改全局环境。TMPDIR统一在worktree内的`.tmp/skill-label-fixture-type-repair`。

[清理记录](skill-label-fixture-cleanup.json)：本轮TMPDIR及jiti缓存已删除；按运行前清单仅删除1个本轮新增quality stderr，原有38个文件仍在。没有单独启动后台服务；结束时进程扫描无本轮测试或TMPDIR候选进程，未发现其遗留监听进程。没有触碰既有Pi/tmux宿主。旧`.tmp/skill-ui-prototype-GG4yw8`仍不存在，保留此前更正，不重建或声称已保留。

仅将返工计划、交付和核验结果补入#15 Execution/Delivery/Verification，Acceptance及Map/Spec/progress/#16由协调者维护。本轮完成后返回协调者，不自动关闭Issue或扩大实施。
