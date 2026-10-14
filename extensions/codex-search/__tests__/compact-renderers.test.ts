import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ToolExecutionComponent, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { getKeybindings, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { createSearchRenderers } from "../src/renderers.ts";
import { SearchAnimations } from "../src/animation.ts";
import type { ResolvedConfig } from "../src/config.ts";
import type { WebSearchDetails } from "../src/index.ts";

const themes = await import(pathToFileURL(join(process.cwd(), "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js")).href);
const theme: Theme = themes.loadThemeFromPath(join(process.cwd(), "themes/codex-pi.json"), "truecolor");
const config = { searchApi: "responses", defaultFreshness: "live", defaultSearchContextSize: "high" } as ResolvedConfig;
const args = { queries: ["Anthropic 官方回应", "Second query"], freshness: "live", search_context_size: "high" };
function result() {
  const details: WebSearchDetails = { api: "responses", model: "fixture", freshness: "live", searchContextSize: "high", queries: args.queries, queryCount: 2, failedQueryCount: 0,
    successes: args.queries.map(query => ({ query, text: "Body", citations: [{ title: "Source", url: "https://example.com/source" }], searchCalls: [] })), failures: [], elapsedMs: 6000 };
  return { content: [{ type: "text" as const, text: "Body with complete sources\nhttps://example.com/source" }], details, isError: false };
}
function harness() {
  const animations = new SearchAnimations();
  const renderers = createSearchRenderers(config, value => value.queries as string[] ?? [], animations);
  const tool = { name: "codex_search", ...renderers } as ToolDefinition;
  const row = new ToolExecutionComponent(tool.name, "compact", args, { showImages: false }, tool, { requestRender: vi.fn() } as unknown as TUI, process.cwd());
  const lines = (width = 100) => row.render(width).map(stripTerminalSequences);
  return { row, lines, animations, tool };
}
beforeEach(() => themes.setThemeInstance(theme));

test("search renders two compact lines and only one host-owned separator", () => {
  const { row, lines } = harness(); row.updateResult(result());
  const output = lines();
  assert.equal(output.length, 3);
  assert.equal(output[0], "");
  assert.match(output[1]!, /^⌕ Searched web \(Anthropic 官方回应 \+1 query\)/);
  assert.match(output[2]!, /^  └ 2 sources · 2 queries · 6s/);
  assert(!output.join("\n").includes("responses/high/live"));
  assert(row.render(100)[1]!.includes(theme.fg("muted", "⌕")));
  const adjacent = [...output, ...output];
  assert(adjacent[2]!.trim() && !adjacent[3]!.trim() && adjacent[4]!.trim());
});

test("progress and partial failure update the same row with warning priority", () => {
  const { row, lines } = harness();
  assert(row.render(100)[1]!.includes(theme.fg("warning", "⌕")));
  row.markExecutionStarted();
  const progress = result(); Object.assign(progress.details, { partial: true, total: 2, completed: 1, successes: [], queryCount: 2 });
  row.updateResult(progress, true);
  assert.match(lines()[2]!, /1\/2 queries completed/);
  const partial = result(); partial.details.successes.pop(); partial.details.failedQueryCount = 1;
  partial.details.failures.push({ query: "Second query", kind: "unknown", message: "Unavailable" });
  row.updateResult(partial);
  assert.match(lines(40)[2]!, /1\/2 succeeded · 1 failed/);
  assert(row.render(40)[1]!.includes(theme.fg("warning", "⌕")));
});

test("missing metadata never invents success and persisted diagnostics retain timeout or cancellation", () => {
  const { row, lines } = harness();
  row.updateResult({ content: [{ type: "text", text: "Legacy output" }], details: undefined, isError: false });
  assert.match(lines()[1]!, /⌕ Web search/);
  assert.match(lines()[2]!, /Legacy output/);
  assert(!lines().join("\n").includes("0 sources"));
  for (const [kind, cancelled, title, color] of [["timeout", false, "timed out", "warning"], ["unknown", true, "interrupted", "warning"], ["unknown", false, "failed", "error"]] as const) {
    row.updateResult({ content: [{ type: "text", text: "Actual diagnostic" }], details: { searchFailure: { kind, cancelled } }, isError: true });
    assert.match(lines()[1]!, new RegExp(title));
    assert.match(lines()[2]!, /Actual diagnostic/);
    assert(row.render(100)[1]!.includes(theme.fg(color, "⌕")));
  }
  row.updateResult({ content: [{ type: "text", text: "The word timeout in arbitrary prose" }], details: undefined, isError: true });
  assert(row.render(100)[1]!.includes(theme.fg("error", "⌕")));
});

test("expansion preserves queries, settings, source URLs and bounded result text", () => {
  const { row, lines } = harness();
  const value = result(); value.content[0]!.text += "\n" + "x".repeat(100000);
  row.updateResult(value); row.setExpanded(true);
  const output = lines(80).join("\n");
  for (const text of ["Queries", "Second query", "responses · high · live", "fixture", "https://example.com/source", "truncated"]) assert(output.includes(text), text);
  for (const width of [1, 16, 40, 80, 120]) assert(row.render(width).every(line => visibleWidth(line) <= width));
  row.setExpanded(false); assert.equal(lines().length, 3);
});

test("incomplete final metadata is not labelled successful and typed legacy timeouts stay warnings", () => {
  const { row, lines } = harness();
  const value = result(); value.details.successes = [];
  row.updateResult(value);
  assert(!lines()[1]!.includes("Searched web"));
  value.details = { ...value.details, failure: { kind: "timeout", message: "Legacy deadline" }, failedQueryCount: 2 };
  row.updateResult({ ...value, isError: true });
  assert.match(lines()[1]!, /timed out/);
  row.updateResult({ content: value.content, details: { ...result().details, failedQueryCount: undefined }, isError: false });
  assert(!lines()[1]!.includes("Searched web"));
  row.updateResult({ content: value.content, details: { ...result().details, successes: [{}] }, isError: false });
  assert.match(lines()[1]!, /⌕ Web search/);
});

test("expand hints honor configured bindings and untrusted text cannot emit control sequences", () => {
  const keys = vi.spyOn(getKeybindings(), "getKeys").mockReturnValue(["ctrl+shift+o"]);
  try {
    const { row, lines } = harness();
    row.updateArgs({ queries: ["safe\x1b]0;malicious-title\x07\x1b[31mquery"] });
    const value = result(); value.content[0]!.text = "Safe\x1b]0;malicious-title\x07\x1b[2J body";
    row.updateResult(value);
    assert(lines().join("\n").includes("ctrl+shift+o expand"));
    assert(!row.render(100).join("\n").includes("malicious-title"));
    row.setExpanded(true);
    assert(!row.render(100).join("\n").includes("malicious-title"));
    assert(!row.render(100).join("\n").includes("\x1b[2J"));
  } finally { keys.mockRestore(); }
});

test("standalone keeps its existing action title, preview and timer policy", async () => {
  vi.useFakeTimers();
  try {
    const animations = new SearchAnimations();
    const renderers = createSearchRenderers({ ...config, searchApi: "standalone" }, () => ["https://example.com"], animations);
    const tool = { name: "codex_standalone_web", ...renderers } as ToolDefinition;
    const row = new ToolExecutionComponent(tool.name, "standalone", { urls: ["https://example.com"] }, { showImages: false }, tool, { requestRender() {} } as unknown as TUI, process.cwd());
    let resolve!: () => void;
    const pending = animations.run("standalone", true, undefined, () => new Promise<void>(done => { resolve = done; }));
    row.markExecutionStarted(); row.render(100);
    assert.equal(vi.getTimerCount(), 1);
    resolve(); await pending;
    const value = result(); value.details.api = "standalone"; value.details.successes[0]!.searchCalls = [{ actionType: "open_page" }];
    row.updateResult(value);
    const output = stripTerminalSequences(row.render(100).join("\n"));
    assert(output.includes("Codex Standalone Web"));
    assert(output.includes("Opened: Body"));
    assert.equal(vi.getTimerCount(), 0);
    animations.dispose();
  } finally { vi.useRealTimers(); }
});

test("collapsed rerenders and resize do not rescan source arrays or full bodies", () => {
  for (const size of [1, 1000, 10000]) {
    const { row, lines } = harness();
    const value = result();
    const successes = value.details.successes;
    const scan = vi.fn(() => successes);
    Object.defineProperty(value.details, "successes", { get: scan });
    Object.defineProperty(successes[0], "text", { get() { throw new Error("Search text accessed"); } });
    successes[0]!.citations = new Proxy(Array.from({ length: size }, () => ({ url: "https://example.com" })), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) throw new Error("Collapsed view must not visit individual sources");
        return Reflect.get(target, property, receiver);
      },
    });
    row.updateResult(value); lines();
    const calls = scan.mock.calls.length;
    for (let i = 0; i < 20; i++) { row.invalidate(); lines(i % 2 ? 40 : 100); }
    assert.equal(scan.mock.calls.length, calls, "Stable result metadata must not be rescanned during redraws");
  }
});
