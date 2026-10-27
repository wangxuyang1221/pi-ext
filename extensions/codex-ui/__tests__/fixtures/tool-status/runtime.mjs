import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makeScenario, TOOLS, OUTCOMES } from "./scenarios.mjs";
import { playTimeline } from "./playback.mjs";

const root = process.env.TOOL_STATUS_ROOT;
const repo = process.env.TOOL_STATUS_REPO;
if (!root || !repo) throw new Error("Use pnpm run tool-status:check.");
const lowPower = process.env.TOOL_STATUS_LOW_POWER === "1";
const mcpOnly = process.env.TOOL_STATUS_MCP_ONLY === "1";
const resume = process.env.TOOL_STATUS_RESUME === "1";
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network is disabled in the tool status fixture."); };
const sdk = await import("@earendil-works/pi-coding-agent");
const ai = await import("@earendil-works/pi-ai");
const moduleDirectory = "dist";
const codexUi = mcpOnly ? undefined : (await import(pathToFileURL(join(root, "runtime/codex-ui", moduleDirectory, "index.js")).href)).default;
const mcp = await import(pathToFileURL(join(root, "runtime/mcp", moduleDirectory, "renderers.js")).href);
const workspace = join(root, "workspace");
for (const dir of ["src", "docs"]) await mkdir(join(workspace, dir), { recursive: true });
const text = value => ({ content: [{ type: "text", text: value }], details: {} });
const toolName = name => name === "mcp" ? "fixture_mcp_search" : name;
const outcomes = new Map();
const waiting = new Map();
const plans = new Map();
let serial = 0;
const invocation = process.pid;
let active = false;
let launching = false;
let epoch = 0;
let playback = false;
let playlist = [];
let nextFrame;
let playbackController = new AbortController();
// Slow argument delivery exposes native pending states before tool execution starts.
const faux = ai.fauxProvider({ provider: "openai-codex", tokensPerSecond: 400, tokenSize: { min: 4, max: 4 } });
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);

