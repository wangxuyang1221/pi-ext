import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import * as ai from "@earendil-works/pi-ai";
import * as adapter from "@earendil-works/pi-ai/api/openai-codex-responses";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createTestUi } from "../../../test-support/pi-ui.js";
import { registerGoal } from "../src/index.js";
import { GoalStore } from "../src/storage.js";
import { offlineCodex, toolStep } from "./budget-fixtures.mjs";

it.each([
  ["usage_limit_reached", false], ["insufficient_quota", false],
  ["usage_limit_reached", true], ["insufficient_quota", true],
  ["rate_limit", false], ["rate_limit", true],
] as const)("classifies native adapter SSE %s with budget=%s", async (code, budget) => {
  const root = await mkdtemp(join(process.cwd(), ".goal-quota-"));
  const store = new GoalStore(join(root, "goals"));
  const manager = SessionManager.create(root, join(root, "sessions"));
  const seed = await store.openSession({ ownerSessionId: manager.getSessionId(), cwd: root, sessionFile: manager.getSessionFile()! });
  await seed.replace("Retain quota goal", seed.snapshot, budget ? 50 : undefined);
  const goalId = seed.snapshot.goal!.goalId;
  await seed.close();
  const fixture = offlineCodex(ai, adapter, [...(budget ? [toolStep("get_goal", {})] : []), { error: code }]);
  const models = await ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsStore: new ai.InMemoryModelsStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  models.registerNativeProvider(fixture.provider);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager: settings,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    extensionFactories: [pi => registerGoal(pi, store)],
  });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir: join(root, "agent"), sessionManager: manager, resourceLoader: loader, modelRuntime: models, model: fixture.model, settingsManager: settings, tools: ["get_goal", "create_goal", "update_goal"] });
  const errors: unknown[] = [];
  try {
    await session.bindExtensions({ mode: "tui", uiContext: createTestUi(), onError: error => errors.push(error) });
    await session.prompt("Inspect the goal");
    await session.waitForIdle();
    const goal = (await store.records())[0].goal!;
    expect(goal).toMatchObject({ goalId, objective: "Retain quota goal", status: code === "rate_limit" ? budget ? "budget_limited" : "blocked" : "usage_limited" });
    if (budget) expect(goal.tokensUsed).toBeGreaterThanOrEqual(100);
    expect(fixture.calls()).toBe(budget ? 2 : 1);
    expect(session.messages.some(message => message.role === "assistant" && message.errorMessage === `Codex error: ${code}`)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await session.abort(); await session.waitForIdle(); session.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
