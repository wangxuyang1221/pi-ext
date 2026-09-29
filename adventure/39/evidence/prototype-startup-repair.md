# Prototype startup repair

## Failure and fix

用户在手动验收阶段报告旧原型无法启动。运行 `node adventure/39/prototypes/goal-tool-ui/demo.mjs` 复现 `ERR_MODULE_NOT_FOUND`，缺少隔离目录下的 `runtime/goal/renderers.js`。

产品实现为 `tools.ts` 增加了 renderer 导入，但原型 `prepare.mjs` 仍只转译 tools/upstream。此次仅将 renderers 加入转译清单，不改变正式产品源码或原型布局。

新增 `prepare.test.mjs`，实际导入临时转译后的 Goal tools。该测试修复前因缺少 renderers 失败，补齐清单后通过。后续生产依赖变化导致模块无法加载时，该测试会再次报错。

## Verification

在本冒险 worktree 执行：

- `node --test adventure/39/prototypes/goal-tool-ui/prepare.test.mjs adventure/39/prototypes/goal-tool-ui/renderers.test.mjs`：5/5 通过。
- `conda run --no-capture-output -n codex-py312 python adventure/39/prototypes/goal-tool-ui/smoke.py`：regular 通过，PID 79814，15 个场景快照。
- 同一命令添加 `--fullscreen`：fullscreen 通过，PID 79907，15 个场景快照。
- `pnpm run check`：173 个测试文件通过，2604 项测试通过，13 项既有跳过；类型、构建与包检查通过。运行环境经 `env -i` 清理，HOME/TMPDIR/agent 使用 worktree 内临时目录。

[regular 快照](prototype/regular.json)、[fullscreen 快照](prototype/fullscreen.json)、[完整 check 日志](prototype/repair-check.log)。两个 PTY 均验证了启动、固定工具调用、变体切换、展开、窄屏、异常和主题，并在运行中通过 `/quit` 退出。

## Cleanup and limits

两个 PTY 启动进程均已退出，smoke 确认各自隔离目录删除。再次检查未发现 `goal-tool-ui-*` 临时目录，check 的隔离目录也已删除。本次未启动网络监听服务。

原型仍为布局对照工具，使用内存 Goal fixture。用户验收正式插件应使用已经切换到冒险构建的正常 Pi 会话，不将原型启动成功当作正式 Goal 存储/调度验收。
