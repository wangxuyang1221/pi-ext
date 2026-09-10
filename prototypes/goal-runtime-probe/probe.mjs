import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// This is a bounded SDK experiment, not a goal implementation.
const packageRoot = resolve(process.argv[2] ?? "node_modules/@earendil-works/pi-coding-agent");
const sdk = await import(pathToFileURL(resolve(packageRoot, "dist/index.js")).href);
const aiRoot = resolve(packageRoot, "../pi-ai");
const ai = await import(pathToFileURL(resolve(aiRoot, "dist/index.js")).href);
const version = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8")).version;
const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = sdk;
const { fauxProvider, fauxAssistantMessage, InMemoryCredentialStore, InMemoryModelsStore } = ai;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts++;
  throw new Error("Network calls are disabled in the goal runtime probe");
};

async function runCase(name, register, options = {}) {
  const events = [];
  const errors = [];
  const state = { ends: 0, pending: [], active: true, beforeStart: 0, contexts: [], filteredContexts: [] };
  const faux = fauxProvider({ provider: "goal-runtime-probe", tokensPerSecond: 100000 });
  faux.setResponses(Array.from({ length: 8 }, (_, index) => async () => {
    await pause(15);
    return options.response?.(index) ?? fauxAssistantMessage(`response-${index + 1}`);
  }));
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({
    compaction: options.compaction ?? { enabled: false },
    retry: options.retry ?? { enabled: false },
  });
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: resolve("prototypes/goal-runtime-probe/.isolated-agent"),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => "Local runtime probe.",
    extensionFactories: [(pi) => {
      pi.on("before_agent_start", () => { state.beforeStart++; });
      pi.on("agent_start", () => events.push("start"));
      pi.on("context", (event) => {
        state.contexts.push(event.messages.map((message) => ({
          role: message.role, customType: message.customType, content: message.content,
        })));
      });
      pi.on("agent_end", () => { state.ends++; events.push("end"); });
      register(pi, state, events);
      pi.on("context", (event) => {
        state.filteredContexts.push(event.messages.map((message) => ({
          role: message.role, customType: message.customType, content: message.content,
        })));
      });
      pi.on("agent_settled", (_event, ctx) => {
        events.push(`observer:settled:idle=${ctx.isIdle()}`);
      });
    }],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await createAgentSession({
    cwd: process.cwd(),
    agentDir: resolve("prototypes/goal-runtime-probe/.isolated-agent"),
    modelRuntime,
    model: faux.getModel(),
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(process.cwd()),
    settingsManager,
    noTools: "all",
    thinkingLevel: "off",
  });
  await session.bindExtensions({ mode: "json", onError: (error) => errors.push(error.message) });
  session.subscribe((event) => {
    if (event.type === "auto_retry_start") events.push("retry:start");
    if (event.type === "auto_retry_end") events.push(`retry:end:success=${event.success}`);
  });
  const deadline = setTimeout(() => {
    session.abort();
    console.error("Goal runtime probe deadline exceeded");
    process.exitCode = 1;
  }, 3000);
  try {
    await session.prompt("probe");
    const atPromptReturn = { calls: faux.state.callCount, idle: session.isIdle, ends: state.ends };
    await session.waitForIdle();
    const atIdleReturn = { calls: faux.state.callCount, idle: session.isIdle, ends: state.ends };
    await pause(80);
    assert.deepEqual(errors, []);
    assert.equal(networkAttempts, 0);
    return {
      name, atPromptReturn, atIdleReturn,
      finalCalls: faux.state.callCount, finalEnds: state.ends,
      beforeAgentStartCalls: state.beforeStart,
      pendingQueueObservations: state.pending,
      finalActive: state.active, contexts: state.contexts, filteredContexts: state.filteredContexts, events,
    };
  } finally {
    clearTimeout(deadline);
    await session.abort();
    session.dispose();
  }
}

function continuation(pi) {
  pi.sendMessage({ customType: "goal-probe", content: "Continue probe.", display: false }, {
    deliverAs: "followUp", triggerTurn: true,
  });
}

