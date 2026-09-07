import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ToolExecutionComponent, type ExtensionAPI, type ExtensionContext, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import search from "../src/index.ts";
import { runResponsesSearch } from "../src/codex.ts";

vi.mock("../src/config.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../src/config.ts")>(),
  loadConfig: async () => ({ enabled: true, toolName: "codex_search", model: "fixture", defaultSearchContextSize: "medium",
    defaultFreshness: "live", searchApi: "responses", standaloneEnabled: false, batchSize: 32, sources: {} }),
}));
vi.mock("../src/pi-auth.ts", () => ({ resolveCodexAccountId: () => "fixture-account" }));
vi.mock("../src/codex.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../src/codex.ts")>(),
  runResponsesSearch: vi.fn(),
}));
const themePath = join(process.cwd(), "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
const themes = await import(pathToFileURL(themePath).href);
const theme: Theme = themes.loadThemeFromPath(join(process.cwd(), "themes/codex-pi.json"), "truecolor");
const green = "\x1b[38;2;120;217;154m";
const params = { queries: ["first query", "second query"], freshness: "live", search_context_size: "medium" };
function success(query = "first query", citations = 2, calls = 3) {
  return { query, text: "Fixture search body.", citations: Array.from({ length: citations }, (_, i) => ({ url: `https://example.com/${i}`, title: "Source" })),
    searchCalls: Array.from({ length: calls }, () => ({ actionType: "search" })) };
}
function result() {
  return { content: [{ type: "text" as const, text: "Fixture search body.\nSources:\nhttps://example.com/0" }], isError: false,
    details: { model: "fixture", api: "responses", freshness: "live", searchContextSize: "medium", queryCount: 2,
      queries: params.queries, failedQueryCount: 0, successes: [success(), success("second query", 1, 2)], failures: [], elapsedMs: 20000 } };
}
async function harness() {
  const events = new Map<string, (...args: any[]) => any>();
  let tool: ToolDefinition | undefined;
  search({ registerCommand() {}, on(event: string, handler: (...args: any[]) => any) { events.set(event, handler); },
    registerTool(value: ToolDefinition) { tool = value; } } as unknown as ExtensionAPI);
  const ctx = { mode: "tui", cwd: process.cwd(), isProjectTrusted: () => false,
    modelRegistry: { getApiKeyForProvider: async () => "fixture-token" },
    sessionManager: { getSessionId: () => "fixture-session" },
  } as unknown as ExtensionContext;
  await events.get("session_start")!({}, ctx);
  const requestRender = vi.fn();
  const row = new ToolExecutionComponent(tool!.name, "search-test", params, { showImages: false }, tool!, { requestRender } as unknown as TUI, ctx.cwd);
  const output = (width = 130) => row.render(width).join("\n");
  return { tool: tool!, ctx, row, output, requestRender, shutdown: () => events.get("session_shutdown")?.({}, ctx) };
}
beforeEach(() => { themes.setThemeInstance(theme); vi.mocked(runResponsesSearch).mockReset(); });
afterEach(() => { vi.useRealTimers(); });

test("production search uses the chosen background-free accent palette", async () => {
  const { row, output } = await harness();
  row.updateResult(result());
  const raw = output();
  assert(!/\x1b\[48;/.test(raw), "Search must not inherit the green host background");
  assert(raw.includes("\x1b[38;2;166;218;220mWeb Search\x1b[39m"));
  assert(raw.includes("\x1b[38;2;168;204;236m3 sources\x1b[39m"));
  assert(raw.includes(`${green}✓\x1b[39m`));
  assert.equal(raw.split(green).length - 1, 1);
  assert.equal(stripTerminalSequences(raw).match(/responses\/medium\/live/g)?.length, 1);
});

function deferred() {
  let resolve!: (value: Awaited<ReturnType<typeof runResponsesSearch>>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Awaited<ReturnType<typeof runResponsesSearch>>>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("real execution drives progress and one timer, then settles without further redraws", async () => {
  vi.useFakeTimers();
  const first = deferred();
  const second = deferred();
  vi.mocked(runResponsesSearch).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { row, tool, ctx, output, requestRender, shutdown } = await harness();
  row.markExecutionStarted();
  const pending = tool.execute("search-test", params, undefined, update => row.updateResult({ ...update, isError: false }, true), ctx);
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(vi.getTimerCount(), 1, "Exactly one UI timer must animate the active row");
  assert(stripTerminalSequences(output()).includes("Searching 0/2"));
  const before = output();
  await vi.advanceTimersByTimeAsync(100);
  assert.notEqual(output(), before);
  first.resolve({ model: "fixture", ...success() });
  await vi.advanceTimersByTimeAsync(0);
  assert(stripTerminalSequences(output()).includes("Searching 1/2"));
  await vi.advanceTimersByTimeAsync(1100);
  second.resolve({ model: "fixture", ...success("second query", 1, 2) });
  const value = await pending;
  row.updateResult({ ...value, isError: false });
  assert.equal(vi.getTimerCount(), 0);
  assert(output().includes("✓"));
  assert(!output().includes("Searching"));
  assert(stripTerminalSequences(output()).includes("in 1s"));
  const calls = requestRender.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000);
  assert.equal(requestRender.mock.calls.length, calls);
  shutdown();
});

test("abort stops animation immediately even when one query already succeeded", async () => {
  vi.useFakeTimers();
  const wait = deferred();
  vi.mocked(runResponsesSearch).mockResolvedValueOnce({ model: "fixture", ...success() }).mockReturnValueOnce(wait.promise);
  const { row, tool, ctx, output, shutdown } = await harness();
  const controller = new AbortController();
  const pending = tool.execute("search-test", params, controller.signal, update => row.updateResult({ ...update, isError: false }, true), ctx);
  const rejected = assert.rejects(pending);
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(vi.getTimerCount(), 1);
  controller.abort();
  assert.equal(vi.getTimerCount(), 0);
  assert(output().includes("cancelled"));
  assert(!output().includes("✓"));
  wait.reject(new Error("Aborted"));
  await rejected;
  shutdown();
});

test("single-query startup and session shutdown do not depend on text deltas", async () => {
  vi.useFakeTimers();
  const wait = deferred();
  vi.mocked(runResponsesSearch).mockReturnValueOnce(wait.promise);
  const { row, tool, ctx, output, shutdown } = await harness();
  const args = { queries: ["Only one"] };
  row.updateArgs(args);
  const pending = tool.execute("search-test", args, undefined, update => row.updateResult({ ...update, isError: false }, true), ctx);
  await vi.advanceTimersByTimeAsync(1000);
  assert(stripTerminalSequences(output()).includes("Searching 0/1 · 1s"));
  assert.equal(vi.getTimerCount(), 1);
  shutdown();
  assert.equal(vi.getTimerCount(), 0);
  wait.resolve({ model: "fixture", ...success() });
  await pending;
  assert.equal(vi.getTimerCount(), 0);
});

test("partial failure keeps successful sources but never displays a success check", async () => {
  vi.useFakeTimers();
  vi.mocked(runResponsesSearch).mockResolvedValueOnce({ model: "fixture", ...success() }).mockRejectedValueOnce(new Error("Fixture failure"));
  const { row, tool, ctx, output, shutdown } = await harness();
  const value = await tool.execute("search-test", params, undefined, update => row.updateResult({ ...update, isError: false }, true), ctx);
  row.updateResult({ ...value, isError: false });
  assert(stripTerminalSequences(output()).includes("Did 1/2 searches"));
  assert(output().includes("Fixture failure"));
  assert(!output().includes("✓"));
  row.setExpanded(true);
  assert(output().includes("Failures (1)"));
  assert(output().includes("https://example.com/0"));
  assert.equal(vi.getTimerCount(), 0);
  shutdown();
});

test("failure and non-TUI execution never leave animation timers", async () => {
  vi.useFakeTimers();
  for (const mode of ["tui", "rpc", "json", "print"] as const) {
    vi.mocked(runResponsesSearch).mockRejectedValue(new Error("Fixture failure"));
    const { row, tool, ctx, output, shutdown } = await harness();
    await assert.rejects(tool.execute("search-test", params, undefined, update => row.updateResult({ ...update, isError: false }, true), { ...ctx, mode }));
    row.updateResult({ content: [{ type: "text", text: "Fixture failure" }], details: undefined, isError: true });
    assert(output().includes("Fixture failure"));
    assert(!output().includes("✓"));
    assert.equal(vi.getTimerCount(), 0);
    shutdown();
  }
});

test("history, theme changes, expanded links, and narrow terminals preserve content without timers", async () => {
  vi.useFakeTimers();
  const { row, output } = await harness();
  const value = result();
  row.updateArgs({ queries: ["长查询 ".repeat(70), "second query"] });
  row.updateResult(value);
  const collapsed = output();
  row.setExpanded(true);
  assert(output().includes("https://example.com/0"));
  for (const width of [16, 32, 60, 100, 160]) assert(row.render(width).every(line => visibleWidth(line) <= width));
  row.setExpanded(false);
  assert.equal(output(), collapsed);
  const light: Theme = themes.getThemeByName("light");
  themes.setThemeInstance(light);
  row.invalidate();
  assert(!output().includes(green));
  assert(output().includes(light.fg("success", "✓")));
  assert(!/\x1b\[48;/.test(output()));
  assert.equal(vi.getTimerCount(), 0);
});

test("collapsed responses do not access full result bodies or search texts", async () => {
  const { tool } = await harness();
  const value = result();
  Object.defineProperty(value, "content", { get() { throw new Error("Full body accessed"); } });
  for (const item of value.details.successes) Object.defineProperty(item, "text", { get() { throw new Error("Search text accessed"); } });
  const rendered = tool.renderResult!(value, { expanded: false, isPartial: false }, theme,
    { state: {}, args: params, isError: false } as never);
  assert(stripTerminalSequences(rendered.render(130).join("\n")).includes("3 sources"));
});

test("records a repeatable collapsed and expanded rendering baseline", async () => {
  const { row, output } = await harness();
  const value = result();
  value.content[0]!.text = "Fixture detail line.\n".repeat(1000);
  row.updateResult(value);
  const measure = (expanded: boolean, iterations: number) => {
    row.setExpanded(expanded);
    const start = performance.now();
    for (let i = 0; i < iterations; i++) { row.invalidate(); output(); }
    return Math.round((performance.now() - start) * 100) / 100;
  };
  console.log(JSON.stringify({ benchmark: "search-render", collapsed300Ms: measure(false, 300), expanded20Ms: measure(true, 20) }));
});
