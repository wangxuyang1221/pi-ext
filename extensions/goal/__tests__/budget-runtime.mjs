import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { offlineCodex, rawUsage, textStep, toolStep } from "./budget-fixtures.mjs";

const root = resolve(process.env.GOAL_BUDGET_EVIDENCE ?? `.scratch/goal-level7-sdk-${Date.now()}`);
await mkdir(root, { recursive: true });
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_OFFLINE = "1";
process.env.PI_TELEMETRY = "0";
const packageRoot = resolve(process.argv[2] ?? "node_modules/@earendil-works/pi-coding-agent");
const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
const aiRoot = resolve(packageRoot, "../pi-ai");
const ai = await import(pathToFileURL(join(aiRoot, "dist/index.js")).href);
const adapter = await import(pathToFileURL(join(aiRoot, "dist/api/openai-codex-responses.js")).href);
const { registerGoal } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const { goalTokens } = await import("../dist/accounting.js");
const version = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network forbidden by offline budget acceptance"); };
const results = [];

const mapping = offlineCodex(ai, adapter, [textStep("Mapping", rawUsage()), textStep("Missing", null)]);
const mapped = await mapping.stream(mapping.model, { messages: [] }).result();
assert.equal(mapped.stopReason, "stop");
assert.equal(mapped.usage.input, 80);
assert.equal(mapped.usage.cacheRead, 40);
assert.equal(mapped.usage.output, 20);
assert.equal(mapped.usage.reasoning, 8);
assert.equal(goalTokens(mapped.usage), 100);
const missing = await mapping.stream(mapping.model, { messages: [] }).result();
assert.equal(missing.usage.input, 0);
await writeFile(join(root, "adapter-mapping.json"), JSON.stringify({ version, mapped, missing }, null, 2));

