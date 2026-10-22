import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import compact from "../src/index.js";
import { findNativeCheckpoint, modelKey, NATIVE_COMPACTION_KIND } from "../src/native-compaction.js";

const configuration = vi.hoisted(() => ({ manualProjection: { hiddenTools: [] as string[], forcedPrompt: undefined as string | undefined } }));

vi.mock("../src/model-metadata.js", async importOriginal => {
  const original = await importOriginal<typeof import("../src/model-metadata.js")>();
  const { fixtureSnapshot } = await import("./fixtures/compaction-metadata.js");
  return { ...original, createModelMetadataStore: () => ({ resolve: async () => fixtureSnapshot, clear() {} }) };
});
vi.mock("../src/config.js", async importOriginal => {
  const original = await importOriginal<typeof import("../src/config.js")>();
  return { ...original, loadConfig: () => ({ autoCompactScope: "total", manualProjection: configuration.manualProjection }) };
});

const apiKey = `a.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "offline" } })).toString("base64url")}.c`;
const sse = (events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
function answer(index: number, tokens = 10) {
  const item = { type: "message", id: `msg_${index}`, role: "assistant", content: [{ type: "output_text", text: "Finished", annotations: [] }] };
  return sse([{ type: "response.output_item.added", output_index: 0, item }, { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: `r_${index}`, status: "completed", usage: { input_tokens: tokens, output_tokens: 5 } } }]);
}

test.each(["manual", "threshold", "overflow", "repeated-overflow"])("repairs long input through the real SDK %s lifecycle", async kind => {
  const root = await mkdtemp(join(process.cwd(), ".tmp/repair-runtime-"));
  const manager = SessionManager.create(root, join(root, "sessions"));
  const model = { ...getBuiltinModel("openai-codex", "gpt-5.5")!, contextWindow: 800_000,
    compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true } };
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(model.provider, async () => ({ type: "oauth", access: apiKey, refresh: "offline", expires: Date.now() + 600_000 }));
  const runtime = await ModelRuntime.create({ credentials, modelsStore: new InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerNativeProvider(openaiCodexProvider());
  const settings = SettingsManager.inMemory({ compaction: { enabled: kind !== "manual", keepRecentTokens: 1, reserveTokens: 100_000 }, retry: { enabled: false }, cacheWarming: "off" });
  const events: any[] = [], errors: unknown[] = [], payloads: any[] = [], remote: any[] = [];
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager: settings,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    systemPromptOverride: () => "Fixed prompt", extensionFactories: [compact] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir: join(root, "agent"), modelRuntime: runtime, model,
    resourceLoader: loader, sessionManager: manager, settingsManager: settings, tools: [] });
  let requests = 0;
  session.subscribe(event => events.push(event));
  session.agent.streamFunction = (selected, context, options) => streamSimple(selected as never, context, { ...options, apiKey, transport: "sse", maxRetries: 0,
    onPayload: async (value, selectedModel) => {
      const prepared = await options?.onPayload?.(value, selectedModel);
      payloads.push(structuredClone(prepared ?? value));
      return prepared;
    },
    fetch: async () => {
      // Pi rejects usage from attempts timestamped at or before the checkpoint.
      await new Promise(resolve => setTimeout(resolve, 2));
      const index = requests++;
      if (index > 3) throw new Error("Unexpected continuation");
      if ((kind === "overflow" && index === 0) || kind === "repeated-overflow") {
        return sse([{ type: "response.failed", response: { error: { code: "context_length_exceeded", message: "Context length exceeded" } } }]);
      }
      return answer(index, kind === "threshold" && index === 0 ? 710_000 : 10);
    },
  });
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.input?.some((item: any) => item.type === "compaction_trigger")) throw new Error("Unexpected network request");
    remote.push(body);
    return sse([{ type: "response.output_item.done", item: { type: "compaction", encrypted_content: "offline-opaque" } },
      { type: "response.completed", response: { id: "compact" } }]);
  });
  const timer = setTimeout(() => void session.abort(), 15_000);
  const text = "BEGIN_" + "x".repeat(280_000) + "_END";
  try {
    await session.bindExtensions({ onError: error => errors.push(error) });
    await session.prompt(text);
    await session.waitForIdle();
    if (kind === "manual") await session.compact();
    expect(errors).toEqual([]);
    expect(remote).toHaveLength(1);
    const checkpoint = findNativeCheckpoint(manager.getBranch(), modelKey(model));
    expect(checkpoint.status).toBe("valid");
    if (checkpoint.status !== "valid") throw new Error("Missing checkpoint");
    const users = [...checkpoint.checkpoint.details.replacementHistory, ...(checkpoint.checkpoint.details.preservedInput ?? [])].filter(item => item.role === "user");
    expect(users).toHaveLength(1);
    if (kind.includes("overflow")) {
      expect(JSON.stringify(remote[0].input)).not.toContain("BEGIN_");
      expect(users[0]?.content).toEqual([{ type: "input_text", text }]);
      expect(requests).toBe(2);
      expect(payloads[1].input.filter((item: any) => item.role === "user")).toEqual(users);
    } else {
      expect(JSON.stringify(remote[0].input)).toContain(text);
      expect(JSON.stringify(users[0])).not.toContain(text);
      await session.prompt("continue");
      await session.waitForIdle();
      expect(payloads.at(-1).input.filter((item: any) => item.role === "user")).toHaveLength(2);
    }
    expect(events.filter(event => event.type === "compaction_start").map(event => event.reason)).toEqual([kind === "repeated-overflow" ? "overflow" : kind]);
    if (kind === "repeated-overflow") expect(events.some(event => event.type === "compaction_end" && event.errorMessage?.includes("after one"))).toBe(true);
    const reopened = SessionManager.open(manager.getSessionFile()!, join(root, "reopened"));
    expect(findNativeCheckpoint(reopened.getBranch(), modelKey(model))).toMatchObject({ status: "valid", checkpoint: { details: checkpoint.checkpoint.details } });
  } finally {
    clearTimeout(timer);
    await session.abort();
    await session.waitForIdle();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    session.dispose();
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  }
}, 25_000);

