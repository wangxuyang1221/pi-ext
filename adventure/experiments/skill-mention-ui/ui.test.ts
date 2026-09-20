import { expect, it } from "vitest";
import { Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";
import { initTheme, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { completionReference } from "../../../extensions/skill-mentions/src/references.js";
import { knownReferences, openStyle, sample, styleEditorLines, styleMarkdown } from "./ui.js";

const names = new Set(["presentations", "lark-doc"]);
it("styles complete known references next to punctuation but keeps strict completion", () => {
  expect(knownReferences(sample, names).map(reference => reference.name)).toEqual(["presentations", "lark-doc"]);
  expect(completionReference("$presentations,", 14)).toBeUndefined();
  const styled = styleMarkdown(sample, names, "tint");
  initTheme("dark", false);
  const rendered = new Markdown(styled, 0, 0, getMarkdownTheme()).render(104).map(stripTerminalSequences);
  expect(rendered[0].trimEnd()).toBe(sample.split("\n")[0]);
  expect(styled.split(openStyle("tint"))).toHaveLength(3);
});

it("decorates editor output without changing text, cursor markers or excluded mentions", () => {
  const marker = "\x1b_pi:c\x07";
  const lines = ["────", "  $pre" + marker + "\x1b[7ms\x1b[27mentations, 和 $lark-doc，这两个 skill 做啥的？  ", "  $unknown  ` $presentations `  \\$lark-doc  ", "────"];
  const result = styleEditorLines(lines, sample, names, "accent");
  expect(result.map(stripTerminalSequences)).toEqual(lines.map(stripTerminalSequences));
  expect(result[1]).toContain(openStyle("accent"));
  expect(result[1]).toContain(marker);
  expect(result[2]).toBe(lines[2]);
  expect(result[0]).toBe(lines[0]);
});
