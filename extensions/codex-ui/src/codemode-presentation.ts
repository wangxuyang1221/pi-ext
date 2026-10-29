import { resolve } from "node:path";
import type { BashToolDetails, ReadToolDetails, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { renderReadGroup } from "./read-group-layout.js";
import { renderBashGroup } from "./bash-group-layout.js";
import type { ReadMember } from "./read-groups.js";
import type { BashMember } from "./bash-groups.js";
import { ToolRenderCache } from "./render-cache.js";
import { clean, inline } from "./codemode-data.js";
import { type CodemodeCall, type CodemodeRow, CodemodeStore } from "./codemode-model.js";
import { callLabel, duration, type InspectorState, renderCodemodeTree, statusColor, wrapDetail } from "./codemode-view.js";

type ToolRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

export const themeKey = (theme: Theme): string => (["text", "dim", "accent", "muted", "toolTitle", "success", "warning", "error", "borderMuted"] as const).map(name => theme.fg(name, "x")).join("");

/** Bounded derived strings only: native components never retain nested execution results. */
export class CodemodePresentation {
  private cache = new ToolRenderCache({ layoutBytes: 4 * 1024 * 1024, countBytes: 128 * 1024 });
  private scope = this.cache.scope();
  constructor(readonly store: CodemodeStore, private readonly natives: ReadonlyMap<string, ToolRenderers>) {}
  clear(): void { this.cache.clear(); this.scope = this.cache.scope(); }
  stats() { return this.cache.stats(); }
  tree(row: CodemodeRow, theme: Theme, width: number, expanded: boolean, cwd: string, expandHint: string): string[] {
    // Result cache eviction can make an earlier child's body unavailable without changing its status.
    return renderCodemodeTree(row, { theme, width, expanded, expandHint, child: (call, available, colors) => this.child(call, available, colors, cwd) });
  }
  child(call: CodemodeCall, width: number, theme: Theme, cwd: string): string[] {
    const captured = this.store.results.get(call.id);
    const key = ["child", this.scope.identity(call), call.revision, captured?.revision ?? "missing", width, themeKey(theme)].join("\0");
    return this.scope.lines(key, () => {
      const heading = theme.fg(statusColor(call.status), `${callLabel(call)} · ${call.status}${call.durationMs === undefined ? "" : ` · ${duration(call.durationMs)}`}`);
      const fallback = () => {
        const lines = [heading];
        if (!call.argsComplete) lines.push(theme.fg("dim", "Arguments incomplete or omitted"));
        if (!captured) lines.push(theme.fg("dim", call.status === "running" ? "Running…" : "Raw result unavailable; history or cache limit"));
        else {
          const prefix = captured.result.content.map(block => clean(block.text, 8192)).join("\n");
          for (const line of prefix.split("\n").slice(0, 16)) lines.push(line);
          if (!captured.complete || prefix.split("\n").length > 16) lines.push(theme.fg("dim", "Preview limited; inspect captured output"));
        }
        return lines;
      };
      if (!captured?.complete || !call.argsComplete || call.model) return wrapDetail(fallback(), width);
      const status = call.status === "running" ? "running" : call.status === "ok" ? "completed" : "failed";
      const result = captured.result;
      if (call.name === "read" && typeof call.args.path === "string") {
        const member: ReadMember = { id: call.id, cache: this.scope, group: { members: [], version: 0 }, path: clean(call.args.path), fullPath: resolve(cwd, call.args.path),
          offset: typeof call.args.offset === "number" ? call.args.offset : undefined, limit: typeof call.args.limit === "number" ? call.args.limit : undefined,
          status, content: result.content, details: result.details as ReadToolDetails, revision: call.revision };
        member.group.members.push(member);
        return renderReadGroup(member, true, theme, width);
      }
      if (call.name === "bash" && typeof call.args.command === "string") {
        const member: BashMember = { id: call.id, cache: this.scope, group: { members: [] }, command: call.args.command, commandRevision: call.revision, outputRevision: captured.revision,
          status, content: result.content, details: result.details as BashToolDetails };
        member.group.members.push(member);
        return renderBashGroup(member.group, true, theme, width, "");
      }
      if (call.name === "edit" || call.name === "write") {
        const renderer = this.natives.get(call.name);
        if (renderer?.renderCall && renderer.renderResult) {
          const context: ToolRenderContext = { toolCallId: call.id, args: call.args, state: {}, lastComponent: undefined, cwd, executionStarted: true, argsComplete: true,
            isPartial: call.status === "running", expanded: true, showImages: false, isError: call.status !== "ok" && call.status !== "running", durationMs: call.durationMs, outputPad: 0, invalidate() {} };
          const a = renderer.renderCall(call.args, theme, context);
          const b = renderer.renderResult({ ...result, details: result.details }, { expanded: true, isPartial: context.isPartial }, theme, context);
          return [...a.render(width), ...b.render(width)];
        }
      }
      return wrapDetail(fallback(), width);
    });
  }
  detail(row: CodemodeRow, state: InspectorState, theme: Theme, width: number, cwd: string): string[] {
    const call = row.calls[state.selected];
    const captured = call && this.store.results.get(call.id);
    const key = ["inspect", this.scope.identity(row), state.tab, state.tab === "Calls" ? `${call?.id}:${call?.revision}:${captured?.revision}` : row.revision, width, themeKey(theme)].join("\0");
    return this.scope.lines(key, () => {
      if (state.tab === "Script") return wrapDetail([...(row.code || "Script unavailable").split("\n"), ...(row.code.length >= 65536 ? ["Script preview limited to 64 Ki characters"] : [])], width);
      if (state.tab === "Output") return wrapDetail((row.output || "(No output)").split("\n").concat(row.output.length >= 65536 ? ["Output preview limited to 64 Ki characters"] : [], row.outputPath ? [`Full output: ${row.outputPath}`] : []), width);
      if (!call) return [row.incomplete ? "Call metadata unavailable" : "No calls"];
      const head = [callLabel(call), `Status: ${call.status} · ${duration(call.durationMs)}`, `Started: ${call.startMs === undefined ? "unavailable" : `+${duration(call.startMs)}`}`, `Parent: ${inline(call.parentId)}`,
        ...clean(JSON.stringify(call.args, null, 2), 8192).split("\n"), ...(!call.argsComplete ? ["Arguments incomplete or omitted"] : [])];
      const raw = captured ? captured.result.content.flatMap(block => clean(block.text, 32768).split("\n")) : ["Raw result unavailable; history or cache limit"];
      const notice = captured && !captured.complete ? ["Captured result truncated; full child result was not retained"] : [];
      const diff = captured?.complete && ["edit", "write"].includes(call.name) ? this.child(call, width, theme, cwd) : [];
      return [...wrapDetail(head, width), ...diff, ...wrapDetail(["Raw child output", ...raw, ...notice], width)];
    });
  }
}
