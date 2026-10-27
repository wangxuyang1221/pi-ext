import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AgentSessionRuntime, InteractiveMode, ModelRuntime, SessionManager, SettingsManager, DefaultResourceLoader, createAgentSession } from "@earendil-works/pi-coding-agent";
import { InMemoryModelsStore } from "@earendil-works/pi-ai";
import { findNativeCheckpoint, modelKey } from "../extensions/codex-compact/dist/native-compaction.js";
import { drainBudgetObservations } from "./pi14-live-budget.mjs";

const stage = process.argv[2], root = process.env.PI14_LIVE_ROOT, repo = process.env.PI14_REPO;
assert.ok(root && repo && process.env.PI14_LIVE_STATE, "Run through pi14-live.mjs");
const agentDir = join(root, "agent"), cwd = join(root, "work");
const runtime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null,
  modelsStore: new InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false });
const model = stage.startsWith("noncodex")
  ? runtime.getModels("deepseek").find(model => /flash/.test(model.id)) ?? runtime.getModels("deepseek")[0]
  : runtime.getModel("openai-codex", "gpt-5.6-sol");
assert.ok(model, "Acceptance model unavailable");
const auth = await runtime.getAuth(model);
assert.ok(auth?.auth?.apiKey, "Existing provider authorization unavailable");
const manager = ["resume", "auto-switch"].includes(stage)
  ? SessionManager.open(JSON.parse(await readFile(join(root, "resume.json"), "utf8")).sessionFile, join(root, "sessions"))
  : SessionManager.create(cwd, join(root, "sessions"));
const settings = SettingsManager.inMemory({ transport: "sse", retry: { enabled: false, provider: { maxRetries: 0 } }, compaction: { enabled: false, keepRecentTokens: 1 }, cacheWarming: "off" });
const manifest = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
let context;
const requests = [], errors = [], events = [];
const tui = process.env.PI14_LIVE_TUI === "1";
const record = value => {
  const text = JSON.stringify({ stage, provider: model.provider, model: model.id, ...value });
  if (tui) appendFileSync(join(root, `${stage}.worker.jsonl`), `${text}\n`);
  else console.log(text);
};
const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager: settings,
  noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
  additionalExtensionPaths: [...manifest.pi.extensions.map(path => resolve(repo, path)), resolve(repo, "extensions/codex-search/src/index.ts")],
  systemPromptOverride: () => "You are running an isolated plugin acceptance test. Follow the requested tool sequence exactly. Only use synthetic data. Never access paths outside the test working directory, contact other people, or spawn additional agents unless explicitly requested in the test prompt. Keep final answers brief.",
  extensionFactories: [pi => {
    pi.registerTool({ name: "acceptance_empty", label: "Empty acceptance output", description: "Return whitespace for a tool protocol acceptance test.",
      parameters: { type: "object", properties: {}, additionalProperties: false }, execute: async () => ({ content: [{ type: "text", text: "\r\n" }], details: undefined }) });
    pi.on("session_start", (_event, ctx) => { context = ctx; });
    pi.on("before_provider_request", event => {
      requests.push({ serviceTier: event.payload.service_tier ?? null,
        checkpoint: event.payload.input?.some(item => item.type === "compaction") ?? false });
    });
  }] });
await loader.reload();
const { session } = await createAgentSession({ cwd, agentDir, modelRuntime: runtime, model, resourceLoader: loader,
  sessionManager: manager, settingsManager: settings, thinkingLevel: "low" });
