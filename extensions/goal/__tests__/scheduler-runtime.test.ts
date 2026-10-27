import { createTestUi } from "../../../test-support/pi-ui.js";
import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { registerGoal } from "../src/index.js";
import { GoalStore } from "../src/storage.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it.each(["external-first", "external-last", "user", "goal-only", "old-external"])("handles a real Pi mixed batch: %s", async kind => {
  const root = await mkdtemp(join(process.cwd(), ".goal-runtime-test-"));
  roots.push(root);
  const store = new GoalStore(join(root, "goals"));
  const manager = SessionManager.create(root, join(root, "sessions"));
  const seed = await store.openSession({ ownerSessionId: manager.getSessionId(), cwd: root, sessionFile: manager.getSessionFile()! });
  await seed.replace("Handle queued work", seed.snapshot);
  await seed.close();
  const faux = fauxProvider({ provider: "openai-codex", tokensPerSecond: 1000000 });
  faux.setResponses([
    fauxAssistantMessage({ type: "toolCall", name: "hold_goal_batch", arguments: {}, id: "hold" }, { stopReason: "toolUse" }),
    fauxAssistantMessage("External request handled"),
    fauxAssistantMessage("External request handled"),
  ]);
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  let other!: ExtensionAPI;
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const contexts: Array<{ messages: Array<{ role: string; customType?: string; content?: unknown }>; signal?: AbortSignal }> = [];
  const notices: string[] = [];
  const errors: string[] = [];
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    extensionFactories: [pi => registerGoal(pi, store, { temporaryRoot: join(root, "tmp") }), pi => {
      other = pi;
      pi.registerTool({ name: "hold_goal_batch", label: "Hold batch", description: "Hold one batch", parameters: { type: "object", properties: {} }, execute: async (_id, _args, signal) => {
        enter();
        await Promise.race([held, new Promise<void>(resolve => signal?.addEventListener("abort", () => resolve(), { once: true }))]);
        return { content: [{ type: "text", text: "Released" }], details: {} };
      } });
      pi.on("context", (event, ctx) => { contexts.push({ messages: event.messages, signal: ctx.signal }); });
    }],
  });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir: join(root, "agent"), modelRuntime, model: faux.getModel(), resourceLoader: loader, sessionManager: manager, settingsManager, tools: ["hold_goal_batch", "get_goal", "create_goal", "update_goal"] });
  await session.bindExtensions({ mode: "tui", uiContext: { ...createTestUi(), notify: text => notices.push(text), setStatus() {}, confirm: async () => true, editor: async () => "Edited goal" }, onError: error => errors.push(error.error) });
  session.setSteeringMode("all");
  const timer = setTimeout(() => { release(); void session.abort(); }, 12000);
  let running: Promise<unknown> | undefined;
  try {
    if (kind === "old-external") await session.sendCustomMessage({ customType: "other-extension", content: "Old request", display: false }, { triggerTurn: false });
    running = session.prompt("Start work");
    await Promise.race([entered, running.then(() => { throw new Error(`Prompt finished before hold tool: ${JSON.stringify({ contexts, notices, errors })}`); })]);
    const external = () => other.sendMessage({ customType: "other-extension", content: "Fresh request", display: false }, { deliverAs: "steer" });
    if (kind === "external-first") await external();
    await session.prompt("/goal edit");
    await session.prompt("/goal pause");
    if (kind === "external-last") await external();
    if (kind === "user") await session.prompt("Fresh user request", { streamingBehavior: "steer" });
    release();
    await running;
    await session.waitForIdle();
    const mixed = contexts.find(({ messages }) => messages.some(message => message.customType === "pi-ext-goal-continuation" && typeof message.content === "string" && message.content.includes("Edited goal")));
    expect(mixed, JSON.stringify(contexts.map(item => item.messages.map(message => [message.role, message.customType])))).toBeDefined();
    expect(mixed!.signal?.aborted).toBe(kind === "goal-only" || kind === "old-external");
    const answered = session.messages.some(message => message.role === "assistant" && message.content.some(part => part.type === "text" && part.text.includes("External request handled")));
    expect(answered).toBe(kind !== "goal-only" && kind !== "old-external");
    if (kind.startsWith("external")) {
      const custom = mixed!.messages.filter(message => message.role === "custom");
      const externalIndex = custom.findIndex(message => message.customType === "other-extension" && message.content === "Fresh request");
      const editIndex = custom.findIndex(message => message.customType === "pi-ext-goal-continuation" && typeof message.content === "string" && message.content.includes("Edited goal"));
      expect(externalIndex).toBeGreaterThanOrEqual(0);
      expect(Math.sign(externalIndex - editIndex)).toBe(kind === "external-first" ? -1 : 1);
    }
    expect((await store.records())[0]!.goal?.status).toBe("paused");
    expect(errors).toEqual([]);
    expect(notices.some(text => text.includes("Goal storage error"))).toBe(false);
  } finally {
    clearTimeout(timer);
    release();
    await session.abort();
    await running?.catch(() => {});
    await session.waitForIdle();
    session.dispose();
  }
});
