# Upstream

## Source

- Repository: https://github.com/Leechael/pi-codex-search
- Commit: `976e8683cb5a342a4cf982c0a8a63e8f9b992d44`
- Package version: `0.1.6`
- License: MIT，原始版权声明见同目录 `LICENSE`。

## Import Scope

本目录复制上述提交的运行时代码和全部单元测试，作为 `pi-ext` 内维护的源码，不包含嵌套 Git 仓库。

未引入上游独立包的依赖清单、锁文件、发布脚本、CI、格式化配置和在线端到端测试脚本；依赖与测试工具复用本仓库。原始说明见[上游 README](https://github.com/Leechael/pi-codex-search/blob/976e8683cb5a342a4cf982c0a8a63e8f9b992d44/README.md)。

## Local Adaptations

- 上游根目录 `index.ts` 移至 `src/index.ts`，同步调整相对导入路径。
- 上游 `tests/` 移至 `__tests__/`，测试注册从 `node:test` 改为仓库使用的 `vitest`，保留原有断言与测试内容。
- `tsconfig.json` 的检查范围调整为 `src/` 和 `__tests__/`。
- 保留英文界面文案及上游搜索、认证和设置流程；搜索开始时额外发送初始进度，部分结果携带总数与已用时间。
- `src/renderers.ts` 实现选定的亮色 `accent`：无背景、青色标题、蓝色来源、较亮数字，绿色仅用于全部成功后的勾号；模式参数只在调用头显示。
- `src/animation.ts` 按真实工具执行管理动画，每个可见的执行中工具行最多一个 100ms 定时器；成功、失败、取消和会话退出时清理。历史结果及非 TUI 执行不启动动画。
- 深色 truecolor 的 `codex-pi` / `dark` 使用选定色板，其他主题和非 truecolor 使用主题语义色。保留展开正文、链接、独立网页工具预览与缺少元数据的历史结果回退。

## Validation

在仓库根目录执行：

```sh
pnpm exec tsc -p extensions/codex-search/tsconfig.json --noEmit
pnpm exec vitest run extensions/codex-search/__tests__
pnpm run prototype:search-ui --production --pty-smoke
pnpm run check
```

新增真实工具组件测试覆盖配色、进度、取消、部分失败、历史结果、主题切换、窄宽度和折叠性能。生产 PTY 验证使用真正的工具执行链路，仅以 fixture 替换认证和 HTTP，不访问 OpenAI。

Pi `0.84.3` / Node `22.22.2` 下，同一千行结果的 300 次折叠重绘，改动前约 6.49ms、改动后约 9.48–10.02ms；20 次展开重绘分别约 29.74ms 和 28.84–32.86ms。额外着色有小幅开销，不能据此声称性能提升；折叠的 Responses 结果不读取正文。

本目录的单元测试由根目录 Vitest 自动发现；类型检查暂需使用上面的独立命令。

## Activation

本地源码已包含上述界面改动，但尚未加入根目录的构建、发布和 Pi 扩展加载列表，不会替换已安装的 `npm:pi-codex-search`。

后续启用本地版本前，须停用原插件，避免 `codex_search`、`codex_standalone_web` 和 `/codex-search-settings` 重名注册。
