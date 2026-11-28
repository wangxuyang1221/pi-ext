import {
  sessionEntryToContextMessages,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { CodemodeStore, type CodemodeRow } from "./codemode-model.js";
import { CodemodePresentation } from "./codemode-presentation.js";
import { renderInspector, type InspectorState } from "./codemode-view.js";
import { record } from "./codemode-data.js";
import { hostKeybindingHints, type HostKeybindingHints } from "./keybinding-hints.js";
import { normalizeOutputPad, padOutputLines, resolveOutputPad } from "./layout.js";
import type { GroupLayout } from "./native-tools.js";

type RenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
interface RowView extends Component {
  row: CodemodeRow; generation: number; theme: Theme; expanded: boolean; cwd: string; outputPad: number; context: RenderContext; hints: HostKeybindingHints;
}
interface RowState { codemodeView?: RowView }

export interface CodemodeServices {
  layout: GroupLayout;
  nativeRenderers: ReadonlyMap<string, ToolRenderers>;
  getKeybindings?: () => Pick<KeybindingsManager, "getKeys"> | undefined;
  readContextMessages?: (event: unknown, ctx: ExtensionContext) => Iterable<unknown>;
}

/** Display-only integration. Never registers, wraps or executes a tool. */
export function registerCodemodeUi(pi: ExtensionAPI, services: CodemodeServices): void {
  // Older hosts keep their own renderer. Test/SDK hosts may omit renderer registration too.
  if (typeof pi.registerToolRenderer !== "function") return;
  const store = new CodemodeStore();
  const presentation = new CodemodePresentation(store, services.nativeRenderers, services.layout);
  const invalidators = new Map<string, () => void>();
  store.listeners.add(row => {
    if (row) { invalidators.get(row.id)?.(); if (row.evicted) invalidators.delete(row.id); }
    else for (const invalidate of invalidators.values()) invalidate();
  });
  const rebuild = (event: unknown, ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    presentation.clear();
    if (services.readContextMessages) {
      store.rebuild(services.readContextMessages(event, ctx));
    } else {
      function* messages() {
        for (const entry of ctx.sessionManager.buildContextEntries()) yield* sessionEntryToContextMessages(entry);
      }
      store.rebuild(messages());
    }
    invalidators.clear();
  };
  pi.on("session_start", rebuild);
  pi.on("session_tree", rebuild);
  pi.on("session_compact", rebuild);
  pi.on("session_shutdown", () => { store.clear(); presentation.clear(); invalidators.clear(); });
  pi.on("tool_execution_start", (value, ctx) => { if (ctx.mode === "tui") store.event(value); });
  pi.on("tool_execution_update", (value, ctx) => { if (ctx.mode === "tui") store.event(value); });
  pi.on("tool_execution_end", (value, ctx) => { if (ctx.mode === "tui") store.event(value); });
  pi.on("message_end", (event, ctx) => { if (ctx.mode === "tui") store.message(event.message); });

  const bind = (context: RenderContext, theme: Theme): RowView => {
    const state = context.state as RowState;
    let view = state.codemodeView;
    if (!view) {
      const row = store.ensure(context.toolCallId, record(context.args)?.code);
      let hintContext = context;
      let hintKeys = services.getKeybindings?.();
      view = { row, generation: store.generation, theme, expanded: context.expanded, cwd: context.cwd, outputPad: normalizeOutputPad(context.outputPad), context, hints: hostKeybindingHints(context as RenderContext & Partial<HostKeybindingHints>, hintKeys),
        invalidate() {}, render(width) {
          const keys = services.getKeybindings?.();
          if (hintContext !== this.context || hintKeys !== keys) {
            hintContext = this.context; hintKeys = keys;
            this.hints = hostKeybindingHints(hintContext as RenderContext & Partial<HostKeybindingHints>, hintKeys);
          }
          const current = store.get(row.id) ?? this.row;
          const pad = resolveOutputPad(width, this.outputPad);
          const expandKey = this.hints.keyText("app.tools.expand");
          const expandHint = expandKey ? this.hints.keyHint("app.tools.expand", "to expand") : "";
          return padOutputLines(
            presentation.tree(current, this.theme, width - pad * 2, this.expanded, this.cwd, expandHint, this.hints),
            width,
            pad,
          );
        } };
      state.codemodeView = view;
    } else if (view.generation === store.generation && !view.row.evicted) store.ensure(context.toolCallId, record(context.args)?.code);
    view.theme = theme; view.expanded = context.expanded; view.cwd = context.cwd; view.outputPad = normalizeOutputPad(context.outputPad); view.context = context;
    if (store.get(context.toolCallId)) invalidators.set(context.toolCallId, context.invalidate);
    return view;
  };
  pi.registerToolRenderer((name, next) => name !== "codemode" ? next() : {
    renderShell: "self",
    renderCall(_args, theme, context) { return bind(context, theme); },
    renderResult(result, options, theme, context) {
      const view = bind(context, theme);
      // Live data comes from execution/message events. This path supports history/HTML with no live events.
      if (!options.isPartial && view.generation === store.generation && view.row.priority < 2 && !view.row.evicted) {
        view.row.restored = true;
        store.finish(view.row, result, context.isError, context.durationMs);
      }
      return { render: () => [], invalidate() {} };
    },
  });

  pi.registerCommand("inspect", {
    description: "Inspect the latest codemode execution on this branch",
    async handler(_args, ctx) {
      if (ctx.mode !== "tui") { ctx.ui.notify("Codemode inspection requires the terminal UI.", "info"); return; }
      const row = store.latest();
      if (!row) { ctx.ui.notify("No codemode execution on this branch.", "info"); return; }
      const activeKeys = services.getKeybindings?.();
      if (activeKeys && activeKeys.getKeys("tui.select.cancel").length === 0) {
        ctx.ui.notify("Configure a tui.select.cancel keybinding before opening /inspect.", "warning");
        return;
      }
      const generation = store.generation;
      await ctx.ui.custom<void>((tui, initialTheme, keys, done) => {
        const hints = hostKeybindingHints({}, keys);
        const inspectorActions = [
          "tui.select.cancel",
          "tui.input.tab",
          "tui.select.down",
          "tui.select.up",
          "tui.select.pageDown",
          "tui.select.pageUp",
        ] as const;
        const formatFooter = (): readonly [string, string] => {
          const shiftTabOccupied = inspectorActions.some(action => keys.getKeys(action).some(key => String(key).toLowerCase() === "shift+tab"));
          const tabKey = hints.keyText("tui.input.tab");
          const viewKeys = [tabKey, shiftTabOccupied ? "" : "shift+tab"].filter(Boolean).join("/");
          const callKeys = [hints.keyText("tui.select.up"), hints.keyText("tui.select.down")].filter(Boolean).join("/");
          const scrollKeys = [hints.keyText("tui.select.pageUp"), hints.keyText("tui.select.pageDown")].filter(Boolean).join("/");
          const nav = [
            viewKeys ? `${viewKeys}: view` : "",
            callKeys ? `${callKeys}: call` : "",
            scrollKeys ? `${scrollKeys}: scroll` : "",
          ].filter(Boolean).join(" · ");
          const cancelKey = hints.keyText("tui.select.cancel");
          const closeLine = cancelKey ? `${cancelKey}: close` : "";
          return [nav, closeLine];
        };
        const state: InspectorState = { tab: "Calls", selected: 0, scroll: 0 };
        let closed = false;
        const close = () => { if (closed) return; closed = true; store.listeners.delete(update); done(); };
        const update = (changed?: CodemodeRow) => {
          if (store.generation !== generation) { close(); return; }
          if (!changed || changed.id === row.id) tui.requestRender();
        };
        store.listeners.add(update);
        return {
          invalidate() { presentation.clear(); },
          dispose() { store.listeners.delete(update); closed = true; },
          render(width) {
            const theme = ctx.ui.theme ?? initialTheme;
            const inner = Math.max(1, width - 4), height = Math.max(4, Math.min(30, tui.terminal.rows - 8));
            state.selected = Math.max(0, Math.min(state.selected, row.calls.length - 1));
            const detailWidth = state.tab === "Calls" && inner >= 90 ? inner - Math.floor(inner * 0.4) - 3 : inner;
            const detail = presentation.detail(row, state, theme, detailWidth, ctx.cwd, hints);
            const body = renderInspector(row, state, theme, inner, height, detail, formatFooter());
            return [theme.fg("borderMuted", `┌${"─".repeat(Math.max(0, width - 2))}┐`),
              ...body.map(line => theme.bg("toolPendingBg", `│ ${line}${" ".repeat(Math.max(0, inner - visibleWidth(line)))} │`)),
              theme.fg("borderMuted", `└${"─".repeat(Math.max(0, width - 2))}┘`)].map(line => truncateToWidth(line, width));
          },
          handleInput(data) {
            if (keys.matches(data, "tui.select.cancel")) { close(); return; }
            const tabs = ["Calls", "Script", "Output"] as const;
            if (keys.matches(data, "tui.input.tab")) {
              state.tab = tabs[(tabs.indexOf(state.tab) + 1) % 3]!; state.scroll = 0;
            } else if (keys.matches(data, "tui.select.down")) {
              state.selected = Math.min(row.calls.length - 1, state.selected + 1); state.scroll = 0;
            } else if (keys.matches(data, "tui.select.up")) {
              state.selected = Math.max(0, state.selected - 1); state.scroll = 0;
            } else if (keys.matches(data, "tui.select.pageDown")) {
              state.scroll += 5;
            } else if (keys.matches(data, "tui.select.pageUp")) {
              state.scroll = Math.max(0, state.scroll - 5);
            } else if (matchesKey(data, "shift+tab")) {
              state.tab = tabs[(tabs.indexOf(state.tab) + 2) % 3]!; state.scroll = 0;
            } else {
              return;
            }
            tui.requestRender();
          },
        };
      }, { overlay: true, overlayOptions: { width: "95%", maxHeight: "90%", anchor: "center" } });
    },
  });
}
