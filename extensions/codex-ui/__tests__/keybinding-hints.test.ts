import assert from "node:assert/strict";
import { test } from "vitest";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const { KeybindingsManager } = await import(pathToFileURL(resolve("node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js")).href);
import { bindingText, formatKeyBindings, hostKeybindingHints } from "../../../shared/ui/keybinding-hints.js";

test("legacy hints use the supplied host manager including custom and unbound keys", () => {
  const defaults = hostKeybindingHints({}, new KeybindingsManager());
  const custom = hostKeybindingHints({}, new KeybindingsManager({ "app.tools.expand": ["f3", "ctrl+e"] }));
  assert.equal(defaults.keyText("app.tools.expand"), "ctrl+o");
  assert.equal(custom.keyHint("app.tools.expand", "expand"), "f3/ctrl+e expand");
  const unbound = hostKeybindingHints({}, new KeybindingsManager({ "app.tools.expand": [] }));
  assert.equal(unbound.keyText("app.tools.expand"), "");
  assert.equal(unbound.keyHint("app.tools.expand", "expand"), "");
});

test("missing manager falls back only for app.tools.expand and context keyText composes keyHint", () => {
  const fallback = hostKeybindingHints({});
  assert.equal(fallback.keyText("app.tools.expand"), "ctrl+o");
  assert.equal(fallback.keyText("app.interrupt"), "");
  assert.equal(fallback.keyText("app.thinking.toggle"), "");
  assert.equal(fallback.keyText("tui.input.tab"), "");
  assert.equal(fallback.keyHint("app.interrupt", "to interrupt"), "");

  const contextOnlyText = hostKeybindingHints({ keyText: (id) => (id === "app.tools.expand" ? "f9" : "") });
  assert.equal(contextOnlyText.keyText("app.tools.expand"), "f9");
  assert.equal(contextOnlyText.keyHint("app.tools.expand", "to expand"), "f9 to expand");
  assert.equal(contextOnlyText.keyHint("app.interrupt", "to interrupt"), "");

  const unboundContextText = hostKeybindingHints({ keyText: () => "" }, new KeybindingsManager());
  assert.equal(unboundContextText.keyText("app.tools.expand"), "");
  assert.equal(unboundContextText.keyHint("app.tools.expand", "to expand"), "");
});

test("formatKeyBindings handles shortEscape, multi-bindings, and Darwin modifier normalization", () => {
  assert.equal(formatKeyBindings(["escape"], { shortEscape: true }), "esc");
  assert.equal(formatKeyBindings(["escape"]), "escape");
  assert.equal(formatKeyBindings(["ctrl+escape"], { shortEscape: true }), "ctrl+escape");
  assert.equal(formatKeyBindings(["escape", "ctrl+g"], { shortEscape: true }), "esc/ctrl+g");
  assert.equal(formatKeyBindings([], { shortEscape: true }), "");

  const expectedAlt = process.platform === "darwin" ? "option+enter" : "alt+enter";
  assert.equal(formatKeyBindings(["alt+enter"]), expectedAlt);
  assert.equal(bindingText(new KeybindingsManager({ "app.interrupt": ["escape", "f8"] }), "app.interrupt", { shortEscape: true }), "esc/f8");
  assert.equal(bindingText(new KeybindingsManager({ "app.interrupt": [] }), "app.interrupt", { shortEscape: true }), "");
});
