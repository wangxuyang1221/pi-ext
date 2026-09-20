# Reference boundary verification

## Decision and scope

[Planning #5](https://github.com/wangxuyang1221/pi-ext/issues/5) 的有效规则移交 [Spec](https://github.com/wangxuyang1221/pi-ext/issues/2#references-and-boundaries)，此处仅记录验证依据。用户选择常用句读与闭合符号，随后确认英文句点紧接名称字符时不激活，避免 `$research.md` 误触。不是采用所有 Unicode 标点，也不扩大左侧或候选边界。

## Source verification

基于提交 `08118e2` 的 `extensions/skill-mentions/src/references.ts`。当前产品用相同的 `boundary` 约束左侧和右侧，`completionReference` 又调用 `findReferences`。名称字符是 Unicode 字母、数字、下划线和连字符，不含句点。因此只放宽共享边界会同时误放宽候选，并将文件名式文本截为引用。

最小可行方案是保留左侧条件，独立判断激活右侧，并在补全入口再次施加严格右侧条件。保留原有 Markdown token 排除、原文位置和名称完整匹配，不在原输入中把标点替换为空白。

## Probe

运行：

```bash
node --experimental-strip-types adventure/experiments/skill-reference-boundaries/verify.mjs
```

实验读取真实产品解析器，为临时副本注入右侧判定与严格补全过滤，再运行原有 Markdown 过滤路径。脚本对替换点做唯一性检查，结束自动删除 `.tmp/reference-boundaries-*`。未改产品或生成的 dist，也未调用模型或联网服务。

结果：Node 22.22.2，89 项断言通过。覆盖：

- 明确列出的每个句读/闭合符号允许激活，但不弹候选。
- 英文句点位于末尾或后接空白时允许；后接字母、数字、下划线、连字符时拒绝，包含中文及非 BMP 字符。
- 路径分隔符、`@`、`#`、`+`、`=`、紧贴左侧正文、左括号、反斜线转义、CR/NBSP 不获得新豁免。
- 行内代码、普通围栏和引用容器中的围栏继续排除；代码后的正文可识别。
- 带连字符/下划线的完整名称、重复名称、多行和返回的原文范围保持一致。
- 原有候选末尾匹配与名称中间光标限制保留。

## Limits and deferred verification

该实验支持解析分离的可行性，不等于生产实现或完整验收。未读取 skill 文件，不验证加载成功、队列、标签或历史渲染。未知名称、去重、消费时加载等沿用旧规则，正式实施时需补受影响的端到端回归及完整边界测试。

本次 `pnpm run check` 结果写入存档。既有 MCP 缺文件失败不属于本关修复范围。
