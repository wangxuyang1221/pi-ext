import { stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { SummaryScanner } from "./reasoning-summary-scan.js";
function formatSummary(title, width) {
    if (!title || !Number.isFinite(width) || width < 1)
        return "";
    const clean = stripTerminalSequences(title).replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim();
    if (!clean)
        return "";
    const line = stripTerminalSequences(truncateToWidth(`• ${clean}`, Math.floor(width), "…"));
    // Escaped brackets are also native LaTeX delimiters. Preserve these titles literally.
    if (/[\[\]()\\]/u.test(line)) {
        let longest = 0;
        for (const match of line.matchAll(/`+/gu))
            longest = Math.max(longest, match[0].length);
        const ticks = "`".repeat(longest + 1);
        return `${ticks} ${line} ${ticks}`;
    }
    return line.replace(/[\\`*_{}#+.!<>|~=-]/gu, "\\$&");
}
/** Display-only, bounded content memoization; message lifecycle never changes the output. */
export class ReasoningSummary {
    maxEntries;
    maxChars;
    entries = new Map();
    retainedChars = 0;
    previous;
    constructor(maxEntries = 32, maxChars = 256 * 1024) {
        this.maxEntries = maxEntries;
        this.maxChars = maxChars;
    }
    clear() {
        this.entries.clear();
        this.retainedChars = 0;
        this.previous = undefined;
    }
    render(markdown, width) {
        // Native Markdown may recreate an equal source string on every paint. Avoid hashing it again.
        if (this.previous?.text === markdown)
            return this.format(this.previous, width);
        let entry = this.entries.get(markdown);
        if (entry) {
            this.entries.delete(markdown);
            this.entries.set(markdown, entry);
        }
        else {
            const previous = this.previous;
            const extendsPrevious = previous && markdown.length > previous.text.length && markdown.startsWith(previous.text);
            const scanner = extendsPrevious ? previous.scanner.clone() : new SummaryScanner();
            scanner.append(markdown, extendsPrevious ? previous.text.length : 0);
            entry = { text: markdown, scanner, title: scanner.getTitle(markdown) };
            if (extendsPrevious) {
                this.entries.delete(previous.text);
                this.retainedChars -= previous.text.length;
            }
            if (this.maxEntries > 0 && markdown.length <= this.maxChars) {
                this.entries.set(markdown, entry);
                this.retainedChars += markdown.length;
                while (this.entries.size > this.maxEntries || this.retainedChars > this.maxChars) {
                    const oldest = this.entries.keys().next().value;
                    this.entries.delete(oldest);
                    this.retainedChars -= oldest.length;
                }
            }
        }
        this.previous = this.entries.get(markdown);
        return this.format(entry, width);
    }
    format(entry, width) {
        if (entry.width !== width || entry.output === undefined) {
            entry.width = width;
            entry.output = formatSummary(entry.title, width);
        }
        return entry.output;
    }
}
//# sourceMappingURL=reasoning-summary.js.map