session.subscribe(event => events.push(event));
const prompt = async text => {
  const start = manager.getBranch().length;
  await session.prompt(text);
  await session.waitForIdle();
  const messages = manager.getBranch().slice(start).filter(entry => entry.type === "message").map(entry => entry.message);
  const replies = messages.filter(message => message.role === "assistant");
  assert.ok(replies.length, "No assistant response");
  const failures = replies.filter(message => message.stopReason === "error" || message.stopReason === "aborted");
  assert.equal(failures.length, 0, `Provider request failed or aborted: ${failures.map(message => message.errorMessage ?? message.stopReason).join("; ")}`);
  assert.ok(messages.filter(message => message.role === "toolResult").every(message => !message.isError), "A model-selected tool failed");
  return { text: replies.flatMap(message => message.content.filter(block => block.type === "text").map(block => block.text)).join("\n"), messages };
};
const call = async (name, args = {}) => {
  const tool = session.getToolDefinition(name);
  assert.ok(tool, `Missing tool ${name}`);
  return tool.execute(`acceptance-${Date.now()}`, args, undefined, undefined, context);
};
const checkpoint = () => {
  const value = findNativeCheckpoint(manager.getBranch(), modelKey(session.model));
  assert.equal(value.status, "valid", "Missing valid persisted checkpoint");
  assert.ok(value.checkpoint.details.replacementHistory.some(item => item.type === "compaction" && item.encrypted_content?.length > 20));
  return value.checkpoint.entryId;
};
const configPath = join(agentDir, "pi-codex-compact.json");
let interactive;
try {
  if (tui) {
    assert.ok(process.stdin.isTTY && process.stdout.isTTY, "Goal acceptance requires a real PTY");
    const host = new AgentSessionRuntime(session, { cwd, agentDir, modelRuntime: runtime, settingsManager: settings, resourceLoader: loader, diagnostics: [] },
      async () => { throw new Error("Session replacement is outside this live case"); });
    interactive = new InteractiveMode(host, { migratedProviders: [] });
    await interactive.init();
    assert.equal(context.mode, "tui");
  } else await session.bindExtensions({ onError: error => errors.push(error) });
  for (let attempt = 0; !session.getActiveToolNames().includes("mcp__acceptance__fact") && attempt < 50; attempt++) await delay(100);
  assert.ok(session.getActiveToolNames().includes("mcp__acceptance__fact"), "Controlled MCP server did not become ready");
  if (stage === "preflight" || stage === "preflight-tui") {
    for (const name of ["acceptance_empty", "create_goal", "subagent_spawn", "codex_search"]) assert.ok(session.getToolDefinition(name), `Missing ${name}`);
    record({ case: "offline-entry-and-isolation", passed: true });
    if (tui) for (const name of ["create_goal", "get_goal", "update_goal"]) assert.ok(session.getActiveToolNames().includes(name));
  } else if (stage === "seed") {
    const result = await prompt("Remember the synthetic project marker ORCHID-731 and owner Mira. Call acceptance_empty exactly once, then reply ACK ORCHID-731 Mira. Do not use other tools.");
    assert.ok(result.messages.some(message => message.role === "toolResult" && message.toolName === "acceptance_empty"));
    assert.match(result.text, /ORCHID-731/);
    await session.compact();
    checkpoint();
    await writeFile(join(root, "resume.json"), JSON.stringify({ sessionFile: manager.getSessionFile() }));
    record({ case: "initial-tool-and-manual-checkpoint", passed: true });
  } else if (stage === "resume" || stage === "auto-switch") {
    if (stage === "resume") {
      const old = checkpoint();
      const restored = await prompt("Call acceptance_empty exactly once, then state the project marker and owner that I gave earlier. Do not use other tools.");
      assert.match(restored.text, /ORCHID-731/); assert.match(restored.text, /Mira/i);
      assert.ok(restored.messages.some(message => message.role === "toolResult" && message.toolName === "acceptance_empty"));
      assert.ok(requests.at(-1).checkpoint, "Restored request did not contain the server checkpoint");
      await session.compact();
      assert.notEqual(checkpoint(), old);
      record({ case: "new-process-restore-tools-and-repeat-manual", passed: true });
      // The production guard avoids recompressing a checkpoint with no new history.
      const primed = await prompt("Without tools, repeat the marker and owner once.");
      assert.match(primed.text, /ORCHID-731/); assert.match(primed.text, /Mira/i);
    }
    const beforeAuto = checkpoint();
    await writeFile(configPath, JSON.stringify({ manualProjection: { hiddenTools: [] }, autoCompactTokenLimit: 1 }));
    const auto = await prompt("Without tools, repeat the marker and owner once more.");
    assert.match(auto.text, /ORCHID-731/); assert.match(auto.text, /Mira/i);
    assert.notEqual(checkpoint(), beforeAuto, "Configured automatic compaction did not occur");
    record({ case: "configured-automatic-compaction", passed: true, loweredAutoThreshold: true });
    await writeFile(configPath, JSON.stringify({ manualProjection: { hiddenTools: [] } }));
    const next = runtime.getModel("openai-codex", "gpt-5.6-luna");
    assert.ok(next);
    await session.setModel(next);
    const switched = await prompt("Without tools, repeat the original marker and owner.");
    assert.match(switched.text, /ORCHID-731/); assert.match(switched.text, /Mira/i);
    record({ case: "model-switch-fact-continuity", passed: true, switchedModel: next.id });
  } else if (stage === "fast") {
    await session.prompt("/fast on");
    await prompt("Reply FAST-ON without tools.");
    assert.equal(requests.at(-1).serviceTier, "priority");
    await session.prompt("/fast off");
    await prompt("Reply FAST-OFF without tools.");
    assert.notEqual(requests.at(-1).serviceTier, "priority");
    record({ case: "fast-request-toggle", passed: true });
  } else if (stage === "goal") {
    const goal = await prompt("Explicit test instruction: use create_goal to create the objective 'Confirm the synthetic value 17', then use get_goal, then use update_goal with status complete, and finish with GOAL-DONE. The value 17 is already confirmed. Use exactly one tool call per assistant turn and wait for its result before the next call. Do not use other tools or create subagents.");
    for (const name of ["create_goal", "get_goal", "update_goal"]) assert.ok(goal.messages.some(message => message.role === "toolResult" && message.toolName === name), `Missing ${name}`);
    const state = await call("get_goal");
    assert.equal(state.details.goal.status, "complete");
    assert.ok(state.details.goal.tokensUsed > 0);
    record({ case: "goal-create-read-complete-accounting", passed: true, tokensUsed: state.details.goal.tokensUsed });
  } else if (stage === "mcp") {
    const mcpName = "mcp__acceptance__fact";
    for (let attempt = 0; !session.getActiveToolNames().includes(mcpName) && attempt < 50; attempt++) await delay(100);
    const mcp = await prompt(`Call ${mcpName} once and report its returned marker. Do not use other tools.`);
    assert.match(mcp.text, /MCP-ORCHID-731/);
    assert.ok(mcp.messages.some(message => message.role === "toolResult" && message.toolName === mcpName));
    record({ case: "mcp-real-model-dispatch", passed: true });
  } else if (stage === "subagent") {
    const spawned = await prompt("Explicit acceptance instruction: call subagent_spawn once. Give it this exact task: 'Call bash with command printf CHILD-731, then answer CHILD-731. Do not read any files, use other tools, or create subagents.' Set model to openai-codex/gpt-5.6-sol and thinkingLevel to low. After spawning, reply SPAWNED and do not wait, read, or close it yet.");
    const spawnResult = spawned.messages.find(message => message.role === "toolResult" && message.toolName === "subagent_spawn");
    assert.ok(spawnResult, "Model did not spawn the acceptance child");
    const child = JSON.parse(spawnResult.content.find(part => part.type === "text").text).agent;
    try {
      let settled;
      for (let attempt = 0; attempt < 6; attempt++) {
        const result = await call("subagent_wait", { agentId: child.agentId, afterSettled: child.settledCursor, timeoutMs: 30_000 });
        settled = JSON.parse(result.content[0].text);
        if (settled.outcome === "settled") break;
      }
      assert.equal(settled?.outcome, "settled", "Child did not settle");
      const read = await call("subagent_read", { agentId: child.agentId, view: "recent_activity", assistantLimit: 5, toolLimit: 5 });
      const text = JSON.stringify(read);
      assert.match(text, /CHILD-731/);
      assert.match(text, /bash/);
      assert.ok(resolve(child.sessionFile).startsWith(`${resolve(root)}/`), "Child session escaped the isolated workspace");
      const childEntries = (await readFile(child.sessionFile, "utf8")).trim().split("\n").map(JSON.parse);
      assert.ok(childEntries.some(entry => entry.type === "message" && entry.message.role === "toolResult"
        && entry.message.toolName === "bash" && !entry.message.isError
        && entry.message.content.some(block => block.type === "text" && block.text.includes("CHILD-731"))), "Child did not execute the expected shell tool");
      const usage = childEntries.filter(entry => entry.type === "message" && entry.message.role === "assistant")
        .map(entry => ({ provider: entry.message.provider, model: entry.message.model, usage: entry.message.usage }));
      assert.ok(usage.length > 0, "No child provider usage was persisted");
      record({ case: "subagent-real-model-tool-read", passed: true, childUsage: usage });
    } finally {
      const closed = await call("subagent_close", { target: child.agentId });
      assert.equal(closed.details.relationshipRemoved, true);
    }
  } else if (stage === "search") {
    const search = await call("codex_search", { queries: ["site:nodejs.org Node.js documentation file system readFile"], freshness: "cached", search_context_size: "low" });
    assert.ok(!search.isError, "Search execution failed");
    assert.equal(search.details.failedQueryCount, 0);
    assert.ok(search.details.successes.some(result => result.citations.some(citation => /^https:\/\//.test(citation.url))), "Search returned no public citation");
    record({ case: "search-public-citations", passed: true, result: search.details });
  } else if (stage === "noncodex" || stage === "noncodex-goal") {
    if (stage === "noncodex") {
    const result = await prompt("Call acceptance_empty exactly once, then reply DEEPSEEK-OK. Do not use other tools.");
    assert.ok(result.messages.some(message => message.role === "toolResult" && message.toolName === "acceptance_empty"));
    assert.match(result.text, /DEEPSEEK-OK/);
    record({ case: "noncodex-tool-continuation", passed: true });
    }
    const goal = await prompt("Explicit test instruction: use create_goal to create the objective 'Confirm the synthetic value 23', then use get_goal, then use update_goal with status complete, and finish with GOAL-DONE. The value 23 is already confirmed. Use exactly one tool call per assistant turn and wait for its result before the next call. Do not use other tools or create subagents.");
    for (const name of ["create_goal", "get_goal", "update_goal"]) assert.ok(goal.messages.some(message => message.role === "toolResult" && message.toolName === name), `Missing ${name}`);
    const state = await call("get_goal");
    assert.equal(state.details.goal.status, "complete");
    assert.ok(state.details.goal.tokensUsed > 0);
    record({ case: "noncodex-goal-accounting", passed: true, tokensUsed: state.details.goal.tokensUsed });
  } else throw new Error("Unknown acceptance stage");
  assert.equal(errors.length, 0, "Extension runtime errors occurred");
} catch (error) {
  record({ passed: false, error: error.name, message: error.message.slice(0, 500) });
  process.exitCode = 1;
} finally {
  await writeFile(configPath, JSON.stringify({ manualProjection: { hiddenTools: [] } }));
  await session.abort(); await session.waitForIdle();
  interactive?.stop();
  await session.extensionRunner?.emit({ type: "session_shutdown", reason: "exit" });
  session.dispose();
  await drainBudgetObservations();
  record({ case: "usage", requests: requests.length, usage: manager.getBranch().filter(entry => entry.type === "message" && entry.message.role === "assistant")
    .map(entry => ({ provider: entry.message.provider, model: entry.message.model, usage: entry.message.usage })),
    compactionEvents: events.filter(event => event.type === "compaction_end").map(event => ({ reason: event.reason, aborted: event.aborted, usage: event.usage })) });
}
