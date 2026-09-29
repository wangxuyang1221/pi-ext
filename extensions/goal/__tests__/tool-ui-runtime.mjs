import assert from "node:assert/strict";
import { appendFileSync, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repo = resolve(import.meta.dirname, "../../..");
const tui = process.argv.includes("--tui");
const standalone = process.argv.includes("--standalone");
await mkdir(join(repo, ".tmp"), { recursive: true });
const root = process.env.GOAL_UI_TEST_ROOT ?? await mkdtemp(join(repo, ".tmp/goal-ui-integration-"));
assert.ok(root.startsWith(join(repo, ".tmp/")));
for (const name of ["home", "tmp", "agent", "sessions", "workspace"]) await mkdir(join(root, name), { recursive: true });
Object.assign(process.env, { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1", PI_TELEMETRY: "0" });
delete process.env.PI_SUBAGENT_PARENT;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Integration test forbids network"); };
const sdk = await import("@earendil-works/pi-coding-agent");
const ai = await import("@earendil-works/pi-ai");
const { stripTerminalSequences } = await import("@earendil-works/pi-tui");
const goalExtension = (await import("../dist/index.js")).default;
const codexUi = standalone ? undefined : (await import("../../codex-ui/dist/index.js")).default;
const { GoalStore } = await import("../dist/storage.js");
const store = new GoalStore(join(root, "agent/goals"));
const cwd = join(root, "workspace");
const log = (event, data = {}) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ event, ...data }) + "\n");
const definitions = new Map();
const errors = [];
const unexpectedModelErrors = [];
const results = [];
const contexts = [];
const faux = ai.fauxProvider({ provider: "openai-codex", tokensPerSecond: tui ? 10000 : undefined });
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
let serial = 0, scenario = "mixed", incomplete = false, holding;
const call = (name, args) => ai.fauxAssistantMessage({ type: "toolCall", id: `ui-${++serial}`, name, arguments: args }, { stopReason: "toolUse" });
const objective = "统一 Goal 工具 UI";
const long = "中文🙂第一行\u001b]52;c;YQ==\u0007\u001b[2J\n" + "检查 Goal summary 与真实工具同屏，保留模型数据。🙂 ".repeat(25) + "\nLONG-GOAL-END";
function steps(name) {
  switch (name) {
    case "mixed": return [call("bash", { command: "printf 'Real Bash output\\n'" }), call("create_goal", { objective, token_budget: 500000 }), async () => { await sleep(1100); return call("write", { path: "ui-note.txt", content: "Before edit\n" }); }, call("get_goal", {}), call("edit", { path: "ui-note.txt", edits: [{ oldText: "Before edit", newText: "After edit" }] }), call("update_goal", { status: "complete" })];
    case "empty": return [call("get_goal", {})];
    case "error": return [call("update_goal", { status: "complete" })];
    case "long": return [call("create_goal", { objective: long }), call("get_goal", {}), call("update_goal", { status: "complete" })];
    case "paused": return [call("create_goal", { objective: "Unbounded goal" }), call("update_goal", { status: "paused" })];
    case "blocked": return [call("update_goal", { status: "blocked" })];
    case "complete": return [call("update_goal", { status: "complete" })];
    case "quota": return [call("create_goal", { objective: "Provider quota goal" }), ai.fauxAssistantMessage("", { stopReason: "error", errorMessage: "usage_limit_reached" })];
    case "budget": return [call("create_goal", { objective: "Small budget", token_budget: 1 })];
    case "incomplete": return [call("create_goal", { objective: "Incomplete usage goal" }), call("get_goal", {}), call("update_goal", { status: "paused" })];
    case "read": case "held": return [call("get_goal", {})];
    default: throw new Error(`Unknown scenario: ${name}`);
  }
}
function prepare(name) {
  scenario = name; incomplete = name === "incomplete";
  faux.setResponses([...steps(name), ...(name === "quota" ? [] : [ai.fauxAssistantMessage(`Scenario finished: ${name}`)]), ...(name === "budget" ? [ai.fauxAssistantMessage("Budget report finished")] : [])]);
}
const observer = pi => {
  // Only model usage is substituted for this boundary case. Goal accounting remains real.
  pi.on("message_end", event => {
    if (incomplete && event.message.role === "assistant") return { message: { ...event.message, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } };
  });
};
const capture = factory => pi => factory(new Proxy(pi, { get(target, key) {
  if (key === "registerTool") return tool => { definitions.set(tool.name, tool); return pi.registerTool(tool); };
  return Reflect.get(target, key);
} }));
const controls = pi => {
  pi.on("message_end", event => {
    if (event.message.role === "assistant" && event.message.stopReason === "error") {
      log("model-error", { scenario, error: event.message.errorMessage });
      if (event.message.errorMessage !== "usage_limit_reached") unexpectedModelErrors.push(event.message.errorMessage);
    }
  });
  pi.on("context", event => { contexts.push(structuredClone(event.messages)); });
  pi.on("tool_call", async event => {
    if (scenario === "held" && event.toolName === "get_goal") {
      log("held"); await new Promise(done => { holding = done; }); holding = undefined;
    }
  });
  pi.on("tool_result", event => {
    const result = structuredClone({ toolName: event.toolName, input: event.input, content: event.content, details: event.details, isError: event.isError });
    results.push(result); log("tool-result", result);
  });
  pi.on("session_start", (event, ctx) => { log("ready", { reason: event.reason, mode: ctx.mode, pid: process.pid, sessionFile: ctx.sessionManager.getSessionFile() }); });
  pi.on("agent_settled", async () => log("settled", { scenario, calls: faux.state.callCount, goal: (await store.records())[0]?.goal }));
  pi.registerCommand("probe", { description: "Run an isolated production UI test", handler: async (name, ctx) => { assert.ok(ctx.isIdle()); prepare(name.trim()); pi.sendUserMessage(`UI test: ${name.trim()}`); } });
  pi.registerCommand("probe-release", { description: "Release test preflight gate", handler: async () => holding?.() });
  pi.registerCommand("probe-theme", { description: "Change test theme", handler: async (name, ctx) => ctx.ui.setTheme(name.trim()) });
  pi.registerCommand("probe-save", { description: "Save test results", handler: async (_args, ctx) => {
    assert.deepEqual(unexpectedModelErrors, []);
    await writeFile(join(root, "session-path.txt"), ctx.sessionManager.getSessionFile());
    log("saved", { entries: ctx.sessionManager.getEntries(), networkAttempts });
    ctx.ui.notify("Evidence saved", "info");
  } });
  pi.on("session_shutdown", () => { holding?.(); log("shutdown"); });
};
const factory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime,
    settingsManager: sdk.SettingsManager.inMemory({ quietStartup: true, theme: "codex-pi", compaction: { enabled: false }, retry: { enabled: false }, terminal: { showImages: false } }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalThemePaths: [join(repo, "themes/codex-pi.json")], systemPromptOverride: () => "Offline production Goal UI integration.", extensionFactories: [observer, ...(!standalone ? [capture(codexUi)] : []), capture(goalExtension), controls] },
  });
  return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), tools: ["bash", "write", "edit", "get_goal", "create_goal", "update_goal"] }), services, diagnostics: services.diagnostics };
};
let runtime;
const { theme } = await import(pathToFileURL(join(repo, "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js")));
sdk.initTheme("dark");
const bind = async (session, mode = "tui") => session.bindExtensions({ mode, uiContext: { theme, getTheme: () => undefined, setHeader() {}, setFooter() {}, setEditorComponent() {}, setTitle() {}, setWorkingVisible() {}, notify: (message, level) => log("notice", { message, level }), setStatus() {}, setWidget() {}, confirm: async () => false }, onError: error => errors.push(error), commandContextActions: { waitForIdle: () => runtime.session.waitForIdle(), reload: () => runtime.session.reload() } });
async function start(manager, mode = "tui") {
  runtime = await sdk.createAgentSessionRuntime(factory, { cwd, agentDir: join(root, "agent"), sessionManager: manager });
  runtime.setRebindSession(bind);
  if (!tui) await bind(runtime.session, mode);
}
// JSONL omits optional undefined properties; compare the persisted representation.
const history = () => JSON.parse(JSON.stringify(runtime.session.messages.filter(message => message.role === "toolResult" && message.toolName.endsWith("_goal"))));
function render(message) {
  const row = new sdk.ToolExecutionComponent(message.toolName, message.toolCallId, {}, { showImages: false }, definitions.get(message.toolName), { requestRender() {} }, cwd);
  row.updateResult(message);
  return row.render(100).map(stripTerminalSequences).join("\n");
}
async function run(name) { prepare(name); await runtime.session.prompt(`UI test: ${name}`); await runtime.session.waitForIdle(); }
try {
  const resumed = process.argv.includes("--resume") ? (await readFile(join(root, "session-path.txt"), "utf8")) : undefined;
  await start(resumed ? sdk.SessionManager.open(resumed, join(root, "sessions")) : sdk.SessionManager.create(cwd, join(root, "sessions")));
  if (tui) {
    await new sdk.InteractiveMode(runtime, { migratedProviders: [], tuiMode: process.argv.includes("--fullscreen") ? "fullscreen" : "regular", ...(!resumed ? { initialMessage: "/probe empty" } : {}) }).run();
  } else {
    sdk.initTheme("dark");
    await run("empty"); assert.equal(results.at(-1).details.goal, null);
    await run("error"); assert.equal(results.at(-1).isError, true); assert.match(render(history().at(-1)), /Update goal failed/);
    await run("mixed");
    const mixed = results.slice(-6);
    assert.deepEqual(mixed.map(r => r.toolName), ["bash", "create_goal", "write", "get_goal", "edit", "update_goal"]);
    assert.ok(mixed.every(r => !r.isError), JSON.stringify(mixed));
    assert.equal(await readFile(join(cwd, "ui-note.txt"), "utf8"), "After edit\n");
    const create = mixed[1].details.goal, read = mixed[3].details.goal, update = mixed[5].details.goal;
    assert.equal(create.tokensUsed, 0); assert.equal(create.status, "active");
    assert.ok(read.tokensUsed > 0); assert.ok(update.tokensUsed >= read.tokensUsed); assert.equal(update.status, "complete");
    assert.ok(read.timeUsedSeconds >= 1); assert.ok(update.timeUsedSeconds >= read.timeUsedSeconds);
    assert.equal((await store.records())[0].goal.tokensUsed, update.tokensUsed);
    const mixedUsage = runtime.session.messages.filter(message => message.role === "assistant" && message.content.some(part => part.type === "toolCall" && ["write", "get_goal", "edit", "update_goal"].includes(part.name))).slice(-4).map(message => message.usage);
    assert.equal(update.tokensUsed, mixedUsage.reduce((sum, usage) => sum + usage.input + usage.output + usage.cacheWrite, 0));
    for (const r of mixed.filter(r => r.toolName.endsWith("_goal"))) assert.deepEqual(JSON.parse(r.content[0].text), r.details);
    assert.ok(contexts.some(messages => messages.some(m => m.role === "toolResult" && m.content?.[0]?.text === mixed[3].content[0].text)));
    const saved = structuredClone(history()); const painted = saved.map(render);
    await run("paused"); assert.equal(results.at(-1).details.goal.status, "paused"); assert.equal(results.at(-1).details.goal.tokenBudget, null);
    await run("blocked"); assert.equal(results.at(-1).details.goal.status, "blocked");
    await run("complete");
    await run("long"); assert.equal(results.at(-1).details.goal.objective, long);
    await run("budget"); await run("read"); assert.equal(results.at(-1).details.goal.status, "budget_limited");
    await run("complete");
    await run("incomplete"); await run("read"); assert.match(results.at(-1).details.usageVisibility, /^incomplete/); assert.match(render(history().at(-1)), /Observed usage only/);
    await run("complete");
    await run("quota"); await run("read"); assert.equal(results.at(-1).details.goal.status, "usage_limited"); await run("complete");
    assert.deepEqual(history().slice(0, saved.length), saved);
    assert.deepEqual(saved.map(render), painted);
    const sessionFile = runtime.session.sessionFile;
    await runtime.session.reload(); assert.deepEqual(history().slice(0, saved.length), saved); assert.deepEqual(saved.map(render), painted);
    const beforeRestart = structuredClone(history());
    await runtime.dispose();
    await start(sdk.SessionManager.open(sessionFile, join(root, "sessions")));
    assert.deepEqual(history(), beforeRestart); assert.deepEqual(saved.map(render), painted);
    await runtime.dispose();
    await start(sdk.SessionManager.open(sessionFile, join(root, "sessions")), "print");
    assert.ok(!runtime.session.agent.state.tools.some(tool => tool.name === "create_goal" || tool.name === "update_goal"));
    await run("read"); assert.equal(results.at(-1).details.goal.status, "complete");
    assert.deepEqual(JSON.parse(results.at(-1).content[0].text), results.at(-1).details);
    const diskBeforeCancel = await store.records();
    for (const name of ["get_goal", "create_goal", "update_goal"]) {
      await assert.rejects(definitions.get(name).execute("cancel", {}, AbortSignal.abort(), undefined, {}), /^Error: Goal tool invocation was cancelled\.$/);
      assert.match(render({ toolName: name, toolCallId: "cancel", content: [{ type: "text", text: "Goal tool invocation was cancelled." }], isError: true }), /interrupted/);
    }
    assert.deepEqual(await store.records(), diskBeforeCancel);
    assert.deepEqual(errors, []); assert.deepEqual(unexpectedModelErrors, []); assert.equal(networkAttempts, 0);
    const source = await readFile(join(repo, "extensions/goal/src/tools.ts"), "utf8");
    const baseline = execFileSync("git", ["show", "f545195:extensions/goal/src/tools.ts"], { cwd: repo, encoding: "utf8" });
    assert.equal(source.replace('import { goalRenderers } from "./renderers.js";\n', "").replaceAll(/\.\.\.goalRenderers\("(?:get|create|update)_goal"\), /g, ""), baseline);
    const ts = await import("typescript");
    for (const file of ["tools", "upstream"]) {
      const input = execFileSync("git", ["show", `f545195:extensions/goal/src/${file}.ts`], { cwd: repo, encoding: "utf8" });
      await writeFile(join(root, `${file}.js`), ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
    }
    const oldTools = new Map();
    (await import(pathToFileURL(join(root, "tools.js")))).registerGoalTools({ registerTool: tool => oldTools.set(tool.name, tool) }, {});
    for (const [name, tool] of oldTools) {
      const current = definitions.get(name);
      assert.deepEqual(current.parameters, tool.parameters); assert.equal(current.description, tool.description); assert.equal(current.execute.toString(), tool.execute.toString());
    }
    for (const result of results.filter(item => item.toolName.endsWith("_goal") && !item.isError)) {
      const value = result.details.goal;
      const record = value === null ? undefined : { ownerSessionId: value.threadId, goal: { objective: value.objective, status: value.status, tokensUsed: value.tokensUsed, tokenBudget: value.tokenBudget ?? undefined, elapsedSeconds: value.timeUsedSeconds, createdAt: new Date(value.createdAt * 1000).toISOString(), updatedAt: new Date(value.updatedAt * 1000).toISOString(), usageIncomplete: result.details.usageVisibility.startsWith("incomplete") } };
      const access = { get: async () => record, create: async () => record, update: async () => record };
      const baselineTools = new Map();
      (await import(pathToFileURL(join(root, "tools.js")))).registerGoalTools({ registerTool: tool => baselineTools.set(tool.name, tool) }, access);
      const expected = await baselineTools.get(result.toolName).execute("contract", result.input, undefined, undefined, {});
      assert.deepEqual(expected, { content: result.content, details: result.details });
    }
    const report = { passed: true, standalone, pid: process.pid, versions: { node: process.version, pi: JSON.parse(await readFile(join(repo, "node_modules/@earendil-works/pi-coding-agent/package.json"))).version }, scenarios: ["empty", "failure", "mixed-production-tools", "active", "paused", "blocked", "complete", "long-controls", "budget_limited", "usage_limited", "incomplete-usage", "explicit-cancellation",  "history", "reload", "restart", "print-read", "baseline-contract"], mixed, results, modelCalls: faux.state.callCount, networkAttempts, errors, unexpectedModelErrors };
    await writeFile(join(repo, `adventure/39/evidence/implementation/sdk${standalone ? "-standalone" : ""}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, standalone, scenarios: report.scenarios, modelCalls: faux.state.callCount, pid: process.pid }));
  }
} finally {
  holding?.(); await runtime?.session.abort(); await runtime?.dispose();
  assert.equal(networkAttempts, 0);
  if (!tui) { await rm(root, { recursive: true, force: true }); assert.equal(existsSync(root), false); console.log(JSON.stringify({ cleanup: true, pid: process.pid, rootRemoved: true })); }
}
