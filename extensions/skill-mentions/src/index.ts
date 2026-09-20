import { SkillInvocationMessageComponent, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { UserMessage } from "@earendil-works/pi-ai";
import { Container } from "@earendil-works/pi-tui";
import { skillAutocomplete } from "./autocomplete.js";
import { loadSnapshot } from "./loading.js";
import { installHistoryEditor } from "./history-editor.js";
import { decodeSnapshot, encodeSnapshot, isSkillSnapshot, type SkillSnapshot } from "./protocol.js";

export const displayType = "pi-ext/skill-mentions/display-v1";

/** Join user text blocks using the same separator as Pi's user display. */
export function userText(message: UserMessage): string {
  return typeof message.content === "string" ? message.content
    : message.content.filter(block => block.type === "text").map(block => block.text).join("\n");
}

/** Register the development entry point for inline skill mentions. */
export default function skillMentions(pi: ExtensionAPI): void {
  let pending = new WeakMap<object, SkillSnapshot>();
  const pendingIds = new Set<string>();
  let context: ExtensionContext | undefined;
  let indexedLeaf: string | null | undefined;
  let visibleIds = new Set<string>();

  function visible(requestId: string): boolean {
    if (pendingIds.has(requestId)) return true;
    if (!context || context.mode !== "tui") return false;
    const leaf = context.sessionManager.getLeafId();
    if (leaf !== indexedLeaf) {
      visibleIds = new Set();
      for (const entry of context.sessionManager.buildContextEntries()) {
        if (entry.type !== "message" || entry.message.role !== "user") continue;
        const snapshot = decodeSnapshot(userText(entry.message));
        if (snapshot) visibleIds.add(snapshot.requestId);
      }
      indexedLeaf = leaf;
    }
    return visibleIds.has(requestId);
  }

  pi.on("session_start", (_event, ctx) => {
    context = ctx;
    indexedLeaf = undefined;
    if (ctx.mode === "tui") ctx.ui.addAutocompleteProvider(current => skillAutocomplete(current, () => pi.getCommands()));
  });
  pi.on("resources_discover", (_event, ctx) => { installHistoryEditor(ctx); });
  pi.on("session_shutdown", () => {
    pending = new WeakMap(); pendingIds.clear(); visibleIds.clear(); context = undefined; indexedLeaf = undefined;
  });
  pi.on("message_start", async (event, ctx) => {
    if (ctx.mode !== "tui" || event.message.role !== "user" || pending.has(event.message)) return;
    context = ctx;
    const snapshot = await loadSnapshot(userText(event.message), pi.getCommands());
    if (!snapshot) return;
    pending.set(event.message, snapshot);
    pendingIds.add(snapshot.requestId);
    pi.appendEntry(displayType, snapshot);
  });
  pi.on("message_end", (event, ctx) => {
    if (ctx.mode !== "tui" || event.message.role !== "user") return;
    const snapshot = pending.get(event.message);
    if (!snapshot) return;
    pending.delete(event.message);
    pendingIds.delete(snapshot.requestId);
    const images = typeof event.message.content === "string" ? [] : event.message.content.filter(block => block.type === "image");
    return { message: { ...event.message, content: [{ type: "text" as const, text: encodeSnapshot(snapshot) }, ...images] } };
  });
  pi.registerMarkdownTransformer((markdown, options) => options.messageType === "user" ? decodeSnapshot(markdown)?.task ?? markdown : markdown);
  pi.registerEntryRenderer(displayType, (entry, options) => {
    if (!isSkillSnapshot(entry.data) || !visible(entry.data.requestId)) return undefined;
    const group = new Container();
    for (const skill of entry.data.skills) {
      const card = new SkillInvocationMessageComponent({ name: skill.name, location: skill.location, content: skill.body, userMessage: "" });
      card.setExpanded(options.expanded);
      group.addChild(card);
    }
    return group;
  });
}