function wrapTool(tool) {
  return { ...tool, executionMode: "parallel",
    execute: async (id, args, signal, onUpdate, ctx) => {
      const plan = plans.get(id);
      assert.ok(plan, "Only scripted fixture calls may execute");
      assert.equal(tool.name, toolName(plan.tool));
      assert.deepEqual(args, plan.args);
      assert.equal(resolve(ctx.cwd), resolve(workspace));
      let outcome = plan.outcome;
      if (plan.script) {
        const combined = signal ? AbortSignal.any([signal, playbackController.signal]) : playbackController.signal;
        const finished = await playTimeline(plan.script, combined, content => onUpdate?.(text(content)));
        if (!finished) outcome = "interrupted";
      }
      if (outcome === "hold") outcome = await new Promise(done => {
        const finish = value => { waiting.delete(id); signal?.removeEventListener("abort", aborted); done(value); };
        const aborted = () => finish("interrupted");
        if (signal?.aborted) { done("interrupted"); return; }
        waiting.set(id, finish); signal?.addEventListener("abort", aborted, { once: true });
      });
      if (signal?.aborted) outcome = "interrupted";
      outcomes.set(id, outcome);
      if (outcome !== "success") {
        if (tool.name === "fixture_mcp_search") throw new Error(outcome === "interrupted"
          ? 'MCP tool "mcp__fixture__search" was cancelled.' : outcome === "timeout"
          ? 'MCP tool "mcp__fixture__search" failed: [MCP:fixture/search] Connection timed out: MCP operation exceeded its 100ms deadline'
          : "Fixture failure: operation could not be completed");
        if (outcome === "interrupted" && ["read", "edit", "write"].includes(tool.name)) {
          const controller = new AbortController(); controller.abort();
          return tool.execute(id, args, controller.signal, onUpdate, ctx);
        }
        if (tool.name === "bash") throw new Error(outcome === "interrupted" ? "Command aborted" : outcome === "timeout" ? "Command timed out after 30 seconds" : "Command exited with code 1");
        throw new Error(outcome === "interrupted" ? "Interrupted (fixture)" : outcome === "timeout" ? "Timed out (fixture)" : "Fixture failure: operation could not be completed");
      }
      if (tool.name === "bash") return text("✓ status.test.ts (4 tests)\nTest Files  1 passed\nTests       4 passed");
      if (tool.name === "fixture_mcp_search") return text("Found 2 results\n1. Consistent status markers\n2. Static execution indicators");
      return tool.execute(id, args, signal, onUpdate, ctx);
    },
  };
}
const instructions = "Tool status acceptance" + "\n\n/play · /play mixed · /play batch · /play stop\n/batch read|bash|edit|write|mcp [success|mixed|hold]\n/demo all success · /demo all hold · /finish success|error|interrupted|timeout\nCtrl+O expands results. /quit exits. Network and shell execution are disabled.";
function stopPlayback() {
  epoch++;
  playback = false;
  playlist = [];
  clearTimeout(nextFrame); nextFrame = undefined;
  playbackController.abort();
  for (const finish of [...waiting.values()]) finish("interrupted");
}
const extension = pi => {
  const startScenario = async (options, label, animated = false) => {
    const started = epoch;
    launching = true;
    try {
      const calls = makeScenario({ ...options, animate: animated });
      plans.clear();
      for (const call of calls) if (call.seed !== undefined) await writeFile(join(workspace, call.args.path), call.seed);
      if (started !== epoch) return;
      const blocks = calls.map(call => {
        const id = `fixture-${invocation}-${++serial}`;
        plans.set(id, call);
        return { type: "toolCall", id, name: toolName(call.tool), arguments: call.args };
      });
      faux.setResponses([
        ai.fauxAssistantMessage(blocks, { stopReason: "toolUse" }),
        ai.fauxAssistantMessage(animated ? "Playback frame finished." : "Fixture finished. Use /demo to compare another state."),
      ]);
      pi.sendUserMessage(label);
    } finally { launching = false; }
  };
  const playNext = async ctx => {
    if (!playback) return;
    const frame = playlist.shift();
    if (!frame) { playback = false; ctx.ui.notify("Playback complete.", "info"); return; }
    await startScenario(frame, frame.batch ? `Batch playback: ${frame.tool} / ${frame.outcome}` : `Playback: all / ${frame.outcome}`, true);
  };
  const busy = ctx => {
    if (!active && !launching && !playback && ctx.isIdle()) return false;
    ctx.ui.notify(playback ? "Playback is active. Use /play stop first." : "Finish the current fixture first: /finish success", "info");
    return true;
  };
  let lowPowerCommand;
  const proxy = new Proxy(pi, { get(target, key) {
    if (key === "registerTool") return tool => pi.registerTool(wrapTool(tool));
    if (key === "registerCommand") return (name, definition) => {
      if (name === "lowpower") lowPowerCommand = definition;
      pi.registerCommand(name, definition);
    };
    return Reflect.get(target, key);
  } });
  codexUi?.(proxy);
  proxy.registerTool({ name: "fixture_mcp_search", label: "MCP search", description: "Offline MCP display fixture", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }, renderShell: "self", execute: async () => text("unused"),
    renderCall: (args, theme, context) => mcp.renderMcpToolCall(args, { serverName: "fixture", toolName: "search" }, theme, context),
    renderResult: (result, options, theme, context) => mcp.renderMcpToolResult(result, options, theme, context),
  });
  pi.on("agent_start", () => { active = true; });
  pi.on("agent_settled", (_event, ctx) => {
    active = false;
    if (!playback) return;
    const started = epoch;
    nextFrame = setTimeout(() => {
      nextFrame = undefined;
      if (started !== epoch || !playback) return;
      if (!ctx.isIdle()) { stopPlayback(); return; }
      void playNext(ctx).catch(error => { stopPlayback(); ctx.ui.notify(String(error), "error"); });
    }, 900);
  });
  pi.registerCommand("demo", { description: "Show fixture tools: all|bash|read|edit|write|mcp success|error|hold", handler: async (args, ctx) => {
    if (busy(ctx)) return;
    const [tool = "all", outcome = "success"] = args.trim().split(/\s+/).filter(Boolean);
    if ((tool !== "all" && !TOOLS.includes(tool)) || !OUTCOMES.includes(outcome)) { ctx.ui.notify(instructions, "info"); return; }
    await startScenario({ tool, outcome }, `Fixture: ${tool} / ${outcome}`);
  } });
  pi.registerCommand("batch", { description: "Show three native calls: read|bash|edit|write|mcp success|mixed|hold", handler: async (args, ctx) => {
    if (busy(ctx)) return;
    const [tool = "read", outcome = "success"] = args.trim().split(/\s+/).filter(Boolean);
    if (!TOOLS.includes(tool) || !OUTCOMES.includes(outcome)) { ctx.ui.notify(instructions, "info"); return; }
    await startScenario({ tool, outcome, batch: true }, `Batch fixture: ${tool} / ${outcome}`);
  } });
  pi.registerCommand("play", { description: "Animate native tool transitions: all|mixed|batch|stop", handler: async (args, ctx) => {
    const mode = args.trim() || "all";
    if (mode === "stop") { stopPlayback(); ctx.abort(); ctx.ui.notify("Playback stopped.", "info"); return; }
    if (!["all", "mixed", "batch"].includes(mode)) { ctx.ui.notify(instructions, "info"); return; }
    if (busy(ctx)) return;
    playback = true;
    playbackController = new AbortController();
    playlist = mode === "batch" ? ["read", "bash", "edit", "write", "mcp"].map(tool => ({ tool, batch: true, outcome: "mixed" }))
      : [{ tool: "all", outcome: mode === "mixed" ? "mixed" : "success" }];
    try { await playNext(ctx); }
    catch (error) { stopPlayback(); throw error; }
  } });
  pi.registerCommand("finish", { description: "Settle held fixture tools: success|error|interrupted|timeout", handler: async (args, ctx) => {
    const outcome = args.trim() || "success";
    if (!["success", "error", "interrupted", "timeout"].includes(outcome)) { ctx.ui.notify("Use /finish success|error|interrupted|timeout", "info"); return; }
    if (!waiting.size) { ctx.ui.notify("No held tools. Use /demo all hold first.", "info"); return; }
    for (const finish of [...waiting.values()]) finish(outcome);
  } });
  pi.registerCommand("guide", { description: "Show fixture controls", handler: async (_args, ctx) => ctx.ui.notify(instructions, "info") });
  pi.on("session_start", async (_event, ctx) => {
    if (lowPower && lowPowerCommand) await lowPowerCommand.handler("on", ctx);
    ctx.ui.setToolsExpanded(false);
  });
  if (resume) pi.registerCommand("fixture-restored", { description: "Confirm the isolated session was reopened", handler: async (_args, ctx) => {
    ctx.ui.notify("Restored fixture history.", "info");
  } });
  pi.registerCommand("fixture-theme", { description: "Switch the isolated test theme", handler: async (args, ctx) => {
    if (!["light", "codex-pi"].includes(args.trim())) return;
    ctx.ui.setTheme(args.trim());
  } });
  pi.on("input", event => event.source === "extension" ? { action: "continue" } : { action: "handled" });
  pi.on("user_bash", () => ({ result: { output: "Shell execution is disabled in this fixture.", exitCode: 0, cancelled: false, truncated: false } }));
  pi.on("session_before_compact", () => ({ cancel: true }));
  pi.on("session_shutdown", stopPlayback);
};
const create = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime,
    settingsManager: sdk.SettingsManager.inMemory({ quietStartup: true, theme: "codex-pi", retry: { enabled: false }, compaction: { enabled: false }, terminal: { showImages: false } }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalThemePaths: [join(root, "runtime/codex-pi.json")], systemPromptOverride: () => "Offline tool status fixture", extensionFactories: [extension] },
  });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), noTools: "builtin" }), services, diagnostics: services.diagnostics };
};
const sessions = resume ? sdk.SessionManager.continueRecent(workspace, join(root, "sessions")) : sdk.SessionManager.create(workspace, join(root, "sessions"));
if (!resume) {
  sessions.appendMessage({ role: "user", content: "Compare the tool status markers.", timestamp: Date.now() });
  sessions.appendMessage({ ...ai.fauxAssistantMessage(instructions), timestamp: Date.now() });
}
const runtime = await sdk.createAgentSessionRuntime(create, { cwd: workspace, agentDir: join(root, "agent"), sessionManager: sessions });
try {
  await new sdk.InteractiveMode(runtime, { migratedProviders: [], initialMessage: resume ? "/fixture-restored" : mcpOnly ? "/demo mcp success" : "/demo all success", tuiMode: process.env.TOOL_STATUS_FULLSCREEN === "1" ? "fullscreen" : "regular" }).run();
} finally {
  stopPlayback();
  await runtime.session.abort();
  runtime.session.dispose();
  assert.equal(networkAttempts, 0, "The fixture must not attempt network access");
}
