// Synthetic content only; no real session or provider output is read.
export const thinking = [
  "**Checking the rendering boundary**",
  "The request is to change presentation, not the message itself. Keep every paragraph and let the terminal wrap it naturally.",
  "**Preserving the useful detail**",
  "A plain-text response needs the same treatment as one with headings. Inline code such as `thinking.trim()` should stay readable.",
  "中文段落同样完整保留。这里只增加引用竖线，正文斜体、颜色和换行继续遵循 Pi 原生规则。",
].join("\n\n");
export const longThinking = thinking + "\n\n" + Array.from({length: 5}, (_, i) =>
  `**Review step ${i + 1}**\n\nA longer fixture makes scrolling and folding visible. Earlier paragraphs must remain available while new content arrives. This is scripted demo text, not a model response.`).join("\n\n");
export const reply = "The complete thinking text is preserved.\n\nUse `/play` to replay streaming; `Ctrl+T` hides or shows thinking. No host patch is installed.";
export const readResult = "export const showThinking = true;\nexport const wrapThinking = true;\n";
