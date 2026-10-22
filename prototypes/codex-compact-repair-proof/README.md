# Repair research baseline

这些探针针对基线 commit `8667f5fdd41419f7475e5dc5a2421cef19dfccb0`、Pi `1.3.0`，包含“断言旧缺陷仍存在”的检查。`evidence.json` 保留研究时的 36 组结果，不作为生产修复的验收。

修复后的代码可能使原探针失败，这是预期差异。不要在当前工作区运行探针后覆盖原始 evidence，也不要把它仍然通过解释为修复完成。后续验收使用 `extensions/codex-compact/__tests__/` 中的正式测试；实现状态和边界见 [repair todo](../../docs/codex-compact-plugin-repair-todo.md#implementation-record)。
