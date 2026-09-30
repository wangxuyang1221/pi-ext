import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = await mkdtemp(resolve(".goal-provider-test-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_OFFLINE = "1";
process.env.PI_TELEMETRY = "0";
delete process.env.PI_SUBAGENT_PARENT;
const sdkRoot = await realpath(resolve(process.argv[2] ?? "node_modules/@earendil-works/pi-coding-agent"));
const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
const ai = await import(pathToFileURL(resolve(sdkRoot, "../pi-ai/dist/index.js")).href);
const { registerGoal } = await import("../dist/index.js");
const { GoalStore } = await import("../dist/storage.js");
const version = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8")).version;
const versions = Object.fromEntries(await Promise.all(["pi-coding-agent", "pi-ai", "pi-agent-core"].map(async name => [name,
  JSON.parse(await readFile(resolve(sdkRoot, "..", name, "package.json"), "utf8")).version])));
const required = ["create_goal", "get_goal", "update_goal"];
const results = [];
let networkAttempts = 0;
let httpHandler;
globalThis.fetch = async (url, init) => {
  if (String(url) === "https://goal-private.invalid/v1/chat/completions" && httpHandler) return httpHandler(init);
  networkAttempts++;
  throw new Error("Unexpected network request in offline fixture");
};
const text = (value = "Progress", usage = 7) => ({ content: [{ type: "text", text: value }], usage });
let callId = 0;
const tool = (name, args) => ({ content: [{ type: "toolCall", id: `fixture-${++callId}`, name, arguments: args }], usage: 7 });
async function scenario(name, check, options = {}) {
  const cwd = await mkdtemp(join(root, "case-"));
  const agentDir = join(cwd, "agent");
  await mkdir(agentDir);
  const modelsPath = join(agentDir, "models.json");
  await writeFile(modelsPath, JSON.stringify({ providers: { "private-goal": {
    baseUrl: "https://goal-private.invalid/v1", api: "openai-completions", apiKey: "offline-placeholder",
    models: [{ id: "private-function-model", contextWindow: 128000, maxTokens: 4096 }],
  } } }));
  const store = new GoalStore(join(cwd, "goals"));
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath, allowModelNetwork: false, refreshOnCreate: false });
  const builtin = modelRuntime.getModel("anthropic", "claude-sonnet-4-5");
  assert.ok(builtin, "Built-in model metadata must exist");
  const notices = [], errors = [], requests = [], lifecycle = [], toolResults = [];
  const trace = [];
  let diagnosticSession;
  const record = (event, extra = {}) => {
    if (process.env.GOAL_PROVIDER_TRACE) trace.push({ event, ms: performance.now(), requests: requests.length,
      followUp: [...(diagnosticSession?.getFollowUpMessages() ?? [])], ...extra });
  };
  let steps = [], api, currentRequest = 0, unexpectedRequests = 0, timedOut = false;
  const next = async (model, context, signal) => {
    const index = ++currentRequest;
    requests.push({ index, provider: model.provider, model: model.id, api: model.api, tools: (context.tools ?? ai.getCurrentTools(context.messages)).map(t => t.name), messages: context.messages });
    const step = steps.shift();
    if (!step) { unexpectedRequests++; throw new Error("No scripted response remains"); }
    const value = typeof step === "function" ? await step({ index, model, context, signal }) : step;
    return { role: "assistant", content: value.content, api: model.api, provider: model.provider, model: model.id,
      timestamp: Date.now() + index, responseId: `${name}-${index}`,
      stopReason: value.content.some(p => p.type === "toolCall") ? "toolUse" : "stop",
      usage: { input: value.usage - 4, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: value.usage,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  };
  const streamSimple = (model, context, opts) => {
    const stream = ai.createAssistantMessageEventStream();
    void (async () => {
      let message;
      try {
        message = await next(model, context, opts?.signal);
        stream.push({ type: "start", partial: { ...message, content: [], stopReason: "pending" } });
        for (const [contentIndex, part] of message.content.entries()) {
          if (part.type === "toolCall") {
            stream.push({ type: "toolcall_start", contentIndex, partial: message });
            stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(part.arguments), partial: message });
            stream.push({ type: "toolcall_end", contentIndex, toolCall: part, partial: message });
          } else {
            stream.push({ type: "text_start", contentIndex, partial: message });
            stream.push({ type: "text_delta", contentIndex, delta: part.text, partial: message });
            stream.push({ type: "text_end", contentIndex, content: part.text, partial: message });
          }
        }
        if (opts?.signal?.aborted) throw new Error("Request aborted");
        stream.push({ type: "done", reason: message.stopReason, message });
        stream.end(message);
      } catch (error) {
        message = { ...ai.fauxAssistantMessage(""), ...message, stopReason: opts?.signal?.aborted ? "aborted" : "error", errorMessage: error.message };
        stream.push({ type: "error", reason: message.stopReason, error: message }); stream.end(message);
      }
    })();
    return stream;
  };
  httpHandler = async init => {
    const body = JSON.parse(init.body);
    for (const definition of body.tools ?? []) assert.equal(definition.type, "function");
    const message = await next(modelRuntime.getModel("private-goal", "private-function-model"), {
      tools: (body.tools ?? []).map(t => ({ name: t.function.name })), messages: body.messages,
    }, init.signal);
    const call = message.content.find(p => p.type === "toolCall");
    const chunk = (delta, finish_reason = null, usage) => `data: ${JSON.stringify({ id: message.responseId, object: "chat.completion.chunk", created: 1, model: body.model,
      choices: usage ? [] : [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`;
    return new Response(chunk({ role: "assistant", ...(call ? { tool_calls: [{ index: 0, id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : { content: message.content[0].text }) })
      + chunk({}, call ? "tool_calls" : "stop") + chunk({}, null, { prompt_tokens: message.usage.input, completion_tokens: 4, total_tokens: message.usage.totalTokens }) + "data: [DONE]\n\n",
    { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    extensionFactories: [pi => {
      api = pi;
      // Keep built-in metadata but inject only the offline streaming transport.
      for (const provider of ["anthropic", "openai-codex", "custom-goal"]) {
        pi.registerProvider(provider, { baseUrl: "https://goal-stream.invalid", apiKey: "offline-placeholder",
          api: `goal-offline-${provider}`, models: [{ ...builtin, id: provider === "anthropic" ? builtin.id : "function-model", api: `goal-offline-${provider}` }], streamSimple });
      }
      options.beforeGoal?.(pi);
      if (process.env.GOAL_PROVIDER_TRACE) pi.on("context", event => record("context-before-goal", {
        tail: event.messages.slice(-3).map(message => ({ role: message.role, customType: message.customType,
          content: message.customType === "pi-ext-goal-continuation" ? undefined : message.content })) }));
      registerGoal(pi, store, { config: options.budget ? { maxGoalTokenBudget: options.budget } : undefined, temporaryRoot: cwd });
      for (const type of ["agent_start", "agent_end", "agent_settled", "session_start", "session_shutdown", "model_select"]) pi.on(type, event => { lifecycle.push({ type, reason: event.reason, requests: requests.length }); });
      pi.on("tool_result", event => { toolResults.push({ name: event.toolName, isError: event.isError, details: event.details }); });
      options.afterGoal?.(pi);
      if (process.env.GOAL_PROVIDER_TRACE) {
        pi.on("agent_end", () => record("agent-end-after-fixture"));
        pi.on("context", () => record("context-after-goal"));
      }
    }],
  });
  await loader.reload();
  const provider = options.provider ?? "custom-goal";
  const modelId = provider === "anthropic" ? builtin.id : provider === "private-goal" ? "private-function-model" : "function-model";
  // Provider factories are flushed by createAgentSession before model selection.
  const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime, resourceLoader: loader,
    settingsManager, sessionManager: options.ephemeral ? sdk.SessionManager.inMemory(cwd) : sdk.SessionManager.create(cwd, join(cwd, "sessions")), noTools: "builtin" });
  diagnosticSession = session;
  if (process.env.GOAL_PROVIDER_TRACE) {
    const abort = session.abort.bind(session);
    session.abort = () => { record("session-abort"); return abort(); };
    session.subscribe(event => {
      if (["agent_start", "agent_end", "agent_settled", "message_start", "message_end"].includes(event.type)) {
        record(event.type, { role: event.message?.role, customType: event.message?.customType });
      }
    });
  }
  await session.setModel(modelRuntime.getModel(provider, modelId));
  if (options.noModel) session.agent.state.model = undefined;
  if (options.child) process.env.PI_SUBAGENT_PARENT = "offline-child";
  let editorText = options.editorText ?? "";
  const editor = { getText: () => editorText, setText: value => { editorText = value; } };
  let abortHandler;
  if (options.abortBinding === "tui") {
    const { InteractiveMode } = await import(pathToFileURL(join(sdkRoot, "dist/modes/interactive/interactive-mode.js")).href);
    // Exercise the host's actual queue/abort methods; only terminal display is headless.
    const interactive = { session, editor, compactionQueuedMessages: [],
      clearAllQueues() { return InteractiveMode.prototype.clearAllQueues.call(this); },
      updatePendingMessagesDisplay() {} };
    abortHandler = () => InteractiveMode.prototype.restoreQueuedMessagesToEditor.call(interactive, { abort: true });
  }
  await session.bindExtensions({ ...(abortHandler ? { abortHandler } : {}), mode: options.mode ?? "tui", uiContext: {
    notify: (message, level) => notices.push({ message, level }), setStatus() {}, setWidget() {}, custom: async () => undefined,
    confirm: async () => true, editor: async (_title, value) => value,
  }, onError: error => errors.push(error) });
  const timer = setTimeout(() => { timedOut = true; void session.abort(); }, 10000);
  const h = { session, store, modelRuntime, requests, notices, lifecycle, toolResults, editor, observations: {}, get api() { return api; },
    setSteps: values => { steps = [...values]; }, goal: async () => (await store.records())[0]?.goal,
    settle: () => session.waitForIdle(), calls: () => requests.length };
  try {
    await check(h);
    assert.equal(timedOut, false, "Scenario deadline exceeded");
    assert.equal(unexpectedRequests, 0, "Unexpected model request");
    assert.deepEqual(errors, []);
    assert.equal(networkAttempts, 0);
    results.push({ name, provider, transport: provider === "private-goal" ? "native-openai-completions-with-offline-fetch" : "extension-registered-offline-streamSimple", calls: requests.length,
      requests: requests.map(({ messages, ...request }) => request), tools: toolResults.map(t => ({ name: t.name, isError: t.isError })),
      tokens: (await h.goal())?.tokensUsed, status: (await h.goal())?.status, notices, lifecycle,
      ...(options.abortBinding ? { abortBinding: options.abortBinding, observations: h.observations } : {}) });
    console.error(`PASS ${version} ${name} (${requests.length} requests)`);
  } finally {
    clearTimeout(timer);
    record("scenario-finally");
    if (process.env.GOAL_PROVIDER_TRACE) {
      const directory = resolve(process.env.GOAL_PROVIDER_TRACE);
      assert.ok(directory.startsWith(process.cwd() + "/"), "Trace directory must stay inside the repository");
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `${name}.json`), JSON.stringify(trace, null, 2));
    }
    await session.abort();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
    delete process.env.PI_SUBAGENT_PARENT;
    httpHandler = undefined;
  }
}
try {
  for (const provider of ["anthropic", "private-goal", "custom-goal", "openai-codex"]) {
    await scenario(`normal-function-tools-${provider}`, async h => {
      h.setSteps([tool("get_goal", {}), tool("create_goal", { objective: "SDK-created goal" }), tool("get_goal", {}), text("Nonempty text continuation"), tool("update_goal", { status: "complete" }), text("Done")]);
      await h.session.prompt("Create and complete the goal with ordinary function tools"); await h.settle();
      assert.equal(h.calls(), 6, JSON.stringify(h.session.messages.filter(message => message.role === "assistant")));
      assert.equal((await h.goal()).status, "complete");
      assert.equal((await h.goal()).tokensUsed, 21);
      assert.equal(h.toolResults[0].details.goal, null);
      assert.equal(h.toolResults[2].details.goal.objective, "SDK-created goal");
      assert.ok(h.toolResults.every(result => !result.isError));
      assert.ok(h.requests.every(request => required.every(name => request.tools.includes(name))), JSON.stringify(h.requests.map(({ index, tools }) => ({ index, tools }))));
    }, { provider });
  }
  await scenario("creation-with-disabled-tools-persists-recovery", async h => {
    const tools = h.api.getActiveTools();
    h.api.setActiveTools(tools.filter(name => name !== "create_goal"));
    await h.session.prompt("/goal Persist recovery before any request");
    assert.equal(h.calls(), 0);
    assert.equal((await h.goal()).toolRecoveryRequired, true);
    h.api.setActiveTools(tools);
    h.setSteps([text("User work")]);
    await h.session.prompt("Ordinary input after tools return"); await h.settle();
    assert.equal(h.calls(), 1);
    assert.equal((await h.goal()).toolRecoveryRequired, true);
  });
  await scenario("reload-keeps-disabled-tool-choice", async h => {
    h.setSteps([text()]);
    h.api.setActiveTools(h.api.getActiveTools().filter(name => name !== "update_goal"));
    await h.session.prompt("Ordinary work before a goal"); await h.settle();
    await h.session.reload();
    assert.ok(!h.api.getActiveTools().includes("update_goal"), "Reload must preserve external tool disablement");
  });
  for (const missing of required) {
    await scenario(`tool-recovery-${missing}`, async h => {
      const tools = h.api.getActiveTools();
      h.setSteps([() => { h.api.setActiveTools(tools.filter(name => name !== missing)); return text("In-flight final usage"); }]);
      await h.session.prompt("/goal Retain tool recovery intent"); await h.settle();
      const saved = await h.goal();
      assert.equal(saved.tokensUsed, 7);
      assert.equal(saved.status, "active");
      assert.equal(saved.toolRecoveryRequired, true);
      assert.equal(h.calls(), 1);
      assert.ok(h.notices.some(n => n.message.includes(`Missing goal tools: ${missing}`)));
      await h.session.prompt("/goal resume");
      assert.equal(h.calls(), 1);
      assert.ok(!h.api.getActiveTools().includes(missing));
      await h.session.reload();
      assert.ok(!h.api.getActiveTools().includes(missing));
      assert.equal((await h.goal()).toolRecoveryRequired, true);
      h.api.setActiveTools(tools);
      h.setSteps([text("Ordinary input"), text("Another provider")]);
      await h.session.prompt("Ordinary input after tools return", { source: "interactive" }); await h.settle();
      await h.session.setModel(h.modelRuntime.getModel("private-goal", "private-function-model"));
      await h.session.prompt("Ordinary work after model switch", { source: "interactive" }); await h.settle();
      await h.session.reload();
      assert.equal(h.calls(), 3);
      assert.equal((await h.goal()).tokensUsed, 21);
      assert.equal((await h.goal()).goalId, saved.goalId);
      assert.equal((await h.goal()).toolRecoveryRequired, true);
      await h.session.prompt("/goal");
      assert.ok(h.notices.at(-1).message.includes("explicit /goal resume"));
      h.setSteps([tool("update_goal", { status: "complete" }), text("Complete")]);
      await h.session.prompt("/goal resume"); await h.settle();
      assert.equal((await h.goal()).tokensUsed, 28);
      assert.equal((await h.goal()).status, "complete");
      assert.equal((await h.goal()).toolRecoveryRequired, undefined);
      assert.equal(h.calls(), 5);
    });
  }
  await scenario("disabled-tools-still-settle-budget", async h => {
    h.setSteps([() => { h.api.setActiveTools(h.api.getActiveTools().filter(name => name !== "update_goal")); return text("Budget crossing final response", 110); }, text("Budget wrap-up", 7)]);
    await h.session.prompt("/goal Settle usage after tool closure"); await h.settle();
    assert.equal((await h.goal()).status, "budget_limited");
    assert.equal((await h.goal()).tokensUsed, 117);
    assert.equal((await h.goal()).toolRecoveryRequired, true);
    assert.equal(h.calls(), 2);
    assert.equal(h.session.messages.filter(m => m.customType === "pi-ext-goal-budget").length, 1);
    h.api.setActiveTools(required);
    await h.session.prompt("/goal resume"); await h.settle();
    assert.equal((await h.goal()).status, "budget_limited");
    assert.equal((await h.goal()).tokensUsed, 117);
    assert.equal(h.calls(), 2);
  }, { budget: 100 });
  for (const abortBinding of ["tui", "sdk-default"]) {
    for (const input of ["none", "steer", "followUp", "foreign"]) {
      let disabled = false, host, savedGoal, savedEntries;
      const draft = abortBinding === "tui" && input === "followUp" ? "UNSENT_DRAFT" : "";
      await scenario(`stale-queued-continuation-${abortBinding}-${input}`, async h => {
        host = h;
        h.setSteps([text("First response"), ...(["steer", "followUp"].includes(input) ? [text("User request preserved")] : [])]);
        await h.session.prompt("/goal Invalidate only the owned continuation"); await h.settle();
        const automaticRequests = input === "steer" ? 2 : 1;
        assert.equal(h.calls(), automaticRequests, "A queued follow-up must not be confused with delivered steering");
        assert.equal(h.session.isIdle, true);
        assert.equal(h.lifecycle.filter(event => event.type === "agent_settled").length, 1);
        const goal = await h.goal();
        assert.equal(goal.status, "active");
        assert.equal(goal.toolRecoveryRequired, true);
        for (const key of ["goalId", "generation", "objective"]) assert.equal(goal[key], savedGoal[key]);
        assert.ok(goal.tokensUsed >= savedGoal.tokensUsed, "Cancellation must not reset recorded usage");
        const persisted = new Map((await readFile(h.session.sessionManager.getSessionFile(), "utf8")).trim().split("\n")
          .map(line => JSON.parse(line)).filter(entry => entry.id).map(entry => [entry.id, entry]));
        for (const entry of savedEntries) {
          assert.deepEqual(h.session.sessionManager.getEntry(entry.id), entry, "Cancellation must preserve existing history");
          assert.deepEqual(persisted.get(entry.id), entry, "Cancellation must preserve persisted history");
        }
        const queued = h.session.agent.peekQueuedMessages();
        const userQueued = abortBinding === "sdk-default" && input === "followUp";
        const foreignQueued = abortBinding === "sdk-default" && input === "foreign";
        assert.deepEqual(h.session.getFollowUpMessages(), userQueued ? ["PRESERVED_INPUT"] : []);
        assert.equal(queued.length, userQueued || foreignQueued ? 1 : 0);
        if (userQueued || foreignQueued) {
          assert.ok(JSON.stringify(queued[0].content).includes("PRESERVED_INPUT"));
          assert.equal(queued[0].role, foreignQueued ? "custom" : "user");
          if (foreignQueued) assert.equal(queued[0].customType, "foreign-fixture");
        }
        const restored = abortBinding === "tui" && input === "followUp" ? `PRESERVED_INPUT\n\n${draft}` : draft;
        assert.equal(h.editor.getText(), restored, "TUI cancellation must restore queued user text without losing the editor draft");
        if (input === "steer") assert.ok(JSON.stringify(h.requests[1].messages).includes("PRESERVED_INPUT"));
        else assert.ok(h.requests.every(request => !JSON.stringify(request.messages).includes("PRESERVED_INPUT")), "Undelivered input must not be reported as executed");
        h.observations = { automaticRequests: h.calls(), pendingUserInput: [...h.session.getFollowUpMessages()],
          pendingMessages: queued.length, editorText: h.editor.getText(), resumedRequests: 0,
          ...(abortBinding === "sdk-default" && ["followUp", "foreign"].includes(input)
            ? { compatibility: "Pi 0.99.1 abort retains pending work without automatically draining it; historical two-request SDK acceptance is not restored" } : {}) };
        // C11 allows TUI restoration. SDK hosts explicitly recover their retained user queue.
        if (input === "followUp") {
          let recovered;
          if (abortBinding === "tui") {
            recovered = h.editor.getText();
            h.editor.setText("");
          } else {
            const pending = h.session.clearQueue();
            assert.deepEqual(pending, { steering: [], followUp: ["PRESERVED_INPUT"] });
            recovered = pending.followUp[0];
          }
          await h.session.prompt(recovered, { source: "interactive" }); await h.settle();
          assert.equal(h.calls(), 2, "The second request requires explicit resubmission after cancellation");
          assert.ok(JSON.stringify(h.requests[1].messages).includes("PRESERVED_INPUT"));
          assert.equal(h.session.agent.hasQueuedMessages(), false);
          assert.equal(h.editor.getText(), "");
          assert.equal((await h.goal()).goalId, savedGoal.goalId);
          assert.equal((await h.goal()).toolRecoveryRequired, true);
          h.observations.resumedRequests = h.calls() - automaticRequests;
        }
      }, { abortBinding, editorText: draft, afterGoal: pi => pi.on("agent_end", async () => {
        if (disabled) return;
        disabled = true;
        savedGoal = await host.goal();
        savedEntries = structuredClone(host.session.sessionManager.getEntries());
        pi.setActiveTools(pi.getActiveTools().filter(name => name !== "get_goal"));
        if (input === "steer" || input === "followUp") {
          assert.equal(await host.session[input]("PRESERVED_INPUT", undefined, { source: "interactive" }), "queued");
        }
        if (input === "foreign") await host.session.sendCustomMessage({ customType: "foreign-fixture", content: "PRESERVED_INPUT", display: false }, { deliverAs: "followUp", triggerTurn: true });
      }) });
    }
  }
  await scenario("replacement-isolates-in-flight-usage-and-old-end", async h => {
    h.setSteps([async () => {
      await h.session.prompt("/goal Replacement goal");
      return text("Old goal response", 110);
    }, tool("update_goal", { status: "complete" }), text("Replacement complete")]);
    await h.session.prompt("/goal Original goal"); await h.settle();
    assert.equal((await h.goal()).objective, "Replacement goal");
    assert.equal((await h.goal()).tokensUsed, 7);
    assert.equal((await h.goal()).status, "complete");
    assert.equal(h.calls(), 3);
  });
  await scenario("nonempty-text-does-not-add-a-continuation-cap", async h => {
    h.setSteps([...Array.from({ length: 5 }, (_, i) => text(`Progress ${i}`)), tool("update_goal", { status: "complete" }), text("Done")]);
    await h.session.prompt("/goal Keep nonempty text behavior"); await h.settle();
    assert.equal(h.calls(), 7);
    assert.equal((await h.goal()).status, "complete");
    assert.equal((await h.goal()).tokensUsed, 42);
  });
  for (const [name, options] of [["rpc", { mode: "rpc" }], ["print", { mode: "print" }], ["json", { mode: "json" }], ["ephemeral", { ephemeral: true }], ["child", { child: true }], ["no-model", { noModel: true }]]) {
    await scenario(`admission-rejects-${name}`, async h => {
      await h.session.prompt("/goal Reject unsupported session");
      assert.equal(h.calls(), 0);
      assert.equal(await h.goal(), undefined);
      assert.ok(!h.api.getActiveTools().includes("create_goal"));
      assert.ok(!h.api.getActiveTools().includes("update_goal"));
      assert.ok(h.api.getActiveTools().includes("get_goal"));
      assert.ok(h.notices.some(n => /requires|only in interactive/.test(n.message)));
    }, options);
  }
  assert.equal(networkAttempts, 0);
} finally {
  await rm(root, { recursive: true, force: true });
  assert.equal(existsSync(root), false);
}
const report = { version, versions, offline: true, networkAttempts, results, cleanup: { temporaryRootRemoved: true, spawnedProcesses: 0, listeningPorts: [] } };
if (process.env.GOAL_PROVIDER_EVIDENCE) await writeFile(resolve(process.env.GOAL_PROVIDER_EVIDENCE), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
