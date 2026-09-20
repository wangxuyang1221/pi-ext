import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { CustomEditor, SkillInvocationMessageComponent, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, type EditorComponent } from "@earendil-works/pi-tui";
import { fauxProvider, fauxAssistantMessage, type UserMessage } from "@earendil-works/pi-ai";
import { skillAutocomplete } from "../../../extensions/skill-mentions/src/autocomplete.js";
import { loadSnapshot } from "../../../extensions/skill-mentions/src/loading.js";
import { decodeSnapshot, encodeSnapshot, isSkillSnapshot, type SkillSnapshot } from "../../../extensions/skill-mentions/src/protocol.js";
import { installHistoryEditor } from "../../../extensions/skill-mentions/src/history-editor.js";
import { normalizePunctuation, sample, styleEditorLines, styleMarkdown, type Variant } from "./ui.js";
import { chipEditor, chipMarkdown, type ChipVariant } from "./chips.js";

const displayType = "prototype/skill-mention-ui";
const decorated = Symbol.for("prototype/skill-mention-ui/editor");
const userText = (message: UserMessage) => typeof message.content === "string" ? message.content : message.content.filter(block => block.type === "text").map(block => block.text).join("\n");

export default function prototype(pi: ExtensionAPI): void {
  const root = process.env.MENTION_UI_ROOT!;
  if (!root) throw new Error("Use the isolated prototype launcher");
  const record = (kind: string, data: unknown) => appendFileSync(join(root, "events.jsonl"), JSON.stringify({ kind, data }) + "\n");
  const requested = process.env.MENTION_UI_VARIANT;
  const variant: Variant | ChipVariant = requested === "accent" || requested === "tint" || requested === "blue" ? requested : "gray";
  const faux = fauxProvider({ api: "skill-mention-ui-prototype" });
  faux.setResponses(Array.from({ length: 100 }, () => context => {
    record("request", context.messages);
    return fauxAssistantMessage("Fixture response");
  }));
  pi.registerProvider(faux.provider);
  const pending = new WeakMap<object, SkillSnapshot>();
  const liveDisplayNames = new Map<string, Set<string>>();
  let ctx: ExtensionContext | undefined;
  const names = () => new Set(pi.getCommands().filter(command => command.source === "skill").map(command => command.name.replace(/^skill:/, "")));
  pi.on("session_start", (_event, context) => {
    ctx = context;
    context.ui.addAutocompleteProvider(current => skillAutocomplete(current, () => pi.getCommands()));
  });
  pi.on("resources_discover", (event, context) => {
    installHistoryEditor(context, event.reason === "reload");
    const previous = context.ui.getEditorComponent();
    if (!previous || !Reflect.get(previous, decorated)) {
      const factory: NonNullable<typeof previous> = (tui, theme, keys) => {
        const base = previous?.(tui, theme, keys) ?? new CustomEditor(tui, theme, keys);
        if (variant === "gray" || variant === "blue") return chipEditor(base, names, variant);
        const methods = new Map<PropertyKey, unknown>();
        return new Proxy(base, {
          get(target, key) {
            if (key === "render") return (width: number) => styleEditorLines(target.render(width), target.getText(), names(), variant);
            const value = Reflect.get(target, key, target);
            if (typeof value !== "function") return value;
            if (!methods.has(key)) methods.set(key, value.bind(target));
            return methods.get(key);
          },
          set: (target, key, value) => Reflect.set(target, key, value, target),
        }) as EditorComponent;
      };
      Object.defineProperty(factory, decorated, { value: true });
      context.ui.setEditorComponent(factory);
    }
    if (event.reason === "startup") context.ui.setEditorText(sample);
    record("ready", { variant, tty: process.stdin.isTTY });
  });
  pi.on("message_start", async (event, context) => {
    if (context.mode !== "tui" || event.message.role !== "user") return;
    const task = userText(event.message);
    // Only the experiment changes recognition. Production parsing stays untouched.
    const snapshot = await loadSnapshot(normalizePunctuation(task), pi.getCommands());
    if (!snapshot) return;
    snapshot.task = task;
    liveDisplayNames.set(task, new Set(snapshot.skills.map(skill => skill.name)));
    pending.set(event.message, snapshot);
    pi.appendEntry(displayType, snapshot);
  });
  pi.on("message_end", event => {
    if (event.message.role !== "user") return;
    const snapshot = pending.get(event.message);
    if (!snapshot) return;
    pending.delete(event.message);
    const images = typeof event.message.content === "string" ? [] : event.message.content.filter(block => block.type === "image");
    return { message: { ...event.message, content: [{ type: "text" as const, text: encodeSnapshot(snapshot) }, ...images] } };
  });
  pi.registerEntryRenderer(displayType, (entry, options) => {
    if (!isSkillSnapshot(entry.data)) return undefined;
    const group = new Container();
    for (const skill of entry.data.skills) {
      const card = new SkillInvocationMessageComponent({ name: skill.name, location: skill.location, content: skill.body, userMessage: "" });
      card.setExpanded(options.expanded);
      group.addChild(card);
    }
    return group;
  });
  pi.registerMarkdownTransformer((text, options) => {
    if (options.messageType !== "user") return text;
    const snapshot = decodeSnapshot(text);
    const background = ctx?.ui.theme.getBgAnsi("userMessageBg") ?? "\x1b[48;2;67;67;67m";
    const display = (task: string, skills: Set<string>) => variant === "gray" || variant === "blue" ? chipMarkdown(task, skills, background, variant) : styleMarkdown(task, skills, variant, background);
    if (snapshot) return display(snapshot.task, new Set(snapshot.skills.map(skill => skill.name)));
    // Pi first constructs the user component from message_start's raw text.
    return display(text, liveDisplayNames.get(text) ?? new Set());
  });
  pi.registerShortcut("f6", { handler: async context => record("editor", context.ui.getEditorText()) });
  pi.registerCommand("prototype", { handler: async (value, context) => {
    if (value !== "accent" && value !== "tint" && value !== "chip" && value !== "gray" && value !== "blue") return;
    process.env.MENTION_UI_VARIANT = value === "chip" ? "gray" : value;
    await context.reload();
  } });
  pi.on("agent_settled", () => record("settled", true));
  pi.on("session_shutdown", () => { record("shutdown", true); ctx = undefined; });
}
