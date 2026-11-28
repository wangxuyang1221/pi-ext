import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Theme } from "@earendil-works/pi-coding-agent";
const themeModule = await import(pathToFileURL(resolve("node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js")).href);
const getThemeByName = (name: string): Theme => themeModule.getThemeByName(name);
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { renderBashGroup } from "../src/bash-group-layout.js";
import type { BashGroup, BashStatus } from "../../../shared/ui/bash-groups.js";
import { ToolRenderCache } from "../../../shared/ui/render-cache.js";

function fixture(status: BashStatus = "completed", command = "git status --short"): BashGroup {
  const group: BashGroup = { members: [] };
  const member = { id: "a", group, cache: new ToolRenderCache().scope(), command, commandRevision: 0, outputRevision: 0,
    status,
    content: [{ type: "text", text: "output\n\nlast" }] };
  group.members.push(member);
  return group;
}

test("Bash shows one bracketed command and an output-colored capture hanging from a dim elbow", () => {
  const theme = getThemeByName("dark");
  const lines = renderBashGroup(fixture(), false, theme, 180, "ctrl+shift+o/alt+o");
  assert.deepEqual(lines.map(stripTerminalSequences), ["$ Bash(git status --short)", "  └ output", "    ", "    last"]);
  assert.equal(lines[0], theme.fg("muted", "$") + " " + theme.bold("Bash") + "(git status --short)");
  assert.equal(lines[1], theme.fg("dim", "  └ ") + theme.fg("toolOutput", "output"));
});

test("collapsed preview shows the first and last two visual lines around an exact remainder with the active binding", () => {
  const theme = getThemeByName("dark");
  const numbered = (count: number) => Array.from({ length: count }, (_, i) => `line-${i}`);
  for (const count of [0, 1, 3, 4, 5, 6, 25]) {
    const group = fixture();
    group.members[0]!.content = [{ type: "text", text: numbered(count).join("\n") }];
    const lines = renderBashGroup(group, false, theme, 80, "ctrl+x/alt+o").map(stripTerminalSequences);
    const shown = count === 0 ? ["(no output)"] : count <= 5 ? numbered(count)
      : ["line-0", "line-1", `… +${count - 4} lines (ctrl+x/alt+o to expand)`, `line-${count - 2}`, `line-${count - 1}`];
    assert.deepEqual(lines.slice(1), shown.map((line, i) => `${i ? "    " : "  └ "}${line}`));
    const expanded = renderBashGroup(group, true, theme, 80, "ctrl+x/alt+o").map(stripTerminalSequences);
    assert.deepEqual(expanded.slice(1), (count ? numbered(count) : ["(no output)"]).map((line, i) => `${i ? "    " : "  └ "}${line}`));
  }
  const group = fixture();
  group.members[0]!.content = [{ type: "text", text: "x".repeat(70) }];
  assert.deepEqual(renderBashGroup(group, false, theme, 15, "").map(stripTerminalSequences).slice(1),
    ["  └ " + "x".repeat(11), "    " + "x".repeat(11), "    … +3 lines", "    " + "x".repeat(11), "    xxxx"]);
  group.members[0]!.content = [{ type: "text", text: "head\n\nmid-0\nmid-1\nmid-2\n\ntail" }];
  group.members[0]!.outputRevision++;
  assert.deepEqual(renderBashGroup(group, false, theme, 80, "").map(stripTerminalSequences).slice(1),
    ["  └ head", "    … +5 lines", "    tail"]);
});

test("Bash output drops shared indentation and edge blanks and keeps one blank row per run in both views", () => {
  const theme = getThemeByName("dark");
  const group = fixture();
  group.members[0]!.content = [{ type: "text", text: "\n\n    ok 1\n      detail\n\n\n\n    ok 2\n\n" }];
  for (const expanded of [false, true]) {
    assert.deepEqual(renderBashGroup(group, expanded, theme, 80, "ctrl+o").map(line => stripTerminalSequences(line).trimEnd()).slice(1),
      ["  └ ok 1", "      detail", "", "    ok 2"]);
  }
});

