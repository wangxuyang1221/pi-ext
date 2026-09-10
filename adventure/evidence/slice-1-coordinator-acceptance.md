# Slice 1 acceptance

## Result

[Implementation #17](https://github.com/wangxuyang1221/adventure/issues/17) 第一次协调者验收通过。验收代码为 `50ff3b0de1071acec8bd3a85acf9f9b6b431cdd7`。核对获批 Slice、worker 报告、实际测试夹具及产品差异，没有发现规格偏离或本关必需证据缺口。

## Verification

- 独立重跑 `env -u PI_SUBAGENT_PARENT pnpm run check`，1024 项测试通过，2 项默认跳过，类型检查、构建和发布包校验通过。见[协调者检查日志](./slice-1-coordinator-check.log)。
- 独立重跑 `provider-runtime.mjs`，分别加载 Pi 0.84.3 和 0.85.1，各 22 场景、60 次请求通过。命令和夹具版本见[worker 报告](./slice-1-provider-admission.md#reproduction)。
- 检查夹具确实使用实际 SDK 的会话、模型配置加载、扩展 runner 和 Agent loop；私有模型使用原生 Completions adapter 与离线 SSE，其他正常入口使用合规离线 streamSimple。没有将合成生命周期事件替代正常 SDK 时序。
- 产品差异中 provider 名称限制已删除，未选模型及根/TUI/持久要求保留。工具恢复独立持久化，执行门控未加入计量 capability。已归属最后用量、预算命中、四种失效队列组合及替换目标隔离均有双版本运行断言。
- `git diff --check` 通过。协调者复跑后 `.goal-*` 临时目录无残留，命令均已退出，无新增后台服务或监听端口。

## Limits and next level

实际 SDK 离线通过不代表真实远端模型已验证。PTY 视觉效果、完整原生 adapter 计量及真实受管子代理链路归 #19；新 length/deferred 和额度分类，以及与工具门控的组合归 #18。两个默认跳过的 subagent 集成测试不计为通过。

#17 可以关闭，#18 解除前置阻塞。Map 和 Spec 保持 open，最终仍需用户确认交付。
