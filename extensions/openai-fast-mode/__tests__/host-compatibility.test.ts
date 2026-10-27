import { createTestUi } from "../../../test-support/pi-ui.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as ai from "@earendil-works/pi-ai";
import * as adapter from "@earendil-works/pi-ai/api/openai-codex-responses";
import * as responsesAdapter from "@earendil-works/pi-ai/api/openai-responses";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { offlineCodex, responseEvents, textStep } from "../../goal/__tests__/budget-fixtures.mjs";
import { createPiFastModeExtension } from "../src/index.js";
import { getUserConfigPath } from "../src/config.js";

test.each(["gpt-5.4", "gpt-unlisted"])("applies the OpenAI allowlist to the real Responses transport for %s", async id => {
  mkdirSync(".tmp", { recursive: true });
  const cwd = mkdtempSync(resolve(".tmp/fast-openai-host-"));
  const agentDir = join(cwd, "agent");
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const model = { id, name: "Offline OpenAI fixture", provider: "openai", api: "openai-responses" as const,
      baseUrl: "https://offline.invalid/v1", reasoning: true, input: ["text" as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 };
    const payloads: any[] = [], errors: string[] = [];
    const stream = (selected: typeof model, context: any, options: any) => responsesAdapter.streamSimple(selected, context, {
      ...options, apiKey: "fixture", maxRetries: 0, fetch: async (_url: unknown, init: any) => {
        payloads.push(JSON.parse(String(init.body)));
        return new Response(responseEvents(textStep("Done"), "response_fixture").map((event: any) => `data: ${JSON.stringify(event)}\n\n`).join(""),
          { status: 200, headers: { "content-type": "text/event-stream" } });
      },
    });
    const modelRuntime = await ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(),
      modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    modelRuntime.registerNativeProvider(ai.createProvider({ id: "openai", models: [model],
      auth: { apiKey: { name: "Offline", resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } } as any));
    const configPath = getUserConfigPath(agentDir);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ enabled: true }));
    const settingsManager = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions: true, noSkills: true,
      noThemes: true, noContextFiles: true, noPromptTemplates: true,
      extensionFactories: [createPiFastModeExtension({ agentDir, extensionDir: cwd, env: {} })] });
    await resourceLoader.reload();
    ({ session } = await createAgentSession({ cwd, agentDir, settingsManager, sessionManager: SessionManager.inMemory(cwd),
      resourceLoader, modelRuntime, model, noTools: "all" }));
    await session.bindExtensions({ mode: "json", onError: error => errors.push(error.error) });
    await session.prompt("Check the OpenAI request");
    await session.waitForIdle();
    expect(errors).toEqual([]);
    const last = session.messages.at(-1);
    expect(last?.role === "assistant" && last.stopReason).toBe("stop");
    expect(payloads).toHaveLength(1);
    expect(payloads[0].service_tier).toBe(id === "gpt-5.4" ? "priority" : undefined);
    expect(payloads[0].model).toBe(id);
  } finally { await session?.abort(); session?.dispose(); rmSync(cwd, { recursive: true, force: true }); }
});

test("sets service tier on the real host's normalized Codex request", async () => {
  mkdirSync(".tmp", { recursive: true });
  const cwd = mkdtempSync(resolve(".tmp/fast-host-"));
  const agentDir = join(cwd, "agent");
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const fixture = offlineCodex(ai, adapter, [textStep("Done")]);
    fixture.model.id = "gpt-6-astra";
    const configPath = getUserConfigPath(agentDir);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ enabled: true, targets: [{ provider: fixture.model.provider, model: fixture.model.id, serviceTier: "priority" }] }));
    const modelRuntime = await ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    modelRuntime.registerNativeProvider(fixture.provider);
    const settingsManager = SettingsManager.inMemory();
    const payloads: any[] = [], errors: string[] = [];
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
      extensionFactories: [createPiFastModeExtension({ agentDir, extensionDir: cwd }), pi => {
        pi.on("before_provider_request", event => { payloads.push(structuredClone(event.payload)); });
      }],
    });
    await resourceLoader.reload();
    ({ session } = await createAgentSession({ cwd, agentDir, settingsManager, sessionManager: SessionManager.inMemory(cwd), resourceLoader, modelRuntime, model: fixture.model, noTools: "builtin" }));
    await session.bindExtensions({ mode: "tui", uiContext: { ...createTestUi(), setStatus() {}, setWidget() {} }, onError: error => { errors.push(error.error); } });
    await session.prompt("Check the request");
    await session.waitForIdle();
    expect(errors).toEqual([]);
    expect(fixture.calls()).toBe(1);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].service_tier).toBe("priority");
    expect(payloads[0].input).toContainEqual({ role: "user", content: [{ type: "input_text", text: "Check the request" }] });
  } finally { await session?.abort(); session?.dispose(); rmSync(cwd, { recursive: true, force: true }); }
});

test("stops requesting Fast after a Codex SSE rejection in the real host", async () => {
  mkdirSync(".tmp", { recursive: true });
  const cwd = mkdtempSync(resolve(".tmp/fast-host-"));
  const agentDir = join(cwd, "agent");
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    const fixture = offlineCodex(ai, adapter, [
      { error: "service_tier priority is not supported for this model" },
      textStep("Done"),
    ]);
    fixture.model.id = "gpt-7-unlisted";
    const configPath = getUserConfigPath(agentDir);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ enabled: true, targets: [] }));
    const modelRuntime = await ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    modelRuntime.registerNativeProvider(fixture.provider);
    const settingsManager = SettingsManager.inMemory();
    const payloads: any[] = [], errors: string[] = [];
    const notifications: Array<[string, string | undefined]> = [];
    const statuses: Array<string | undefined> = [];
    const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
      extensionFactories: [createPiFastModeExtension({ agentDir, extensionDir: cwd }), pi => {
        pi.on("before_provider_request", event => { payloads.push(structuredClone(event.payload)); });
      }],
    });
    await resourceLoader.reload();
    ({ session } = await createAgentSession({ cwd, agentDir, settingsManager, sessionManager: SessionManager.inMemory(cwd), resourceLoader, modelRuntime, model: fixture.model, noTools: "builtin" }));
    await session.bindExtensions({ mode: "tui", uiContext: { ...createTestUi(),
      setStatus(_key, text) { statuses.push(text); }, setWidget() {},
      notify(message, type) { notifications.push([message, type]); },
    }, onError: error => { errors.push(error.error); } });
    await session.prompt("Try fast");
    await session.waitForIdle();
    expect(fixture.calls()).toBe(1);
    expect(payloads[0].service_tier).toBe("priority");
    expect(errors).toEqual([]);
    expect(statuses).toEqual(["fast", undefined]);
    expect(notifications).toEqual([[
      "Fast mode is not supported for openai-codex/gpt-7-unlisted. This request failed. Retry to use standard mode for this model in this session.",
      "warning",
    ]]);
    await session.prompt("Retry");
    await session.waitForIdle();
    expect(errors).toEqual([]);
    expect(fixture.calls()).toBe(2);
    expect(payloads[1].service_tier).toBeUndefined();
  } finally { await session?.abort(); session?.dispose(); rmSync(cwd, { recursive: true, force: true }); }
});
