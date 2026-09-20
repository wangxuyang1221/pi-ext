import { afterEach, beforeAll, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { InMemoryCredentialStore, InMemoryModelsStore, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
  createAgentSession, createSyntheticSourceInfo, DefaultResourceLoader, getMarkdownTheme, initTheme,
  InteractiveMode, ModelRuntime, SessionManager, SettingsManager, SkillInvocationMessageComponent, stripFrontmatter,
  type AgentSession, type ExtensionContext, type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences } from "@earendil-works/pi-tui";

// Planning experiment only: the fixture recognizes known space-separated references, not the product grammar.
// Real extension loading, AgentSession, queue consumption, persistence and faux provider calls are exercised.
const kind = "multi-skill-lifecycle-probe";
const displayType = `${kind}-display`;
type Snapshot = { name: string; location: string; content: string };
type Envelope = { kind: typeof kind; task: string; skills: Snapshot[]; requestId?: string };
const task = "Please use $alpha and $beta";
const textOf = (message: any): string => typeof message.content === "string" ? message.content :
  message.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n");
function decode(text: string): Envelope | undefined {
  try { const value = JSON.parse(text); return value.kind === kind ? value : undefined; } catch { return undefined; }
}
const resources: { cwd: string; session?: AgentSession }[] = [];
beforeAll(() => initTheme("dark", false));
afterEach(async () => {
  for (const item of resources.splice(0)) {
    if (item.session) { await item.session.abort(); item.session.dispose(); }
    rmSync(item.cwd, { recursive: true, force: true });
  }
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function harness(entries?: SessionEntry[], options: { failAppendOnce?: boolean; expandAt?: "input" | "message_end"; earlyDisplay?: boolean; repairAfterCompact?: boolean } = {}) {
  const cwd = mkdtempSync(join(process.cwd(), "adventure/experiments/.lifecycle-"));
  const resource: { cwd: string; session?: AgentSession } = { cwd };
  resources.push(resource);
  const skills = ["alpha", "beta"].map(name => {
    const baseDir = join(cwd, name); mkdirSync(baseDir);
    const filePath = join(baseDir, "SKILL.md");
    writeFileSync(filePath, `---\nname: ${name}\ndescription: Fixture ${name}\n---\n${name.toUpperCase()}_BODY\n`);
    return { name, description: `Fixture ${name}`, filePath, baseDir,
      sourceInfo: createSyntheticSourceInfo(filePath, { source: "sdk" }), disableModelInvocation: false };
  });
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false },
    showCacheMissNotices: false, steeringMode: "all", followUpMode: "all" });
  const sessionManager = SessionManager.inMemory(cwd, undefined, entries);
  const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(),
    modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const faux = fauxProvider(); models.registerNativeProvider(faux.provider);
  const calls: any[] = [], errors: string[] = [], inputEvents: any[] = [];
  let beforeCount = 0, latestContext: ExtensionContext | undefined;
  let failAppend = options.failAppendOnce ?? false;
  let compactFrom = "";
  const respond = (context: any) => { calls.push(structuredClone(context.messages)); return fauxAssistantMessage("Fixture response"); };
  faux.setResponses(Array.from({ length: 8 }, () => respond));
  const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    skillsOverride: () => ({ skills, diagnostics: [] }),
    extensionFactories: [pi => {
      const pending = new Map<object, string>();
      const pendingIds = new Set<string>();
      function reconcile(ctx: ExtensionContext) {
        latestContext = ctx;
        const visible = ctx.sessionManager.buildContextEntries();
        const shown = new Set(visible.flatMap(entry => entry.type === "custom" && entry.customType === displayType
          ? [(entry.data as any).requestId ?? (entry.data as any).userEntryId] : []));
        for (const entry of visible) {
          if (entry.type !== "message" || entry.message.role !== "user") continue;
          const envelope = decode(textOf(entry.message));
          if (!envelope) continue;
          if (envelope.requestId) pendingIds.delete(envelope.requestId);
          if (shown.has(envelope.requestId ?? entry.id)) continue;
          if (failAppend) { failAppend = false; throw new Error("Injected display append failure"); }
          pi.appendEntry(displayType, { userEntryId: entry.id, requestId: envelope.requestId, skills: envelope.skills });
        }
      }
      function expand(text: string) {
        if (decode(text)) return text;
        const commands = pi.getCommands().filter(command => command.source === "skill");
        const snapshots = [...new Set(text.split(/\s+/).filter(token => token.startsWith("$")).map(token => token.slice(1)))]
          .flatMap(name => {
            const command = commands.find(item => item.name === `skill:${name}`);
            if (!command) return [];
            try {
              const location = command.sourceInfo.path;
              return [{ name, location, content: `References are relative to ${dirname(location)}.\n\n${stripFrontmatter(readFileSync(location, "utf8"))}` }];
            } catch { return []; }
          });
        return snapshots.length ? JSON.stringify({ kind, task: text, skills: snapshots } satisfies Envelope) : text;
      }
      pi.on("input", event => {
        inputEvents.push({ source: event.source, streamingBehavior: event.streamingBehavior });
        if (options.expandAt === "message_end" || event.source !== "interactive") return { action: "continue" };
        return { action: "transform", text: expand(event.text) };
      });
      pi.on("message_start", (event, ctx) => {
        if (!options.earlyDisplay || ctx.mode !== "tui" || event.message.role !== "user") return;
        latestContext = ctx;
        const envelope = decode(expand(textOf(event.message)));
        if (!envelope) return;
        envelope.requestId ??= randomUUID();
        pending.set(event.message, JSON.stringify(envelope));
        pendingIds.add(envelope.requestId);
        pi.appendEntry(displayType, { requestId: envelope.requestId, skills: envelope.skills });
      });
      pi.on("message_end", (event, ctx) => {
        if (options.expandAt !== "message_end" || ctx.mode !== "tui" || event.message.role !== "user") return;
        const original = textOf(event.message), text = pending.get(event.message) ?? expand(original);
        pending.delete(event.message);
        if (text === original) return;
        const images = typeof event.message.content === "string" ? [] : event.message.content.filter(block => block.type === "image");
        return { message: { ...event.message, content: [{ type: "text", text }, ...images] } };
      });
      pi.registerMarkdownTransformer((markdown, ctx) => ctx.messageType === "user" ? decode(markdown)?.task ?? markdown : markdown);
      pi.registerEntryRenderer<{ userEntryId?: string; requestId?: string; skills: Snapshot[] }>(displayType, (entry, renderOptions) => {
        const requestId = entry.data?.requestId;
        const visible = latestContext?.sessionManager.buildContextEntries().some(item => item.id === entry.data?.userEntryId ||
          (requestId && item.type === "message" && item.message.role === "user" && decode(textOf(item.message))?.requestId === requestId));
        if (!visible && !(requestId && pendingIds.has(requestId))) return undefined;
        const group = new Container();
        for (const snapshot of entry.data!.skills) {
          const card = new SkillInvocationMessageComponent({ ...snapshot, userMessage: "" });
          card.setExpanded(renderOptions.expanded); group.addChild(card);
        }
        return group;
      });
      pi.on("before_agent_start", () => { beforeCount++; });
      pi.on("context", (_event, ctx) => { reconcile(ctx); });
      pi.on("session_start", (_event, ctx) => { reconcile(ctx); });
      pi.on("session_tree", (_event, ctx) => { reconcile(ctx); });
      pi.on("session_compact", (_event, ctx) => { if (options.repairAfterCompact) reconcile(ctx); });
      pi.on("session_before_compact", () => ({ compaction: { summary: "Fixture summary", firstKeptEntryId: compactFrom, tokensBefore: 10 } }));
    }],
  });
  await loader.reload();
  expect(loader.getExtensions().errors).toEqual([]);
  const { session } = await createAgentSession({ cwd, agentDir: join(cwd, "agent"), settingsManager, sessionManager,
    resourceLoader: loader, modelRuntime: models, model: faux.getModel(), noTools: "all" });
  resource.session = session;
  await session.bindExtensions({ mode: "tui", onError: error => { errors.push(error.error); } });

  // Actual transcript methods and renderers, with terminal/editor plumbing omitted. Not a PTY test.
  const mode: any = Object.create(InteractiveMode.prototype);
  Object.defineProperties(mode, Object.getOwnPropertyDescriptors({ session, sessionManager, settingsManager,
    chatContainer: new Container(), pendingTools: new Map(), toolOutputExpanded: false, hideThinkingBlock: false,
    outputPad: 1, ui: { requestRender() {} }, editor: { addToHistory() {} },
    getMarkdownThemeWithSettings: () => getMarkdownTheme(),
    getMarkdownTransformers: () => session.extensionRunner.getMarkdownTransformers(),
  }));
  const liveSequence: string[] = [];
  session.subscribe(event => {
    if (event.type === "message_start" && event.message.role === "user") {
      liveSequence.push("user"); mode.addMessageToChat(event.message);
    }
    if (event.type === "entry_appended" && event.entry.type === "custom") { liveSequence.push("display"); mode.addCustomEntryToChat(event.entry); }
  });
  const plain = () => mode.chatContainer.render(90).map(stripTerminalSequences).join("\n");
  const rebuild = () => { mode.rebuildChatFromMessages(); return plain(); };
  const displays = () => sessionManager.buildContextEntries().filter(entry => entry.type === "custom" && entry.customType === displayType);
  const users = () => sessionManager.buildContextEntries().filter(entry => entry.type === "message" && entry.message.role === "user");
  return { cwd, session, sessionManager, skills, faux, calls, respond, errors, inputEvents, liveSequence, plain, rebuild, displays, users,
    get beforeCount() { return beforeCount; }, setCompactFrom(id: string) { compactFrom = id; } };
}

