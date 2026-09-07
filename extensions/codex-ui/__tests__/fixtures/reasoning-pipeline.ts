import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent, initTheme, ToolExecutionComponent, type ExtensionAPI, type MarkdownTransformer, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, TuiMainScreen, type Component, type Terminal } from "@earendil-works/pi-tui";
import { join } from "node:path";
import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function reasoningMessage(text = "", timestamp = 1): AssistantMessage {
  return {
    role: "assistant", content: [{ type: "thinking", thinking: text }], timestamp,
    api: "openai-responses", provider: "fixture", model: "fixture", stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

export class CaptureTerminal {
  columns = 120;
  rows = 40;
  chunks: string[] = [];
  write(text: string) { this.chunks.push(text); }
  start() {}
  stop() {}
  async drainInput() {}
  hideCursor() {}
  showCursor() {}
  moveBy() {}
  clearLine() {}
  clearFromCursor() {}
  setTitle() {}
  take() { const data = this.chunks.join(""); this.chunks = []; return data; }
}

/** Exercise production registration with real host components and explicit frame boundaries. */
export async function reasoningPipeline(register: (pi: ExtensionAPI) => void, root: string, history = 0, expanded = true, outputPad: 0 | 1 = 1) {
  // Read unmodified host internals only in this fixture, beside the selected public runtime.
  const modulePath = createRequire(import.meta.url).resolve.paths("@earendil-works/pi-coding-agent")!
    .map(path => join(path, "@earendil-works/pi-coding-agent")).find(path => existsSync(join(path, "package.json")))!;
  const host = pathToFileURL(join(realpathSync(modulePath), "dist") + "/");
  const palette = await import(new URL("modes/interactive/theme/theme.js", host).href);
  const { KeybindingsManager } = await import(new URL("core/keybindings.js", host).href);
  initTheme("dark", false);
  palette.setThemeInstance(palette.loadThemeFromPath(join(root, "themes/codex-pi.json"), "truecolor"));
  const { theme, getEditorTheme } = palette;
  const terminal = new CaptureTerminal();
  const screen = new TuiMainScreen(terminal as unknown as Terminal, false, join(root, ".tmp"));
  let requests = 0;
  screen.requestRender = () => { requests++; };
  screen.start();
  const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
  const tools = new Map<string, ToolDefinition>();
  const transformers: MarkdownTransformer[] = [];
  const commands = new Map<string, any>();
  const widgetContainer = new Container();
  const widgets = new Map<string, Component & { dispose?(): void }>();
  const chat = new Container();
  const header = new Container();
  const editorContainer = new Container();
  const footer = new Container();
  let editor: any;
  let widgetInstalls = 0;
  const titles: string[] = [];
  const context = {
    mode: "tui", cwd: root, model: { id: "fixture" },
    sessionManager: { buildContextEntries: () => [] },
    getContextUsage: () => ({ tokens: 20, contextWindow: 128000, percent: 0.01 }),
    ui: {
      get theme() { return theme; },
      getTheme: () => theme, setTheme: () => ({ success: true }),
      setStatus() {}, notify() {}, setWorkingVisible() {}, setWorkingIndicator() {},
      setTitle: (value: string) => titles.push(value),
      setHeader: (factory: any) => header.addChild(factory(screen, theme)),
      setEditorComponent(factory: any) {
        editor = factory(screen, getEditorTheme(), new KeybindingsManager());
        editorContainer.addChild(editor);
      },
      setFooter: (factory: any) => footer.addChild(factory(screen, theme, {
        getGitBranch: () => "fixture", getExtensionStatuses: () => new Map(), onBranchChange: () => () => {},
      })),
      setWidget(key: string, factory: any) {
        widgets.get(key)?.dispose?.(); widgets.delete(key);
        if (factory) { widgets.set(key, factory(screen, theme)); widgetInstalls++; }
        widgetContainer.clear(); widgetContainer.addChild(new Spacer(1));
        for (const component of widgets.values()) widgetContainer.addChild(component);
        screen.requestRender();
      },
    },
  };
  register({
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    registerMarkdownTransformer: (transformer: MarkdownTransformer) => transformers.push(transformer),
    getThinkingLevel: () => "medium",
    on: (name: string, handler: (event: any, ctx: any) => unknown) => handlers.set(name, [...handlers.get(name) ?? [], handler]),
  } as unknown as ExtensionAPI);
  const emit = async (name: string, event: any = {}) => {
    for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, context);
  };
  await emit("session_start", { reason: "startup" });
  for (let index = 0; index < history; index++) {
    const row = new ToolExecutionComponent("bash", `history-${index}`, { command: "printf fixture" },
      { showImages: false }, tools.get("bash"), screen, root);
    row.setExpanded(expanded);
    row.updateResult({ content: [{ type: "text", text: "offscreen-reasoning-marker\n".repeat(1800) }], isError: false });
    row.setArgsComplete(); chat.addChild(row);
  }
  const assistant = new AssistantMessageComponent(undefined, false, undefined, "Thinking...", outputPad, transformers);
  chat.addChild(assistant);
  screen.addChild(header); screen.addChild(chat); screen.addChild(widgetContainer);
  screen.addChild(editorContainer); screen.addChild(footer);
  let current = reasoningMessage();
  return {
    screen, terminal, assistant, widgets, tools, context, emit, commands, titles, editor,
    stats: () => ({ requests, widgetInstalls }),
    async begin(text = "", timestamp = current.timestamp + 1) {
      current = reasoningMessage(text, timestamp);
      await emit("agent_start");
      await emit("message_start", { message: current });
      assistant.updateContent(current, true);
      return current;
    },
    async update(text: string, delta: string, type = "thinking_delta", contentIndex = 0) {
      current = { ...current, content: [{ type: "thinking", thinking: text }] };
      await emit("message_update", { message: current, assistantMessageEvent: { type, contentIndex, delta, partial: current } });
      assistant.updateContent(current, true);
      screen.requestRender();
    },
    async finish(stopReason: AssistantMessage["stopReason"] = "stop") {
      current = { ...current, stopReason };
      await emit("message_end", { message: current });
      assistant.updateContent(current, false);
      await emit("agent_end", { messages: [current] });
      await emit("agent_settled");
    },
    async dispose() {
      await emit("session_shutdown", { reason: "quit" });
      for (const component of widgets.values()) component.dispose?.();
      screen.stop();
    },
  };
}
