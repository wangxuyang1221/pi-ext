import { expect, it } from "vitest";
import { visibleWidth, stripTerminalSequences } from "@earendil-works/pi-tui";
import { icons, labelReferences, layoutLabels, paintLabels } from "../src/labels.js";
import { projectedCursor, paintEditorLine } from "../src/editor-surface.js";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";

it.each(["cube", "command"] as const)("retains prototype spacing and source boundaries in %s projections", mode => {
  const source = "x  $alpha  $alpha.", refs = labelReferences(source, new Set(["alpha"]));
  const expected = `x   ${icons[mode]} alpha    ${icons[mode]} alpha .`;
  const lines = layoutLabels(source, refs, mode, 80);
  expect.soft(stripTerminalSequences(paintLabels(source, refs, mode))).toBe(expected);
  expect.soft(lines.map(line => stripTerminalSequences(line.text)).join("")).toBe(expected);
  for (const [offset, column] of [[3, 3], [9, 12], [11, 14], [17, 23], [18, 24]]) {
    expect.soft(projectedCursor(lines, offset)).toEqual({ row: 0, column });
    const painted = paintEditorLine(lines[0], offset, true).split(CURSOR_MARKER);
    expect.soft(visibleWidth(painted[0])).toBe(column);
    expect.soft(painted).toHaveLength(2);
  }
  expect(source).toBe("x  $alpha  $alpha.");
});

it.each(["cube", "command"] as const)("keeps the caret outside wrapped display-only spacing in %s", mode => {
  for (const width of [1, 2, 3, 4, 8, 9, 10]) {
    const source = "$alpha", lines = layoutLabels(source, labelReferences(source, new Set(["alpha"])), mode, width);
    expect.soft(projectedCursor(lines, 0)).toEqual({ row: 0, column: 0 });
    expect.soft(projectedCursor(lines, source.length)).toEqual({ row: Math.ceil(9 / width) - 1, column: 9 % width || width });
    expect(lines.map(line => stripTerminalSequences(line.text)).join("")).toBe(` ${icons[mode]} alpha `);
    expect(lines.every(line => visibleWidth(line.text) <= width)).toBe(true);
  }
  const source = "$alpha\n\n$beta", lines = layoutLabels(source, labelReferences(source, new Set(["alpha", "beta"])), mode, 9);
  expect(projectedCursor(lines, 6)).toEqual({ row: 0, column: 9 });
  expect(projectedCursor(lines, 7)).toEqual({ row: 1, column: 0 });
  expect(projectedCursor(lines, 8)).toEqual({ row: 2, column: 0 });
});

it.each(["cube", "command"] as const)("adds only three display cells to complete long %s labels", mode => {
  for (const size of [64, 256, 1024]) {
    const name = "a".repeat(size), source = "$" + name;
    for (const width of [8, 16, 80, 120]) {
      const lines = layoutLabels(source, labelReferences(source, new Set([name])), mode, width);
      expect(lines.map(line => stripTerminalSequences(line.text)).join("")).toBe(` ${icons[mode]} ${name} `);
      expect(lines.reduce((count, line) => count + line.cells.length, 0)).toBe(source.length + 3);
      expect(lines.every(line => visibleWidth(line.text) <= width)).toBe(true);
      expect(projectedCursor(lines, 0)).toEqual({ row: 0, column: 0 });
      expect(projectedCursor(lines, source.length)).toEqual({ row: Math.ceil((size + 4) / width) - 1, column: (size + 4) % width || width });
    }
  }
});

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
  const lines = layoutLabels(text, labelReferences(text, new Set(["alpha"])), "command", 9);
  expect(lines.map(line => stripTerminalSequences(line.text))).toEqual(["123 ", " ⌘ alpha "]);
  const long = "$" + "a".repeat(64);
  const wrapped = layoutLabels(long, labelReferences(long, new Set(["a".repeat(64)])), "cube", 8);
  expect(wrapped.map(line => stripTerminalSequences(line.text)).join("")).toBe(" \u{f01a7} " + "a".repeat(64) + " ");
  expect(wrapped.every(line => visibleWidth(line.text) <= 8)).toBe(true);
});

it("projects normal-weight cyan without changing the task or adding background escapes", () => {
  const text = "**$alpha** $alpha.";
  const painted = paintLabels(text, labelReferences(text, new Set(["alpha"])), "command");
  expect(painted).toContain("\x1b[22m\x1b[38;2;141;249;253m ⌘ alpha ");
  expect(painted).not.toMatch(/\x1b\[(?:4[0-9]|48)[;m]/);
  expect(text).toBe("**$alpha** $alpha.");
});
