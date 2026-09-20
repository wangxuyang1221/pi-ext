import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryCredentialStore, InMemoryModelsStore, fauxAssistantMessage, fauxProvider, type Message, type UserMessage } from "@earendil-works/pi-ai";
import { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, createSyntheticSourceInfo, CustomEditor, getMarkdownTheme, InteractiveMode, ModelRuntime, SessionManager, SettingsManager,
  type AgentSession, type AgentSessionRuntime, type CustomEntry, type SessionMessageEntry, type ExtensionAPI, type ExtensionContext, type ExtensionFactory, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { CombinedAutocompleteProvider, Container, stripTerminalSequences, type EditorComponent, type TUI } from "@earendil-works/pi-tui";
import { CodexEditor } from "../../codex-ui/src/components.js";
import skillMentions, { displayType } from "../src/index.js";

const resources: { cwd: string; runtime?: AgentSessionRuntime; editors: EditorComponent[] }[] = [];
export async function cleanup() {
  for (const resource of resources.splice(0)) {
    if (resource.runtime) { await resource.runtime.session.abort(); await resource.runtime.dispose(); }
    for (const editor of resource.editors) editor.setText("");
    rmSync(resource.cwd, { recursive: true, force: true });
  }
}
export const textOf = (message: { content: unknown }): string => typeof message.content === "string" ? message.content :
  (message.content as { type: string; text?: string }[]).filter(block => block.type === "text").map(block => block.text).join("\n");
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

export async function lifecycleFixture(options: { codex?: "before" | "after"; extraBefore?: ExtensionFactory; extra?: ExtensionFactory } = {}) {
  const cwd = mkdtempSync(join(process.cwd(), "extensions/skill-mentions/__tests__/.lifecycle-"));
  const resource: typeof resources[number] = { cwd, editors: [] }; resources.push(resource);
  const skills = ["alpha", "beta"].map(name => {
    const baseDir = join(cwd, name); mkdirSync(baseDir);
    const filePath = join(baseDir, "SKILL.md");
    writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name}\n---\n${name.toUpperCase()}_BODY\n`);
    return { name, description: name, filePath, baseDir, sourceInfo: createSyntheticSourceInfo(filePath, { source: "sdk" }), disableModelInvocation: false };
  });
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false }, showCacheMissNotices: false, steeringMode: "all", followUpMode: "all" });
  const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsStore: new InMemoryModelsStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const faux = fauxProvider(); models.registerNativeProvider(faux.provider);
  const calls: Message[][] = [], errors: string[] = [], sequence: string[] = [];
  const respond = (context: { messages: Message[] }) => { calls.push(structuredClone(context.messages)); return fauxAssistantMessage("Fixture response"); };
  faux.setResponses(Array.from({ length: 30 }, () => respond));
  let pi!: ExtensionAPI, compactFrom = "";
  const codex: ExtensionFactory = api => { api.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setEditorComponent((tui, theme, keys) => new CodexEditor(tui, theme, keys, () => ctx.ui.theme));
  }); };
  const runtime = await createAgentSessionRuntime(async ({ sessionManager, sessionStartEvent }) => {
    const services = await createAgentSessionServices({ cwd, agentDir: join(cwd, "agent"), settingsManager, modelRuntime: models,
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
        skillsOverride: () => ({ skills, diagnostics: [] }),
        extensionFactories: [...(options.extraBefore ? [options.extraBefore] : []), ...(options.codex === "before" ? [codex] : []), skillMentions, ...(options.codex === "after" ? [codex] : []), api => {
          pi = api;
          api.on("session_before_compact", () => ({ compaction: { summary: "Fixture summary", firstKeptEntryId: compactFrom, tokensBefore: 10 } }));
        }, ...(options.extra ? [options.extra] : [])],
      },
    });
    return { ...await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: faux.getModel(), noTools: "all" }), services, diagnostics: services.diagnostics };
  }, { cwd, agentDir: join(cwd, "agent"), sessionManager: SessionManager.create(cwd, join(cwd, "sessions")) });
  resource.runtime = runtime;

  // Real editor/transcript methods with inert terminal plumbing. PTY belongs to slice 3.
  const mode: any = Object.create(InteractiveMode.prototype);
  const tui = { terminal: { rows: 40, columns: 100 }, requestRender() {}, setFocus() {} } as unknown as TUI;
  const keys = { matches: () => false } as unknown as KeybindingsManager;
  const identity = (text: string) => text;
  const defaultEditor = new CustomEditor(tui, { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } }, keys, { embedWorkingStatus: true });
  resource.editors.push(defaultEditor);
  Object.defineProperties(mode, Object.getOwnPropertyDescriptors({
    get session() { return runtime.session; }, get sessionManager() { return runtime.session.sessionManager; }, settingsManager,
    chatContainer: new Container(), pendingTools: new Map(), toolOutputExpanded: false, hideThinkingBlock: false,
    outputPad: 1, ui: tui, keybindings: keys, editor: defaultEditor, defaultEditor,
    editorContainer: new Container(), statusContainer: new Container(), disposeActiveSelector() {},
    footer: { invalidate() {} }, updateEditorBorderColor() {},
    getMarkdownThemeWithSettings: () => getMarkdownTheme(),
    getMarkdownTransformers: () => runtime.session.extensionRunner!.getMarkdownTransformers(),
  }));
  const wrappers: ((provider: any) => any)[] = [];
  const ui = {
    theme: { fg: (_key: string, text: string) => text, getBgAnsi: () => "" },
    getEditorComponent: () => mode.editorComponentFactory,
    setEditorComponent: (factory: any) => { mode.setCustomEditorComponent(factory); resource.editors.push(mode.editor); },
    addAutocompleteProvider: (wrapper: (provider: any) => any) => { wrappers.push(wrapper); mode.autocompleteProvider = wrappers.reduce((p, wrap) => wrap(p), new CombinedAutocompleteProvider([{ name: "help" }], cwd)); mode.editor.setAutocompleteProvider(mode.autocompleteProvider); },
  } as unknown as ExtensionContext["ui"];
  const resetUI = () => { wrappers.length = 0; mode.setCustomEditorComponent(undefined); };
  let unsubscribe: (() => void) | undefined;
  async function bind(session: AgentSession) {
    unsubscribe?.(); resetUI();
    await session.bindExtensions({ mode: "tui", uiContext: ui, onError: error => errors.push(error.error) });
    unsubscribe = session.subscribe(event => {
      if (event.type === "message_start" && event.message.role === "user") { sequence.push("user"); mode.addMessageToChat(event.message); }
      if (event.type === "entry_appended" && event.entry.type === "custom") { sequence.push("display"); mode.addCustomEntryToChat(event.entry); }
    });
  }
  runtime.setRebindSession(bind);
  runtime.setBeforeSessionInvalidate(resetUI);
  await bind(runtime.session);
  const plain = () => mode.chatContainer.render(100).map(stripTerminalSequences).join("\n");
  return { cwd, runtime, skills, faux, calls, errors, respond, sequence, mode, wrappers,
    get pi() { return pi; }, get session() { return runtime.session; }, get sm() { return runtime.session.sessionManager; },
    plain, rebuild() { mode.rebuildChatFromMessages(); return plain(); },
    async reload() { await runtime.session.reload({ beforeSessionStart: async () => resetUI() }); },
    displays() { return runtime.session.sessionManager.getEntries().filter((entry): entry is CustomEntry => entry.type === "custom" && entry.customType === displayType); },
    users() { return runtime.session.sessionManager.getEntries().filter((entry): entry is SessionMessageEntry & { message: UserMessage } => entry.type === "message" && entry.message.role === "user"); },
    setCompactFrom(id: string) { compactFrom = id; },
  };
}
