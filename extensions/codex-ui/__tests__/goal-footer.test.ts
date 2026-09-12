import { expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { CodexFooter } from "../src/footer.js";
import { readGoalDisplay } from "../src/goal-display.js";

it("accepts only bounded current-session display fields", () => {
  const value = { version: 1, ownerSessionId: "s", goalId: "g", objective: "\x1b[31m目标\x1b[0m\n", status: "active", summary: "Active · <1m", history: "should not be forwarded" };
  const display = readGoalDisplay(value, "s");
  expect(display?.objective).toBe("目标 ");
  expect(display).not.toHaveProperty("history");
  expect(readGoalDisplay(value, "other")).toBeUndefined();
  expect(readGoalDisplay({ ...value, version: 2 }, "s")).toBeUndefined();
  expect(readGoalDisplay({ ...value, goalId: "g".repeat(257) }, "s")).toBeUndefined();
  expect(readGoalDisplay({ ...value, objective: "x".repeat(2049) }, "s")).toBeUndefined();
});

it("renders structured goal rows without recomputing the unchanged model line", () => {
  let theme = { fg: vi.fn((_tone, text) => text), bold: (text: string) => text, getColorMode: () => "256color" } as unknown as Theme;
  let goal = { version: 1 as const, ownerSessionId: "s", goalId: "g", objective: "中文目标".repeat(80), status: "active", summary: "Active · 12m · 12.3k / 80k tokens" };
  const footer = new CodexFooter({ cwd: "/repo", getModelId: () => "model", getThinkingLevel: () => "off", getContextUsage: () => undefined, getBranch: () => "main", getExtensionStatuses: () => new Map([["goal", "native fallback"]]), getTheme: () => theme, getGoalDisplay: () => goal });
  const first = footer.render(80);
  expect(first).toHaveLength(3);
  expect(first.map(stripTerminalSequences).join("\n")).toContain("Active · 12m");
  expect(footer.render(80)).toBe(first);
  vi.mocked(theme.fg).mockClear();
  goal = { ...goal, summary: "Active · 13m · 12.3k / 80k tokens" };
  const next = footer.render(80);
  expect(next[0]).toBe(first[0]);
  expect(next[2]).toContain("13m");
  expect(vi.mocked(theme.fg).mock.calls.every(([, text]) => !text.includes("main"))).toBe(true);
  for (const width of [1, 16, 40, 120]) expect(footer.render(width).every(line => visibleWidth(line) <= width)).toBe(true);
  const beforeTheme = footer.render(80);
  theme = { ...theme, bold: text => `[${text}]` };
  expect(footer.render(80)).not.toBe(beforeTheme);
  expect(footer.render(80)[1]).toContain("[Goal]");
  footer.invalidate();
  expect(footer.render(80)[2]).toContain("13m");
});
