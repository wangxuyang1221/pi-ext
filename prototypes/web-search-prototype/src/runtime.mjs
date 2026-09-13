import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createSearchRenderers } from "./renderers.mjs";
import { QUERIES, OUTCOMES, runFixture } from "./fixtures.mjs";

const root = process.env.WEB_SEARCH_ROOT;
if (!root) throw new Error("Use pnpm run prototype:web-search.");
const resume = process.env.WEB_SEARCH_RESUME === "1";
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network disabled in the web search prototype."); };
const production = process.env.WEB_SEARCH_PRODUCTION === "1" ? (await import("./production.mjs")).createProductionSearch() : undefined;
const sdk = await import("@earendil-works/pi-coding-agent");
const ai = await import("@earendil-works/pi-ai");
const codexUi = (await import(pathToFileURL(join(root, "runtime/codex-ui/index.js")))).default;
const mcp = await import(pathToFileURL(join(root, "runtime/mcp/renderers.js")));
const workspace = join(root, "workspace");
await writeFile(join(workspace, "research-notes.txt"), "Offline web search UI prototype\nCompare search rows with native Read and MCP rows.\nNo remote requests or credentials are used.\n");
const faux = ai.fauxProvider({ provider: "openai-codex", tokensPerSecond: 1200, tokenSize: { min: 8, max: 8 } });
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
const plans = new Map();
const waiting = new Map();
let serial = 0;
let queued = false;
let controller = new AbortController();
const text = value => ({ content: [{ type: "text", text: value }], details: {} });
const guide = (production ? "Production renderer" : "Web search prototype") + " · OFFLINE FIXTURES\n/play success|partial|timeout|error|empty|single|batch\n/hold · /finish success|partial|timeout|error · /play stop\nCtrl+O expands tools. /theme light|codex-pi changes theme. /quit exits.";