function verifyPayload(messages: any[]) {
  const users = messages.filter(message => message.role === "user" && decode(textOf(message)));
  expect(users).toHaveLength(1);
  const envelope = decode(textOf(users[0]))!;
  expect(envelope.task).toBe(task);
  expect(envelope.skills.map(skill => skill.name)).toEqual(["alpha", "beta"]);
  for (const skill of envelope.skills) {
    expect(skill.content).toContain(`${skill.name.toUpperCase()}_BODY`);
    expect(skill.content).toContain(dirname(skill.location));
    expect(skill.content).not.toContain("description:");
    expect(readFileSync(skill.location, "utf8")).toContain(`${skill.name.toUpperCase()}_BODY`);
  }
}

test.each(["input", "message_end"] as const)("%s: real session delivers two snapshots and images in one request, with task before cards", async expandAt => {
  const h = await harness(undefined, { expandAt });
  const image = { type: "image" as const, data: "AA==", mimeType: "image/png" };
  await h.session.prompt(task, { source: "interactive", images: [image] });
  expect(h.faux.state.callCount).toBe(1); verifyPayload(h.calls[0]);
  expect(h.calls[0].find((message: any) => message.role === "user").content).toContainEqual(image);
  expect(h.displays()).toHaveLength(1); expect(h.errors).toEqual([]);
  expect(h.liveSequence).toEqual(["user", "display"]);
  const display = h.plain();
  expect(display).toContain(task); expect(display).toContain("[skill] alpha"); expect(display).toContain("[skill] beta");
  expect(display).not.toContain("ALPHA_BODY"); expect(display).not.toContain(kind);
  expect(display.indexOf(task)).toBeLessThan(display.indexOf("[skill] alpha"));
  expect(h.rebuild()).toContain("[skill] beta");
});

