export const TOOL_STATUS_GLYPH = "⏺";
const COLORS = { pending: "warning", running: "warning", completed: "success", failed: "error", interrupted: "warning", timed_out: "warning" };
/** Native file tools throw this exact diagnostic; ordinary prose is not a status. */
export function fileFailureStatus(content) {
    return content?.length === 1 && content[0]?.type === "text" && content[0].text === "Operation aborted"
        ? "interrupted" : "failed";
}
/** Native Bash appends a final diagnostic after a blank separator. Inspect only its bounded tail. */
export function bashFailureStatus(content) {
    const text = content.length === 1 && content[0]?.type === "text" ? content[0].text : undefined;
    const tail = typeof text === "string" ? text.slice(-256) : "";
    if (/(?:^|\n\n)Command aborted$/u.test(tail))
        return "interrupted";
    if (/(?:^|\n\n)Command timed out after \d+(?:\.\d+)? seconds$/u.test(tail))
        return "timed_out";
    return "failed";
}
export function toolStatusColor(status) {
    return COLORS[status];
}
export function toolStatusMarker(theme, status) {
    return theme.fg(toolStatusColor(status), TOOL_STATUS_GLYPH);
}
//# sourceMappingURL=tool-status.js.map