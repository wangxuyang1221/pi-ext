import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = await mkdtemp(resolve(".goal-terminal-test-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_OFFLINE = "1";
process.env.PI_TELEMETRY = "0";
delete process.env.PI_SUBAGENT_PARENT;
const sdkRoot = await realpath(resolve(process.argv[2] ?? "node_modules/@earendil-works/pi-coding-agent"));
const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
const ai = await import(pathToFileURL(resolve(sdkRoot, "../pi-ai/dist/index.js")).href);
const { registerGoal } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const versions = Object.fromEntries(await Promise.all(["pi-coding-agent", "pi-ai", "pi-agent-core"].map(async name => [name,
  JSON.parse(await readFile(resolve(sdkRoot, "..", name, "package.json"), "utf8")).version])));
const version = versions["pi-coding-agent"];
const results = [];
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Unexpected network request in offline terminal fixture"); };
const response = (stopReason = "stop", errorMessage, tokens = 7) => ({ stopReason, errorMessage, tokens, content: [{ type: "text", text: stopReason === "error" ? "" : "Offline result" }] });
let callId = 0;
const complete = () => ({ ...response("toolUse"), content: [{ type: "toolCall", id: `finish-${++callId}`, name: "update_goal", arguments: { status: "complete" } }] });
const compact = { enabled: true, reserveTokens: 1024, keepRecentTokens: 1 };
const retry = { enabled: true, maxRetries: 1, baseDelayMs: 1 };

async function scenario(name, check, options = {}) {
  if (process.env.GOAL_TERMINAL_FILTER && !name.includes(process.env.GOAL_TERMINAL_FILTER)) return;
  const cwd = await mkdtemp(join(root, "case-"));
  const agentDir = join(cwd, "agent");
  await mkdir(agentDir);
  const store = new GoalStore(join(cwd, "goals"));
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const settingsManager = sdk.SettingsManager.inMemory({ compaction: options.compaction ?? { enabled: false }, retry: options.retry ?? { enabled: false } });
  const requests = [], lifecycle = [], hostEvents = [], notices = [], errors = [];
  let api, steps = [], unexpectedRequests = 0, timedOut = false;
  const goal = async () => (await store.records())[0]?.goal;
  const recordEvent = async (type, event) => {
    const saved = await goal();
    lifecycle.push({ type, requests: requests.length, status: saved?.status, tokens: saved?.tokensUsed, goalId: saved?.goalId,
      reason: event.reason, willRetry: event.willRetry, errorMessage: event.errorMessage,
      stopReason: event.message?.stopReason ?? event.messages?.findLast(m => m.role === "assistant")?.stopReason });
  };
  const streamSimple = (model, context, opts) => {
    const stream = ai.createAssistantMessageEventStream();
    void (async () => {
      let message;
      try {
        const index = requests.length + 1;
        requests.push({ index, provider: model.provider, api: model.api, model: model.id, maxTokens: opts?.maxTokens, deferredRequested: opts?.deferred ?? false, modelMaxTokens: model.maxTokens,
          tools: (context.tools ?? ai.getCurrentTools(context.messages)).map(t => t.name), before: await goal() });
        const step = steps.shift();
        if (!step) { unexpectedRequests++; throw new Error("No scripted response remains"); }
        const value = typeof step === "function" ? await step({ index, model, context, signal: opts?.signal }) : step;
        message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
          content: value.content, stopReason: value.stopReason, errorMessage: value.errorMessage,
          timestamp: Date.now() + index, responseId: `${name}-${index}`,
          ...(value.stopReason === "deferred" ? { deferred: { provider: model.provider, modelId: model.id, api: model.api, id: `offline-handle-${index}` } } : {}),
          usage: { input: value.tokens - 4, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: value.tokens,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: "start", partial: { ...message, content: [], stopReason: "pending" } });
        if (message.stopReason === "error") stream.push({ type: "error", reason: "error", error: message });
        else stream.push({ type: "done", reason: message.stopReason, message });
        stream.end(message);
      } catch (error) {
        message = { ...ai.fauxAssistantMessage(""), ...message, stopReason: "error", errorMessage: error.message };
        stream.push({ type: "error", reason: "error", error: message }); stream.end(message);
      }
    })();
    return stream;
  };
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    extensionFactories: [pi => {
      api = pi;
      pi.registerProvider("terminal-private", { apiKey: "offline-placeholder", baseUrl: "https://terminal.invalid", api: "terminal-offline",
        models: [{ id: "function-model", name: "Offline function model", reasoning: false, input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }], streamSimple });
      options.beforeGoal?.(pi);
      registerGoal(pi, store, { config: options.budget ? { maxGoalTokenBudget: options.budget } : undefined, temporaryRoot: cwd });
      for (const type of ["agent_start", "message_end", "agent_end", "session_before_compact", "session_compact", "session_compact_failed", "agent_settled"]) {
        pi.on(type, event => recordEvent(type, event));
      }
      options.afterGoal?.(pi);
    }],
  });
  await loader.reload();
  const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime, resourceLoader: loader, settingsManager,
    sessionManager: sdk.SessionManager.create(cwd, join(cwd, "sessions")), noTools: "builtin" });
  await session.setModel(modelRuntime.getModel("terminal-private", "function-model"));
  await session.bindExtensions({ mode: "tui", uiContext: {
    notify: (message, level) => notices.push({ message, level }), setStatus() {}, setWidget() {}, confirm: async () => true, editor: async (_title, value) => value,
  }, onError: error => errors.push(error.message) });
  session.subscribe(event => { if (/^(auto_retry|compaction)/.test(event.type)) hostEvents.push({ type: event.type, attempt: event.attempt, success: event.success, reason: event.reason, willRetry: event.willRetry }); });
  const timer = setTimeout(() => { timedOut = true; void session.abort(); }, 10000);
  const h = { session, api, goal, requests, lifecycle, hostEvents, notices, setSteps: values => { steps = [...values]; },
    calls: () => requests.length, settle: () => session.waitForIdle(),
    disable: () => api.setActiveTools(api.getActiveTools().filter(name => name !== "update_goal")),
    seed: async () => { steps = [response()]; await session.prompt("Seed history for native compaction"); await session.waitForIdle(); },
  };
  try {
    await check(h);
    assert.equal(timedOut, false, "Scenario deadline exceeded");
    assert.equal(unexpectedRequests, 0, "Unexpected model request");
    assert.deepEqual(errors, []);
    assert.equal(networkAttempts, 0);
    assert.ok(requests.every(r => r.deferredRequested === false), "Goal must not request deferred execution");
    results.push({ name, calls: requests.length, goal: await goal(), requests, lifecycle, hostEvents, notices });
    console.error(`PASS ${version} ${name} (${requests.length} requests)`);
  } catch (error) {
    console.error(JSON.stringify({ name, requests, lifecycle, hostEvents, errors }, null, 2));
    throw error;
  } finally {
    clearTimeout(timer);
    await session.abort();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  }
}
try {
  await scenario("recoverable-length-exhausted", async h => {
    await h.seed();
    h.setSteps([response("length"), response(), response(), response("length")]);
    await h.session.prompt("/goal Keep the final truncated goal"); await h.settle();
    assert.equal(h.calls(), 5);
    assert.equal((await h.goal()).status, "blocked");
    const failures = h.lifecycle.filter(e => e.type === "session_compact_failed");
    assert.equal(failures.length, 1);
    assert.equal(failures[0].status, "active", "Compaction failure must not stop the goal before agent_settled");
    assert.equal(h.lifecycle.at(-1).type, "agent_settled");
    assert.equal(h.lifecycle.at(-1).status, "blocked");
  }, { compaction: compact });
  for (const reason of ["length", "deferred", "error", "quota"]) {
    for (const disabled of [false, true]) for (const budget of [undefined, 100]) {
      await scenario(`final-${reason}-tools-${disabled ? "off" : "on"}-budget-${budget ?? "none"}`, async h => {
        const savedTools = h.api.getActiveTools();
        const stopReason = reason === "quota" ? "error" : reason;
        const error = reason === "quota" ? "insufficient_quota" : reason === "error" ? "401 Authentication failed" : undefined;
        const wraps = budget && stopReason !== "error";
        h.setSteps([() => { if (disabled) h.disable(); return response(stopReason, error, budget ? 110 : 7); }, ...(wraps ? [response(stopReason, error)] : [])]);
        await h.session.prompt("/goal Preserve final outcome and last usage"); await h.settle();
        const saved = await h.goal();
        const expected = reason === "quota" ? "usage_limited" : budget ? "budget_limited" : "blocked";
        assert.equal(saved.status, expected);
        assert.equal(saved.tokensUsed, budget ? wraps ? 117 : 110 : 7);
        assert.equal(h.calls(), wraps ? 2 : 1);
        assert.equal(saved.toolRecoveryRequired, disabled ? true : undefined);
        assert.ok(h.lifecycle.filter(e => e.type === "agent_end").every(e => e.status === (budget ? "budget_limited" : "active")));
        assert.equal(h.lifecycle.at(-1).type, "agent_settled");
        assert.equal(h.lifecycle.at(-1).status, expected);
        assert.equal(h.session.messages.filter(m => m.customType === "pi-ext-goal-budget").length, wraps ? 1 : 0);
        if (disabled) {
          assert.ok(h.notices.some(n => n.message.includes("Missing goal tools: update_goal")));
          await h.session.prompt("/goal resume");
          assert.equal(h.calls(), wraps ? 2 : 1);
          assert.ok(!h.api.getActiveTools().includes("update_goal"));
          h.api.setActiveTools(savedTools);
          await h.session.reload();
          assert.equal((await h.goal()).toolRecoveryRequired, true);
          h.setSteps([response()]);
          await h.session.prompt("Ordinary input does not resume the goal"); await h.settle();
          assert.equal((await h.goal()).status, expected);
          assert.equal((await h.goal()).toolRecoveryRequired, true);
          assert.equal((await h.goal()).tokensUsed, saved.tokensUsed);
        }
        const beforeResume = h.calls();
        if (!budget) h.setSteps([complete(), response()]);
        await h.session.prompt("/goal resume"); await h.settle();
        assert.equal((await h.goal()).goalId, saved.goalId);
        assert.equal((await h.goal()).status, budget ? "budget_limited" : "complete");
        assert.equal((await h.goal()).tokensUsed, saved.tokensUsed + (budget ? 0 : 7));
        assert.equal(h.calls(), beforeResume + (budget ? 0 : 2));
      }, { budget });
    }
  }
  const quotaCases = [
    ["openai-code", "insufficient_quota", "usage_limited"],
    ["codex-code", '{"error":{"type":"usage_limit_reached"}}', "usage_limited"],
    ["opencode-go", '{"error":{"type":"GoUsageLimitError"}}', "usage_limited"],
    ["opencode-free", "FreeUsageLimitError", "usage_limited"],
    ["codex-text", "You've hit your usage limit. Try again later.", "usage_limited"],
    ["workspace-credits", "Your workspace is out of credits. Add credits to continue.", "usage_limited"],
    ["quota-details", "Quota exceeded. Check your plan and billing details.", "usage_limited"],
    ["bare-429", "429 Too many requests", "blocked"],
    ["rate-code", "rate_limit_exceeded", "blocked"],
    ["billing", "billing service unavailable", "blocked"],
    ["authentication", "401 Authentication failed", "blocked"],
    ["network", "Network error: connection refused", "blocked"],
    ["ambiguous-quota", "quota exceeded", "blocked"],
    ["available-balance", "available balance lookup failed", "blocked"],
    ["codex-friendly-429", "You have hit your ChatGPT usage limit.", "blocked"],
    ["code-substring", "not_insufficient_quota", "blocked"],
    ["code-mention", "Failed to load handler for insufficient_quota", "blocked"],
    ["json-code-mention", '{"error":{"type":"authentication_error","message":"Documentation says usage_limit_reached"}}', "blocked"],
    ["http-json-code", '429 {"error":{"code":"insufficient_quota"}}', "usage_limited"],
    ["http-json-message", 'HTTP 429: {"error":{"message":"Your workspace is out of credits. Add credits to continue."}}', "usage_limited"],
  ];
  for (const [name, error, status] of quotaCases) {
    await scenario(`classification-${name}`, async h => {
      h.setSteps([response("error", error)]);
      await h.session.prompt("/goal Classify only explicit account exhaustion"); await h.settle();
      assert.equal(h.calls(), 1);
      assert.equal((await h.goal()).status, status);
      assert.equal((await h.goal()).tokensUsed, 7);
      assert.equal(h.lifecycle.find(e => e.type === "agent_end").status, "active");
      assert.equal(h.lifecycle.at(-1).status, status);
    });
  }
  for (const error of ["500 Internal Server Error", "429 Too many requests"]) {
    for (const succeeds of [false, true]) {
      await scenario(`native-retry-${error.slice(0, 3)}-${succeeds ? "recovers" : "exhausted"}`, async h => {
        h.setSteps([response("error", error), () => { h.disable(); return response(succeeds ? "stop" : "error", succeeds ? undefined : error); }]);
        await h.session.prompt("/goal Leave retries to Pi"); await h.settle();
        assert.equal(h.calls(), 2);
        assert.equal((await h.goal()).status, succeeds ? "active" : "blocked");
        assert.equal((await h.goal()).tokensUsed, 14);
        assert.equal((await h.goal()).toolRecoveryRequired, true);
        assert.ok(h.lifecycle.filter(e => e.type === "agent_end").every(e => e.status === "active"));
        assert.equal(h.hostEvents.filter(e => e.type === "auto_retry_start").length, 1);
        assert.equal(h.hostEvents.find(e => e.type === "auto_retry_end").success, succeeds);
        assert.equal(h.notices.some(n => n.message.startsWith("Goal blocked") || n.message.startsWith("Goal usage_limited")), !succeeds);
        assert.equal(h.requests[0].maxTokens, h.requests[1].maxTokens);
        assert.ok(h.requests.every(r => r.modelMaxTokens === 4096));
      }, { retry });
    }
  }
  for (const reason of ["length", "error"]) {
    await scenario(`native-compaction-${reason}-recovers-with-tools-off`, async h => {
      await h.seed();
      h.setSteps([response(reason, reason === "error" ? "context_length_exceeded" : undefined), response(), response(), () => { h.disable(); return response(); }]);
      await h.session.prompt("/goal Accept the recovered response"); await h.settle();
      assert.equal(h.calls(), 5);
      assert.equal((await h.goal()).status, "active");
      assert.equal((await h.goal()).toolRecoveryRequired, true);
      assert.ok(h.lifecycle.filter(e => e.type === "agent_end" && e.goalId).every(e => e.status === "active"));
      assert.equal(h.lifecycle.filter(e => e.type === "session_compact").length, 1);
      assert.equal(h.lifecycle.filter(e => e.type === "session_compact_failed").length, 0);
      assert.equal(h.notices.some(n => n.message.startsWith("Goal blocked")), false);
      assert.equal(h.requests[1].maxTokens, h.requests.at(-1).maxTokens);
      assert.ok(h.requests.every(r => r.modelMaxTokens === 4096));
    }, { compaction: compact });
  }
  for (const quota of [false, true]) for (const budget of [undefined, 100]) {
    await scenario(`compaction-failure-${quota ? "quota" : "ordinary"}-budget-${budget ?? "none"}`, async h => {
      await h.seed();
      h.setSteps([() => { h.disable(); return response("error", "context_length_exceeded", budget ? 110 : 7); }, response("error", quota ? "insufficient_quota" : "Summary failed")]);
      await h.session.prompt("/goal Settle a failed recovery with disabled tools"); await h.settle();
      assert.equal(h.calls(), 3);
      assert.equal((await h.goal()).status, quota ? "usage_limited" : budget ? "budget_limited" : "blocked");
      assert.equal((await h.goal()).tokensUsed, budget ? 110 : 7);
      assert.equal((await h.goal()).toolRecoveryRequired, true);
      assert.equal(h.lifecycle.find(e => e.type === "session_compact_failed").status, budget ? "budget_limited" : "active");
      assert.equal(h.lifecycle.at(-1).type, "agent_settled");
    }, { budget, compaction: compact });
  }
  let queuedAfterQuota = false;
  await scenario("queued-success-clears-old-quota-error", async h => {
    h.setSteps([response("error", "insufficient_quota"), () => { h.disable(); return response(); }]);
    await h.session.prompt("/goal Use the later successful result"); await h.settle();
    assert.equal(h.calls(), 2);
    assert.equal((await h.goal()).status, "active");
    assert.equal((await h.goal()).tokensUsed, 14);
    assert.equal(h.notices.some(n => n.message.startsWith("Goal usage_limited")), false);
  }, { afterGoal: pi => pi.on("agent_end", event => {
    if (queuedAfterQuota || event.messages.findLast(m => m.role === "assistant")?.stopReason !== "error") return;
    queuedAfterQuota = true;
    pi.sendUserMessage("Explicit queued recovery", { deliverAs: "followUp" });
  }) });
  for (const reason of ["error", "length", "deferred"]) {
    await scenario(`replacement-ignores-old-${reason}`, async h => {
      h.setSteps([async () => {
        await h.session.prompt("/goal Replacement objective");
        return response(reason, "insufficient_quota", 110);
      }, () => { h.disable(); return response(); }]);
      await h.session.prompt("/goal Original objective"); await h.settle();
      assert.equal((await h.goal()).objective, "Replacement objective");
      assert.equal((await h.goal()).status, "active");
      assert.equal((await h.goal()).tokensUsed, 7);
      assert.equal(h.calls(), 2);
      assert.equal(h.notices.some(n => n.message.startsWith("Goal blocked") || n.message.startsWith("Goal usage_limited")), false);
    });
  }
  await scenario("replacement-during-native-compaction-failure", async h => {
    await h.seed();
    h.setSteps([response("length"), async () => {
      await h.session.prompt("/goal Replacement during recovery");
      return response("error", "insufficient_quota");
    }, () => { h.disable(); return response(); }]);
    await h.session.prompt("/goal Original recovery objective"); await h.settle();
    assert.equal(h.calls(), 4);
    assert.equal((await h.goal()).objective, "Replacement during recovery");
    assert.equal((await h.goal()).status, "active");
    assert.equal((await h.goal()).tokensUsed, 7);
    assert.equal(h.lifecycle.filter(e => e.type === "session_compact_failed").length, 1);
    assert.equal(h.notices.some(n => n.message.startsWith("Goal blocked") || n.message.startsWith("Goal usage_limited")), false);
  }, { compaction: compact });
  for (const reason of ["length", "deferred"]) {
    let queued = false;
    await scenario(`queued-input-recovers-${reason}`, async h => {
      h.setSteps([response(reason), () => { h.disable(); return response(); }]);
      await h.session.prompt("/goal Keep a recovered queued response"); await h.settle();
      assert.equal(h.calls(), 2);
      assert.equal((await h.goal()).status, "active");
      assert.equal((await h.goal()).tokensUsed, 14);
      assert.equal(h.notices.some(n => n.message.startsWith("Goal blocked")), false);
    }, { afterGoal: pi => pi.on("message_end", event => {
      if (queued || event.message.role !== "assistant" || event.message.stopReason !== reason) return;
      queued = true;
      pi.sendUserMessage("Queued user recovery", { deliverAs: "followUp" });
    }) });
  }
  await scenario("empty-response-guard-remains", async h => {
    h.setSteps(Array.from({ length: 4 }, () => ({ ...response(), content: [] })));
    await h.session.prompt("/goal Retain empty response protection"); await h.settle();
    assert.equal((await h.goal()).status, "blocked");
    assert.equal(h.calls(), 4);
    assert.ok(h.notices.some(n => n.message.includes("three empty automatic continuations")));
  });
  await scenario("nonempty-text-has-no-new-limit", async h => {
    h.setSteps([...Array.from({ length: 8 }, () => response()), complete(), response()]);
    await h.session.prompt("/goal Continue nonempty progress"); await h.settle();
    assert.equal(h.calls(), 10);
    assert.equal((await h.goal()).status, "complete");
  });
} finally {
  await rm(root, { recursive: true, force: true });
  assert.equal(existsSync(root), false);
}
const report = { version, versions, offline: true, networkAttempts, results, cleanup: { temporaryRootRemoved: true, spawnedProcesses: 0, listeningPorts: [] } };
if (process.env.GOAL_TERMINAL_EVIDENCE) await writeFile(resolve(process.env.GOAL_TERMINAL_EVIDENCE), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ version, versions, networkAttempts, results: results.map(r => ({ name: r.name, calls: r.calls, status: r.goal?.status })), cleanup: report.cleanup }, null, 2));
