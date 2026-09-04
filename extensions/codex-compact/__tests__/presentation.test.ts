import { expect, test, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

import { createCompactionWidget } from "../src/presentation.js";

test("compaction widget animates above a balanced trailing spacer and disposes its timer", () => {
	vi.useFakeTimers();
	try {
		const requestRender = vi.fn();
		const tui = { requestRender } as unknown as TUI;
		const theme = {
			fg: (_color: string, text: string) => text,
		} as unknown as Theme;
		const component = createCompactionWidget()(tui, theme) as {
			render(width: number): string[];
			dispose(): void;
		};

		expect(component.render(80)).toEqual([
			"⠋ Compacting context... (esc to cancel)",
			"",
		]);
		vi.advanceTimersByTime(80);
		expect(requestRender).toHaveBeenCalledTimes(1);
		expect(component.render(80)[0]).toMatch(/^⠙ Compacting context/u);

		component.dispose();
		vi.advanceTimersByTime(240);
		expect(requestRender).toHaveBeenCalledTimes(1);
	} finally {
		vi.useRealTimers();
	}
});

test("compaction widget truncates its message without removing the trailing spacer", () => {
	const component = createCompactionWidget()(
		{ requestRender() {} } as unknown as TUI,
		{ fg: (_color: string, text: string) => text } as unknown as Theme,
	) as { render(width: number): string[]; dispose(): void };
	try {
		const lines = component.render(12);
		expect(lines).toHaveLength(2);
		expect(lines[0]?.replace(/\x1b\[[0-9;]*m/gu, "")).toBe("⠋ Compacting");
		expect(lines[1]).toBe("");
	} finally {
		component.dispose();
	}
});
