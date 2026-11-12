import assert from "node:assert/strict";
import { test } from "vitest";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const { KeybindingsManager } = await import(pathToFileURL(resolve("node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js")).href);
import { hostKeybindingHints } from "../src/keybinding-hints.js";

test("legacy hints use the supplied host manager including custom and unbound keys", () => {
  const defaults = hostKeybindingHints({}, new KeybindingsManager());
  const custom = hostKeybindingHints({}, new KeybindingsManager({ "app.tools.expand": ["f3", "ctrl+e"] }));
  assert.equal(defaults.keyText("app.tools.expand"), "ctrl+o");
  assert.equal(custom.keyHint("app.tools.expand", "expand"), "f3/ctrl+e expand");
  assert.equal(hostKeybindingHints({}, new KeybindingsManager({ "app.tools.expand": [] })).keyText("app.tools.expand"), "");
});
