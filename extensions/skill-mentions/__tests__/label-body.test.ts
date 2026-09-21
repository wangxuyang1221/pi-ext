import { afterEach, beforeAll, expect, it } from "vitest";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { cleanup, lifecycleFixture, textOf } from "./lifecycle-fixture.js";
import { decodeSnapshot } from "../src/protocol.js";

beforeAll(() => initTheme("dark", false));
afterEach(cleanup);
it("paints successful live and restored snapshots while leaving model text unprojected", async () => {
  const h = await lifecycleFixture();
  await h.session.prompt("Use $alpha. $missing");
  expect(h.plain()).toContain("\u{f01a7}alpha.");
  expect(h.plain()).toContain("$missing");
  expect(h.rebuild()).toContain("\u{f01a7}alpha.");
  const task = decodeSnapshot(textOf(h.users()[0].message))!.task;
  expect(task).toBe("Use $alpha. $missing");
  expect(JSON.stringify(h.calls)).not.toContain("\u{f01a7}");
  expect(h.errors).toEqual([]);
});
it.each([undefined, "before", "after"] as const)("switches both surfaces and persists through reload with Codex order %s", async codex => {
  const h = await lifecycleFixture({ codex });
  await h.session.prompt("$alpha");
  expect(h.plain()).toContain("\u{f01a7}alpha");
  h.mode.editor.setText("$alpha");
  await h.session.prompt("/skill-label-icon command");
  expect(h.mode.editor.render(80).map(stripTerminalSequences).join("\n")).toContain("⌘alpha");
  expect(h.mode.editor.getText()).toBe("$alpha");
  expect(h.plain()).toContain("⌘alpha");
  expect(JSON.parse(readFileSync(h.preferencePath, "utf8")).icon).toBe("command");
  expect(h.notifications.at(-1)).toEqual({ message: "Skill label icon saved: command", type: "info" });
  await h.reload(); h.mode.editor.setText("$alpha");
  expect(h.mode.editor.render(80).map(stripTerminalSequences).join("\n")).toContain("⌘alpha");
  expect(h.rebuild()).toContain("⌘alpha");
  expect(h.errors).toEqual([]);
});

it("reports invalid arguments and read/write failures without claiming a save", async () => {
  const h = await lifecycleFixture({ preparePreference: path => writeFileSync(path, "broken") });
  expect(h.notifications[0].message).toContain("Could not load");
  await h.session.prompt("/skill-label-icon text");
  expect(h.notifications.at(-1)?.message).toBe("Usage: /skill-label-icon cube|command");
  unlinkSync(h.preferencePath); mkdirSync(h.preferencePath);
  await h.session.prompt("/skill-label-icon command");
  expect(h.notifications.at(-1)?.message).toContain("Could not save");
  h.mode.editor.setText("$alpha");
  expect(h.mode.editor.render(80).map(stripTerminalSequences).join("\n")).toContain("\u{f01a7}alpha");
  expect(h.notifications.some(value => value.message.includes("icon saved"))).toBe(false);
  expect(h.errors).toEqual([]);
});

it("preserves a folded paste and a visible label when the real reload replaces factories", async () => {
  const h = await lifecycleFixture(); const paste = "p".repeat(2048);
  h.mode.editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
  h.mode.editor.insertTextAtCursor(" $alpha");
  await h.reload();
  expect(h.mode.editor.getExpandedText()).toBe(paste + " $alpha");
  expect(h.mode.editor.getText()).toMatch(/^\[paste #1 2048 chars\] \$alpha$/);
  expect(h.errors).toEqual([]);
});

it("hands expanded source to the native editor when removed and restores folding when re-enabled", async () => {
  let enabled = true;
  const h = await lifecycleFixture({ skillMentionsEnabled: () => enabled }), paste = "p".repeat(2048);
  h.mode.editor.handleInput(`\x1b[200~${paste}\x1b[201~`); h.mode.editor.insertTextAtCursor(" $alpha");
  enabled = false; await h.reload();
  expect(h.mode.editor.getExpandedText()).toBe(paste + " $alpha");
  expect(h.mode.editor.getText()).not.toContain("[paste #");
  enabled = true; await h.reload();
  expect(h.mode.editor.getExpandedText()).toBe(paste + " $alpha");
  expect(h.mode.editor.getText()).toContain("[paste #1 2048 chars]");
  expect(h.errors).toEqual([]);
});

it("binds equal live task text to distinct successful snapshots without text lookup", async () => {
  const h = await lifecycleFixture();
  await h.session.prompt("$alpha $beta");
  unlinkSync(h.skills[0].filePath);
  await h.session.prompt("$alpha $beta");
  const text = h.plain();
  expect(text).toContain("\u{f01a7}alpha \u{f01a7}beta");
  expect(text).toContain("$alpha \u{f01a7}beta");
  expect(h.errors).toEqual([]);
});
