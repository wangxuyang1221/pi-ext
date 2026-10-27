import { expect, test } from "vitest";
import { hasSuccessfulPaneExit } from "../tmux-exit.js";

function stat(state: string, status: number): string {
  return `3260 (pi (worker)) ${state} ${Array(48).fill("0").join(" ")} ${status}\n`;
}

test("recognizes an exited Linux pane before tmux reaps its successful child", () => {
  expect(hasSuccessfulPaneExit("1\t\n", stat("Z", 0))).toBe(true);
  expect(hasSuccessfulPaneExit("1\t0\n")).toBe(true);
});

test("rejects running, failed, signaled, and unknown exits", () => {
  expect(hasSuccessfulPaneExit("1\t\n", stat("S", 0))).toBe(false);
  expect(hasSuccessfulPaneExit("1\t\n", stat("Z", 256))).toBe(false);
  expect(hasSuccessfulPaneExit("1\t\n", stat("Z", 9))).toBe(false);
  expect(hasSuccessfulPaneExit("0\t\n", stat("Z", 0))).toBe(false);
  expect(hasSuccessfulPaneExit("1\t1\n", stat("Z", 0))).toBe(false);
  expect(hasSuccessfulPaneExit("1\t\n")).toBe(false);
  expect(hasSuccessfulPaneExit("1\t\n", "3260 (pi) Z 0")).toBe(false);
});
