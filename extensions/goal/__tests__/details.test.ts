import { expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GoalDetails } from "../src/details.js";
it("renders a bounded snapshot with scrolling and only available actions", () => {
  const done = vi.fn(); const refresh = vi.fn();
  const theme = { fg: (_tone: string, text: string) => text, bold: (text: string) => text } as Theme;
  const panel = new GoalDetails("Elapsed: 12m 38s\n" + "长目标\n".repeat(100), { pause: false, resume: true }, () => theme, () => 12, done, refresh);
  const first = panel.render(40);
  expect(first.length).toBeLessThanOrEqual(12);
  expect(first.every(line => visibleWidth(line) <= 40)).toBe(true);
  expect(first.join("\n")).toContain("12m 38s");
  panel.handleInput("p"); expect(done).not.toHaveBeenCalled();
  panel.handleInput("\x1b[6~"); expect(refresh).toHaveBeenCalledTimes(1);
  expect(panel.render(40).join("\n")).not.toContain("12m 38s");
  panel.handleInput("r"); expect(done).toHaveBeenCalledWith("resume");
});