async function scenario(name, steps, check, options = {}) {
  const cwd = join(root, name);
  await mkdir(cwd, { recursive: true });
  const store = new GoalStore(join(cwd, "goals"));
  const fixture = offlineCodex(ai, adapter, steps);
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(fixture.provider);
  const notices = [], errors = [], events = [], contexts = [];
  let extensionPi;
  const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await sdk.createAgentSessionServices({ cwd, agentDir: join(root, "agent"), modelRuntime,
      settingsManager: sdk.SettingsManager.inMemory({ compaction: options.compaction ?? { enabled: false }, retry: options.retry ?? { enabled: false } }),
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
        extensionFactories: [pi => {
          extensionPi = pi;
          registerGoal(pi, store, { config: options.config ?? {} });
          pi.on("context", event => { contexts.push(structuredClone(event.messages)); });
          for (const type of ["message_start", "message_end", "agent_end", "agent_settled", "session_compact", "session_compact_failed"]) pi.on(type, event => { events.push(structuredClone(event)); });
          options.extend?.(pi);
        }],
      },
    });
    return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: fixture.model, tools: ["bash", "get_goal", "create_goal", "update_goal"] }), services, diagnostics: services.diagnostics };
  };
  const runtime = await sdk.createAgentSessionRuntime(createRuntime, { cwd, agentDir: join(root, "agent"), sessionManager: sdk.SessionManager.create(cwd, join(cwd, "sessions")) });
  const bind = session => session.bindExtensions({ mode: "tui", uiContext: { notify: (text, level) => notices.push({ text, level }), setStatus() {}, setWidget() {}, confirm: async () => true, editor: async (_title, text) => `${text} edited` },
    commandContextActions: { reload: () => runtime.session.reload(), waitForIdle: () => runtime.session.waitForIdle() }, onError: error => errors.push(error) });
  runtime.setRebindSession(bind);
  await bind(runtime.session);
  const timer = setTimeout(() => { void runtime.session.abort(); }, 8000);
  const goal = async () => (await store.records())[0]?.goal;
  try {
    await check({ runtime, session: runtime.session, fixture, store, goal, contexts, notices, events, pi: extensionPi });
    assert.deepEqual(errors, []);
    assert.equal(networkAttempts, 0);
    results.push({ name, calls: fixture.calls(), goal: await goal(), passed: true });
  } finally {
    clearTimeout(timer);
    await runtime.session.abort();
    await runtime.dispose();
    await writeFile(join(cwd, "events.json"), JSON.stringify({ contexts, providerContexts: fixture.contexts, notices, errors, events }, null, 2));
  }
}
try {
  await scenario("budget-100-actual-110", [toolStep("get_goal", {}), textStep("Wrapped up without declaring success")], async ({ session, fixture, goal, contexts }) => {
    await session.prompt("/goal Budget fixture"); await session.waitForIdle();
    assert.equal(fixture.calls(), 2);
    assert.equal((await goal()).tokensUsed, 110);
    assert.equal((await goal()).status, "budget_limited");
    assert.equal(contexts.flat().filter(message => message.customType === "pi-ext-goal-budget").length, 1);
    const getResult = session.messages.find(message => message.role === "toolResult" && message.toolName === "get_goal");
    assert.equal(JSON.parse(getResult.content[0].text).goal.tokensUsed, 100);
    await session.prompt("/goal edit");
    await session.prompt("/goal resume");
    assert.equal((await goal()).tokensUsed, 110);
    assert.equal((await goal()).status, "budget_limited");
    assert.equal(fixture.calls(), 2);
    await session.prompt("/reload");
    await session.prompt("/goal");
    assert.equal((await goal()).tokensUsed, 110);
  }, { config: { maxGoalTokenBudget: 100 } });
  await scenario("plain-final-soft-wrap", [textStep("Budget reached", rawUsage(80, 0, 20)), textStep("Wrapped up")], async ({ session, fixture, goal, contexts }) => {
    await session.prompt("/goal A final response can cross the soft budget"); await session.waitForIdle();
    assert.equal(fixture.calls(), 2);
    assert.equal((await goal()).tokensUsed, 110);
    assert.equal((await goal()).status, "budget_limited");
    assert.equal(contexts.flat().filter(message => message.customType === "pi-ext-goal-budget").length, 1);
  }, { config: { maxGoalTokenBudget: 100 } });
  await scenario("genuine-completion-in-wrap", [toolStep("get_goal", {}), toolStep("update_goal", { status: "complete" }, rawUsage(7, 0, 3)), textStep("Actually finished")], async ({ session, fixture, goal }) => {
    await session.prompt("/goal Complete only when finished"); await session.waitForIdle();
    assert.equal(fixture.calls(), 3);
    assert.equal((await goal()).tokensUsed, 110);
    assert.equal((await goal()).status, "complete");
  }, { config: { maxGoalTokenBudget: 100 } });
  await scenario("ordinary-error-below-budget", [textStep("Filtered", rawUsage(7, 0, 3), { status: "incomplete", incompleteReason: "content_filter" })], async ({ session, fixture, goal }) => {
    await session.prompt("/goal Stop on ordinary error"); await session.waitForIdle();
    assert.equal(fixture.calls(), 1);
    assert.equal((await goal()).tokensUsed, 10);
    assert.equal((await goal()).status, "blocked");
  }, { config: { maxGoalTokenBudget: 100 } });
  await scenario("model-creation-baseline", [toolStep("create_goal", { objective: "Explicit fixture", token_budget: 100 }, rawUsage(900, 0, 100, 10)), toolStep("get_goal", {}), textStep("Wrapped up")], async ({ session, fixture, goal }) => {
    await session.prompt("Explicitly create the budgeted goal"); await session.waitForIdle();
    assert.equal(fixture.calls(), 3);
    assert.equal((await goal()).tokensUsed, 110);
    assert.equal((await goal()).status, "budget_limited");
  });
  await scenario("duplicate-response", [toolStep("get_goal", {}, rawUsage(7, 0, 3), { id: "duplicate" }), toolStep("get_goal", {}, rawUsage(7, 0, 3), { id: "duplicate" }), toolStep("update_goal", { status: "complete" }, rawUsage(7, 0, 3)), textStep("Finished")], async ({ session, fixture, goal }) => {
    await session.prompt("/goal Deduplicate"); await session.waitForIdle();
    assert.equal(fixture.calls(), 4);
    assert.equal((await goal()).tokensUsed, 20);
    assert.equal((await goal()).status, "complete");
  });
  await scenario("budget-wrap-native-retry", [toolStep("get_goal", {}), { error: "500 Internal Server Error" }, textStep("Wrapped after retry")], async ({ session, fixture, goal, contexts }) => {
    await session.prompt("/goal Preserve budget through a native retry"); await session.waitForIdle();
    assert.equal(fixture.calls(), 3);
    assert.equal((await goal()).tokensUsed, 110);
    assert.equal((await goal()).status, "budget_limited");
    assert.equal((await goal()).usageIncomplete, true);
    const reminders = contexts.flat().filter(message => message.customType === "pi-ext-goal-budget");
    assert.equal(reminders.length, 2);
    assert.equal(new Set(reminders.map(message => message.details.scheduleId)).size, 1);
    assert.deepEqual(reminders[0], reminders[1]);
  }, { config: { maxGoalTokenBudget: 100 }, retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } });
  await scenario("budget-then-quota-error", [toolStep("get_goal", {}), { error: "insufficient_quota" }], async ({ session, goal, notices, fixture }) => {
    await session.prompt("/goal Quota failure during wrap-up"); await session.waitForIdle();
    assert.equal(fixture.calls(), 2);
    assert.equal((await goal()).tokensUsed, 100);
    assert.equal((await goal()).status, "usage_limited");
    assert.equal((await goal()).usageIncomplete, true);
    assert.ok(notices.some(notice => notice.text.includes("usage is incomplete")));
  }, { config: { maxGoalTokenBudget: 100 } });
  await scenario("error-with-visible-usage", [textStep("Filtered", rawUsage(100, 0, 10), { status: "incomplete", incompleteReason: "content_filter" })], async ({ session, goal, fixture }) => {
    await session.prompt("/goal Error with real adapter usage"); await session.waitForIdle();
    assert.equal(fixture.calls(), 1);
    assert.equal((await goal()).tokensUsed, 110);
    assert.equal((await goal()).status, "budget_limited");
  }, { config: { maxGoalTokenBudget: 100 } });
  await scenario("missing-usage", [toolStep("get_goal", {}, null), toolStep("update_goal", { status: "complete" }, rawUsage(7, 0, 3)), textStep("Done")], async ({ session, goal, notices }) => {
    await session.prompt("/goal Diagnose missing usage"); await session.waitForIdle();
    assert.equal((await goal()).tokensUsed, 10);
    assert.equal((await goal()).usageIncomplete, true);
    assert.ok(notices.some(notice => notice.text.includes("usage is incomplete")));
  });
  await scenario("native-compaction-usage", [textStep("Progress", rawUsage(120000, 119000, 1)), textStep("Summary"), toolStep("update_goal", { status: "complete" }, rawUsage(7, 0, 3)), textStep("Done")], async ({ session, goal, fixture }) => {
    await session.prompt("/goal Count compaction usage, not tokensBefore"); await session.waitForIdle();
    assert.equal(fixture.calls(), 4);
    assert.equal((await goal()).tokensUsed, 1021);
    assert.equal((await goal()).status, "complete");
  }, { compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 1 } });
  console.log(JSON.stringify({ version, networkAttempts, results }, null, 2));
} finally { await writeFile(join(root, "results.json"), JSON.stringify({ version, networkAttempts, results }, null, 2)); }
