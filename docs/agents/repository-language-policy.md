# Repository Language Policy

## Default Policy

本 policy 适用于本 repo 中由 agent 创建、修改或发布的 text artifacts；未覆盖的 artifact 或 partition 默认使用英文。

| Artifact / Partition | Language |
| --- | --- |
| metadata / frontmatter | English |
| document title | English |
| section headings | English |
| agent-facing prose / instruction text, such as setup instructions, `AGENTS.md` / `CLAUDE.md` rule text, skill body prose, and agent config reference blocks | Chinese |
| document body text | Chinese |
| terms / glossary entries | English term + Chinese explanation |
| examples | Follow surrounding context |
| code blocks | Keep source language |
| source code comments | English |
| API documentation comments / doc comments for public functions, classes, methods, modules, endpoints, and exported APIs | English |
| log messages | English |
| structured log keys | English |
| variable / function / class names | English |
| test names | English |
| assertion messages | English |
| user-facing product copy | English by default |
| commands / paths / config keys / API names / identifiers | Keep original |
| quoted source text | Keep original, then explain in Chinese when needed |
| issue title / PR title | Chinese |
| issue body / PR description | Chinese |
| commit message subject / body / footer | Chinese, while Conventional Commit type and scope stay English |
| labels / branch names / commit hashes | Keep original |
