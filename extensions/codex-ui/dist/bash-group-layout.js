import { stripTerminalSequences, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { fitToWidth, normalizeWidth } from "./layout.js";
const presentation = {
    pending: { mark: "○", color: "dim", label: "queued" },
    running: { mark: "◌", color: "accent", label: "running" },
    completed: { mark: "✓", color: "success", label: "succeeded" },
    failed: { mark: "×", color: "error", label: "failed" },
};
function clean(text) {
    return stripTerminalSequences(text)
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\ud800-\udfff\u202a-\u202e\u2066-\u2069\ufff9-\ufffb]/gu, "")
        .replace(/\t/gu, "  ");
}
function elapsed(member) {
    return member.startedAt === undefined ? "" : `${(Math.max(0, (member.endedAt ?? Date.now()) - member.startedAt) / 1000).toFixed(1)}s`;
}
function withMetadata(left, right, width, preferredInset = 0) {
    const remaining = width - visibleWidth(left) - visibleWidth(right);
    // Spend existing whitespace, never shorten or rewrap the command for metadata padding.
    const inset = remaining >= preferredInset + 3 ? preferredInset : 0;
    return right && remaining >= 3 ? left + " ".repeat(remaining - inset) + right + " ".repeat(inset)
        : fitToWidth(left, width, { ellipsis: "…" });
}
function indent(last, width) { return width >= 16 ? last ? "        " : "  │     " : ""; }
function fingerprint(theme) {
    return ["toolOutput", "toolTitle", "borderMuted", "dim"].map(color => theme.fg(color, "x")).join("\0");
}
function physical(member) {
    const cache = member.cache;
    return cache.lines(`group-clean\0${cache.identity(member)}\0${member.outputRevision}`, () => {
        const text = (member.content ?? []).filter(block => block.type === "text" && typeof block.text === "string")
            .map(block => clean(block.text)).join("\n");
        return text ? text.split("\n") : [];
    });
}
function commandLines(member, expanded, last, theme, width) {
    const style = presentation[member.status];
    const branch = width >= 16 ? last ? "  ╰ " : "  ├ " : "";
    const prefix = width >= 8 ? `${theme.fg("borderMuted", branch)}${theme.fg(style.color, style.mark)} ${theme.fg("dim", "$ ")}` : "";
    const duration = member.status === "pending" ? "queued" : expanded && member.status === "running" ? "" : elapsed(member);
    const meta = member.status === "failed" ? theme.fg("warning", duration)
        : !duration || member.status === "pending" ? theme.fg("dim", duration)
            : theme.fg("muted", duration.slice(0, -1)) + theme.fg("dim", "s");
    const reserve = width >= 64 && duration ? visibleWidth(meta) + 3 : 0;
    const available = Math.max(1, width - visibleWidth(prefix) - reserve);
    const contentWidth = expanded ? available : Math.min(120, available);
    const cache = member.cache;
    const key = ["group-command", cache.identity(member), member.commandRevision, expanded, contentWidth].join("\0");
    const commands = cache.lines(key, () => {
        const command = clean(member.command) || "…";
        return expanded ? wrapTextWithAnsi(command, contentWidth)
            : [fitToWidth(command.replace(/\n/gu, " "), contentWidth, { ellipsis: "..." })];
    });
    return commands.map((line, index) => {
        const left = (index ? theme.fg("borderMuted", indent(last, width)) : prefix) + theme.fg("toolTitle", line);
        return index === 0 && reserve ? withMetadata(left, meta, width, 2) : fitToWidth(left, width);
    });
}
function outputLines(member, expanded, last, theme, width) {
    // Do not read, clean or wrap captures until the user expands results.
    if (!expanded)
        return [];
    const cache = member.cache;
    const key = ["group-output", cache.identity(member), member.outputRevision, width, last, fingerprint(theme)].join("\0");
    const lines = cache.lines(key, () => {
        const prefix = theme.fg("borderMuted", indent(last, width));
        const contentWidth = Math.max(1, width - visibleWidth(prefix));
        return physical(member).flatMap(line => wrapTextWithAnsi(line, contentWidth))
            // Fit plain text before styling so the width pass does not parse our own ANSI.
            .map(line => `${prefix}${theme.fg("toolOutput", fitToWidth(line, contentWidth))}`);
    });
    // Empty-state wording is not part of the output cache: it changes without a new capture.
    if (lines.length === 0) {
        const empty = member.status === "pending" ? "Queued" : member.status === "running" ? "Waiting for output…" : "(no output)";
        return [fitToWidth(`${indent(last, width)}${theme.fg("toolOutput", empty)}`, width)];
    }
    return lines;
}
/** Render the accepted two-state layout with live clocks confined to the group tail. */
export function renderBashGroup(group, expanded, theme, availableWidth, toggleKeys) {
    const width = normalizeWidth(availableWidth);
    if (!width)
        return [];
    const metric = (count, label) => `${theme.fg("muted", String(count))} ${theme.fg("dim", label)}`;
    const counts = ["completed", "failed", "running", "pending"]
        .flatMap(status => group.counts[status] ? [metric(group.counts[status], presentation[status].label)] : []);
    const summary = [metric(group.members.length, group.members.length === 1 ? "command" : "commands"), ...counts]
        .join(theme.fg("borderMuted", "  ·  "));
    // Match the two cells occupied by Read/Edited's marker and following space.
    const title = `${width >= 8 ? "  " : ""}${theme.fg("toolTitle", theme.bold("Bash"))} ${theme.fg("dim", "· ")}${summary}`;
    const hint = toggleKeys ? theme.bg("selectedBg", theme.fg("muted", ` ${toggleKeys} `))
        + " " + theme.fg("dim", expanded ? "collapse" : "expand") + "  " : "";
    const lines = [withMetadata(title, hint, width)];
    group.members.forEach((member, index) => {
        const last = index === group.members.length - 1;
        if (expanded && index)
            lines.push(width >= 16 ? theme.fg("borderMuted", "  │") : "");
        for (const line of commandLines(member, expanded, last, theme, width))
            lines.push(line);
        // Do not spread large captures into push(): tiny widths can exceed the argument limit.
        for (const line of outputLines(member, expanded, last, theme, width))
            lines.push(line);
        if (member.details?.truncation?.truncated) {
            const path = member.details.fullOutputPath;
            const warning = `Truncated capture · ${path ? clean(path) : "full output unavailable"}`;
            for (const line of wrapTextWithAnsi(warning, Math.max(1, width - indent(last, width).length))) {
                lines.push(fitToWidth(`${indent(last, width)}${theme.fg("warning", line)}`, width));
            }
        }
    });
    if (expanded && group.running.size) {
        const clocks = group.members.flatMap((member, index) => member.status === "running" && member.startedAt !== undefined
            ? [`${index + 1}: ${elapsed(member)} running`] : []).join(" · ");
        if (clocks)
            for (const line of wrapTextWithAnsi(clocks, width))
                lines.push(fitToWidth(theme.fg("dim", line), width));
    }
    return lines;
}
//# sourceMappingURL=bash-group-layout.js.map