for (const behavior of ["steer", "followUp"] as const) {
  test.each(["input", "message_end"] as const)(`%s: real ${behavior} queue carries both snapshots in one consumed user message`, async expandAt => {
    const h = await harness(undefined, { expandAt });
    const entered = deferred(), release = deferred();
    h.faux.setResponses([async context => { entered.resolve(); await release.promise; return h.respond(context); }, h.respond]);
    const run = h.session.prompt("Initial task", { source: "interactive" });
    await entered.promise;
    try {
      await h.session.prompt(task, { source: "interactive", streamingBehavior: behavior });
      const pending = behavior === "steer" ? h.session.getSteeringMessages() : h.session.getFollowUpMessages();
      expect(pending).toHaveLength(1);
      if (expandAt === "input") {
        expect(decode(pending[0])?.skills).toHaveLength(2);
        expect(pending[0]).toContain("ALPHA_BODY");
      } else {
        expect(pending[0]).toBe(task);
        expect(pending[0]).not.toContain("ALPHA_BODY");
      }
      expect(h.displays()).toHaveLength(0);
    } finally { release.resolve(); }
    await run;
    expect(h.faux.state.callCount).toBe(2); verifyPayload(h.calls[1]);
    expect(h.beforeCount).toBe(1); expect(h.displays()).toHaveLength(1);
    expect(h.inputEvents).toContainEqual({ source: "interactive", streamingBehavior: behavior });
    expect(h.errors).toEqual([]);
  });
}

