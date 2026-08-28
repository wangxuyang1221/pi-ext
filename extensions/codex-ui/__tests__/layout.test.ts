import assert from "node:assert/strict";
import { test } from "vitest";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

import {
  fitSegments,
  fitToWidth,
  formatContextLeft,
  formatHomePath,
  paintBackground,
} from "../src/layout.js";

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

test("path and context labels use real bounded values", () => {
  assert.equal(formatHomePath("/Users/pi/Code/app", "/Users/pi"), "~/Code/app");
  assert.equal(formatHomePath("/Users/pilot/app", "/Users/pi"), "/Users/pilot/app");
  assert.equal(formatContextLeft({ percent: 28 }), "Context 72% left");
  assert.equal(formatContextLeft({ percent: 140 }), "Context 0% left");
  assert.equal(formatContextLeft({ percent: null }), undefined);
  assert.equal(formatContextLeft(undefined), undefined);
});
