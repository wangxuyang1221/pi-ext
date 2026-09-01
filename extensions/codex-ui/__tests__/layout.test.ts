import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

import {
  fitSegments,
  fitToWidth,
  formatContextLeft,
  formatHomePath,
  normalizeWidth,
  paintBackground,
  type PrioritizedSegment,
} from "../src/layout.js";

function legacyFitSegments(
  segments: readonly PrioritizedSegment[],
  width: number,
  separator: string,
): string {
  const safeWidth = normalizeWidth(width);
  if (safeWidth === 0) return "";

  const active = segments
    .map((segment, index) => ({ ...segment, index }))
    .filter((segment) => segment.text.length > 0);
  if (active.length === 0) return "";

  const join = () => active
    .sort((left, right) => left.index - right.index)
    .map((segment) => segment.text)
    .join(separator);

  while (active.length > 1 && visibleWidth(join()) > safeWidth) {
    let removableIndex = 0;
    for (let index = 1; index < active.length; index += 1) {
      const candidate = active[index];
      const current = active[removableIndex];
      if (
        candidate.priority < current.priority
        || (candidate.priority === current.priority && candidate.index > current.index)
      ) {
        removableIndex = index;
      }
    }
    active.splice(removableIndex, 1);
  }

  return fitToWidth(join(), safeWidth);
}

function createRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

test("fitToWidth handles ANSI text and wide graphemes", () => {
  const styled = `\x1b[36m状态 ok\x1b[39m`;
  const fitted = fitToWidth(styled, 8, { pad: true });

  assert.equal(visibleWidth(fitted), 8);
  assert.match(stripTerminalSequences(fitted), /^状态 ok\s+$/u);
  assert.equal(visibleWidth(fitToWidth("abcdef", 4)), 4);
  assert.equal(fitToWidth("ignored", 0), "");
});

test("paintBackground restores background and requested modifiers after full SGR resets", () => {
  const background = "\x1b[48;2;72;72;72m";
  const modifier = "\x1b[2m";
  const rendered = paintBackground(`a\x1b[0mb`, 6, background, modifier);

  assert.equal(visibleWidth(rendered), 6);
  assert.ok(rendered.startsWith(background));
  assert.ok(rendered.includes(`\x1b[0m${background}${modifier}`));
  assert.ok(rendered.endsWith("\x1b[49m"));
});

test("fitSegments removes low-priority content before extension statuses", () => {
  const fitted = fitSegments(
    [
      { text: "model-x high", priority: 90 },
      { text: "/a/very/long/project/path", priority: 40 },
      { text: "Context 72% left", priority: 60 },
      { text: "MCP 2/2 · 14 tools", priority: 100 },
    ],
    24,
    " · ",
  );

  assert.ok(stripTerminalSequences(fitted).includes("MCP"));
  assert.ok(!stripTerminalSequences(fitted).includes("project/path"));
  assert.ok(visibleWidth(fitted) <= 24);
});

test("fitSegments preserves legacy output for ANSI and Unicode inputs", () => {
  const random = createRandom(0xc0d3c);
  const samples = [
    "",
    "plain",
    "状态",
    "emoji 👩🏽‍💻",
    "e\u0301",
    "e",
    "\u0301",
    "👩",
    "\u200d",
    "💻",
    "\x1b[38;5;81mstyled\x1b[39m",
  ];

  const nonFinitePriorities = [
    { text: "a", priority: 1 },
    { text: "b", priority: Number.NaN },
    { text: "c", priority: 0 },
  ];
  assert.equal(
    fitSegments(nonFinitePriorities, 1, " · "),
    legacyFitSegments(nonFinitePriorities, 1, " · "),
  );

  assert.equal(
    fitSegments([
      { text: "👩", priority: 1 },
      { text: "\u200d", priority: 1 },
      { text: "💻", priority: 1 },
    ], 2, ""),
    legacyFitSegments([
      { text: "👩", priority: 1 },
      { text: "\u200d", priority: 1 },
      { text: "💻", priority: 1 },
    ], 2, ""),
  );

  for (let caseIndex = 0; caseIndex < 200; caseIndex += 1) {
    const segments = Array.from({ length: 1 + Math.floor(random() * 30) }, () => ({
      text: samples[Math.floor(random() * samples.length)] ?? "",
      priority: Math.floor(random() * 5),
    }));
    const width = Math.floor(random() * 80);
    const separators = [" · ", " | ", "", "\u0301"];
    const separator = separators[Math.floor(random() * separators.length)] ?? "";
    assert.equal(
      fitSegments(segments, width, separator),
      legacyFitSegments(segments, width, separator),
      `case=${caseIndex}, width=${width}`,
    );
  }
});

test("fitSegments sorts a large status set at most twice", () => {
  const segments = Array.from({ length: 200 }, (_, index) => ({
    text: `status-${index}`,
    priority: index % 5,
  }));
  const sortSpy = vi.spyOn(Array.prototype, "sort");
  try {
    sortSpy.mockClear();
    const fitted = fitSegments(segments, 20, " · ");
    assert.ok(visibleWidth(fitted) <= 20);
    assert.ok(sortSpy.mock.calls.length <= 2);
  } finally {
    sortSpy.mockRestore();
  }
});

test("path and context labels use real bounded values", () => {
  assert.equal(formatHomePath("/Users/pi/Code/app", "/Users/pi"), "~/Code/app");
  assert.equal(formatHomePath("/Users/pilot/app", "/Users/pi"), "/Users/pilot/app");
  assert.equal(formatContextLeft({ percent: 28 }), "Context 72% left");
  assert.equal(formatContextLeft({ percent: 140 }), "Context 0% left");
  assert.equal(formatContextLeft({ percent: null }), undefined);
  assert.equal(formatContextLeft(undefined), undefined);
});
