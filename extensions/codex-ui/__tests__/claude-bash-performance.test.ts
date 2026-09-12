import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { renderBashGroup } from "../src/bash-group-layout.js";
import type { BashGroup, BashMember } from "../src/bash-groups.js";
import { ToolRenderCache } from "../src/render-cache.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

vi.mock("@earendil-works/pi-tui", async importOriginal => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-tui")>();
  return { ...actual, stripTerminalSequences: vi.fn(actual.stripTerminalSequences), wrapTextWithAnsi: vi.fn(actual.wrapTextWithAnsi) };
});
const themeModule = await import(pathToFileURL(resolve("node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js")).href);

for (const size of [1, 3, 10]) for (const kind of ["lines", "token"]) {
  test(`${size} Claude Bash calls cache stable ${kind} captures and only process the updated member`, () => {
    initTheme("dark", false);
    const base: Theme = themeModule.getThemeByName("dark");
    const fg = vi.fn(base.fg.bind(base));
    const theme = Object.assign(Object.create(base), { fg }) as Theme;
    const cache = new ToolRenderCache();
    const group: BashGroup = { members: [] };
    const reads = new Array<number>(size).fill(0);
    for (let index = 0; index < size; index++) {
      const text = kind === "lines" ? Array.from({ length: 1800 }, (_, line) => `member-${index} line-${line}`).join("\n") : `member-${index} ` + "x".repeat(50 * 1024);
      const member: BashMember = { id: String(index), cache: cache.scope(), group, command: `printf member-${index}`, commandRevision: 0, outputRevision: 0, status: "running",
        content: [{ type: "text", get text() { reads[index]!++; return text; } }] };
      group.members.push(member);
    }
    const samples = [];
    for (const expanded of [false, true]) {
      const start = performance.now();
      renderBashGroup(group, expanded, theme, 120, "ctrl+o");
      const warmMs = performance.now() - start;
      const previousReads = [...reads]; const previousStats = cache.stats();
      vi.mocked(wrapTextWithAnsi).mockClear(); vi.mocked(stripTerminalSequences).mockClear(); fg.mockClear();
      const stableStart = performance.now();
      for (let frame = 0; frame < 10; frame++) renderBashGroup(group, expanded, theme, 120, "ctrl+o");
      const stableMs = performance.now() - stableStart;
      assert.deepEqual(reads, previousReads);
      assert.equal(vi.mocked(wrapTextWithAnsi).mock.calls.length, 0);
      assert.equal(vi.mocked(stripTerminalSequences).mock.calls.length, 0);
      assert.equal(fg.mock.calls.filter(([color, text]) => color === "text" && text.startsWith("member-")).length, 0);
      assert.equal(cache.stats().counts.misses, previousStats.counts.misses);
      samples.push({ expanded, warmMs: +warmMs.toFixed(2), stable10Ms: +stableMs.toFixed(2), reads: [...reads], ...cache.stats() });
    }
    const previousReads = [...reads];
    const member = group.members.at(-1)!;
    member.content = [{ type: "text", text: "changed\nnew\nprefix\ntail" }]; member.outputRevision++;
    vi.mocked(wrapTextWithAnsi).mockClear(); fg.mockClear();
    const collapsed = renderBashGroup(group, false, theme, 120, "ctrl+o");
    renderBashGroup(group, true, theme, 120, "ctrl+o");
    assert.deepEqual(reads, previousReads);
    assert(collapsed.some(line => line.includes("changed")));
    assert(vi.mocked(wrapTextWithAnsi).mock.calls.every(([line]) => !line.startsWith("member-")));
    assert(fg.mock.calls.filter(([color, text]) => color === "text").every(([, text]) => !text.startsWith("member-")));
    assert(cache.stats().layouts.chargedBytes <= 16 * 1024 * 1024);
    assert(cache.stats().counts.chargedBytes <= 2 * 1024 * 1024);
    console.log(JSON.stringify({ benchmark: "claude-bash-cache", size, kind, samples }));
  });
}

test("collapsed snapshots coalesce and content replacement or final clearing invalidates exact previews", () => {
  const theme: Theme = themeModule.getThemeByName("dark");
  const cache = new ToolRenderCache();
  const group: BashGroup = { members: [] };
  const member: BashMember = { id: "one", group, cache: cache.scope(), command: "printf", commandRevision: 0, outputRevision: 0, status: "running" };
  group.members.push(member);
  let reads = 0;
  for (let revision = 0; revision < 20; revision++) {
    member.content = [{ type: "text", get text() { reads++; return `snapshot-${revision}`; } }]; member.outputRevision++;
  }
  assert.equal(reads, 0);
  assert(renderBashGroup(group, false, theme, 120, "").some(line => line.includes("snapshot-19")));
  assert.equal(reads, 1);
  for (const output of ["one\ntwo\nthree\nfour", "prefix\ntwo\nthree\nfour\nfive", "prefix\nchanged-tail", "replaced", ""]) {
    member.content = [{ type: "text", text: output }]; member.outputRevision++;
    if (!output) member.status = "completed";
    const lines = renderBashGroup(group, false, theme, 120, "").map(stripTerminalSequences);
    assert.equal(lines.at(-1), output.includes("five") ? "     … +2 lines" : output.includes("four") ? "     … +1 lines" : output.includes("changed-tail") ? "     changed-tail" : output ? "  ⎿  replaced" : "  ⎿  (No content)");
  }
});
