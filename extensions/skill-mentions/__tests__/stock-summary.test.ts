import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import skillMentions from "../src/index.js";
import { encodeSnapshot } from "../src/protocol.js";

it("keeps core registration and history intact without summary projection capability", async () => {
  const root = await mkdtemp(join(process.cwd(), ".tmp/stock-summary-"));
  try {
    const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager: SettingsManager.inMemory({}),
      noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
      extensionFactories: [pi => {
        Object.defineProperty(pi, "registerSessionSummaryTransformer", { value: undefined });
        skillMentions(pi, { preferencePath: join(root, "preference.json") });
      }],
    });
    await loader.reload();
    expect(loader.getExtensions().errors).toEqual([]);
    const manager = SessionManager.create(root, join(root, "sessions"));
    const snapshot = encodeSnapshot({ namespace: "pi-ext/skill-mentions", version: 1, requestId: randomUUID(), task: "Task $alpha",
      skills: [{ name: "alpha", location: join(root, "missing/SKILL.md"), baseDir: join(root, "missing"), body: "SAVED_SKILL_BODY" }] });
    manager.appendMessage({ role: "user", content: snapshot, timestamp: Date.now() });
    const file = manager.getSessionFile()!;
    const before = await readFile(file, "utf8");
    const [summary] = await SessionManager.list(root, join(root, "sessions"));
    expect(summary!.firstMessage).toContain("<pi-ext-skill-mentions");
    expect(summary!.allMessagesText).toContain("SAVED_SKILL_BODY");
    expect(await readFile(file, "utf8")).toBe(before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
