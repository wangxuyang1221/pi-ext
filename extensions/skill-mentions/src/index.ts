import { CustomEditor, getAgentDir, SkillInvocationMessageComponent, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
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
  // Pi 0.86 awaits each user start/end pair before consuming the next user.
  let pending: { task: string; snapshot?: SkillSnapshot; reads: Map<string, Promise<string>> } | undefined;
  let context: ExtensionContext | undefined;
  let stopped = false;
  let indexedLeaf: string | null | undefined;
  let visibleSnapshots = new Map<string, SkillSnapshot>();
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

  function visibleSnapshot(requestId: string): SkillSnapshot | undefined {
    if (pending?.snapshot?.requestId === requestId) return pending.snapshot;
    if (!context || context.mode !== "tui") return;
    const leaf = context.sessionManager.getLeafId();
    if (leaf !== indexedLeaf) {
      visibleSnapshots = new Map();
      for (const entry of context.sessionManager.buildContextEntries()) {
        if (entry.type !== "message" || entry.message.role !== "user") continue;
        const snapshot = decodeSnapshot(userText(entry.message));
        if (snapshot) visibleSnapshots.set(snapshot.requestId, snapshot);
      }
      indexedLeaf = leaf;
    }
    return visibleSnapshots.get(requestId);
  }

  pi.on("session_start", (_event, ctx) => {
    clearPending();
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
    clearPending(); visibleSnapshots.clear(); context = undefined; indexedLeaf = undefined;
  });
  const clearPending = () => {
    if (pending) { pending.reads.clear(); pending.snapshot = undefined; }
    pending = undefined;
    pi.registerMarkdownTransformer(ordinaryMarkdown);
  };
  const readFor = (request: NonNullable<typeof pending>) => (path: string) => {
    if (pending !== request || stopped) return Promise.reject(new Error("Skill request is no longer active"));
    let read = request.reads.get(path);
    if (!read) { read = readFile(path, "utf8"); request.reads.set(path, read); }
    return read;
  };
  pi.on("agent_end", clearPending);
  pi.on("message_start", async (event, ctx) => {
    if (ctx.mode !== "tui" || event.message.role !== "user") return;
    clearPending();
    context = ctx;
    const request: NonNullable<typeof pending> = { task: userText(event.message), reads: new Map() };
    const initialTask = request.task;
    pending = request;
    const snapshot = await loadSnapshot(request.task, pi.getCommands(), readFor(request));
    if (pending !== request || stopped) { request.reads.clear(); return; }
    request.snapshot = snapshot;
    // The component captures this request, whose finalized task can differ after message_end.
    pi.registerMarkdownTransformer((markdown, options) => {
      if (options.messageType !== "user") return markdown;
      const current = request.snapshot ?? decodeSnapshot(request.task);
      return current ? visualize(current) : request.task === initialTask ? markdown : request.task;
    });
    if (snapshot) pi.appendEntry(displayType, snapshot);
  });
  pi.on("message_end", async (event, ctx) => {
    if (ctx.mode !== "tui" || event.message.role !== "user") return;
    const request = pending;
    pi.registerMarkdownTransformer(ordinaryMarkdown);
    if (!request) return;
    try {
      const task = userText(event.message), original = request.snapshot;
      if (task !== request.task) {
        const revised = await loadSnapshot(task, pi.getCommands(), readFor(request));
        if (pending !== request || stopped) return;
        request.task = task;
        request.snapshot = revised && { ...revised, requestId: original?.requestId ?? revised.requestId };
        for (const tui of editors.keys()) { tui.invalidate(); tui.requestRender(); }
      }
      const snapshot = request.snapshot;
      if (!snapshot) return;
      // Existing cards resolve the authoritative user snapshot by requestId at render time.
      // A reference introduced only at message_end has no earlier card to reuse.
      if (!original) pi.appendEntry(displayType, snapshot);
      const images = typeof event.message.content === "string" ? [] : event.message.content.filter(block => block.type === "image");
      return { message: { ...event.message, content: [{ type: "text" as const, text: encodeSnapshot(snapshot) }, ...images] } };
    } catch (error) {
      request.task = userText(event.message);
      request.snapshot = undefined;
      for (const tui of editors.keys()) { tui.invalidate(); tui.requestRender(); }
      throw error;
    } finally {
      request.reads.clear();
      if (pending === request) pending = undefined;
    }
  });
  pi.registerMarkdownTransformer(ordinaryMarkdown);
  pi.registerEntryRenderer(displayType, (entry, options) => {
    if (stopped || !isSkillSnapshot(entry.data) || (context && !visibleSnapshot(entry.data.requestId))) return undefined;
    const requestId = entry.data.requestId;
    let renderedSnapshot: SkillSnapshot | undefined;
    let group: Container | undefined;
    // /reload constructs transcript components before session_start binds context.
    // Return a component now, but decide visibility only when the host renders it.
    return {
      render(width) {
        const snapshot = visibleSnapshot(requestId);
        if (!snapshot) return [];
        if (!group || snapshot !== renderedSnapshot) {
          renderedSnapshot = snapshot;
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
