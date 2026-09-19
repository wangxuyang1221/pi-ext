# Codex Compact Quality Validation

## Default Checks

`pnpm test` 使用 `extensions/codex-compact/__tests__/fixtures/quality-report.ts` 中的小型合成数据，验证报告计算、失败尝试、部分 usage、链式压缩及输入校验。这些数据不代表历史实验结果，也不能用于证明压缩质量提升。

发布包不包含测试 fixture、原始日志或本地历史实验材料。`package.json.files` 和 `scripts/check-package.mjs` 使用相同的发布路径约束。

## Historical Report Rebuild

在仓库 checkout 中，持有历史证据时可显式运行以下命令。路径为示例，应替换为实际文件；输出目录必须已存在且位于当前仓库内。

```bash
pnpm run codex-compact:quality:report --evidence .tmp/archive/codex-quality-development-evidence.json .tmp/archive/codex-quality-development-results.json
pnpm run codex-compact:quality:report --chain-evidence .tmp/archive/codex-quality-chain-evidence.json .tmp/archive/codex-quality-chain-results.json
```

`fixed`、`kubediff` 和 `native` 的 development-schema 报告同样使用 `--evidence`，分别传入对应 evidence 和 results 路径。该入口沿用既有重建脚本，不属于默认测试或发布链路。

证据文件缺失、格式无效或已存在的报告与重建结果不一致时，命令以非零状态退出，不会将缺失材料视为验证成功。不存在的输出文件会被创建；已有报告只接受逐字一致的重建结果，不覆盖差异。

不要提交凭据、原始会话或 encrypted checkpoint。历史证据的可用性与报告的算术正确性是不同的验收项。
