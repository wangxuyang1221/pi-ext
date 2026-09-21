import { CustomEditor, getAgentDir, SkillInvocationMessageComponent, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import type { UserMessage } from "@earendil-works/pi-ai";
import { Container, type TUI } from "@earendil-works/pi-tui";
import { captureLabelDraft, createLabelEditor, releaseLabelEditor } from "./label-editor.js";
import { clearDraftHandoff, saveDraftHandoff, takeDraftHandoff } from "./draft-handoff.js";
import { labelReferences, paintLabels, type IconMode } from "./labels.js";
import { loadIconPreference, saveIconPreference } from "./label-preference.js";
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

/** Register inline skill completion, snapshots, and history rendering. */
export default function skillMentions(pi: ExtensionAPI, configuration: { preferencePath?: string } = {}): void {
  let pending = new WeakMap<object, SkillSnapshot>();
  const pendingIds = new Set<string>();
  let context: ExtensionContext | undefined;
  let stopped = false;
  let indexedLeaf: string | null | undefined;
  let visibleIds = new Set<string>();
  let icon: IconMode = "cube";
  const preferencePath = configuration.preferencePath ?? join(getAgentDir(), "skill-mentions.json");
  const editors = new Map<TUI, CustomEditor>();
  const visualize = (snapshot: SkillSnapshot) => paintLabels(snapshot.task,
    labelReferences(snapshot.task, new Set(snapshot.skills.map(skill => skill.name))), icon);
  const ordinaryMarkdown = (markdown: string, options: { messageType: string }) => {
    if (options.messageType !== "user") return markdown;
    const snapshot = decodeSnapshot(markdown);
    return snapshot ? visualize(snapshot) : markdown;
  };
  pi.registerCommand("skill-label-icon", {
    description: "Choose and save the skill label icon: cube or command",
    handler: async (args, ctx) => {
      const value = args.trim();
      if (value !== "cube" && value !== "command") {
        ctx.ui.notify("Usage: /skill-label-icon cube|command", "error"); return;
      }
      try { saveIconPreference(preferencePath, value); }
      catch (error) { ctx.ui.notify(`Could not save the skill label icon: ${error instanceof Error ? error.message : String(error)}`, "error"); return; }
      icon = value;
      for (const tui of editors.keys()) { tui.invalidate(); tui.requestRender(true); }
      ctx.ui.notify(`Skill label icon saved: ${value}`, "info");
    },
  });

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
    stopped = false;
    context = ctx;
    indexedLeaf = undefined;
    if (ctx.mode === "tui") {
      try { icon = loadIconPreference(preferencePath); }
      catch (error) { ctx.ui.notify(`Could not load the skill label icon; using cube: ${error instanceof Error ? error.message : String(error)}`, "error"); icon = "cube"; }
      ctx.ui.addAutocompleteProvider(current => skillAutocomplete(current, () => pi.getCommands()));
    }
  });
  pi.on("resources_discover", (event, ctx) => {
    installHistoryEditor(ctx, event.reason === "reload", (base, tui) => {
      if (typeof (base as CustomEditor).getCursor !== "function" || typeof (base as CustomEditor).getLines !== "function") return base;
      const previous = editors.get(tui);
      const handoff = previous ? captureLabelDraft(previous) : event.reason === "reload" ? takeDraftHandoff(tui) : undefined;
      if (previous) releaseLabelEditor(previous);
      if (event.reason !== "reload") clearDraftHandoff(tui);
      const editor = createLabelEditor(base as CustomEditor, {
        tui, handoff, icon: () => icon,
        names: () => new Set(pi.getCommands().filter(command => command.source === "skill" && command.name.startsWith("skill:")).map(command => command.name.slice(6))),
      });
      editors.set(tui, editor);
      return editor;
    });
  });
  pi.on("session_shutdown", (event, ctx) => {
    stopped = true;
    for (const [tui, editor] of editors) {
      if (event.reason === "reload") {
        const draft = captureLabelDraft(editor);
        if (draft && draft.raw !== draft.expanded) {
          saveDraftHandoff(tui, draft);
          // The host copies getText() through its default editor while replacing factories.
          // Transfer expanded text through that public boundary even if this extension is removed.
          ctx.ui.setEditorText(draft.expanded);
        } else clearDraftHandoff(tui);
      } else clearDraftHandoff(tui);
      releaseLabelEditor(editor);
    }
    editors.clear();
    pending = new WeakMap(); pendingIds.clear(); visibleIds.clear(); context = undefined; indexedLeaf = undefined;
  });
  pi.on("message_start", async (event, ctx) => {
    if (ctx.mode !== "tui" || event.message.role !== "user" || pending.has(event.message)) return;
    context = ctx;
    const snapshot = await loadSnapshot(userText(event.message), pi.getCommands());
    if (!snapshot) return;
    pending.set(event.message, snapshot);
    pendingIds.add(snapshot.requestId);
    // Each user component captures its request's transformer function at construction.
    pi.registerMarkdownTransformer((markdown, options) => options.messageType === "user"
      ? visualize(decodeSnapshot(markdown) ?? snapshot) : markdown);
    pi.appendEntry(displayType, snapshot);
  });
  pi.on("message_end", (event, ctx) => {
    if (ctx.mode !== "tui" || event.message.role !== "user") return;
    const snapshot = pending.get(event.message);
    pi.registerMarkdownTransformer(ordinaryMarkdown);
    if (!snapshot) return;
    pending.delete(event.message);
    pendingIds.delete(snapshot.requestId);
    const images = typeof event.message.content === "string" ? [] : event.message.content.filter(block => block.type === "image");
    return { message: { ...event.message, content: [{ type: "text" as const, text: encodeSnapshot(snapshot) }, ...images] } };
  });
  pi.registerMarkdownTransformer(ordinaryMarkdown);
  pi.registerEntryRenderer(displayType, (entry, options) => {
    if (stopped || !isSkillSnapshot(entry.data) || (context && !visible(entry.data.requestId))) return undefined;
    const snapshot = entry.data;
    let group: Container | undefined;
    // /reload constructs transcript components before session_start binds context.
    // Return a component now, but decide visibility only when the host renders it.
    return {
      render(width) {
        if (!visible(snapshot.requestId)) return [];
        if (!group) {
          group = new Container();
          for (const skill of snapshot.skills) {
            const card = new SkillInvocationMessageComponent({ name: skill.name, location: skill.location, content: skill.body, userMessage: "" });
            card.setExpanded(options.expanded);
            group.addChild(card);
          }
        }
        return group.render(width);
      },
      invalidate() { group?.invalidate(); },
    };
  });
}