test("two queued users produce U1 U2 D1 D2 ordering instead of adjacent native cards", async () => {
  const h = await harness();
  const entered = deferred(), release = deferred();
  h.faux.setResponses([async context => { entered.resolve(); await release.promise; return h.respond(context); }, h.respond]);
  const run = h.session.prompt("Initial task", { source: "interactive" }); await entered.promise;
  try {
    await h.session.prompt(task, { source: "interactive", streamingBehavior: "steer" });
    await h.session.prompt(`Again ${task}`, { source: "interactive", streamingBehavior: "steer" });
  } finally { release.resolve(); }
  await run;
  expect(h.liveSequence).toEqual(["user", "user", "user", "display", "display"]);
  expect(h.displays()).toHaveLength(2);
  expect(h.faux.state.callCount).toBe(2);
  expect(h.errors).toEqual([]);
});

test("withdrawn queue text contains the full envelope and must not be mistaken for clean editor text", async () => {
  const h = await harness(); const entered = deferred(), release = deferred();
  h.faux.setResponses([async context => { entered.resolve(); await release.promise; return h.respond(context); }]);
  const run = h.session.prompt("Initial task", { source: "interactive" }); await entered.promise;
  try {
    await h.session.prompt(task, { source: "interactive", streamingBehavior: "followUp" });
    const cleared = h.session.clearQueue();
    expect(cleared.followUp).toHaveLength(1);
    expect(decode(cleared.followUp[0])?.task).toBe(task);
    expect(cleared.followUp[0]).toContain("BETA_BODY");
  } finally { release.resolve(); }
  await run;
  expect(h.displays()).toHaveLength(0); expect(h.faux.state.callCount).toBe(1);
});

test.each(["input", "message_end"] as const)("%s: reload and JSON restoration preserve cards without rereading skill files", async expandAt => {
  const h = await harness(undefined, { expandAt }); await h.session.prompt(task, { source: "interactive" });
  const saved = JSON.parse(JSON.stringify(h.sessionManager.getEntries()));
  for (const skill of h.skills) rmSync(skill.filePath);
  await h.session.reload();
  expect(h.displays()).toHaveLength(1); expect(h.rebuild()).toContain("[skill] alpha");
  const restored = await harness(saved);
  expect(restored.displays()).toHaveLength(1);
  expect(restored.rebuild()).toContain("[skill] beta");
  const restoredUser = restored.users()[0] as any;
  expect(decode(textOf(restoredUser.message))?.skills[0].location).toBe(h.skills[0].filePath);
  expect(restored.errors).toEqual([]);
});