const results = [];
results.push(await runCase("agent-end-followup", (pi, state) => {
  pi.on("agent_end", (_event, ctx) => {
    if (state.ends >= 3) return;
    continuation(pi);
    state.pending.push(ctx.hasPendingMessages());
  });
}));
results.push(await runCase("agent-end-later-pause", (pi, state) => {
  pi.on("agent_end", () => {
    if (state.ends === 1 && state.active) continuation(pi);
  });
  pi.on("agent_end", () => { state.active = false; });
}));
results.push(await runCase("agent-end-pause-context-guard", (pi, state, events) => {
  pi.on("agent_end", () => {
    if (state.ends === 1 && state.active) continuation(pi);
  });
  pi.on("agent_end", () => { state.active = false; });
  pi.on("context", (event, ctx) => {
    const last = event.messages.at(-1);
    if (!state.active && last?.role === "custom" && last.customType === "goal-probe") {
      events.push("context:abort-stale-continuation");
      ctx.abort();
    }
  });
}));
results.push(await runCase("settled-immediate-restart", (pi, state) => {
  pi.on("agent_settled", () => {
    if (state.ends < 3) continuation(pi);
  });
}));
results.push(await runCase("settled-earlier-observer", (pi, state, events) => {
  pi.on("agent_settled", (_event, ctx) => {
    events.push(`earlier:settled:idle=${ctx.isIdle()}`);
  });
  pi.on("agent_settled", () => {
    if (state.ends < 3) continuation(pi);
  });
}));
function continueSuccessfulRuns(pi, state) {
  pi.on("agent_end", (event) => {
    state.lastStopReason = event.messages.findLast((message) => message.role === "assistant")?.stopReason;
    if (state.active && state.ends < 3 && state.lastStopReason === "stop") continuation(pi);
  });
  pi.on("agent_settled", () => {
    if (state.lastStopReason === "error") state.active = false;
  });
}
results.push(await runCase("native-retry-before-goal-continuation", continueSuccessfulRuns, {
  retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 },
  response: (index) => index === 0
    ? fauxAssistantMessage("", { stopReason: "error", errorMessage: "500 Internal Server Error" })
    : fauxAssistantMessage(`response-${index + 1}`),
}));
results.push(await runCase("native-retry-exhaustion-stops-goal", continueSuccessfulRuns, {
  retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 },
  response: () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "500 Internal Server Error" }),
}));
function probeCompactionFailure(blockRepeatedCompaction) {
  return (pi, state, events) => {
    continueSuccessfulRuns(pi, state);
    pi.on("message_end", (event) => {
      if (event.message.role !== "assistant" || event.message.stopReason !== "stop") return;
      events.push("probe:force-context-overflow");
      return { message: { ...event.message, usage: {
        ...event.message.usage, input: 130000, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 130001,
      } } };
    });
    pi.on("session_before_compact", (event) => {
      events.push("compaction:before");
      if (blockRepeatedCompaction && !state.active && event.reason !== "manual") {
        events.push("compaction:cancel-stopped-goal-recovery");
        return { cancel: true };
      }
    });
    pi.on("session_compact_failed", (event) => {
      events.push(`compaction:failed:aborted=${event.aborted}`);
      state.active = false;
    });
    pi.on("context", (event, ctx) => {
      const last = event.messages.at(-1);
      if (!state.active && last?.role === "custom" && last.customType === "goal-probe") {
        events.push("context:abort-stale-continuation");
        ctx.abort();
      }
    });
  };
}
const compactionFailureOptions = {
  compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 1 },
  response: (index) => index === 0 ? fauxAssistantMessage("response-1")
    : fauxAssistantMessage("", { stopReason: "error", errorMessage: "Summarization probe failure" }),
};
results.push(await runCase("compaction-failure-context-guard-only", probeCompactionFailure(false), compactionFailureOptions));
results.push(await runCase("compaction-failure-with-recovery-guard", probeCompactionFailure(true), compactionFailureOptions));
for (const filterStale of [false, true]) {
 for (const userFirst of [true, false]) {
  results.push(await runCase(`queued-user-${userFirst ? "before" : "after"}-stale-goal${filterStale ? "-filtered" : ""}`,  (pi, state, events) => {
    pi.on("agent_end", async () => {
      if (state.ends !== 1) return;
      if (userFirst) await pi.sendUserMessage("Explicit user follow-up.", { deliverAs: "followUp" });
      continuation(pi);
      if (!userFirst) await pi.sendUserMessage("Explicit user follow-up.", { deliverAs: "followUp" });
      state.active = false;
    });
    pi.on("context", (event, ctx) => {
      const last = event.messages.at(-1);
      if (!state.active && last?.role === "custom" && last.customType === "goal-probe") {
        events.push("context:abort-stale-continuation");
        ctx.abort();
      }
      if (filterStale && !state.active) {
        return { messages: event.messages.filter((message) =>
          message.role !== "custom" || message.customType !== "goal-probe") };
      }
    });
  }));
 }
}
console.log(JSON.stringify({ version, networkAttempts, results }, null, 2));
for (const result of results.slice(9)) {
  assert.equal(result.finalCalls, 2);
  assert.equal(result.finalActive, false);
  assert.equal(result.events.includes("context:abort-stale-continuation"), true);
  assert.equal(result.filteredContexts.some((context) => context.at(-1)?.role === "user"
    && context.at(-1).content.some((part) => part.text === "Explicit user follow-up.")), true);
  if (result.name.endsWith("-filtered")) {
    assert.equal(result.filteredContexts.some((context) => context.some((message) =>
      message.customType === "goal-probe")), false);
  }
}
assert.equal(results[10].filteredContexts.at(-1).some((message) => message.customType === "goal-probe"), true);
assert.equal(results[5].finalCalls, 3);
assert.equal(results[5].events.includes("retry:start"), true);
assert.equal(results[5].events.includes("retry:end:success=true"), true);
assert.equal(results[6].finalCalls, 2);
assert.equal(results[6].finalActive, false);
assert.equal(results[6].events.includes("retry:end:success=false"), true);
assert.equal(results[7].finalCalls, 3);
assert.equal(results[7].events.filter((event) => event === "compaction:failed:aborted=false").length, 2);
assert.equal(results[8].finalCalls, 2);
assert.equal(results[8].events.filter((event) => event === "compaction:failed:aborted=false").length, 1);
assert.equal(results[8].events.includes("compaction:cancel-stopped-goal-recovery"), true);
assert.equal(results[8].finalActive, false);
assert.equal(results[7].finalActive, false);
assert.equal(results[7].events.includes("compaction:failed:aborted=false"), true);
assert.equal(results[7].events.includes("context:abort-stale-continuation"), true);
assert.equal(results[0].finalCalls, 3);
assert.equal(results[0].atPromptReturn.ends, 3);
assert.deepEqual(results[0].pendingQueueObservations, [false, false]);
assert.equal(results[1].finalCalls, 2);
assert.equal(results[1].finalActive, false);
assert.equal(results[2].finalCalls, 1);
assert.equal(results[2].events.includes("context:abort-stale-continuation"), true);
assert.equal(results[3].atPromptReturn.idle, false);
assert.equal(results[3].atPromptReturn.ends, 1);
assert.equal(results[4].events.includes("earlier:settled:idle=true"), true);
assert.equal(results[4].events.includes("observer:settled:idle=false"), true);
