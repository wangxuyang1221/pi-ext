import { afterEach, beforeAll, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryCredentialStore, InMemoryModelsStore, fauxAssistantMessage, fauxProvider, type Message } from "@earendil-works/pi-ai";
import { createAgentSession, createSyntheticSourceInfo, DefaultResourceLoader, getMarkdownTheme, initTheme, InteractiveMode, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, stripTerminalSequences } from "@earendil-works/pi-tui";
import skillMentions, { displayType } from "../src/index.js";
import { decodeSnapshot } from "../src/protocol.js";
import { RED_PIXEL_PNG } from "./png-fixture.js";

const resources: { cwd: string; session?: AgentSession }[] = [];
beforeAll(() => initTheme("dark", false));
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    if (resource.session) { await resource.session.abort(); resource.session.dispose(); }
    rmSync(resource.cwd, { recursive: true, force: true });
  }
});
const textOf = (message: { content: unknown }) => typeof message.content === "string" ? message.content : (message.content as { type: string; text?: string }[]).filter(block => block.type === "text").map(block => block.text).join("\n");

async function harness(mode: "tui" | "rpc" | "print" | "json" = "tui", filesystem = false) {
  const cwd = mkdtempSync(join(process.cwd(), "extensions/skill-mentions/__tests__/.flow-"));
  const resource: { cwd: string; session?: AgentSession } = { cwd }; resources.push(resource);
  const skills = ["alpha", "beta"].map(name => {
    const baseDir = join(cwd, name); mkdirSync(baseDir);
    const filePath = join(baseDir, "SKILL.md");
    writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name}\n---\n${name.toUpperCase()}_BODY\n $beta \n`);
    return { name, description: name, filePath, baseDir, sourceInfo: createSyntheticSourceInfo(filePath, { source: "sdk" }), disableModelInvocation: name === "alpha" };
  });
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, showCacheMissNotices: false });
  const sessionManager = SessionManager.inMemory(cwd);
  const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const faux = fauxProvider(); models.registerNativeProvider(faux.provider);
  const calls: Message[][] = [], errors: string[] = [], sequence: string[] = [];
  let pi!: ExtensionAPI;
  faux.setResponses(Array.from({ length: 8 }, () => context => { calls.push(structuredClone(context.messages)); return fauxAssistantMessage("Fixture response $alpha"); }));
  const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager,
    noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    skillsOverride: () => ({ skills, diagnostics: [] }),
    additionalExtensionPaths: filesystem ? [join(process.cwd(), "extensions/skill-mentions/src/index.ts")] : [],
    extensionFactories: [...(filesystem ? [] : [skillMentions]), api => { pi = api; }],
  });
  await loader.reload(); expect(loader.getExtensions().errors).toEqual([]);
  const { session } = await createAgentSession({ cwd, agentDir: join(cwd, "agent"), settingsManager, sessionManager, resourceLoader: loader, modelRuntime: models, model: faux.getModel(), noTools: "all" });
  resource.session = session;
  await session.bindExtensions({ mode, onError: error => { errors.push(error.error); } });

  // Exercise the real transcript methods with an inert terminal, not a PTY.
  const ui: any = Object.create(InteractiveMode.prototype);
  Object.defineProperties(ui, Object.getOwnPropertyDescriptors({ session, sessionManager, settingsManager,
    chatContainer: new Container(), pendingTools: new Map(), toolOutputExpanded: false, hideThinkingBlock: false,
    outputPad: 1, ui: { requestRender() {} }, editor: { addToHistory() {} },
    getMarkdownThemeWithSettings: () => getMarkdownTheme(),
    getMarkdownTransformers: () => session.extensionRunner!.getMarkdownTransformers(),
  }));
  session.subscribe(event => {
    if (event.type === "message_start" && event.message.role === "user") { sequence.push("user"); ui.addMessageToChat(event.message); }
    if (event.type === "entry_appended" && event.entry.type === "custom") { sequence.push("display"); ui.addCustomEntryToChat(event.entry); }
  });
  const plain = () => ui.chatContainer.render(90).map(stripTerminalSequences).join("\n");
  return { cwd, skills, session, sessionManager, calls, errors, sequence, pi, plain, ui };
}

it.each(["prompt", "plugin-string", "plugin-blocks"])("activates punctuated references through %s with original task and ordered snapshots", async source => {
  const h = await harness("tui", true);
  const task = "用 $beta，继续 $alpha. $beta) $alpha.md $alpha.中文 $alpha-other! $unknown;";
  const image = { type: "image" as const, data: RED_PIXEL_PNG, mimeType: "image/png" };
  if (source === "prompt") await h.session.prompt(task, { images: [image] });
  else {
    h.pi.sendUserMessage(source === "plugin-string" ? task : [{ type: "text", text: task }, image]);
    await new Promise<void>(resolve => {
      const unsubscribe = h.session.subscribe(event => {
        if (event.type === "agent_end") { unsubscribe(); resolve(); }
      });
    });
  }
  const users = h.calls[0].filter(message => message.role === "user");
  expect(users).toHaveLength(1);
  const snapshot = decodeSnapshot(textOf(users[0]));
  expect(snapshot?.task).toBe(task);
  expect(snapshot?.skills.map(skill => skill.name)).toEqual(["beta", "alpha"]);
  if (source !== "plugin-string") expect(users[0].content).toContainEqual(image);
  expect(h.sequence).toEqual(["display", "user"]);
  expect(h.errors).toEqual([]);
});

it("silently falls back on punctuated unknown and unreadable names through the real loader", async () => {
  const h = await harness("tui", true); rmSync(h.skills[1].filePath);
  for (const task of ["$beta, $unknown! $beta。 $alpha;", "$beta, $unknown! $beta。"]) {
    await h.session.sendUserMessage(task);
    const user = h.calls.at(-1)!.filter(message => message.role === "user").at(-1)!;
    const snapshot = decodeSnapshot(textOf(user));
    if (task.includes("$alpha")) {
      expect(snapshot?.task).toBe(task);
      expect(snapshot?.skills.map(skill => skill.name)).toEqual(["alpha"]);
    } else {
      expect(snapshot).toBeUndefined();
      expect(textOf(user)).toBe(task);
    }
    expect(h.errors).toEqual([]);
  }
  expect(h.sequence).toEqual(["display", "user", "user"]);
});

it("loads the development entry through the installed Pi filesystem loader", async () => {
  const h = await harness("tui", true); await h.session.prompt("$alpha");
  expect(decodeSnapshot(textOf(h.calls[0].find(message => message.role === "user")!))?.skills.map(skill => skill.name)).toEqual(["alpha"]);
  expect(h.errors).toEqual([]);
});

it("preserves a pasted snapshot instead of rereading or recursively activating its task and body", async () => {
  const h = await harness(); await h.session.prompt("$alpha");
  const text = textOf(h.calls[0].find(message => message.role === "user")!);
  for (const skill of h.skills) rmSync(skill.filePath);
  await h.session.sendUserMessage(text);
  const users = h.calls[1].filter(message => message.role === "user");
  expect(users.map(textOf)).toEqual([text, text]);
  expect(h.sequence).toEqual(["display", "user", "user"]); expect(h.errors).toEqual([]);
});

it.each(["rpc", "print", "json"] as const)("leaves %s users untouched", async mode => {
  const h = await harness(mode); await h.session.prompt("$alpha $beta，继续 $alpha.");
  expect(h.calls[0].filter(message => message.role === "user").map(textOf)).toEqual(["$alpha $beta，继续 $alpha."]);
  expect(h.sequence).toEqual(["user"]); expect(h.errors).toEqual([]);
});

it("accepts ordinary plugin user messages but never assistant or custom messages", async () => {
  const h = await harness();
  await h.session.sendUserMessage("$alpha");
  expect(decodeSnapshot(textOf(h.calls[0].find(message => message.role === "user")!))?.skills.map(skill => skill.name)).toEqual(["alpha"]);
  h.pi.sendMessage({ customType: "fixture", content: "$beta", display: true });
  await h.session.prompt("Continue");
  const displays = h.sessionManager.getEntries().filter(entry => entry.type === "custom" && entry.customType === displayType);
  expect(displays).toHaveLength(1);
  expect(h.errors).toEqual([]);
});

it("silently keeps missing and unknown references while displaying only readable skills", async () => {
  const h = await harness(); rmSync(h.skills[1].filePath);
  const task = "$beta $unknown $alpha"; await h.session.prompt(task);
  const snapshot = decodeSnapshot(textOf(h.calls[0].find(message => message.role === "user")!));
  expect(snapshot?.task).toBe(task); expect(snapshot?.skills.map(skill => skill.name)).toEqual(["alpha"]);
  expect(h.plain()).not.toContain("[skill] beta"); expect(h.plain()).toContain("$beta $unknown  \u{f01a7}alpha ");
  expect(h.errors).toEqual([]);
  await h.session.prompt("$beta $unknown");
  expect(h.calls[1].filter(message => message.role === "user").map(textOf).at(-1)).toBe("$beta $unknown");
  expect(h.sequence).toEqual(["display", "user", "user"]); expect(h.errors).toEqual([]);
});

it("keeps native slash expansion and its history display without recursive dollar activation", async () => {
  const h = await harness(); await h.session.prompt("/skill:alpha use $beta");
  const text = textOf(h.calls[0].find(message => message.role === "user")!);
  expect(text).toContain('<skill name="alpha"'); expect(text).toContain("ALPHA_BODY");
  expect(text).not.toContain("BETA_BODY"); expect(decodeSnapshot(text)).toBeUndefined();
  expect(h.sequence).toEqual(["user"]); expect(h.plain()).toContain("[skill] alpha");
  h.ui.rebuildChatFromMessages(); expect(h.plain()).toContain("[skill] alpha");
  expect(h.errors).toEqual([]);
});

it("uses native expanded cards and only transforms strictly recognized user envelopes", async () => {
  const h = await harness(); await h.session.prompt("$alpha");
  const text = textOf(h.calls[0].find(message => message.role === "user")!);
  const transformers = h.session.extensionRunner!.getMarkdownTransformers();
  for (const messageType of ["user", "assistant", "assistant-thinking"] as const) {
    const actual = transformers.reduce((value, transform) => transform(value, { messageType, isStreaming: false, availableWidth: 90 }), text);
    expect(stripTerminalSequences(actual)).toBe(messageType === "user" ? " \u{f01a7}alpha" : text);
  }
  const renderer = h.session.extensionRunner!.getEntryRenderer(displayType)!;
  const entry = h.sessionManager.getEntries().find(entry => entry.type === "custom" && entry.customType === displayType)!;
  const component = renderer(entry as any, { expanded: true }, {} as any)!;
  const expanded = component.render(90).map(stripTerminalSequences).join("\n");
  expect(expanded).toContain("ALPHA_BODY"); expect(expanded).toContain("References are relative to");
  expect(decodeSnapshot(text)?.skills[0].baseDir).toBe(h.skills[0].baseDir);
  component.invalidate(); expect(component.render(90)).not.toHaveLength(0);
});

it("sends multiple snapshots and images in one user and displays native cards before the task", async () => {
  const h = await harness();
  const task = "用 $beta $alpha $beta $unknown 调查";
  const image = { type: "image" as const, data: RED_PIXEL_PNG, mimeType: "image/png" };
  await h.session.prompt(task, { images: [image] });
  expect(h.calls).toHaveLength(1);
  const users = h.calls[0].filter(message => message.role === "user"); expect(users).toHaveLength(1);
  const snapshot = decodeSnapshot(textOf(users[0]));
  expect(snapshot?.task).toBe(task);
  expect(snapshot?.skills.map(skill => skill.name)).toEqual(["beta", "alpha"]);
  expect(snapshot?.skills[0].body).toContain("BETA_BODY");
  expect(snapshot?.skills[1].location).toBe(h.skills[0].filePath);
  expect(users[0].content).toContainEqual(image);
  expect(h.sequence).toEqual(["display", "user"]);
  const display = h.plain();
  expect(display).toContain("[skill] beta"); expect(display).toContain("[skill] alpha");
  expect(display.indexOf("[skill] alpha")).toBeLessThan(display.indexOf("用  \u{f01a7}beta  \u{f01a7}alpha  \u{f01a7}beta $unknown 调查"));
  expect(display).not.toContain("BETA_BODY"); expect(display).not.toContain("pi-ext/skill-mentions");
  const stored = h.sessionManager.getEntries().filter(entry => entry.type === "message" && entry.message.role === "user");
  expect(stored).toHaveLength(1);
  expect(stored[0].type === "message" && stored[0].message.role === "user" && decodeSnapshot(textOf(stored[0].message))).toEqual(snapshot);
  h.ui.rebuildChatFromMessages(); expect(h.plain()).not.toContain("pi-ext/skill-mentions");
  expect(h.errors).toEqual([]);
});
