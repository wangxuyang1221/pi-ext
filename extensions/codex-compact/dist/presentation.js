import { truncateToWidth, } from "@earendil-works/pi-tui";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;
const MESSAGE = "Compacting context... (esc to cancel)";
class CompactionProgress {
    tui;
    theme;
    frameIndex = 0;
    timer;
    constructor(tui, theme) {
        this.tui = tui;
        this.theme = theme;
        this.timer = setInterval(() => {
            this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
            this.tui.requestRender();
        }, SPINNER_INTERVAL_MS);
        this.timer.unref?.();
    }
    render(width) {
        const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
        const frame = SPINNER_FRAMES[this.frameIndex] ?? SPINNER_FRAMES[0];
        const line = `${this.theme.fg("accent", frame)} ${this.theme.fg("muted", MESSAGE)}`;
        return [truncateToWidth(line, safeWidth, ""), ""];
    }
    invalidate() { }
    dispose() {
        clearInterval(this.timer);
    }
}
export function createCompactionWidget() {
    return (tui, theme) => new CompactionProgress(tui, theme);
}
//# sourceMappingURL=presentation.js.map