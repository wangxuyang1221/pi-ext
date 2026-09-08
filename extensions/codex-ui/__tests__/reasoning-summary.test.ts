import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { ReasoningSummary } from "../src/reasoning-summary.js";
import { SummaryScanner } from "../src/reasoning-summary-scan.js";

test("summary reuse is width independent and only scans appended content", () => {
  const append = vi.spyOn(SummaryScanner.prototype, "append");
  try {
    const summary = new ReasoningSummary();
    let text = "**First title**\n\n";
    assert.equal(summary.render(text, 120), "• First title");
    const before = append.mock.calls.length;
    for (let i = 0; i < 100; i++) summary.render(text, i % 2 ? 30 : 120);
    assert.equal(append.mock.calls.length, before, "Repeated paints and width changes must reuse parsed titles");
    for (const delta of [...Array<string>(64).fill("body ".repeat(200)), "\n\n*", "*Second", " title*", "*"]) {
      const offset = text.length;
      text += delta;
      summary.render(text, 120);
      assert.equal(append.mock.calls.at(-1)?.[1], offset, "Only the verified appended suffix needs parsing");
    }
    assert.equal(summary.render(text, 120), "• Second title");
  } finally { append.mockRestore(); }
});

test("bounded cache evicts entries and oversized sources and clears explicitly", () => {
  const append = vi.spyOn(SummaryScanner.prototype, "append");
  try {
    for (const summary of [new ReasoningSummary(2, 100), new ReasoningSummary(20, 10)]) {
      summary.render("**A**", 30);
      summary.render("**B**", 30);
      summary.render("**C**", 30);
      const before = append.mock.calls.length;
      assert.equal(summary.render("**A**", 30), "• A");
      assert.equal(append.mock.calls.length, before + 1);
      summary.clear();
      summary.render("**A**", 30);
      assert.equal(append.mock.calls.length, before + 2);
    }
    const small = new ReasoningSummary(2, 8);
    const text = "**Oversized**";
    small.render(text, 30);
    const before = append.mock.calls.length;
    small.render(text, 30);
    assert.equal(append.mock.calls.length, before + 1);
  } finally { append.mockRestore(); }
});

test("incremental and cold summaries agree for every prefix and interleaved snapshots", () => {
  const sources = [
    "**First**\n\n**Second** prose\n\n**Third**\r\nBody\n**Partial",
    "plain body\n\t**检查 👩🏽‍💻 é**\n**invalid*title**\n**Last**",
    "**A**\n**B**\r\n**C**\n**D** inline\n**E**",
  ];
  const warm = new ReasoningSummary();
  for (const source of sources) {
    for (let end = 0; end <= source.length; end++) {
      const text = source.slice(0, end);
      assert.equal(warm.render(text, 60), new ReasoningSummary().render(text, 60), text);
      if (end % 7 === 0) warm.render("**Unrelated**", 30);
    }
  }
  assert.equal(warm.render("**First**\n**Second** prose", 60), "• First");
  assert.equal(warm.render("**Same**", 60), "• Same");
  assert.equal(warm.render("**Else**", 60), "• Else");
  assert.equal(warm.render("body **inline**", 60), "");
});

test("summary rejects invalid widths and strips terminal controls", () => {
  const summary = new ReasoningSummary();
  for (const width of [NaN, Infinity, -1, 0]) assert.equal(summary.render("**Title**", width), "");
  assert.equal(summary.render("**\x1b[31mTitle\x1b[0m\x07**", 120), "• Title");
});
