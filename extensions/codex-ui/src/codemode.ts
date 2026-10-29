import { sessionEntryToContextMessages, type ExtensionAPI, type ExtensionContext, type KeybindingsManager, type Theme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { CodemodeStore, type CodemodeRow } from "./codemode-model.js";
import { CodemodePresentation } from "./codemode-presentation.js";
import { renderInspector, type InspectorState } from "./codemode-view.js";
import { record } from "./codemode-data.js";

type RenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
interface RowView extends Component {
  row: CodemodeRow; generation: number; theme: Theme; expanded: boolean; cwd: string; hint: string;
}
interface RowState { codemodeView?: RowView }
export interface CodemodeServices {
  nativeRenderers: ReadonlyMap<string, ToolRenderers>;
  getKeybindings?: () => Pick<KeybindingsManager, "getKeys"> | undefined;
}

/** Display-only integration. Never registers, wraps or executes a tool. */
export function registerCodemodeUi(pi: ExtensionAPI, services: CodemodeServices): void {
  // Older hosts keep their own renderer. Test/SDK hosts may omit renderer registration too.
  if (typeof pi.registerToolRenderer !== "function") return;
  const store = new CodemodeStore();
  const presentation = new CodemodePresentation(store, services.nativeRenderers);
  const invalidators = new Map<string, () => void>();
  store.listeners.add(row => {
    if (row) { invalidators.get(row.id)?.(); if (row.evicted) invalidators.delete(row.id); }
    else for (const invalidate of invalidators.values()) invalidate();
  });
  const rebuild = (_event: unknown, ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;
    presentation.clear();
    function* messages() {
      for (const entry of ctx.sessionManager.buildContextEntries()) yield* sessionEntryToContextMessages(entry);
    }
    store.rebuild(messages());
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
      view = { row, generation: store.generation, theme, expanded: context.expanded, cwd: context.cwd, hint: "",
        invalidate() {}, render(width) {
          const current = store.get(row.id) ?? this.row;
          return presentation.tree(current, this.theme, width, this.expanded, this.cwd, this.hint);
        } };
      state.codemodeView = view;
    } else if (view.generation === store.generation && !view.row.evicted) store.ensure(context.toolCallId, record(context.args)?.code);
    view.theme = theme; view.expanded = context.expanded; view.cwd = context.cwd;
    view.hint = `${services.getKeybindings?.()?.getKeys("app.tools.expand").join("/") || "ctrl+o"} to expand`;
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
      const generation = store.generation;
      await ctx.ui.custom<void>((tui, initialTheme, keys, done) => {
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
            const detail = presentation.detail(row, state, theme, detailWidth, ctx.cwd);
            const body = renderInspector(row, state, theme, inner, height, detail);
            if (body.length >= 2) body[body.length - 2] = truncateToWidth(theme.fg("dim", `Tab: view · ${keys.getKeys("tui.select.up").join("/")}/${keys.getKeys("tui.select.down").join("/")}: call · ${keys.getKeys("tui.select.pageDown").join("/")}: scroll`), inner);
            if (body.length) body[body.length - 1] = truncateToWidth(theme.fg("dim", `${keys.getKeys("tui.select.cancel").join("/")}: close`), inner);
            return [theme.fg("borderMuted", `┌${"─".repeat(Math.max(0, width - 2))}┐`),
              ...body.map(line => theme.bg("toolPendingBg", `│ ${line}${" ".repeat(Math.max(0, inner - visibleWidth(line)))} │`)),
              theme.fg("borderMuted", `└${"─".repeat(Math.max(0, width - 2))}┘`)].map(line => truncateToWidth(line, width));
          },
          handleInput(data) {
            if (keys.matches(data, "tui.select.cancel")) { close(); return; }
            if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
              const tabs = ["Calls", "Script", "Output"] as const;
              state.tab = tabs[(tabs.indexOf(state.tab) + (matchesKey(data, "shift+tab") ? 2 : 1)) % 3]!; state.scroll = 0;
            }
            if (keys.matches(data, "tui.select.down")) { state.selected = Math.min(row.calls.length - 1, state.selected + 1); state.scroll = 0; }
            if (keys.matches(data, "tui.select.up")) { state.selected = Math.max(0, state.selected - 1); state.scroll = 0; }
            if (keys.matches(data, "tui.select.pageDown")) state.scroll += 5;
            if (keys.matches(data, "tui.select.pageUp")) state.scroll = Math.max(0, state.scroll - 5);
            tui.requestRender();
          },
        };
      }, { overlay: true, overlayOptions: { width: "95%", maxHeight: "90%", anchor: "center" } });
    },
  });
}
