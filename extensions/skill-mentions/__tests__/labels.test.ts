import { expect, it } from "vitest";
import { visibleWidth, stripTerminalSequences } from "@earendil-works/pi-tui";
import { labelReferences, layoutLabels, paintLabels } from "../src/labels.js";

it("recognizes only complete known references using the activation parser", () => {
  const text = "$alpha. `$alpha` \\$alpha $missing $alpha.md\n$alpha，继续";
  expect(labelReferences(text, new Set(["alpha"]))).toEqual([
    { start: 0, end: 6, name: "alpha" },
    { start: text.lastIndexOf("$alpha"), end: text.lastIndexOf("$alpha") + 6, name: "alpha" },
  ]);
});

it("defers an unfinished handwritten reference but accepts explicit source completion", () => {
  expect(labelReferences("$alpha", new Set(["alpha"]), 6)).toEqual([]);
  expect(labelReferences("$alpha.", new Set(["alpha"]), 7)).toHaveLength(1);
  expect(labelReferences("$alpha", new Set(["alpha"]))).toHaveLength(1);
});

it("moves a fitting label intact and wraps an oversized name without truncation", () => {
  const text = "123 $alpha";
  const lines = layoutLabels(text, labelReferences(text, new Set(["alpha"])), "command", 8);
  expect(lines.map(line => stripTerminalSequences(line.text))).toEqual(["123 ", "⌘alpha"]);
  const long = "$" + "a".repeat(64);
  const wrapped = layoutLabels(long, labelReferences(long, new Set(["a".repeat(64)])), "cube", 8);
  expect(wrapped.map(line => stripTerminalSequences(line.text)).join("")).toBe("\u{f01a7}" + "a".repeat(64));
  expect(wrapped.every(line => visibleWidth(line.text) <= 8)).toBe(true);
});

it("projects normal-weight cyan without changing the task or adding background escapes", () => {
  const text = "**$alpha** $alpha.";
  const painted = paintLabels(text, labelReferences(text, new Set(["alpha"])), "command");
  expect(painted).toContain("\x1b[22m\x1b[38;2;141;249;253m⌘alpha");
  expect(painted).not.toMatch(/\x1b\[(?:4[0-9]|48)[;m]/);
  expect(text).toBe("**$alpha** $alpha.");
});
