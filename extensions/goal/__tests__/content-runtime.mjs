import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.env.GOAL_CONTENT_EVIDENCE);
for (const name of ["home", "agent", "tmp", "sessions"]) await mkdir(join(root, name), { recursive: true });
Object.assign(process.env, { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), PI_CODING_AGENT_DIR: join(root, "agent"), PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"), PI_OFFLINE: "1", PI_TELEMETRY: "0" });
const packageRoot = resolve(process.argv[2]);
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network disabled by content runtime test"); };
const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
const ai = await import(pathToFileURL(resolve(packageRoot, "../pi-ai/dist/index.js")).href);
const { registerGoal } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const { GoalContent } = await import("../dist/content.js");
const version = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
const store = new GoalStore(join(root, "goals"));
const faux = ai.fauxProvider({ provider: "openai-codex", tokensPerSecond: 1000000 });
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false });
modelRuntime.registerNativeProvider(faux.provider);
const tool = (name, args, id) => ai.fauxAssistantMessage({ type: "toolCall", name, arguments: args, id }, { stopReason: "toolUse" });
faux.setResponses([
  tool("create_goal", { objective: "🧭".repeat(4001) }, "too-long"), ai.fauxAssistantMessage("Rejected invalid objective"),
  tool("create_goal", { objective: "🧭".repeat(4000) }, "boundary"),
  tool("update_goal", { status: "complete" }, "complete"), ai.fauxAssistantMessage("Completed boundary fixture"),
]);
const errors = [];
const results = [];
const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager, noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true, extensionFactories: [pi => registerGoal(pi, store)] });
await loader.reload();
const { session } = await sdk.createAgentSession({ cwd: root, agentDir: join(root, "agent"), modelRuntime, model: faux.getModel(), resourceLoader: loader, sessionManager: sdk.SessionManager.create(root, join(root, "sessions")), settingsManager, tools: ["read", "get_goal", "create_goal", "update_goal"] });
await session.bindExtensions({ mode: "tui", uiContext: { notify() {}, setStatus() {}, confirm: async () => true, editor: async (_title, text) => text }, onError: error => errors.push(error.message) });
session.subscribe(event => { if (event.type === "tool_execution_end") results.push({ id: event.toolCallId, isError: event.isError, result: event.result }); });
const timer = setTimeout(() => { void session.abort(); }, 15000);
try {
  await session.prompt("Explicitly create the provided overlong goal for boundary validation.");
  await session.waitForIdle();
  assert.equal((await store.records())[0]?.goal ?? null, null);
  assert.equal(results[0].id, "too-long");
  assert.equal(results[0].isError, true);
  assert.ok(JSON.stringify(results[0].result).includes("4000"));
  await session.prompt("Explicitly create and complete the boundary goal.");
  await session.waitForIdle();
  const goal = (await store.records())[0].goal;
  assert.equal(goal.objective, "🧭".repeat(4000));
  assert.equal(goal.content, undefined);
  assert.equal(goal.status, "complete");
  assert.ok(results.slice(1).every(result => !result.isError));
  assert.equal(faux.state.callCount, 5);
  assert.deepEqual(errors, []);
  assert.equal(networkAttempts, 0);
  const content = new GoalContent(join(store.root, "content"), join(root, "tmp"));
  const text = "x".repeat(1024 * 1024);
  const start = performance.now();
  const draft = await content.prepare(text, []);
  const materializeMs = performance.now() - start;
  const readStart = performance.now();
  assert.equal(await content.expand(draft), text);
  const expandMs = performance.now() - readStart;
  await content.discard(draft);
  await writeFile(join(root, "results.json"), JSON.stringify({ version, pid: process.pid, networkAttempts, modelCalls: faux.state.callCount, toolResults: results.map(({ id, isError }) => ({ id, isError })), unicodeBoundary: [4000, 4001], goalId: goal.goalId, performance: { textBytes: Buffer.byteLength(text), materializeMs, expandMs, peakRssBytes: process.resourceUsage().maxRSS * 1024 } }, null, 2));
  console.log(JSON.stringify({ version, passed: true, evidence: root }));
} finally {
  clearTimeout(timer);
  await session.abort();
  session.dispose();
  await writeFile(join(root, "cleanup.json"), JSON.stringify({ pid: process.pid, disposed: true }));
}