function stop() {
  controller.abort();
  for (const finish of [...waiting.values()]) finish("interrupted");
}
const extension = pi => {
  const guard = tool => ({ ...tool,
    execute: async (id, args, signal, onUpdate, ctx) => {
      const plan = plans.get(id);
      assert(plan, "Only named offline fixtures may execute");
      assert.equal(plan.name, tool.name);
      assert.deepEqual(args, plan.args);
      assert.equal(resolve(ctx.cwd), resolve(workspace));
      return tool.execute(id, args, signal, onUpdate, ctx);
    },
  });
  const proxy = new Proxy(pi, { get(target, key) {
    if (key === "registerTool") return tool => {
      // Keep native rendering; only the read fixture may touch an isolated file.
      pi.registerTool(guard({ ...tool, execute: tool.name === "read" ? tool.execute : async () => text("Shell and file mutation disabled in this prototype.") }));
    };
    return Reflect.get(target, key);
  } });
  codexUi(proxy);
  pi.registerTool(guard({ name: "fixture_mcp_search", label: "MCP search", description: "Offline adjacent MCP fixture", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, renderShell: "self",
    execute: async () => text("Found 2 local notes about search UI. Offline fixture."),
    renderCall: (args, theme, context) => mcp.renderMcpToolCall(args, { serverName: "fixture", toolName: "search" }, theme, context),
    renderResult: (result, options, theme, context) => mcp.renderMcpToolResult(result, options, theme, context),
  }));
  pi.registerTool(guard({ name: "codex_search", label: "Web search", description: "Offline search UI experiment", executionMode: "sequential",
    parameters: { type: "object", properties: { queries: { type: "array", items: { type: "string" } }, freshness: { type: "string" }, search_context_size: { type: "string" } }, required: ["queries"] },
    ...(production?.renderers ?? createSearchRenderers()),
    execute: async (id, args, signal, onUpdate) => {
      const plan = plans.get(id);
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      let finish;
      let aborted;
      if (plan.hold) finish = new Promise(done => {
        const settle = outcome => { waiting.delete(id); combined.removeEventListener("abort", aborted); done(outcome); };
        aborted = () => settle("interrupted");
        if (combined.aborted) settle("interrupted");
        else { waiting.set(id, settle); combined.addEventListener("abort", aborted, { once: true }); }
      });
      try {
        if (production) return await production.run(id, { queries: args.queries, outcome: plan.outcome, signal: combined, onUpdate, finish });
        return await runFixture({ outcome: plan.outcome, total: args.queries.length, signal: combined, onUpdate, finish });
      }
      finally { waiting.delete(id); if (aborted) combined.removeEventListener("abort", aborted); }
    },
  }));
  // Fixture outcome is explicit; this does not exercise real provider error classification.
  pi.on("tool_result", event => {
    if (event.toolName !== "codex_search") return;
    if (production) return production.result(event);
    if (["failed", "timed_out", "interrupted"].includes(event.details?.status)) return { isError: true };
  });
  async function start(mode, ctx, hold = false) {
    if (queued || !ctx.isIdle()) { ctx.ui.notify("Playback active. Use /play stop or /finish first.", "info"); return; }
    queued = true;
    controller = new AbortController();
    plans.clear();
    const calls = [];
    const add = (name, args, outcome = "success") => {
      const id = `search-fixture-${++serial}`;
      plans.set(id, { name, args, outcome, hold: hold && name === "codex_search" });
      calls.push({ type: "toolCall", id, name, arguments: args });
    };
    add("read", { path: "research-notes.txt" });
    add("fixture_mcp_search", { query: "search UI notes" });
    add("codex_search", { queries: mode === "single" ? QUERIES.slice(0, 1) : QUERIES, freshness: "live", search_context_size: "high" }, OUTCOMES.includes(mode) ? mode : "success");
    if (mode === "batch") add("codex_search", { queries: ["Follow-up: official statements", "Follow-up: reporting"], freshness: "live", search_context_size: "high" }, "partial");
    faux.setResponses([
      ai.fauxAssistantMessage(calls, { stopReason: "toolUse" }),
      ai.fauxAssistantMessage("Playback complete. Ctrl+O shows queries and fixture sources; /play repeats."),
    ]);
    try { pi.sendUserMessage(`Offline fixture: ${hold ? "hold" : mode}`); }
    catch (error) { queued = false; throw error; }
  }
  pi.on("agent_settled", () => { queued = false; });
  pi.registerCommand("play", { description: "Play an offline search scenario", handler: async (args, ctx) => {
    const mode = args.trim() || "success";
    if (mode === "stop") { stop(); ctx.abort(); return; }
    if (![...OUTCOMES, "single", "batch"].includes(mode)) { ctx.ui.notify(guide, "info"); return; }
    await start(mode, ctx);
  } });
  pi.registerCommand("hold", { description: "Hold search in progress until /finish", handler: async (_args, ctx) => start("success", ctx, true) });
  pi.registerCommand("finish", { description: "Complete a held search fixture", handler: async (args, ctx) => {
    const outcome = args.trim() || "success";
    if (!OUTCOMES.includes(outcome)) { ctx.ui.notify(guide, "info"); return; }
    if (!waiting.size) { ctx.ui.notify("No held search. Use /hold first.", "info"); return; }
    for (const finish of [...waiting.values()]) finish(outcome);
  } });
  pi.registerCommand("fixture-restored", { description: "Confirm isolated history restoration", handler: async (_args, ctx) => ctx.ui.notify("Restored search history.", "info") });
  pi.registerCommand("guide", { description: "Show prototype controls", handler: async (_args, ctx) => ctx.ui.notify(guide, "info") });
  pi.registerCommand("theme", { description: "Switch isolated prototype theme", handler: async (args, ctx) => {
    if (["light", "codex-pi"].includes(args.trim())) ctx.ui.setTheme(args.trim());
  } });
  pi.on("session_start", (_event, ctx) => { ctx.ui.setToolsExpanded(false); });
  pi.on("input", (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };
    ctx.ui.notify("Offline prototype: use /play or /guide.", "info"); return { action: "handled" };
  });
  pi.on("user_bash", () => ({ result: { output: "Shell execution disabled.", exitCode: 0, cancelled: false, truncated: false } }));
  pi.on("session_before_compact", () => ({ cancel: true }));
  pi.on("session_shutdown", () => { stop(); production?.dispose(); });
};
const create = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime,
    settingsManager: sdk.SettingsManager.inMemory({ quietStartup: true, theme: "codex-pi", retry: { enabled: false }, compaction: { enabled: false }, terminal: { showImages: false } }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      additionalThemePaths: [join(root, "runtime/codex-pi.json")], systemPromptOverride: () => "Offline search fixtures only", extensionFactories: [extension] },
  });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), noTools: "builtin" }), services, diagnostics: services.diagnostics };
};
const sessions = resume ? sdk.SessionManager.continueRecent(workspace, join(root, "sessions")) : sdk.SessionManager.create(workspace, join(root, "sessions"));
if (!resume) {
  sessions.appendMessage({ role: "user", content: "Preview compact web search in context.", timestamp: Date.now() });
  sessions.appendMessage({ ...ai.fauxAssistantMessage(guide), timestamp: Date.now() });
}
const runtime = await sdk.createAgentSessionRuntime(create, { cwd: workspace, agentDir: join(root, "agent"), sessionManager: sessions });
try {
  await new sdk.InteractiveMode(runtime, { migratedProviders: [], initialMessage: resume ? "/fixture-restored" : "/play success", tuiMode: process.env.WEB_SEARCH_FULLSCREEN === "1" ? "fullscreen" : "regular" }).run();
} finally {
  stop(); await runtime.session.abort(); runtime.session.dispose(); production?.dispose();
  assert.equal(networkAttempts, 0, "Prototype must not attempt network access");
}
