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
  let steps = [], api, currentRequest = 0, unexpectedRequests = 0, timedOut = false;
  const next = async (model, context, signal) => {
    const index = ++currentRequest;
    requests.push({ index, provider: model.provider, model: model.id, api: model.api, tools: context.tools.map(t => t.name), messages: context.messages });
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
      registerGoal(pi, store, { config: options.budget ? { maxGoalTokenBudget: options.budget } : undefined, temporaryRoot: cwd });
      for (const type of ["agent_start", "agent_end", "agent_settled", "session_start", "session_shutdown", "model_select"]) pi.on(type, event => { lifecycle.push({ type, reason: event.reason, requests: requests.length }); });
      pi.on("tool_result", event => { toolResults.push({ name: event.toolName, isError: event.isError, details: event.details }); });
      options.afterGoal?.(pi);
    }],
  });
  await loader.reload();
  const provider = options.provider ?? "custom-goal";
  const modelId = provider === "anthropic" ? builtin.id : provider === "private-goal" ? "private-function-model" : "function-model";
  // Provider factories are flushed by createAgentSession before model selection.
  const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime, resourceLoader: loader,
    settingsManager, sessionManager: options.ephemeral ? sdk.SessionManager.inMemory(cwd) : sdk.SessionManager.create(cwd, join(cwd, "sessions")), noTools: "builtin" });
  await session.setModel(modelRuntime.getModel(provider, modelId));
  if (options.noModel) session.agent.state.model = undefined;
  if (options.child) process.env.PI_SUBAGENT_PARENT = "offline-child";
  await session.bindExtensions({ mode: options.mode ?? "tui", uiContext: {
    notify: (message, level) => notices.push({ message, level }), setStatus() {}, setWidget() {}, confirm: async () => true, editor: async (_title, value) => value,
  }, onError: error => errors.push(error.message) });
  const timer = setTimeout(() => { timedOut = true; void session.abort(); }, 10000);
  const h = { session, store, modelRuntime, requests, notices, lifecycle, toolResults, get api() { return api; },
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
      tokens: (await h.goal())?.tokensUsed, status: (await h.goal())?.status, notices, lifecycle });
    console.error(`PASS ${version} ${name} (${requests.length} requests)`);
  } finally {
    clearTimeout(timer);
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
      assert.equal(h.calls(), 6);
      assert.equal((await h.goal()).status, "complete");
      assert.equal((await h.goal()).tokensUsed, 21);
      assert.equal(h.toolResults[0].details.goal, null);
      assert.equal(h.toolResults[2].details.goal.objective, "SDK-created goal");
      assert.ok(h.toolResults.every(result => !result.isError));
      assert.ok(h.requests.every(request => required.every(name => request.tools.includes(name))));
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
  for (const input of ["none", "steer", "followUp", "foreign"]) {
    let disabled = false;
    await scenario(`stale-queued-continuation-${input}`, async h => {
      h.setSteps([text("First response"), ...(input === "none" ? [] : [text("User request preserved")])]);
      await h.session.prompt("/goal Invalidate only the owned continuation"); await h.settle();
      assert.equal(h.calls(), input === "none" ? 1 : 2);
      assert.equal((await h.goal()).status, "active");
      assert.equal((await h.goal()).toolRecoveryRequired, true);
      if (input !== "none") {
        assert.ok(JSON.stringify(h.requests.at(-1).messages).includes("PRESERVED_INPUT"));
        assert.ok(!h.session.messages.some(m => m.role === "assistant" && m.stopReason === "aborted"));
      }
    }, { afterGoal: pi => pi.on("agent_end", () => {
      if (disabled) return;
      disabled = true;
      pi.setActiveTools(pi.getActiveTools().filter(name => name !== "get_goal"));
      if (input === "steer" || input === "followUp") pi.sendUserMessage("PRESERVED_INPUT", { deliverAs: input });
      if (input === "foreign") pi.sendMessage({ customType: "foreign-fixture", content: "PRESERVED_INPUT", display: false }, { deliverAs: "followUp", triggerTurn: true });
    }) });
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
