import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { decorateGoalTool } from "./renderers.mjs";

const root = process.env.GOAL_UI_ROOT;
if (!root) throw new Error("Start this prototype with demo.mjs.");
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network is disabled in the Goal UI prototype."); };
const sdk = await import("@earendil-works/pi-coding-agent");
const ai = await import("@earendil-works/pi-ai");
const codexUi = (await import(pathToFileURL(join(root, "runtime/codex-ui/index.js")))).default;
const { registerGoalTools } = await import(pathToFileURL(join(root, "runtime/goal/tools.js")));
const workspace = join(root, "workspace");
const faux = ai.fauxProvider({ provider: "openai-codex", tokensPerSecond: 4000, tokenSize: { min: 8, max: 8 } });
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
const preferences = { density: "summary", rows: new Set() };
const plans = new Map();
let record;
let scenario = "compare";
let serial = 0;
let finishHeld;
let launching = false;
const objective = "统一 Goal 工具 UI，与 Bash、Write、Edit 保持一致";
const instructions = [
  "Goal tool UI prototype · isolated fixtures, real Pi and codex-ui",
  "/variant summary | /variant minimal  ·  switch existing rows",
  "/demo compare|long|error|empty|paused|blocked|unbounded|incomplete|running",
  "/finish releases a running call · Ctrl+O expands/collapses · /quit exits",
].join("\n");
function fixture(text = objective, status = "active", budget = 50000) {
  return { ownerSessionId: "prototype-session", goal: { objective: text, status, tokensUsed: 12480, tokenBudget: budget, elapsedSeconds: 192, createdAt: "2026-05-01T09:00:00Z", updatedAt: "2026-05-01T09:03:12Z" } };
}
async function delay(ctx) {
  if (scenario !== "running") {
    try { await sleep(220, undefined, { signal: ctx.signal }); }
    catch { throw new Error("Goal tool invocation was cancelled."); }
    return;
  }
  await new Promise((done, reject) => {
    const complete = () => { finishHeld = undefined; ctx.signal?.removeEventListener("abort", abort); done(); };
    const abort = () => { finishHeld = undefined; ctx.signal?.removeEventListener("abort", abort); reject(new Error("Goal tool invocation was cancelled.")); };
    finishHeld = complete;
    if (ctx.signal?.aborted) abort();
    else ctx.signal?.addEventListener("abort", abort, { once: true });
  });
}
const extension = pi => {
  const gate = tool => ({ ...tool, execute: async (id, args, signal, update, ctx) => {
    const expected = plans.get(id);
    assert.ok(expected, "Only scripted calls may execute");
    assert.equal(expected.name, tool.name);
    assert.deepEqual(expected.arguments, args);
    assert.equal(resolve(ctx.cwd), resolve(workspace));
    return tool.execute(id, args, signal, update, ctx);
  } });
  codexUi(new Proxy(pi, { get(target, key) {
    if (key === "registerTool") return tool => pi.registerTool(gate(tool));
    return Reflect.get(target, key);
  } }));
  // Replace only the persistence boundary, keeping actual Goal schemas and response serialization.
  registerGoalTools({ registerTool(tool) {
    const decorated = decorateGoalTool(tool, preferences);
    assert.equal(decorated.execute, tool.execute);
    assert.equal(decorated.parameters, tool.parameters);
    pi.registerTool(gate(decorated));
  } }, {
    get: async ctx => { await delay(ctx); return structuredClone(record); },
    create: async (ctx, text, budget) => { await delay(ctx); record = fixture(text, "active", budget); record.goal.tokensUsed = 0; record.goal.elapsedSeconds = 0; return structuredClone(record); },
    update: async (ctx, status) => {
      await delay(ctx);
      if (!record) throw new Error("No goal exists.\nCreate a goal before updating its status.");
      record.goal = { ...record.goal, status, tokensUsed: 12480, elapsedSeconds: 192 };
      return structuredClone(record);
    },
  });
  const showDensity = ctx => ctx.ui.setStatus("goal-ui-prototype", `Prototype: ${preferences.density} · /variant · /guide`);
  const run = async (name, ctx) => {
    if (launching || !ctx.isIdle()) { ctx.ui.notify("Finish or cancel the current fixture first.", "warning"); return; }
    const valid = ["compare", "long", "error", "empty", "paused", "blocked", "unbounded", "incomplete", "running"];
    if (!valid.includes(name)) { ctx.ui.notify(instructions, "info"); return; }
    launching = true;
    try {
      scenario = name;
      plans.clear();
      record = fixture();
      if (name === "error" || name === "empty") record = undefined;
      if (name === "unbounded") record.goal.tokenBudget = undefined;
      if (name === "incomplete") record.goal.usageIncomplete = true;
      if (name === "long") record.goal.objective = "统一 Goal 工具在真实对话中的展示。\n" + "保留原来的执行逻辑和模型数据；对照 Bash、Write、Edit 的间距、颜色和展开行为。🙂 ".repeat(8) + "\nLONG-GOAL-END";
      await writeFile(join(workspace, "ui-note.txt"), "Goal UI review\nBefore review\n");
      const calls = name === "compare" ? [
        ["bash", { command: "printf 'Existing Bash output\\nGoal UI comparison\\n'" }],
        ["create_goal", { objective, token_budget: 50000 }],
        ["write", { path: "ui-note.txt", content: "Goal UI review\nSummary variant\n" }],
        ["get_goal", {}],
        ["edit", { path: "ui-note.txt", edits: [{ oldText: "Summary variant", newText: "Compare both variants" }] }],
        ["update_goal", { status: "complete" }],
      ] : [[name === "error" || name === "paused" || name === "blocked" ? "update_goal" : "get_goal", name === "error" ? { status: "complete" } : ["paused", "blocked"].includes(name) ? { status: name } : {}]];
      const messages = calls.map(([tool, args]) => {
        const call = { type: "toolCall", id: `goal-ui-${++serial}`, name: tool, arguments: args };
        plans.set(call.id, call);
        return ai.fauxAssistantMessage(call, { stopReason: "toolUse" });
      });
      faux.setResponses([...messages, ai.fauxAssistantMessage(`Review ready: ${name}. Use /variant summary or /variant minimal.`)]);
      pi.sendUserMessage(`Prototype scenario: ${name}`);
    } finally { launching = false; }
  };
  pi.registerCommand("demo", { description: "Run an isolated Goal UI scenario", handler: async (args, ctx) => run(args.trim() || "compare", ctx) });
  pi.registerCommand("variant", { description: "Switch all Goal rows: summary|minimal", handler: async (args, ctx) => {
    const value = args.trim();
    if (!["summary", "minimal"].includes(value)) { ctx.ui.notify("Use /variant summary or /variant minimal.", "info"); return; }
    preferences.density = value;
    for (const repaint of [...preferences.rows]) repaint();
    showDensity(ctx);
    ctx.ui.notify(`Prototype: ${value}`, "info");
  } });
  pi.registerCommand("finish", { description: "Complete the held running fixture", handler: async (_args, ctx) => {
    if (finishHeld) finishHeld(); else ctx.ui.notify("No held call. Use /demo running.", "info");
  } });
  pi.registerCommand("guide", { description: "Show prototype controls", handler: async (_args, ctx) => ctx.ui.notify(instructions, "info") });
  pi.registerCommand("fixture-theme", { description: "Switch the isolated theme for review", handler: async (args, ctx) => {
    if (["light", "codex-pi"].includes(args.trim())) ctx.ui.setTheme(args.trim());
  } });
  pi.on("session_start", (_event, ctx) => { ctx.ui.setToolsExpanded(false); showDensity(ctx); });
  pi.on("input", event => event.source === "extension" ? { action: "continue" } : { action: "handled" });
  pi.on("user_bash", () => ({ result: { output: "Only scripted sandbox Bash calls are enabled.", exitCode: 0, cancelled: false, truncated: false } }));
  pi.on("session_before_compact", () => ({ cancel: true }));
  pi.on("session_shutdown", () => { finishHeld?.(); preferences.rows.clear(); });
};
const create = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime,
    settingsManager: sdk.SettingsManager.inMemory({ quietStartup: true, theme: "codex-pi", retry: { enabled: false }, compaction: { enabled: false }, terminal: { showImages: false } }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalThemePaths: [join(root, "runtime/codex-pi.json")], systemPromptOverride: () => "Offline Goal UI fixture", extensionFactories: [extension] },
  });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), noTools: "builtin" }), services, diagnostics: services.diagnostics };
};
const manager = sdk.SessionManager.create(workspace, join(root, "sessions"));
manager.appendMessage({ role: "user", content: "Compare Goal tool display with existing tools.", timestamp: Date.now() });
manager.appendMessage({ ...ai.fauxAssistantMessage(instructions), timestamp: Date.now() });
const runtime = await sdk.createAgentSessionRuntime(create, { cwd: workspace, agentDir: join(root, "agent"), sessionManager: manager });
try {
  await new sdk.InteractiveMode(runtime, { migratedProviders: [], initialMessage: "/demo compare", tuiMode: process.env.GOAL_UI_FULLSCREEN === "1" ? "fullscreen" : "regular" }).run();
} finally {
  finishHeld?.();
  await runtime.session.abort();
  await runtime.dispose();
  assert.equal(networkAttempts, 0, "The prototype must not attempt network access");
}