test("pending calls stay hidden and live or empty results have explicit content", () => {
  const theme = getThemeByName("dark");
  const pending = fixture("pending");
  assert.deepEqual(renderBashGroup(pending, false, theme, 80, "ctrl+o"), []);
  for (const [status, title, expected] of [["running", "", "Running…"], ["completed", "", "(no output)"], ["failed", " · failed", "(no output)"]] as const) {
    const group = fixture(status);
    group.members[0]!.content = [];
    const lines = renderBashGroup(group, false, theme, 80, "ctrl+o");
    assert.deepEqual(lines.map(stripTerminalSequences), [`$ Bash(git status --short)${title}`, `  └ ${expected}`]);
    assert.equal(lines[1], theme.fg("dim", "  └ ") + theme.fg("dim", expected));
  }
});

test("long commands use a single ellipsis and expand without losing text at narrow widths", () => {
  const theme = getThemeByName("dark");
  const group = fixture("completed", "x".repeat(200));
  assert.equal(stripTerminalSequences(renderBashGroup(group, false, theme, 64, "ctrl+o")[0]!), "$ Bash(" + "x".repeat(55) + "…)");
  const huge = fixture("completed", "q".repeat(50 * 1024));
  assert.equal(stripTerminalSequences(renderBashGroup(huge, true, theme, 1, "").join("")).match(/q/gu)?.length, 50 * 1024);
  for (const status of ["pending", "running", "completed", "failed"] as const) {
    const current = fixture(status, "中文👩‍💻é".repeat(30) + "\nsecond");
    for (const width of [0, 1, 7, 8, 16, 32, 63, 64, 80, 180]) for (const expanded of [false, true]) {
      const lines = renderBashGroup(current, expanded, theme, width, "ctrl+shift+o");
      assert(lines.every(line => visibleWidth(line) <= width));
      if (!width || status === "pending") assert.deepEqual(lines, []);
      else if (expanded) {
        const text = stripTerminalSequences(lines.join("\n"));
        assert(text.includes("last") || width < 12);
      }
    }
  }
});

test("verified host diagnostics become the title status and leave the output in both views", () => {
  const theme = getThemeByName("dark");
  for (const [suffix, label, color] of [
    ["Command exited with code 7", "exit 7", "error"],
    ["Command aborted", "interrupted", "warning"],
    ["Command timed out after 0.1 seconds", "timed out", "warning"],
  ] as const) {
    const group = fixture("failed");
    group.members[0]!.content = [{ type: "text", text: `first\nsecond\nthird\nfourth\n\n${suffix}` }];
    for (const expanded of [false, true]) {
      const lines = renderBashGroup(group, expanded, theme, 100, "ctrl+o");
      assert.deepEqual(lines.map(stripTerminalSequences),
        [`$ Bash(git status --short) · ${label}`, "  └ first", "    second", "    third", "    fourth"]);
      assert.equal(lines[0], theme.fg(color, "$") + " " + theme.bold("Bash") + "(git status --short)" + theme.fg("dim", " · ") + theme.fg(color, label));
      assert.equal(lines[1], theme.fg("dim", "  └ ") + theme.fg("toolOutput", "first"));
    }
    assert.equal(stripTerminalSequences(renderBashGroup(group, false, theme, 23, "")[0]!), "$ Bash(git status --s…)");
  }
  const long = fixture("failed", "x".repeat(65));
  long.members[0]!.content = [{ type: "text", text: "out\n\nCommand exited with code 2" }];
  assert.deepEqual(renderBashGroup(long, true, theme, 40, "").map(stripTerminalSequences).slice(0, 3),
    ["$ Bash(" + "x".repeat(33), "  " + "x".repeat(32) + ")", "   · exit 2"]);
  const success = fixture("completed");
  success.members[0]!.content = [{ type: "text", text: "Error: harmless\n\nCommand exited with code 7" }];
  const succeeded = renderBashGroup(success, false, theme, 100, "");
  assert(succeeded[0]!.includes(theme.fg("muted", "$")));
  assert.deepEqual(succeeded.map(line => stripTerminalSequences(line).trimEnd()),
    ["$ Bash(git status --short)", "  └ Error: harmless", "", "    Command exited with code 7"]);
  const unknown = fixture("failed");
  unknown.members[0]!.content = [{ type: "text", text: "Permission denied" }];
  assert.deepEqual(renderBashGroup(unknown, false, theme, 100, "").map(stripTerminalSequences),
    ["$ Bash(git status --short) · failed", "  └ Permission denied"]);
});