test("a failed display append does not lose model content and session reload repairs the missing entry once", async () => {
  const h = await harness(undefined, { failAppendOnce: true });
  await h.session.prompt(task, { source: "interactive" }); verifyPayload(h.calls[0]);
  expect(h.errors).toEqual(["Injected display append failure"]); expect(h.displays()).toHaveLength(0);
  await h.session.reload(); expect(h.displays()).toHaveLength(1);
  const repaired = h.displays()[0];
  expect(h.sessionManager.getEntry(repaired.parentId!)?.type).toBe("message");
  await h.session.reload(); expect(h.displays()).toHaveLength(1);
  expect(h.rebuild()).toContain("[skill] alpha");
});

test("tree navigation to a user moves before that user and returns raw envelope for editing", async () => {
  const h = await harness(); await h.session.prompt(task, { source: "interactive" });
  const user = h.users()[0]; const leaf = h.sessionManager.getLeafId()!;
  const result = await h.session.navigateTree(user.id, { summarize: false });
  expect(result.cancelled).toBe(false); expect(decode(result.editorText!)?.task).toBe(task);
  expect(h.users()).toHaveLength(0); expect(h.displays()).toHaveLength(0);
  await h.session.navigateTree(leaf, { summarize: false });
  expect(h.displays()).toHaveLength(1); expect(h.rebuild()).toContain("[skill] alpha");
});

test("early display keeps native card-before-task ordering live and after restoration", async () => {
  const h = await harness(undefined, { expandAt: "message_end", earlyDisplay: true });
  await h.session.prompt(task, { source: "interactive" });
  verifyPayload(h.calls[0]); expect(h.faux.state.callCount).toBe(1);
  expect(h.liveSequence).toEqual(["display", "user"]);
  expect(h.plain().indexOf("[skill] beta")).toBeLessThan(h.plain().indexOf(task));
  expect(h.displays()).toHaveLength(1);
  const saved = JSON.parse(JSON.stringify(h.sessionManager.getEntries()));
  for (const skill of h.skills) rmSync(skill.filePath);
  const restored = await harness(saved, { expandAt: "message_end", earlyDisplay: true });
  const text = restored.rebuild();
  expect(text.indexOf("[skill] beta")).toBeLessThan(text.indexOf(task));
  expect(restored.displays()).toHaveLength(1);
  expect(h.errors).toEqual([]); expect(restored.errors).toEqual([]);
});

test.each(["steer", "followUp"] as const)("early display keeps two %s users adjacent to their cards and pending text clean", async behavior => {
  const h = await harness(undefined, { expandAt: "message_end", earlyDisplay: true });
  const entered = deferred(), release = deferred();
  h.faux.setResponses([async context => { entered.resolve(); await release.promise; return h.respond(context); }, h.respond]);
  const run = h.session.prompt("Initial task", { source: "interactive" }); await entered.promise;
  try {
    await h.session.prompt(task, { source: "interactive", streamingBehavior: behavior });
    await h.session.prompt(`Again ${task}`, { source: "interactive", streamingBehavior: behavior });
    expect(behavior === "steer" ? h.session.getSteeringMessages() : h.session.getFollowUpMessages()).toEqual([task, `Again ${task}`]);
  } finally { release.resolve(); }
  await run;
  expect(h.liveSequence).toEqual(["user", "display", "user", "display", "user"]);
  expect(h.displays()).toHaveLength(2); expect(h.errors).toEqual([]);
  expect(h.faux.state.callCount).toBe(2);
});

test("early display silently keeps unreadable references as text and loads other valid skills", async () => {
  const h = await harness(undefined, { expandAt: "message_end", earlyDisplay: true });
  rmSync(h.skills[1].filePath);
  await h.session.prompt(task, { source: "interactive" });
  const user = h.calls[0].find((message: any) => message.role === "user");
  expect(decode(textOf(user))?.task).toBe(task);
  expect(decode(textOf(user))?.skills.map(item => item.name)).toEqual(["alpha"]);
  expect(h.plain()).toContain(task); expect(h.plain()).not.toContain("[skill] beta");
  expect(h.errors).toEqual([]);
});

