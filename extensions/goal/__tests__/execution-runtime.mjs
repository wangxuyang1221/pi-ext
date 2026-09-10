import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = await mkdtemp(resolve(".goal-execution-test-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_OFFLINE = "1";
process.env.PI_TELEMETRY = "0";
const packageRoot = resolve(process.argv[2] ?? "node_modules/@earendil-works/pi-coding-agent");
const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
const ai = await import(pathToFileURL(resolve(packageRoot, "../pi-ai/dist/index.js")).href);
const { registerGoal } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const version = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).version;
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Network disabled by execution tests"); };
const results = [];
const evidence = [];
const faux = ai.fauxProvider({ provider: "openai-codex", tokensPerSecond: 100000 });
const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
const tool = (name, args, id = "test") => ai.fauxAssistantMessage({ type: "toolCall", name, arguments: args, id }, { stopReason: "toolUse" });
async function scenario(name, responses, check, options = {}) {
  const cwd = await mkdtemp(join(root, "case-"));
  const store = new GoalStore(join(cwd, "goals"));
  const errors = [];
  const notices = [];
  const contexts = [];
  let ends = 0;
  const beforeCalls = faux.state.callCount;
  faux.setResponses(responses);
  const settingsManager = sdk.SettingsManager.inMemory({ compaction: options.compaction ?? { enabled: false }, retry: options.retry ?? { enabled: false } });
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir: join(root, "agent"), settingsManager,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    extensionFactories: [pi => { registerGoal(pi, store); pi.on("context", event => { contexts.push(event.messages); }); pi.on("agent_end", () => { ends++; }); options.extend?.(pi); }],
  });
  await loader.reload();
  const { session } = await sdk.createAgentSession({ cwd, agentDir: join(root, "agent"), modelRuntime, model: faux.getModel(), resourceLoader: loader, sessionManager: sdk.SessionManager.create(cwd, join(cwd, "sessions")), settingsManager, tools: ["bash", "get_goal", "create_goal", "update_goal"] });
  await session.bindExtensions({ mode: "tui", uiContext: { notify: (text, level) => notices.push({ text, level }), setStatus() {}, setWidget() {}, confirm: async () => true, editor: async (_title, text) => text }, onError: error => errors.push(error.message) });
  const timer = setTimeout(() => { void session.abort(); }, 5000);
  try {
    await check({ session, store, notices, contexts, calls: () => faux.state.callCount - beforeCalls });
    assert.deepEqual(errors, []);
    assert.equal(networkAttempts, 0);
    results.push({ name, calls: faux.state.callCount - beforeCalls, ends });
    evidence.push({ name, contexts, notices, records: await store.records() });
  } finally { clearTimeout(timer); await session.abort(); session.dispose(); }
}
try {
  await scenario("repeated-success-pauses-without-agent-abort", Array.from({ length: 178 }, (_, i) => tool("bash", { command: "printf 'same report'" }, `repeat-${i}`)), async ({ session, store, notices, contexts, calls }) => {
    await session.prompt("/goal Review the unchanged report");
    await session.waitForIdle();
    assert.equal(calls(), 10);
    const paused = (await store.records())[0];
    assert.equal(paused.goal.status, "paused");
    assert.equal(paused.goal.pauseReason, "repeated_tool_calls");
    assert.equal(contexts.filter(messages => messages.at(-1)?.customType === "pi-ext-goal-continuation").length, 1);
    assert.equal(notices.filter(notice => notice.text.startsWith("Goal loop warning:")).length, 1);
    await session.prompt("/goal");
    assert.ok(notices.at(-1).text.includes("paused after repeated tool calls"));
    faux.setResponses([tool("update_goal", { status: "complete" }, "finish-after-pause"), ai.fauxAssistantMessage("Done")]);
    await session.prompt("/goal resume");
    await session.waitForIdle();
    const finished = (await store.records())[0].goal;
    assert.equal(finished.status, "complete");
    assert.equal(finished.pauseReason, undefined);
    assert.ok(finished.tokensUsed >= paused.goal.tokensUsed);
  });
  await scenario("alternating-success-pauses", Array.from({ length: 178 }, (_, i) => tool("bash", { command: `printf '${i % 2 ? "report-b" : "report-a"}'` }, `alternate-${i}`)), async ({ session, store, calls }) => {
    await session.prompt("/goal Detect alternating repeated evidence");
    await session.waitForIdle();
    assert.equal(calls(), 11);
    assert.equal((await store.records())[0].goal.pauseReason, "repeated_tool_calls");
  });
  await scenario("distinct-research-does-not-pause", [
    ...Array.from({ length: 40 }, (_, i) => tool("bash", { command: `printf 'evidence-${i}'` }, `research-${i}`)),
    tool("update_goal", { status: "complete" }), ai.fauxAssistantMessage("Research complete"),
  ], async ({ session, store, calls, notices }) => {
    await session.prompt("/goal Research different evidence");
    await session.waitForIdle();
    assert.equal(calls(), 42);
    assert.equal((await store.records())[0].goal.status, "complete");
    assert.equal(notices.filter(notice => notice.text.startsWith("Goal loop warning:")).length, 0);
  });
  for (const deliverAs of ["steer", "followUp"]) {
    await scenario(`loop-pause-preserves-${deliverAs}-and-foreign-message`, [
      ...Array.from({ length: 10 }, (_, i) => tool("bash", { command: "printf 'same report'" }, `queued-${i}`)),
      ai.fauxAssistantMessage("Processed preserved input"), ai.fauxAssistantMessage("Processed foreign input"),
    ], async ({ session, store, contexts }) => {
      await session.prompt("/goal Preserve queued input at loop pause");
      await session.waitForIdle();
      assert.equal((await store.records())[0].goal.status, "paused");
      const messages = JSON.stringify(contexts.at(-1));
      assert.ok(messages.includes("QUEUED_USER_PRESERVED"));
      assert.ok(messages.includes("QUEUED_FOREIGN_PRESERVED"));
    }, { extend: pi => {
      pi.on("message_end", event => {
        if (event.message.role !== "assistant" || !event.message.content.some(part => part.type === "toolCall" && part.id === "queued-9")) return;
        pi.sendUserMessage("QUEUED_USER_PRESERVED", { deliverAs });
        pi.sendMessage({ customType: "foreign-fixture", content: "QUEUED_FOREIGN_PRESERVED", display: false }, { deliverAs: "followUp", triggerTurn: true });
      });
    } });
  }
  await scenario("retained-history-after-continuation-clear-and-reload", [
    ai.fauxAssistantMessage("First turn finished"),
    tool("update_goal", { status: "blocked" }, "blocked"),
    ai.fauxAssistantMessage("Waiting for input"),
    ai.fauxAssistantMessage("Unrelated work completed"),
    ai.fauxAssistantMessage("Work after reload completed"),
  ], async ({ session, store, contexts, calls }) => {
    await session.prompt("/goal Preserve delivered history");
    await session.waitForIdle();
    assert.equal(calls(), 3);
    const beforeClear = contexts.at(-1);
    const reminders = beforeClear.filter(message => message.customType === "pi-ext-goal-continuation");
    assert.equal(reminders.length, 2);
    assert.deepEqual(contexts[0][0], reminders[0]);
    assert.deepEqual(contexts[1].filter(message => message.customType === "pi-ext-goal-continuation"), reminders);
    await session.prompt("/goal clear");
    await session.prompt("Do unrelated work");
    await session.waitForIdle();
    assert.equal(calls(), 4);
    assert.equal((await store.records())[0].goal, null);
    assert.deepEqual(contexts.at(-1).filter(message => message.customType === "pi-ext-goal-continuation"), reminders);
    await session.reload();
    await session.prompt("Continue unrelated work after reload");
    await session.waitForIdle();
    assert.equal(calls(), 5);
    assert.deepEqual(contexts.at(-1).filter(message => message.customType === "pi-ext-goal-continuation"), reminders);
  });
  await scenario("model-get-create-get-complete", [tool("get_goal", {}, "get-none"), tool("create_goal", { objective: "Explicit model-created goal", token_budget: 100 }, "create"), tool("get_goal", {}, "get-current"), tool("update_goal", { status: "complete" }, "finish"), ai.fauxAssistantMessage("Done")], async ({ session, store, calls }) => {
    await session.prompt("Explicitly create and finish the fixture goal");
    await session.waitForIdle();
    const goal = (await store.records())[0].goal;
    assert.equal(goal.status, "complete");
    assert.equal(goal.tokenBudget, 100);
    assert.equal(goal.objective, "Explicit model-created goal");
    assert.equal(calls(), 5);
  });
  await scenario("model-cannot-replace-unfinished-goal", [tool("create_goal", { objective: "Unapproved replacement" }), tool("update_goal", { status: "complete" }, "finish"), ai.fauxAssistantMessage("Done")], async ({ session, store, calls }) => {
    await session.prompt("/goal Preserve original objective");
    await session.waitForIdle();
    const goal = (await store.records())[0].goal;
    assert.equal(goal.objective, "Preserve original objective");
    assert.equal(goal.status, "complete");
    assert.equal(calls(), 3);
  });
  await scenario("create-auto-complete", [tool("update_goal", { status: "complete" }), ai.fauxAssistantMessage("Completed")], async ({ session, store, calls }) => {
    await session.prompt("/goal Complete the fixture");
    await session.waitForIdle();
    assert.equal((await store.records())[0].goal.status, "complete");
    assert.equal(calls(), 2);
  });
  await scenario("three-full-failed-bash-runs", Array.from({ length: 3 }, (_, n) => [tool("bash", { command: "exit 1" }, `bash-${n}`), ai.fauxAssistantMessage("No progress")]).flat(), async ({ session, store, calls }) => {
    await session.prompt("/goal Work through bash failures");
    await session.waitForIdle();
    assert.equal((await store.records())[0].goal.status, "blocked");
    assert.equal(calls(), 6);
  });
  await scenario("user-followups-count-as-complete-runs", Array.from({ length: 3 }, (_, n) => [tool("bash", { command: "exit 1" }, `followup-bash-${n}`), ai.fauxAssistantMessage("No progress")]).flat(), async ({ session, store, calls }) => {
    await session.prompt("/goal Count complete goal runs, not low-level ends");
    await session.waitForIdle();
    assert.equal((await store.records())[0].goal.status, "blocked");
    assert.equal(calls(), 6);
  }, { extend: pi => {
    let completed = 0;
    pi.on("message_end", event => {
      if (event.message.role === "assistant" && event.message.stopReason === "stop" && ++completed < 3) pi.sendUserMessage("Explicit follow-up", { deliverAs: "followUp" });
    });
  } });
  await scenario("native-retry-then-continuation", [ai.fauxAssistantMessage("", { stopReason: "error", errorMessage: "500 Internal Server Error" }), ai.fauxAssistantMessage("Progress"), tool("update_goal", { status: "complete" }), ai.fauxAssistantMessage("Done")], async ({ session, store, calls }) => {
    await session.prompt("/goal Retry the transient failure");
    await session.waitForIdle();
    assert.equal((await store.records())[0].goal.status, "complete");
    assert.equal(calls(), 4);
  }, { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } });
  await scenario("native-retry-exhausted", Array.from({ length: 2 }, () => ai.fauxAssistantMessage("", { stopReason: "error", errorMessage: "500 Internal Server Error" })), async ({ session, store, calls }) => {
    await session.prompt("/goal Stop after native retry exhaustion");
    await session.waitForIdle();
    assert.equal((await store.records())[0].goal.status, "blocked");
    assert.equal(calls(), 2);
  }, { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } });
  const forceOneCompaction = pi => {
    let forced = false;
    pi.on("message_end", event => {
      if (forced || event.message.role !== "assistant" || event.message.stopReason !== "stop") return;
      forced = true;
      return { message: { ...event.message, usage: { ...event.message.usage, input: 130000, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 130001 } } };
    });
  };
  const compact = { enabled: true, reserveTokens: 16384, keepRecentTokens: 1 };
  await scenario("native-compaction-success", [ai.fauxAssistantMessage("Progress"), ai.fauxAssistantMessage("Compacted summary"), tool("update_goal", { status: "complete" }), ai.fauxAssistantMessage("Done")], async ({ session, store, calls }) => {
    await session.prompt("/goal Continue after compaction");
    await session.waitForIdle();
    assert.equal((await store.records())[0].goal.status, "complete");
    assert.equal(calls(), 4);
  }, { compaction: compact, extend: forceOneCompaction });
  await scenario("native-compaction-failure-explicit-input-and-resume", [ai.fauxAssistantMessage("Progress"), ai.fauxAssistantMessage("", { stopReason: "error", errorMessage: "Summarization failed" }), ai.fauxAssistantMessage("Recovered summary"), ai.fauxAssistantMessage("Explicit work completed"), tool("update_goal", { status: "complete" }), ai.fauxAssistantMessage("Done")], async ({ session, store, calls }) => {
    await session.prompt("/goal Stop on compaction failure");
    await session.waitForIdle();
    assert.equal((await store.records())[0].goal.status, "blocked");
    assert.equal(calls(), 2);
    await session.prompt("Explicit user request after failed compaction");
    await session.waitForIdle();
    assert.equal((await store.records())[0].goal.status, "blocked");
    assert.equal(calls(), 4);
    await session.prompt("/goal resume");
    await session.waitForIdle();
    assert.equal((await store.records())[0].goal.status, "complete");
    assert.equal(calls(), 6);
  }, { compaction: compact, extend: forceOneCompaction });
  if (process.env.GOAL_EXECUTION_EVIDENCE) await writeFile(resolve(process.env.GOAL_EXECUTION_EVIDENCE), JSON.stringify({ version, networkAttempts, results, evidence }, null, 2));
  console.log(JSON.stringify({ version, networkAttempts, results }, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
