function trimBlankLines(text) {
    return text.replace(/^(?:[ \t]*\r?\n)+/u, "").trimEnd();
}
/** Format completed thinking for display without modifying persisted messages. */
export function reasoningHistoryMarkdown(markdown) {
    const trimmed = trimBlankLines(markdown);
    if (!trimmed)
        return "";
    // A sequence of standalone titles is not a leading title followed by prose.
    const titleLines = trimmed.split(/\r?\n/u).filter(line => line.trim().length > 0);
    if (titleLines.length > 1 && titleLines.every(line => /^\*\*[^*]+\*\*[ \t]*$/u.test(line))) {
        return titleLines.map(line => `• ${line.trimEnd()}`).join("\n\n");
    }
    const leading = trimmed.match(/^\*\*[^*]+\*\*\r?\n([\s\S]*)$/u);
    const body = (leading && trimBlankLines(leading[1])) || (trimmed.startsWith("**") && !trimmed.slice(2).includes("**")
        ? trimBlankLines(trimmed.slice(2)) : trimmed);
    if (!body)
        return "";
    // Keep fenced code, headings, lists, quotes and tables recognizable by native Markdown.
    const startsBlock = /^(?: {0,3}(?:`{3,}|~{3,}|#{1,6}\s|[-+*]\s|\d+[.)]\s|>|\|)| {4}|\t)/u.test(body);
    return startsBlock ? `•\n\n${body}` : `• ${body}`;
}
//# sourceMappingURL=reasoning-history.js.map