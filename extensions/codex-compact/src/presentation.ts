import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	truncateToWidth,
	type Component,
	type TUI,
} from "@earendil-works/pi-tui";

export type CompactionWidgetFactory = (tui: TUI, theme: Theme) => Component;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SPINNER_INTERVAL_MS = 80;
const MESSAGE = "Compacting context... (esc to cancel)";

class CompactionProgress implements Component {
	private frameIndex = 0;
	private readonly timer: ReturnType<typeof setInterval>;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
	) {
		this.timer = setInterval(() => {
			this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
			this.tui.requestRender();
		}, SPINNER_INTERVAL_MS);
		(this.timer as { unref?: () => void }).unref?.();
	}

	render(width: number): string[] {
		const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
		const frame = SPINNER_FRAMES[this.frameIndex] ?? SPINNER_FRAMES[0];
		const line = `${this.theme.fg("accent", frame)} ${this.theme.fg("muted", MESSAGE)}`;
		return [truncateToWidth(line, safeWidth, ""), ""];
	}

	invalidate(): void {}

	dispose(): void {
		clearInterval(this.timer);
	}
}

export function createCompactionWidget(): CompactionWidgetFactory {
	return (tui, theme) => new CompactionProgress(tui, theme);
}