test("an early display without a finalized user is hidden when restoring an interrupted session", async () => {
  const h = await harness(undefined, { expandAt: "message_end", earlyDisplay: true });
  await h.session.prompt(task, { source: "interactive" });
  const entries = h.sessionManager.getEntries();
  const displayIndex = entries.findIndex(entry => entry.type === "custom" && entry.customType === displayType);
  const restored = await harness(JSON.parse(JSON.stringify(entries.slice(0, displayIndex + 1))), { expandAt: "message_end", earlyDisplay: true });
  expect(restored.users()).toHaveLength(0); expect(restored.displays()).toHaveLength(1);
  expect(restored.rebuild()).not.toContain("[skill]");
  expect(restored.errors).toEqual([]);
});

test("queued skills use file contents at consumption and retain that snapshot afterwards", async () => {
  const h = await harness(undefined, { expandAt: "message_end", earlyDisplay: true });
  const entered = deferred(), release = deferred();
  h.faux.setResponses([async context => { entered.resolve(); await release.promise; return h.respond(context); }, h.respond]);
  const run = h.session.prompt("Initial task", { source: "interactive" }); await entered.promise;
  try {
    await h.session.prompt(task, { source: "interactive", streamingBehavior: "followUp" });
    const path = h.skills[0].filePath;
    writeFileSync(path, readFileSync(path, "utf8").replace("ALPHA_BODY", "ALPHA_UPDATED_WHILE_QUEUED"));
    expect(h.session.getFollowUpMessages()).toEqual([task]);
  } finally { release.resolve(); }
  await run;
  const user = h.calls[1].find((message: any) => message.role === "user" && decode(textOf(message)));
  expect(decode(textOf(user))?.skills[0].content).toContain("ALPHA_UPDATED_WHILE_QUEUED");
  writeFileSync(h.skills[0].filePath, "ALPHA_CHANGED_AFTER_DELIVERY");
  await h.session.reload();
  const stored = h.users().find(entry => entry.type === "message" && decode(textOf(entry.message)))!;
  expect(decode(textOf((stored as any).message))?.skills[0].content).toContain("ALPHA_UPDATED_WHILE_QUEUED");
  expect(h.errors).toEqual([]);
});

test.each([false, true])("compaction cutting before a user repairs missing early cards only at the leaf: repair=%s", async repairAfterCompact => {
  const h = await harness(undefined, { expandAt: "message_end", earlyDisplay: true, repairAfterCompact });
  await h.session.prompt(task, { source: "interactive" });
  const user = h.users()[0]; h.setCompactFrom(user.id);
  await h.session.compact();
  expect(h.users()).toHaveLength(1);
  const after = h.rebuild();
  if (repairAfterCompact) {
    expect(h.displays()).toHaveLength(1);
    expect(after).toContain("[skill] alpha");
    expect(after.indexOf("[skill] alpha")).toBeGreaterThan(after.indexOf(task));
    expect(after.indexOf("[skill] alpha")).toBeGreaterThan(after.indexOf("Fixture response"));
  } else {
    expect(h.displays()).toHaveLength(0);
    expect(after).not.toContain("[skill] alpha");
  }
  const persisted = h.users()[0] as any;
  expect(decode(textOf(persisted.message))?.skills).toHaveLength(2);
  await h.session.reload();
  expect(h.displays()).toHaveLength(1);
  expect(h.rebuild()).toContain("[skill] beta");
  expect(h.errors).toEqual([]);
});

test("compaction removes old cards and a surviving orphan display entry is not rendered", async () => {
  const h = await harness(); await h.session.prompt(task, { source: "interactive" });
  const display = h.displays()[0];
  h.setCompactFrom(display.id);
  await h.session.compact();
  expect(h.users()).toHaveLength(0);
  expect(h.displays()).toHaveLength(1);
  expect(h.rebuild()).not.toContain("[skill] alpha");
  await h.session.reload();
  expect(h.displays()).toHaveLength(1);
  expect(h.rebuild()).not.toContain("[skill] beta");
  expect(h.errors).toEqual([]);
});
