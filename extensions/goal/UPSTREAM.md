# Goal upstream reference

## Source

行为依据为 OpenAI Codex CLI `rust-v0.153.4`，固定提交 [`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`](https://github.com/openai/codex/tree/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a)，以及 [Pi goal spec](https://github.com/wangxuyang1221/adventure/issues/3)。上游仓库使用 [Apache-2.0](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/LICENSE)。

固定提交的 [NOTICE](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/NOTICE) 中适用于本移植的 OpenAI 名称与版权保存在本目录 `NOTICE`。本扩展没有移植 Ratatui 代码，因此不复制上游针对 Ratatui 的附加声明。包 metadata 的 `MIT AND Apache-2.0` 表示发行包含分别适用两种许可证的内容，不把 Apache-2.0 复制内容改授 MIT。

## Local implementation

完整 goal 提醒按工作轮次投递并保留原历史位置，不再每次模型请求尾插。重复工具调用预警、暂停和 `pauseReason` 是本地保护，不是固定 Codex 版本的功能移植；上游模板正文未改。默认 32 条指纹窗口、4 次连续重复预警、8 次进入暂停候选，用户可用 `/goal resume` 恢复。能力边界与验证缺口见 [Goal loop prevention report](../../docs/goal-loop-prevention-report.md)。

长文本与图片内容包、原生附件选择和 codex-ui 状态行是本地 Pi 适配，不是 Codex 核心 UI 的逐像素移植。工具4000 Unicode字符限制及固定提示保持；内容包通过本插件 metadata 与校验和验证，不解析任意用户文件引用。

文件存储和 Pi 命令适配为本地 TypeScript 实现，适用本仓库根目录 MIT 许可证。独立权威 JSON、恢复入口、文件锁和 Pi 镜像是经 C10 确认的本地适配，不兼容 Codex SQLite 存储格式。

`src/upstream.ts` 复制固定提交 `codex-rs/ext/goal/src/spec.rs` 中的工具描述，以及 `templates/continuation.md`、`templates/objective_updated.md`、`templates/budget_limit.md` 提示。原始字符串保留，外层改为 TypeScript 常量；渲染器替换模板变量并进行 XML 转义。上游响应字段与完成预算提示按 `src/tool.rs` 移植。复制内容适用随扩展分发的 [Apache-2.0 许可证](./LICENSE)，保留 OpenAI 版权。上游提示与本地调度适配须区分；#4 至 #9 已由协调者验收，整体集成结果见随包提供的 [Goal integration acceptance](../../docs/goal-integration-acceptance.md)。预算与错误优先级依据同提交 `src/runtime.rs` 的 `can_stop`：普通错误不覆盖 budget_limited，额度错误可覆盖为 usage_limited。
