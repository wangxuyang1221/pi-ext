import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, vi } from "vitest";
import * as defaultHost from "@earendil-works/pi-coding-agent";
const host: typeof defaultHost = process.env.PI_CODEX_TEST_PI_ROOT
  ? await import(pathToFileURL(resolve(process.env.PI_CODEX_TEST_PI_ROOT, "dist/index.js")).href) : defaultHost;
const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = host;
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import compact from "../src/index.js";
import { NATIVE_COMPACTION_KIND, piContextInputForBranch } from "../src/native-compaction.js";
import { registerGoal as defaultRegisterGoal } from "../../goal/src/index.js";
const registerGoal: typeof defaultRegisterGoal = process.env.PI_GOAL_TEST_ENTRY
  ? (await import(pathToFileURL(resolve(process.env.PI_GOAL_TEST_ENTRY)).href)).registerGoal : defaultRegisterGoal;
import { GoalStore } from "../../goal/src/storage.js";

// Only catalog discovery and the HTTP response are substituted; request conversion,
// context dispatch, prefix validation, tools, and goal scheduling are production code.
vi.mock("../src/model-metadata.js", async importOriginal => {
  const original = await importOriginal<typeof import("../src/model-metadata.js")>();
  const { fixtureSnapshot } = await import("./fixtures/compaction-metadata.js");
  return { ...original, createModelMetadataStore: () => ({ resolve: async () => fixtureSnapshot, clear() {} }) };
});

const apiKey = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "offline" } })).toString("base64url")}.c`;
function response(index: number): Response {
  const item = index < 2
    ? { type: "function_call", id: `fc_${index}`, call_id: `call_${index}`, name: index === 0 ? "fixture_read" : "update_goal", arguments: index === 0 ? "{}" : '{"status":"complete"}' }
    : { type: "message", id: `msg_${index}`, role: "assistant", content: [{ type: "output_text", text: "Finished", annotations: [] }] };
  return new Response([
    { type: "response.output_item.added", output_index: 0, item },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: `r_${index}`, status: "completed", usage: { input_tokens: 10, output_tokens: 5 } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

test.each(["goal", "user-after-abort", "goal-after-abort"])("continues %s through tool-triggered system updates without losing the checkpoint prefix", async kind => {
  const root = await mkdtemp(join(process.cwd(), ".goal-prefix-runtime-"));
  const manager = SessionManager.create(root, join(root, "sessions"));
  const model = { ...getBuiltinModel("openai-codex", "gpt-5.5")!, compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true } };
  manager.appendModelChange(model.provider, model.id);
  manager.appendMessage({ role: "system", content: "Initial prompt", toolsAdded: [{ name: "fixture_read", description: "Read offline data", parameters: { type: "object", properties: {} } }], timestamp: 1 });
  const kept = manager.appendMessage({ role: "user", content: "Earlier task", timestamp: 2 });
  manager.appendCompaction("Earlier summary", kept, 1000);
  manager.appendCustomEntry(NATIVE_COMPACTION_KIND, { kind: NATIVE_COMPACTION_KIND, version: 2,
    modelKey: `${model.provider}:${model.api}:${model.id}`, compHash: "2911",
    replacementHistory: [{ type: "compaction", encrypted_content: "offline-checkpoint" }] });
  if (kind !== "goal") {
    manager.appendMessage({ role: "system", content: "", sections: { tools: "Previously reordered tools" }, timestamp: 3 });
    manager.appendMessage({ role: "assistant", provider: model.provider, api: model.api, model: model.id, content: [], stopReason: "aborted", errorMessage: "Operation aborted", timestamp: 4,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  }
  const store = new GoalStore(join(root, "goals"));
  const seed = await store.openSession({ ownerSessionId: manager.getSessionId(), cwd: root, sessionFile: manager.getSessionFile()! });
  await seed.replace("Finish the offline task", seed.snapshot);
  await seed.close();
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(model.provider, async () => ({ type: "oauth", access: apiKey, refresh: "offline", expires: Date.now() + 600_000 }));
  const modelRuntime = await ModelRuntime.create({ credentials, modelsStore: new InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(openaiCodexProvider());
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
  let reads = 0;
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    extensionFactories: [compact, pi => registerGoal(pi, store, { temporaryRoot: join(root, "tmp") }), pi => {
      pi.registerTool({ name: "fixture_read", label: "Fixture read", description: "Read offline data", parameters: { type: "object", properties: {} }, execute: async () => {
        reads++;
        pi.registerTool({ name: "fixture_late", label: "Late tool", description: "A late declaration", parameters: { type: "object", properties: {} }, execute: async () => { throw new Error("Unexpected tool execution"); } });
        pi.setActiveTools([...pi.getActiveTools(), "fixture_late"]);
        return { content: [{ type: "text", text: "Offline result" }], details: undefined };
      } });
    }],
  });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir: join(root, "agent"), modelRuntime, model, resourceLoader: loader,
    // Pi 1.3 restores the recorded tool set. Explicitly add the goal tools to this legacy fixture.
    tools: ["fixture_read", "fixture_late", "create_goal", "get_goal", "update_goal"],
    sessionManager: manager, settingsManager });
  const notices: string[] = [];
  const errors: unknown[] = [];
  const pairs: Array<{ actual: unknown; expected: unknown; prepared?: unknown }> = [];
  let requests = 0;
  session.agent.streamFunction = (selected, context, options) => streamSimple(selected as never, context, {
    ...options, apiKey, transport: "sse", maxRetries: 0,
    onPayload: async (payload, selectedModel) => {
      const pair = { actual: (payload as any).input, expected: piContextInputForBranch({ branch: manager.getBranch(), model: selected, tools: session.getAllTools() }), prepared: undefined as unknown };
      pairs.push(pair);
      const prepared = await options?.onPayload?.(payload, selectedModel);
      pair.prepared = (prepared as any)?.input;
      return prepared;
    },
    fetch: async () => { if (requests >= 3) throw new Error("Unexpected continuation"); return response(requests++); },
  });
  const timer = setTimeout(() => void session.abort(), 15000);
  try {
    await session.bindExtensions({ mode: "tui", uiContext: { notify: text => notices.push(text), setStatus() {}, setWidget() {}, confirm: async () => false }, onError: error => errors.push(error) });
    await session.prompt(kind === "user-after-abort" ? "Continue after interruption" : "/goal resume");
    await session.waitForIdle();
    expect(errors).toEqual([]);
    expect(notices.filter(text => text.includes("failure") || text.includes("storage error"))).toEqual([]);
    expect(requests).toBe(3);
    expect(reads).toBe(1);
    expect(pairs).toHaveLength(3);
    for (const pair of pairs) {
      expect(pair.actual).toEqual(pair.expected);
      expect(pair.prepared).toContainEqual({ type: "compaction", encrypted_content: "offline-checkpoint" });
    }
    expect((pairs[1].actual as any[]).some(item => item.type === "additional_tools" && item.tools.some((tool: any) => tool.name === "fixture_late"))).toBe(true);
    expect((await store.records())[0].goal?.status).toBe("complete");
  } finally {
    clearTimeout(timer);
    await session.abort();
    await session.waitForIdle();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    session.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 25000);