test("truncation remains visible from structured details or the host error footer without reading files", () => {
  const theme = getThemeByName("dark");
  for (const expanded of [false, true]) {
    const group = fixture("completed");
    group.members[0]!.details = { truncation: { truncated: true }, fullOutputPath: "/unreadable/capture.log" } as never;
    assert.match(renderBashGroup(group, expanded, theme, 120, "").map(stripTerminalSequences).join("\n"), /Truncated capture · \/unreadable\/capture.log/u);
    const failed = fixture("failed");
    failed.members[0]!.content = [{ type: "text", text: "one\ntwo\nthree\nfour\n\n[Showing lines 101-2100 of 2100. Full output: /unreadable/error.log]\n\nCommand exited with code 9" }];
    assert.match(renderBashGroup(failed, expanded, theme, 120, "").map(stripTerminalSequences).join("\n"), /Truncated capture · \/unreadable\/error.log/u);
  }
});

test("collapsed truncated captures keep real output in the tail and show the footer only as a warning", () => {
  const theme = getThemeByName("dark");
  const output = Array.from({ length: 10 }, (_, index) => `l${index}`).join("\n");
  const footer = "[Showing lines 1-10 of 3000. Full output: /tmp/o.log]";
  const failed = fixture("failed", "make test");
  failed.members[0]!.content = [{ type: "text", text: `${output}\n\n${footer}\n\nCommand exited with code 1` }];
  const succeeded = fixture("completed", "make test");
  succeeded.members[0]!.content = [{ type: "text", text: `${output}\n\n${footer}` }];
  succeeded.members[0]!.details = { truncation: { truncated: true }, fullOutputPath: "/tmp/o.log" } as never;
  for (const [group, title] of [[failed, "$ Bash(make test) · exit 1"], [succeeded, "$ Bash(make test)"]] as const) {
    assert.deepEqual(renderBashGroup(group, false, theme, 120, "").map(stripTerminalSequences),
      [title, "  └ l0", "    l1", "    … +6 lines", "    l8", "    l9", "    Truncated capture · /tmp/o.log"]);
  }
});

test("the host empty-success sentinel uses the selected no-output wording", () => {
  const group = fixture();
  group.members[0]!.content = [{ type: "text", text: "(no output)" }];
  const theme = getThemeByName("dark");
  assert.equal(renderBashGroup(group, false, theme, 80, "")[1], theme.fg("dim", "  └ ") + theme.fg("dim", "(no output)"));
});

test("warmed captures do not repeat styling and collapsed captures style only the four preview lines", () => {
  const base = getThemeByName("dark");
  const fg = vi.fn(base.fg.bind(base));
  const theme = Object.assign(Object.create(base), { fg }) as Theme;
  const group = fixture();
  group.members[0]!.content = [{ type: "text", text: Array.from({ length: 1800 }, (_, i) => `output ${i}`).join("\n") }];
  renderBashGroup(group, false, theme, 120, "ctrl+o");
  assert.equal(fg.mock.calls.filter(([color, text]) => color === "toolOutput" && text.startsWith("output")).length, 4);
  for (const expanded of [false, true]) {
    renderBashGroup(group, expanded, theme, 120, "ctrl+o");
    fg.mockClear();
    for (let i = 0; i < 10; i++) renderBashGroup(group, expanded, theme, 120, "ctrl+o");
    assert.equal(fg.mock.calls.filter(([color, text]) => color === "toolOutput" && text.startsWith("output")).length, 0);
  }
});