test.each(["hidden", "forced", "both"])("replays %s loadout through real ExtensionRunner hooks", async mode => {
  const root = await mkdtemp(join(process.cwd(), ".tmp/projection-runtime-"));
  const manager = SessionManager.inMemory(root);
  const model = { ...getBuiltinModel("openai-codex", "gpt-5.5")!, compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true } };
  const tool = (name: string) => ({ name, description: name, parameters: { type: "object", properties: {} } });
  manager.appendModelChange(model.provider, model.id);
  manager.appendMessage({ role: "system", content: "Fixed prompt", toolsAdded: [tool("hider"), tool("victim")], timestamp: 0 } as never);
  const kept = manager.appendMessage({ role: "user", content: "old task", timestamp: 0 });
  manager.appendCompaction("summary", kept, 100, { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(model), compHash: "2911",
    replacementHistory: [{ type: "compaction", encrypted_content: "offline-opaque" }] });
  manager.appendMessage({ role: "system", content: "Late instruction", toolsAdded: [tool("late")], timestamp: 0 } as never);
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(model.provider, async () => ({ type: "oauth", access: apiKey, refresh: "offline", expires: Date.now() + 600_000 }));
  const runtime = await ModelRuntime.create({ credentials, modelsStore: new InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerNativeProvider(openaiCodexProvider());
  const settings = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false }, cacheWarming: "off" });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager: settings,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true, systemPromptOverride: () => "Fixed prompt",
    extensionFactories: [pi => {
      for (const name of ["hider", "victim", "late"]) pi.registerTool({ ...tool(name), label: name,
        ...(name === "hider" ? { prepareLoadout: () => ({ hiddenDeclarations: mode === "forced" ? [] : ["victim", "late"] }) } : {}),
        execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }) } as never);
      if (mode !== "hidden") pi.on("before_agent_start", () => ({ systemPrompt: "Forced prompt" }));
    }, compact] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir: join(root, "agent"), modelRuntime: runtime, model,
    resourceLoader: loader, sessionManager: manager, settingsManager: settings, tools: ["hider", "victim", "late"] });
  const payloads: any[] = [], errors: unknown[] = [];
  const network = vi.fn().mockRejectedValue(new Error("Unexpected compaction or network"));
  vi.stubGlobal("fetch", network);
  session.agent.streamFunction = (selected, context, options) => streamSimple(selected as never, context, { ...options, apiKey, transport: "sse", maxRetries: 0,
    onPayload: async (value, selectedModel) => {
      const prepared = await options?.onPayload?.(value, selectedModel);
      payloads.push(structuredClone(prepared ?? value)); return prepared;
    }, fetch: async () => answer(payloads.length) });
  try {
    await session.bindExtensions({ onError: error => errors.push(error) });
    await session.prompt("continue");
    await session.waitForIdle();
    expect(errors).toEqual([]);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].input).toContainEqual({ type: "compaction", encrypted_content: "offline-opaque" });
    expect(payloads[0].input.filter((item: any) => item.role === "user")).toEqual([{ role: "user", content: [{ type: "input_text", text: "continue" }] }]);
    if (mode !== "hidden") expect(payloads[0].instructions).toBe("Forced prompt");
    if (mode !== "forced") expect(JSON.stringify(payloads[0].tools)).not.toMatch(/victim|late/);
    expect(network).not.toHaveBeenCalled();
    configuration.manualProjection = { hiddenTools: mode === "forced" ? [] : ["victim", "late"], forcedPrompt: mode !== "hidden" ? "Forced prompt" : undefined };
    const compactionBodies: any[] = [];
    network.mockImplementation(async (_url, init) => {
      compactionBodies.push(JSON.parse(String(init.body)));
      return sse([{ type: "response.output_item.done", item: { type: "compaction", encrypted_content: "manual-opaque" } },
        { type: "response.completed", response: { id: "manual" } }]);
    });
    await session.compact();
    expect(compactionBodies).toHaveLength(1);
    if (mode !== "forced") expect(JSON.stringify(compactionBodies[0].tools)).not.toMatch(/victim|late/);
    if (mode !== "hidden") expect(compactionBodies[0].instructions).toBe("Forced prompt");
    await session.prompt("after manual");
    await session.waitForIdle();
    expect(payloads.at(-1).input).toContainEqual({ type: "compaction", encrypted_content: "manual-opaque" });
  } finally {
    await session.abort(); await session.waitForIdle();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "exit" });
    session.dispose(); vi.unstubAllGlobals(); configuration.manualProjection = { hiddenTools: [], forcedPrompt: undefined as string | undefined };
    await rm(root, { recursive: true, force: true });
  }
}, 25_000);
