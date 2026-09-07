import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { ReasoningTitle } from "../src/reasoning-title.js";

test("incremental titles match the first closed star title across every chunk boundary", () => {
  const values = ["**Computing the ratio**\n\nBody", "prefix ***Title** body", "** ** then **Later**", "**a*b**c**", "****Title**", "**未闭合", "no title"];
  for (const text of values) {
    const expected = text.match(/\*\*([^*]+)\*\*/u)?.[1]?.replace(/\s+/gu, " ").trim() || undefined;
    for (let split = 0; split <= text.length; split++) {
      const title = new ReasoningTitle();
      title.read(text.slice(0, split), text.slice(0, split));
      assert.equal(title.read(text, text.slice(split)), expected, `Split ${split}: ${text}`);
    }
  }
});

test("title scanning is linear before closure and stops scanning later body text", () => {
  const title = new ReasoningTitle();
  let text = "";
  const scan = vi.spyOn(String.prototype, "charCodeAt");
  try {
    for (let index = 0; index < 64; index++) {
      const delta = "No heading here. ".repeat(100);
      text += delta; title.read(text, delta);
    }
    assert.equal(scan.mock.calls.length, text.length);
    text += "**Title**";
    assert.equal(title.read(text, "**Title**"), "Title");
    const before = scan.mock.calls.length;
    for (let index = 0; index < 64; index++) {
      text += " body";
      assert.equal(title.read(text, " body"), "Title");
    }
    assert.equal(scan.mock.calls.length, before);
    assert.equal(title.read("**Replacement**", "**Replacement**"), "Replacement");
    title.reset();
    assert.equal(title.read("**Partial", "**Partial"), undefined);
  } finally { scan.mockRestore(); }
});
