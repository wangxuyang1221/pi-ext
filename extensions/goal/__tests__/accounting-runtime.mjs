import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadSdk, offlineModels, families, usage, cacheOnly, cache90, text, tool } from "./accounting-fixtures.mjs";

const root = await mkdtemp(resolve(".goal-accounting-test-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_OFFLINE = "1";
process.env.PI_TELEMETRY = "0";
delete process.env.PI_SUBAGENT_PARENT;
const loaded = await loadSdk(process.argv[2]);
const { sdk, ai, versions } = loaded;
const product = resolve(process.env.GOAL_PRODUCT_ROOT ?? ".");
const { registerGoal } = await import(`${product}/extensions/goal/dist/index.js`);
const { GoalStore } = await import(`${product}/extensions/goal/dist/storage.js`);
const results = [];
async function scenario(name, family, budget, check) {
  const cwd = await mkdtemp(join(root, "case-"));
  const agentDir = join(cwd, "agent"); await mkdir(agentDir);
  const store = new GoalStore(join(cwd, "goals"));
  const fixture = await offlineModels(loaded);
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  for (const provider of fixture.providers) modelRuntime.registerNativeProvider(provider);
  const notices = [], errors = [], lifecycle = [], normalized = [], toolResults = [];
  let api;
  const create = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await sdk.createAgentSessionServices({ cwd, agentDir, modelRuntime,
      settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false } }),
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true, extensionFactories: [pi => {
        api = pi;
        registerGoal(pi, store, { config: budget === undefined ? {} : { maxGoalTokenBudget: budget }, temporaryRoot: cwd });
        pi.on("message_end", event => { if (event.message.role === "assistant") normalized.push(structuredClone(event.message)); });
        pi.on("tool_result", event => { toolResults.push({ name: event.toolName, isError: event.isError, details: event.details, content: event.content }); });
        for (const type of ["agent_end", "agent_settled", "session_compact", "session_tree"]) pi.on(type, async event => lifecycle.push({ type, goal: (await store.records())[0]?.goal, ...(event.compactionEntry ? { usage: event.compactionEntry.usage } : {}), ...(event.summaryEntry ? { usage: event.summaryEntry.usage } : {}) }));
      }] },
    });
    return { ...await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: fixture.models[family], noTools: "builtin" }), services, diagnostics: services.diagnostics };
  };
  const runtime = await sdk.createAgentSessionRuntime(create, { cwd, agentDir, sessionManager: sdk.SessionManager.create(cwd, join(cwd, "sessions")) });
  const bind = session => session.bindExtensions({ mode: "tui", uiContext: { notify: (message, level) => notices.push({ message, level }), setStatus() {}, setWidget() {}, confirm: async () => true, editor: async (_title, value) => `${value} edited` }, commandContextActions: { waitForIdle: () => runtime.session.waitForIdle(), reload: () => runtime.session.reload() }, onError: error => errors.push(error.message) });
  runtime.setRebindSession(bind); await bind(runtime.session);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void runtime.session.abort(); }, 20000);
  const h = { runtime, fixture, store, cwd, notices, normalized, lifecycle, toolResults, get api() { return api; }, get session() { return runtime.session; }, goal: async () => (await store.records()).find(r => r.ownerSessionId === runtime.session.sessionId)?.goal, prompt: async value => { await runtime.session.prompt(value); await runtime.session.waitForIdle(); } };
  try {
    await check(h);
    fixture.verify(); assert.equal(timedOut, false); assert.deepEqual(errors, []);
    assert.ok(toolResults.every(t => !t.isError), JSON.stringify(toolResults.filter(t => t.isError)));
    results.push({ name, family, budget, requests: fixture.requests, wire: fixture.wire, normalized, notices, lifecycle, toolResults, goal: await h.goal(), networkAttempts: fixture.networkAttempts });
    console.error(`PASS ${versions["pi-coding-agent"]} ${name} (${fixture.requests.length} requests)`);
  } finally { clearTimeout(timer); await runtime.session.abort(); await runtime.dispose(); }
}
try {
  for (const family of families) {
    for (const [kind, value] of [["cache90", family === "google" ? usage(80, 10, 0, 20, 8) : cache90], ["cache-read-only", cacheOnly], ["zero", usage(0, 0)], ["missing", undefined], ["invalid", usage(0, -1)]]) {
      for (const budget of [undefined, 1000]) {
        await scenario(`${family}-${kind}-${budget ?? "unbounded"}`, family, budget, async h => {
          const missing = ["zero", "missing", "invalid"].includes(kind);
          const initial = kind === "cache90" ? 90 : 0;
          h.fixture.setSteps([tool("get_goal", {}, value), text(usage()), tool("update_goal", { status: "paused" }), text(cacheOnly)]);
          // Explicit undefined must reach the custom contract, not a helper default.
          if (kind === "missing") h.fixture.setSteps([{ ...tool("get_goal", {}), usage: undefined }, text(usage()), tool("update_goal", { status: "paused" }), text(cacheOnly)]);
          await h.prompt("/goal Account native response usage");
          assert.equal(h.fixture.requests.length, 4);
          assert.equal((await h.goal()).tokensUsed, initial + 7);
          assert.equal(!!(await h.goal()).usageIncomplete, missing);
          assert.equal(h.toolResults[0].details.goal.status, "active");
          assert.equal(h.toolResults[0].details.goal.tokensUsed, initial);
          assert.equal(h.toolResults[0].details.usageVisibility.startsWith("incomplete"), missing);
          assert.equal(h.toolResults[1].details.usageVisibility.startsWith("incomplete"), missing);
          assert.equal(h.notices.some(n => n.level === "warning" && n.message.includes("usage is incomplete")), missing);
          if (kind === "cache90") {
            const got = h.normalized[0].usage;
            assert.equal(got.input, family === "google" ? 80 : 50);
            assert.equal(got.output, 10); assert.equal(got.cacheWrite, family === "google" ? 0 : 30);
            assert.equal(got.cacheRead, 20); assert.equal(got.reasoning, 8);
          }
        });
      }
    }
    await scenario(`${family}-receipt-replay`, family, undefined, async h => {
      h.fixture.setSteps([tool("get_goal", {}, usage(), { id: "same-receipt" }), tool("get_goal", {}, usage(), { id: "same-receipt" }), tool("update_goal", { status: "paused" }), text(cacheOnly)]);
      await h.prompt("/goal Deduplicate native receipts");
      assert.equal((await h.goal()).tokensUsed, 7);
    });
    await scenario(`${family}-soft-110-of-100`, family, 100, async h => {
      h.fixture.setSteps([text(usage(90, 10)), text(usage(7, 3))]);
      await h.prompt("/goal Soft budget accounting");
      assert.equal((await h.goal()).tokensUsed, 110); assert.equal((await h.goal()).status, "budget_limited");
      assert.equal(h.session.messages.filter(m => m.customType === "pi-ext-goal-budget").length, 1);
      await h.prompt("/goal edit"); await h.prompt("/goal resume"); await h.session.reload();
      assert.equal((await h.goal()).tokensUsed, 110); assert.equal((await h.goal()).tokenBudget, 100); assert.equal((await h.goal()).status, "budget_limited");
      assert.equal(h.fixture.requests.length, 2);
    });
  }
  await scenario("gap-edit-resume-reload-inherit-replace", "anthropic", 1000, async h => {
    h.fixture.setSteps([{ ...tool("get_goal", {}), usage: undefined }, text(usage()), tool("update_goal", { status: "paused" }), text(cacheOnly)]);
    await h.prompt("/goal Persistent incomplete usage");
    const id = (await h.goal()).goalId;
    await h.prompt("/goal edit"); await h.session.reload();
    assert.equal((await h.goal()).goalId, id); assert.equal((await h.goal()).tokensUsed, 7); assert.equal((await h.goal()).usageIncomplete, true);
    h.fixture.setSteps([tool("get_goal", {}), tool("update_goal", { status: "paused" }), text(cacheOnly)]);
    await h.prompt("/goal resume");
    assert.equal(h.toolResults.at(-2).details.usageVisibility, "incomplete: reported tokens include only observed usage");
    assert.equal((await h.goal()).tokensUsed, 7); assert.equal((await h.goal()).tokenBudget, 1000);
    const parent = (await h.store.records())[0];
    const inherited = await h.store.openSession({ ownerSessionId: "inherited-fixture", cwd: h.cwd, sessionFile: join(h.cwd, "inherited.jsonl") });
    try { await inherited.inherit(parent); assert.equal(inherited.snapshot.goal.tokensUsed, 7); assert.equal(inherited.snapshot.goal.usageIncomplete, true); assert.equal(inherited.snapshot.goal.childUsage, undefined); assert.equal(inherited.snapshot.continuationDeferral, true); } finally { await inherited.close(); }
    h.fixture.setSteps([tool("update_goal", { status: "paused" }), text(cacheOnly)]);
    await h.prompt("/goal Independent replacement");
    assert.notEqual((await h.goal()).goalId, id); assert.equal((await h.goal()).tokensUsed, 0); assert.equal((await h.goal()).usageIncomplete, undefined);
  });
  await scenario("native-root-compaction-branch-cross-provider", "completions", undefined, async h => {
    h.fixture.setSteps([text(usage(6, 4), { text: "Root history ".repeat(1000), wait: async () => { h.api.setActiveTools(h.api.getActiveTools().filter(t => t !== "create_goal")); } })]);
    await h.prompt("/goal Combine attributable summary sources");
    assert.equal((await h.goal()).tokensUsed, 10);
    await h.session.setModel(h.fixture.models.anthropic);
    // Pi 1.4 retains a partial turn here and summarizes its prefix separately.
    // Both real provider responses must be attributed exactly once.
    h.fixture.setSteps([text(usage(12, 8), { family: "anthropic", text: "Summary of previous work" }),
      text(usage(3, 4), { family: "anthropic", text: "Summary of the retained turn prefix" })]);
    await h.session.compact();
    assert.equal((await h.goal()).tokensUsed, 37);
    await h.session.setModel(h.fixture.models.google);
    h.fixture.setSteps([text(usage(6, 4), { family: "google", text: "Branch summary" })]);
    const first = h.session.sessionManager.getEntries().find(e => e.type === "custom_message");
    assert.ok(first, "Goal kickoff entry must exist before branch navigation");
    await h.session.navigateTree(first.id, { summarize: true });
    assert.equal((await h.goal()).tokensUsed, 47);
    assert.ok(h.lifecycle.some(e => e.type === "session_compact" && e.usage));
    assert.ok(h.lifecycle.some(e => e.type === "session_tree" && e.usage));
    await h.session.reload(); assert.equal((await h.goal()).tokensUsed, 47);
  });
} finally { await rm(root, { recursive: true, force: true }); }
const report = { versions, product, pid: process.pid, offline: true, results, cleanup: { temporaryRootRemoved: true, listeningPorts: [] } };
if (process.env.GOAL_ACCOUNTING_EVIDENCE) await writeFile(resolve(process.env.GOAL_ACCOUNTING_EVIDENCE), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ versions, scenarios: results.length, requests: results.reduce((n, r) => n + r.requests.length, 0), passed: true }));
