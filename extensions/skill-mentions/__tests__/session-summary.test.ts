import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it, vi } from "vitest";
import { DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import skillMentions from "../src/index.js";
import { encodeSnapshot } from "../src/protocol.js";

import type { SessionSummaryCapability, SessionSummaryTransformer } from "../../../test-support/host-capabilities.js";

// Preserve the stock overloads and describe only the optional patch arguments.
const summaries = SessionManager as unknown as {
  list(...args: [...Parameters<typeof SessionManager.list>, SessionSummaryTransformer[]?]): ReturnType<typeof SessionManager.list>;
  listAll(dir: string, progress?: undefined, signal?: undefined, transformers?: SessionSummaryTransformer[]): ReturnType<typeof SessionManager.list>;
};
const search = await import(pathToFileURL(join(process.cwd(), "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/session-selector-search.js")).href);

it.each([10, 100])("lists %i sessions with capability-correct display and search without changing history", async count => {
  const root = await mkdtemp(join(process.cwd(), ".skill-summary-"));
  try {
    let supportsSummary = false;
    const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, "agent"), settingsManager: SettingsManager.inMemory({}),
      noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
      extensionFactories: [pi => { supportsSummary = typeof (pi as typeof pi & SessionSummaryCapability).registerSessionSummaryTransformer === "function"; skillMentions(pi, { preferencePath: join(root, "preference.json") }); }],
    });
    await loader.reload();
    expect(loader.getExtensions().errors).toEqual([]);
    const transformers = loader.getExtensions().extensions.flatMap(extension => { const transformer = (extension as typeof extension & { sessionSummaryTransformer?: SessionSummaryTransformer }).sessionSummaryTransformer; return transformer ? [vi.fn(transformer)] : []; });
    const enhanced = transformers.length > 0;
    expect(transformers).toHaveLength(supportsSummary ? 1 : 0);
    const dir = join(root, "sessions");
    const before = new Map<string, string>();
    for (let i = 0; i < count; i++) {
      const manager = SessionManager.create(root, dir);
      const task = i < 2 ? "同文 $alpha\n继续工作" : `任务 ${i} $alpha ${"long ".repeat(i)}`;
      let text = encodeSnapshot({ namespace: "pi-ext/skill-mentions", version: 1, requestId: randomUUID(), task,
        skills: [{ name: "alpha", location: join(root, "missing/SKILL.md"), baseDir: join(root, "missing"), body: "PRIVATE_SKILL_BODY" }],
      });
      if (i === 2) text = text.replace('version="1"', 'version="9"');
      if (i === 3) text = '<pi-ext-skill-mentions version="1">\n{bad}\n</pi-ext-skill-mentions>';
      manager.appendMessage({ role: "user", content: text, timestamp: Date.now() });
      manager.appendMessage(fauxAssistantMessage("Done"));
      if (i === 4) manager.appendSessionInfo("Explicit name");
      before.set(manager.getSessionFile()!, await readFile(manager.getSessionFile()!, "utf8"));
    }
    const partial: string[] = [];
    const listed = await summaries.list(root, dir, (_loaded, _total, sessions) => { if (sessions) partial.push(...sessions.map(session => session.firstMessage)); }, undefined, transformers);
    expect(listed).toHaveLength(count);
    if (!enhanced) {
      expect(listed.every(session => session.firstMessage.startsWith("<pi-ext-skill-mentions"))).toBe(true);
      expect(listed.filter(session => session.allMessagesText.includes("PRIVATE_SKILL_BODY"))).toHaveLength(count - 1);
      expect(search.filterAndSortSessions(listed, "PRIVATE_SKILL_BODY", "recent", "all")).toHaveLength(count - 1);
      expect(listed.find(session => session.name)?.name).toBe("Explicit name");
      const all = await summaries.listAll(dir);
      expect(all.map(session => session.firstMessage).sort()).toEqual(listed.map(session => session.firstMessage).sort());
      for (const [file, bytes] of before) expect(await readFile(file, "utf8")).toBe(bytes);
      return;
    }
    expect(transformers[0]).toHaveBeenCalledTimes(count * 2);
    expect(listed.filter(session => session.firstMessage === "同文 $alpha\n继续工作")).toHaveLength(2);
    expect(listed.find(session => session.name)?.name).toBe("Explicit name");
    expect(listed.filter(session => session.firstMessage.startsWith("<pi-ext-skill-mentions"))).toHaveLength(2);
    expect(listed.filter(session => !session.firstMessage.startsWith("<pi-ext-skill-mentions")).every(session => !session.allMessagesText.includes("PRIVATE_SKILL_BODY"))).toBe(true);
    expect(partial).toContain("同文 $alpha\n继续工作");
    for (let i = 0; i < 10; i++) expect(search.filterAndSortSessions(listed, '"同文"', "recent", "all")).toHaveLength(2);
    expect(search.filterAndSortSessions(listed, "", "recent", "named")).toHaveLength(1);
    expect(transformers[0]).toHaveBeenCalledTimes(count * 2);
    const all = await summaries.listAll(dir, undefined, undefined, transformers);
    expect(all.map(session => session.firstMessage).sort()).toEqual(listed.map(session => session.firstMessage).sort());
    const disabled = await summaries.list(root, dir);
    expect(disabled.every(session => session.firstMessage.startsWith("<pi-ext-skill-mentions"))).toBe(true);
    const failed = await summaries.list(root, dir, undefined, undefined, [() => { throw new Error("Projection failed"); }]);
    expect(failed.map(session => session.firstMessage).sort()).toEqual(disabled.map(session => session.firstMessage).sort());
    for (const [file, bytes] of before) expect(await readFile(file, "utf8")).toBe(bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
