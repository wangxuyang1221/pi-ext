const CLAUDE_BLOCK_SYNTAX_START = /^(?: {4}|\t|[ \t]*(?:#{1,6}(?:[ \t]|$)|>|`{3,}|~{3,}|[-+*][ \t]+|\d{1,9}[.)][ \t]+|\|))/u;
const CLAUDE_SETEXT_HEADING = /^[^\r\n]+\r?\n[ \t]*(?:=+|-+)[ \t]*(?:\r?\n|$)/u;
const THEMATIC_BREAK = /^([ \t]*)([-*_])(?:[ \t]*\2){2,}[ \t]*$/u;
function leadingIndent(line: string): number {
  let width = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 3;
    else break;
  }
  return width;
}

function startsWithMarkdownBlock(text: string): boolean {
  if (CLAUDE_BLOCK_SYNTAX_START.test(text) || CLAUDE_SETEXT_HEADING.test(text)) {
    return true;
  }
  const firstLine = text.split(/\r?\n/u, 1)[0] ?? "";
  return leadingIndent(firstLine) >= 4 || THEMATIC_BREAK.test(firstLine);
}

function formatClaudeUserMarkdown(markdown: string): string {
  if (!markdown.trim()) return markdown;
  const trimmedStart = markdown.replace(/^(?:\r?\n)+/u, "");
  if (trimmedStart.startsWith("❯ ") || trimmedStart.startsWith("❯\n")) return markdown;
  if (startsWithMarkdownBlock(trimmedStart)) {
    return `❯\n\n${trimmedStart}`;
  }
  return `❯ ${trimmedStart}`;
}

function formatClaudeAssistantMarkdown(markdown: string): string {
  if (!markdown.trim()) return markdown;
  const trimmedStart = markdown.replace(/^(?:\r?\n)+/u, "");
  if (trimmedStart.startsWith("● ") || startsWithMarkdownBlock(trimmedStart)) {
    return markdown;
  }
  return `● ${trimmedStart}`;
}

function formatClaudeThinkingMarkdown(markdown: string): string {
  if (!markdown.trim()) return markdown;
  return `∴ Thinking…\n\n${markdown.replace(/^\r?\n+/u, "")}`;
}


export function formatMarkdown(markdown: string, context: { messageType: string }): string {
  if (context.messageType === "user") return formatClaudeUserMarkdown(markdown);
  if (context.messageType === "assistant") return formatClaudeAssistantMarkdown(markdown);
  if (context.messageType === "assistant-thinking") return formatClaudeThinkingMarkdown(markdown);
  return markdown;
}