test("unchanged captures survive completion without recomputing any layout", () => {
  const group = fixture("running");
  const cache = new ToolRenderCache();
  group.members[0]!.cache = cache.scope();
  group.members[0]!.content = [{ type: "text", text: Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n") }];
  for (const expanded of [false, true]) renderBashGroup(group, expanded, getThemeByName("dark"), 100, "ctrl+o");
  const before = cache.stats();
  group.members[0]!.status = "completed";
  for (const expanded of [false, true]) renderBashGroup(group, expanded, getThemeByName("dark"), 100, "ctrl+o");
  assert.equal(cache.stats().layouts.misses, before.layouts.misses);
  assert.equal(cache.stats().counts.misses, before.counts.misses);
});

test("theme changes restyle the preview without rereading the capture", () => {
  const group = fixture();
  let reads = 0;
  Object.defineProperty(group.members[0]!, "content", { get() { reads++; return [{ type: "text", text: "output" }]; } });
  const themes: Theme[] = [getThemeByName("dark"), getThemeByName("light"), themeModule.loadThemeFromPath(resolve("extensions/codex-ui/themes/codex-pi.json"), "truecolor")];
  for (const theme of themes) {
    const collapsed = renderBashGroup(group, false, theme, 180, "ctrl+x");
    assert.equal(reads, 1);
    assert(collapsed[0]!.includes(theme.fg("muted", "$")));
    assert.equal(collapsed[1], theme.fg("dim", "  └ ") + theme.fg("toolOutput", "output"));
  }
  renderBashGroup(group, true, themes[0]!, 180, "ctrl+x");
  const warmedReads = reads;
  for (const theme of themes) {
    const expanded = renderBashGroup(group, true, theme, 180, "ctrl+x");
    assert(expanded[0]!.includes(theme.fg("muted", "$")));
    assert.equal(expanded[1], theme.fg("dim", "  └ ") + theme.fg("toolOutput", "output"));
    assert.equal(reads, warmedReads);
  }
});

test("fullOutputError and unsaved truncation footers cover lines, bytes, and lastLinePartial across collapsed and expanded views", () => {
  const theme = getThemeByName("dark");
  const output = Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n");
  const prefixes = [
    "Showing lines 101-2100 of 2100.",
    "Showing lines 1800-2100 of 2100 (50.0KB limit).",
    "Showing last 50.0KB of line 1 (line is 80.0KB).",
  ];
  const reason = "ENOSPC: no space left on device, open '/tmp/pi-bash-1.log'";

  for (const prefix of prefixes) {
    const errorFooter = `[${prefix} Could not save the full output: ${reason}]`;
    const completed = fixture("completed", "make test");
    completed.members[0]!.content = [{ type: "text", text: `${output}\n\n${errorFooter}` }];
    completed.members[0]!.details = { truncation: { truncated: true }, fullOutputError: reason } as never;

    const failedNoDetails = fixture("failed", "make test");
    failedNoDetails.members[0]!.content = [{ type: "text", text: `${output}\n\n${errorFooter}\n\nCommand exited with code 7` }];

    for (const [group, title] of [[completed, "$ Bash(make test)"], [failedNoDetails, "$ Bash(make test) · exit 7"]] as const) {
      const collapsed = renderBashGroup(group, false, theme, 140, "").map(stripTerminalSequences);
      assert.deepEqual(collapsed, [
        title,
        "  └ l0",
        "    l1",
        "    … +6 lines",
        "    l8",
        "    l9",
        `    Truncated capture · Could not save the full output: ${reason}`,
      ]);
      const expanded = renderBashGroup(group, true, theme, 140, "").map(stripTerminalSequences);
      assert.equal(expanded.filter(line => line.includes("Could not save the full output:")).length, 1);
      assert.doesNotMatch(expanded.join("\n"), /\[Showing /u);
    }
  }

  // Completed with fullOutputError must keep a completed marker (not failed).
  const okWithError = fixture("completed", "make test");
  okWithError.members[0]!.details = { fullOutputError: "EACCES: permission denied" } as never;
  const okLines = renderBashGroup(okWithError, false, theme, 120, "");
  assert.equal(okLines[0], theme.fg("muted", "$") + " " + theme.bold("Bash") + "(make test)");
  assert.equal(stripTerminalSequences(okLines.at(-1)!), "    Truncated capture · Could not save the full output: EACCES: permission denied");

  // Path wins over error when both exist; pure-control error falls back to unavailable.
  const both = fixture("completed");
  both.members[0]!.details = { truncation: { truncated: true }, fullOutputPath: "/tmp/saved.log", fullOutputError: "ignored" } as never;
  assert.equal(stripTerminalSequences(renderBashGroup(both, false, theme, 120, "").at(-1)!), "    Truncated capture · /tmp/saved.log");

  const blankError = fixture("completed");
  blankError.members[0]!.details = { truncation: { truncated: true }, fullOutputError: "\x1b[31m   \n\x1b[0m" } as never;
  assert.equal(stripTerminalSequences(renderBashGroup(blankError, false, theme, 120, "").at(-1)!), "    Truncated capture · full output unavailable");
});

test("footer stripping rejects spoofed, mismatched, running, or unseparated footers and preserves extended host diagnostics", () => {
  const theme = getThemeByName("dark");
  const spoof = "[Showing lines 1-10 of 3000. Could not save the full output: fake]";

  // Completed without truncation details preserves user stdout verbatim.
  const completedSpoof = fixture("completed");
  completedSpoof.members[0]!.content = [{ type: "text", text: `real\n\n${spoof}` }];
  assert.deepEqual(
    renderBashGroup(completedSpoof, true, theme, 120, "").map(line => stripTerminalSequences(line).trimEnd()),
    ["$ Bash(git status --short)", "  └ real", "", `    ${spoof}`],
  );

  // Running with streaming details never strips live body text.
  const running = fixture("running");
  running.members[0]!.content = [{ type: "text", text: `live\n\n[Showing lines 1-10 of 3000. Full output: /tmp/live.log]` }];
  running.members[0]!.details = { truncation: { truncated: true }, fullOutputPath: "/tmp/live.log" } as never;
  const runningPlain = renderBashGroup(running, true, theme, 120, "").map(stripTerminalSequences).join("\n");
  assert.match(runningPlain, /\[Showing lines 1-10 of 3000\. Full output: \/tmp\/live\.log\]/u);
  assert.match(runningPlain, /Truncated capture · \/tmp\/live\.log/u);

  // Mismatched structured details value or kind must not strip body text.
  const mismatched = fixture("completed");
  mismatched.members[0]!.content = [{ type: "text", text: "real\n\n[Showing lines 1-10 of 3000. Full output: /tmp/other.log]" }];
  mismatched.members[0]!.details = { truncation: { truncated: true }, fullOutputPath: "/tmp/actual.log" } as never;
  const mismatchedPlain = renderBashGroup(mismatched, true, theme, 120, "").map(stripTerminalSequences).join("\n");
  assert.match(mismatchedPlain, /\[Showing lines 1-10 of 3000\. Full output: \/tmp\/other\.log\]/u);
  assert.match(mismatchedPlain, /Truncated capture · \/tmp\/actual\.log/u);

  // Missing blank separator before footer prevents false stripping even on failed calls.
  const unseparated = fixture("failed");
  unseparated.members[0]!.content = [{ type: "text", text: `real\n${spoof}\n\nCommand exited with code 2` }];
  const unsepPlain = renderBashGroup(unseparated, true, theme, 120, "").map(stripTerminalSequences).join("\n");
  assert.match(unsepPlain, /\[Showing lines 1-10 of 3000\. Could not save the full output: fake\]/u);
  assert.doesNotMatch(unsepPlain, /Truncated capture/u);

  // Extended timeout explanation is preserved while its preceding truncation footer is stripped.
  const extTimeout = "Command timed out after 10 seconds. The shell exited with code 0 after 1 seconds, but background processes it started kept writing output until the timeout.";
  const timedOut = fixture("failed");
  timedOut.members[0]!.content = [{
    type: "text",
    text: `first\nlast-real\n\n[Showing lines 1-2000 of 2500. Could not save the full output: ENOTDIR]\n\n${extTimeout}`,
  }];
  const timedOutPlain = renderBashGroup(timedOut, true, theme, 200, "").map(stripTerminalSequences).join("\n");
  assert.match(timedOutPlain, /last-real/u);
  assert.match(timedOutPlain, /background processes it started kept writing output until the timeout/u);
  assert.match(timedOutPlain, /Truncated capture · Could not save the full output: ENOTDIR/u);
  assert.doesNotMatch(timedOutPlain, /\[Showing lines 1-2000/u);
});

test("multi-line errors and terminal control sequences in warnings are stripped and fit narrow widths safely", () => {
  const theme = getThemeByName("dark");
  const multiError = "line1 [detail]\nline2: \x1b]52;c;ZXZpbA==\x07\x9d52;c;c1payload\x07\u202e\x1b[31mred\x1b[0m";
  const group = fixture("completed");
  group.members[0]!.content = [{
    type: "text",
    text: `tail-marker\n\n[Showing lines 1-2000 of 3000. Could not save the full output: ${multiError}]`,
  }];
  group.members[0]!.details = { truncation: { truncated: true }, fullOutputError: multiError } as never;

  const rendered = renderBashGroup(group, true, theme, 160, "");
  const raw = rendered.join("\n");
  const plain = rendered.map(stripTerminalSequences).join("\n");
  assert.doesNotMatch(raw, /\x1b\]52|\x9d|ZXZpbA|c1payload|\u202e/u);
  assert.doesNotMatch(plain, /\[Showing lines 1-2000/u);
  assert.match(plain, /tail-marker/u);
  assert.match(plain, /Truncated capture · Could not save the full output: line1 \[detail\] line2: red/u);

  // Over-long error messages are bounded and fit narrow widths without overflow.
  const huge = fixture("completed");
  huge.members[0]!.details = { truncation: { truncated: true }, fullOutputError: "E".repeat(400) } as never;
  for (const width of [0, 1, 2, 5, 6, 8, 24, 80]) {
    const lines = renderBashGroup(huge, false, theme, width, "");
    assert.ok(lines.every(line => visibleWidth(line) <= width));
  }
  const capped = stripTerminalSequences(renderBashGroup(huge, false, theme, 500, "").at(-1)!);
  assert.equal(capped, `    Truncated capture · Could not save the full output: ${"E".repeat(256)}…`);

  // Multi-line OSC sequences in stdout before the footer must not break diagnostic or footer parsing.
  const oscReason = "ENOTDIR: not a directory";
  const oscGroup = fixture("failed", "make test");
  oscGroup.members[0]!.content = [{
    type: "text",
    text: `before\x1b]0;multi\nline\x07after\n\n[Showing lines 1-2000 of 3000. Could not save the full output: ${oscReason}]\n\nCommand exited with code 7`,
  }];
  oscGroup.members[0]!.details = { truncation: { truncated: true }, fullOutputError: oscReason } as never;
  const oscPlain = renderBashGroup(oscGroup, true, theme, 160, "").map(stripTerminalSequences);
  assert.deepEqual(oscPlain, [
    "$ Bash(make test) · exit 7",
    "  └ beforeafter",
    `    Truncated capture · Could not save the full output: ${oscReason}`,
  ]);
});
