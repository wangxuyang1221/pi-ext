import assert from "node:assert/strict";
import { test } from "vitest";
import {
  truncateToVisualLines,
  type Theme,
} from "@earendil-works/pi-coding-agent";

import {
  getExactVisualLines,
  getExactVisualTail,
} from "../src/exact-visual-tail.js";

function createTheme(): Theme {
  return {
    fg: (_name: string, text: string) => `\x1b[38;5;250m${text}\x1b[39m`,
  } as Theme;
}

const theme = createTheme();

test("exact visual tail matches Pi text layout byte for byte", () => {
  const cases = [
    ["short"],
    ["one", "two", "three", "four", "five", "six"],
    ["a long ASCII token without convenient wrapping boundaries"],
    ["word wrapped around spaces and punctuation: alpha/beta gamma"],
    ["状态行", "组合 e\u0301", "emoji 👩🏽‍💻 end"],
    ["tab\tseparated", "", "after blank"],
  ];

  for (const physicalLines of cases) {
    const styled = physicalLines.map((line) => theme.fg("toolOutput", line)).join("\n");
    for (const width of [1, 2, 3, 8, 20, 80]) {
      const expected = truncateToVisualLines(styled, 5, width);
      const styleLine = (line: string) => theme.fg("toolOutput", line);
      const actual = getExactVisualTail(physicalLines, styleLine, width, 5);
      assert.deepEqual(actual, expected, `width=${width}, input=${JSON.stringify(physicalLines)}`);

      const expectedExpanded = truncateToVisualLines(styled, Number.MAX_SAFE_INTEGER, width);
      assert.deepEqual(
        getExactVisualLines(physicalLines, styleLine, width),
        expectedExpanded.visualLines,
        `expanded width=${width}, input=${JSON.stringify(physicalLines)}`,
      );
    }
  }
});
