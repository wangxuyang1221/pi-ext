import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ToolExecutionComponent, type ExtensionAPI, type ExtensionToolContext, type Theme, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import search from "../src/index.ts";
import { CodexError, runResponsesSearch } from "../src/codex.ts";

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
const green = "\x1b[38;2;77;255;136m";
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
    tools: [],
    executeTool: async () => { throw new Error("Unexpected nested tool call in search fixture"); },
  } as unknown as ExtensionToolContext;
  await events.get("session_start")!({}, ctx);
  const requestRender = vi.fn();
  const row = new ToolExecutionComponent(tool!.name, "search-test", params, { showImages: false }, tool!, { requestRender } as unknown as TUI, ctx.cwd);
  const output = (width = 130) => row.render(width).join("\n");
  return { tool: tool!, ctx, row, output, requestRender, resultHook: (...args: unknown[]) => events.get("tool_result")?.(...args), shutdown: () => events.get("session_shutdown")?.({}, ctx) };
}
beforeEach(() => { themes.setThemeInstance(theme); vi.mocked(runResponsesSearch).mockReset(); });
afterEach(() => { vi.useRealTimers(); });

test("production search uses the shared semantic palette without background padding", async () => {
  const { row, output } = await harness();
  row.updateResult(result());
  const raw = output();
  assert(!/\x1b\[48;/.test(raw), "Search must not inherit the green host background");
  assert(raw.includes(theme.fg("toolTitle", theme.bold("Searched web"))));
  assert(raw.includes(theme.fg("text", "3 sources")));
  assert(raw.includes(theme.fg("success", "⏺")));
  assert.equal(raw.split(green).length - 1, 1);
  assert.equal(stripTerminalSequences(raw).match(/responses\/medium\/live/g)?.length, undefined);
});

function deferred() {
  let resolve!: (value: Awaited<ReturnType<typeof runResponsesSearch>>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Awaited<ReturnType<typeof runResponsesSearch>>>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("real execution drives event-based progress with no periodic redraw timer", async () => {
  vi.useFakeTimers();
  const first = deferred();
  const second = deferred();
  vi.mocked(runResponsesSearch).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { row, tool, ctx, output, requestRender, shutdown } = await harness();
  row.markExecutionStarted();
  const pending = tool.execute("search-test", params, undefined, update => row.updateResult({ ...update, isError: false }, true), ctx);
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(vi.getTimerCount(), 0, "Search must not start a periodic redraw timer");
  assert(stripTerminalSequences(output()).includes("0/2 queries completed"));
  const before = output();
  await vi.advanceTimersByTimeAsync(100);
  assert.equal(output(), before);
  first.resolve({ model: "fixture", ...success() });
  await vi.advanceTimersByTimeAsync(0);
  assert(stripTerminalSequences(output()).includes("1/2 queries completed"));
  await vi.advanceTimersByTimeAsync(1100);
  second.resolve({ model: "fixture", ...success("second query", 1, 2) });
  const value = await pending;
  row.updateResult({ ...value, isError: false });
  assert.equal(vi.getTimerCount(), 0);
  assert(output().includes("⏺"));
  assert(!output().includes("Searching"));
  assert(stripTerminalSequences(output()).includes(" · 1s"));
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
  assert.equal(vi.getTimerCount(), 0);
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
  assert(stripTerminalSequences(output()).includes("0/1 queries completed · 0ms"));
  assert.equal(vi.getTimerCount(), 0);
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
  assert(stripTerminalSequences(output()).includes("1/2 succeeded · 1 failed"));
  assert(output().includes(theme.fg("warning", "⏺")));
  assert(!output().includes("✓"));
  row.setExpanded(true);
  assert(output().includes("Fixture failure"));
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
  assert(output().includes(light.fg("success", "⏺")));
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

test("typed timeout metadata survives history reconstruction without changing error text", async () => {
  vi.mocked(runResponsesSearch).mockRejectedValue(new CodexError("timeout", "Deadline exceeded"));
  const { row, tool, ctx, resultHook, output } = await harness();
  await assert.rejects(tool.execute("search-test", params, undefined, undefined, ctx), /Deadline exceeded/);
  const content = [{ type: "text" as const, text: "Deadline exceeded" }];
  const patch = resultHook({ toolCallId: "search-test", toolName: "codex_search", content, isError: true }, ctx);
  assert.deepEqual(patch, { details: { searchFailure: { kind: "timeout", cancelled: false } } });
  row.updateResult({ content, ...patch, isError: true });
  assert(output().includes("Web search timed out"));
  assert(output().includes("Deadline exceeded"));
  const restored = new ToolExecutionComponent(tool.name, "restored-timeout", params, { showImages: false }, tool, { requestRender() {} } as unknown as TUI, ctx.cwd);
  restored.updateResult({ content, ...patch, isError: true });
  assert(restored.render(100).join("\n").includes("Web search timed out"));
  assert.equal(resultHook({ toolCallId: "search-test", toolName: "codex_search", content, isError: true }, ctx), undefined);
});

test("pre-aborted execution persists cancellation rather than a timeout", async () => {
  const { tool, ctx, resultHook, shutdown } = await harness();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(tool.execute("search-test", params, controller.signal, undefined, ctx));
  assert.deepEqual(resultHook({ toolCallId: "search-test", toolName: "codex_search", isError: true }, ctx)?.details?.searchFailure,
    { kind: "timeout", cancelled: true });
  assert.equal(vi.mocked(runResponsesSearch).mock.calls.length, 0);
  shutdown();
});

test("shutdown detaches abort listeners and rejects stale diagnostic publication", async () => {
  const wait = deferred(); vi.mocked(runResponsesSearch).mockReturnValue(wait.promise);
  const { tool, ctx, shutdown, resultHook } = await harness();
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, "addEventListener");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const pending = tool.execute("search-test", params, controller.signal, undefined, ctx);
  const rejection = assert.rejects(pending);
  await new Promise(resolve => setTimeout(resolve, 0));
  shutdown();
  assert.equal(add.mock.calls.filter(call => call[0] === "abort").length, 1);
  assert.equal(remove.mock.calls.filter(call => call[0] === "abort").length, 1);
  wait.reject(new CodexError("timeout", "Late failure")); await rejection;
  assert.equal(resultHook({ toolCallId: "search-test", toolName: "codex_search", isError: true }, ctx), undefined);
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
