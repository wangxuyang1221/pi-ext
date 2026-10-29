# Working final-frame capture repair

## Scope

#65 独立维护时发现共享驱动的最后截图早于刷屏。原普通/全屏旅程的53项检查与退出/清理通过，但 `screens.finished` 仍有 Working 和速率，不能用于证明最终隐藏。原证据保留在 `.tmp/maintain-codex-ui-65/working-{regular,fullscreen}/`，后置失败、doctor与暂停清理见同目录的 `sampling-pause-cleanup.json`。

主代理以 Astra high 和 ub-mode 修复共享 `test-support/fixtures/local-refresh/working_journey.py`，仅增加一项等待。收到公开 `agent_settled` 后，继续 pump 真实终端，直到 Working 和速率均不可见，才 capture/quit。已有 wait 还要求 synchronized frame 完整，不用固定延迟猜测。这是证据时序修复，未修改产品代码、宿主补丁、CPU预算或维护代理的目标目录。

## Verification

原始修复证据在 `.tmp/working-final-capture-fix/`。先对旧 finished 执行独立后置断言，确认因残留显示失败，再修改等待条件。使用 #65 本次新安装 `.tmp/local-refresh-install-ZQW7Cw/patched/` 的真实 bin 与已安装 codex-ui，顺序重新执行普通及全屏的完整 Working 旅程。

```bash
node .cursor/skills/verify-pi-text-regions/scripts/doctor.mjs
conda run -n codex-py312 python scripts/local-refresh-pty.py .tmp/working-final-capture-fix/regular --working --cli .tmp/local-refresh-install-ZQW7Cw/patched/node_modules/.bin/pi --extension .tmp/local-refresh-install-ZQW7Cw/patched/node_modules/pi-ext/extensions/codex-ui/dist/index.js
conda run -n codex-py312 python scripts/local-refresh-pty.py .tmp/working-final-capture-fix/fullscreen --working --mode fullscreen --cli .tmp/local-refresh-install-ZQW7Cw/patched/node_modules/.bin/pi --extension .tmp/local-refresh-install-ZQW7Cw/patched/node_modules/pi-ext/extensions/codex-ui/dist/index.js
```

两入口各54项检查通过，CLI退出0。另从落盘 `screens.json` 读回 finished：完整同步帧，Working与速率均不存在。真实 `artifacts/workspace/tool-proof.txt` 为 `TOOL-FINISHED`，取消的 `should-not-exist.txt` 不存在。逐项读回结果保存 `verification.json`。未把原版关联入口、物理终端或联网标为本次已测，#65/#66继续各自剩余范围。

质量工具的副本与源文件逐字节一致。dryer无0.8以上重复；crapper仅记录既有整条journey的CC23，未采集整函数覆盖率，不能据此宣称低CRAP。mutator针对新增行发现3个条件变异，均killed。该快速探针从实际源码读取wait条件，分别验证两区都在、仅Working、仅速率、两区都消失的屏幕状态；它仅证明等待条件，不替代上述真实PTY。其探针和原始报告保留在 `quality/`，不声称整个journey的73个变异均已运行。

完整 `pnpm run check` 退出0：204文件、2951测试，八扩展source/dist加载0错误。日志为 `check.log`。完整检查PID已退出且无监听，变异worker目录为空，读回结果为 `cleanup-check.json`。

## Action log

1. 核对原两模式截图与公开事件、清理记录，保留失败，确认维护代理结束所有live进程并暂停新drive。
2. 阅读共享wait/capture实现，先对原落盘截图运行最终隐藏断言得到红灯。
3. 只增加等待终端两区消失的一行；复用完整帧条件，无产品改动、无固定sleep。
4. 先doctor，再顺序跑真实发布包的两模式完整旅程，独立读回finished、真实文件与取消无副作用。
5. 运行crapper/dryer/mutator，限定质量结论为本次条件及原始工具实际覆盖；记录没有运行的范围。

6. 完整check通过后确认检查进程和变异worker退出，仅提交共享一行修复和本证据，通知维护代理继续剩余验证。

## Cleanup

本次PTY的PID48044、48316及进程组均退出，无监听，runtime删除而原始ANSI、动作、事件、截图和真实文件副本保留。没有修改全局Pi、用户原型或剪贴板，没有删除维护代理的失败证据。
