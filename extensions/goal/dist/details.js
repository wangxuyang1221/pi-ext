import { matchesKey, stripTerminalSequences, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
/** Scrollable, immutable opening snapshot. No timer and no storage access. */
export class GoalDetails {
    body;
    actions;
    getTheme;
    height;
    done;
    refresh;
    offset = 0;
    rows = 1;
    cached;
    constructor(body, actions, getTheme, height, done, refresh) {
        this.body = body;
        this.actions = actions;
        this.getTheme = getTheme;
        this.height = height;
        this.done = done;
        this.refresh = refresh;
    }
    render(width) {
        if (width < 1)
            return [];
        const theme = this.getTheme();
        if (this.cached?.width !== width)
            this.cached = {
                width,
                lines: wrapTextWithAnsi(stripTerminalSequences(this.body).replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, " "), Math.max(1, width - 2)),
            };
        this.rows = Math.max(1, this.height() - 5);
        this.offset = Math.min(this.offset, Math.max(0, this.cached.lines.length - this.rows));
        const hints = [this.actions.pause ? "[p] Pause" : "", this.actions.resume ? "[r] Resume" : "", "[esc] Close"].filter(Boolean).join("   ");
        return [
            ` ${theme.bold("Goal details")} ${theme.fg("dim", "· opening snapshot")}`,
            theme.fg("dim", " Reopen to refresh exact time. ↑↓ / PgUp / PgDn to scroll."),
            "",
            ...this.cached.lines.slice(this.offset, this.offset + this.rows).map(line => ` ${line}`),
            "",
            ` ${theme.fg("accent", hints)}`,
        ].map(line => truncateToWidth(line, width, "…"));
    }
    handleInput(data) {
        if (matchesKey(data, "escape") || matchesKey(data, "enter")) {
            this.done(undefined);
            return;
        }
        if (data === "p" && this.actions.pause) {
            this.done("pause");
            return;
        }
        if (data === "r" && this.actions.resume) {
            this.done("resume");
            return;
        }
        const previous = this.offset;
        if (matchesKey(data, "down"))
            this.offset++;
        else if (matchesKey(data, "up"))
            this.offset--;
        else if (matchesKey(data, "pageDown"))
            this.offset += this.rows;
        else if (matchesKey(data, "pageUp"))
            this.offset -= this.rows;
        this.offset = Math.max(0, Math.min(this.offset, Math.max(0, (this.cached?.lines.length ?? 0) - this.rows)));
        if (previous !== this.offset)
            this.refresh();
    }
    invalidate() { this.cached = undefined; }
}
//# sourceMappingURL=details.js.map