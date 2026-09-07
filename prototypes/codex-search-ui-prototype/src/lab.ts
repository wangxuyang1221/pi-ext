// PROTOTYPE: Reuse production search formatting inside a local, background-free shell.
import type { ExtensionAPI, ExtensionContext, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Box, Spacer, type Component } from "@earendil-works/pi-tui";
import search from "./baseline.js";
import { SearchPlayback } from "./controller.js";

export async function productionTool(cwd: string): Promise<ToolDefinition> {
  let start: ((event: unknown, ctx: ExtensionContext) => Promise<void>) | undefined;
  let tool: ToolDefinition | undefined;
  search({
    registerCommand() {},
    on(event: string, handler: typeof start) { if (event === "session_start") start = handler; },
    registerTool(value: ToolDefinition) { if (value.name === "codex_search") tool = value; },
  } as unknown as ExtensionAPI);
  await start?.({}, { cwd, isProjectTrusted: () => false } as ExtensionContext);
  if (!tool) throw new Error("Production search tool was not registered.");
  return tool;
}

export const TOOL_NAME = "search_lab";
export const args = {
  queries: [
    "site:developers.openai.com codex web search cached live web_search",
    "site:platform.openai.com docs guides tools web-search Responses API",
  ],
  freshness: "live", search_context_size: "medium",
};
export function fixture(error = false) {
  return {
    content: [{ type: "text" as const, text: error ? "Fixture transport failure. No network request was made." :
      "Codex supports cached and live web search.\n\nSources:\n1. Config basics: https://developers.openai.com/codex/config-basic/\n2. Web search: https://platform.openai.com/docs/guides/tools-web-search\n3. Codex: https://developers.openai.com/codex/" }],
    isError: error,
    details: {
      model: "fixture", api: "responses", freshness: "live", searchContextSize: "medium",
      queryCount: 2, failedQueryCount: error ? 2 : 0, elapsedMs: 6000,
      successes: error ? [] : args.queries.map((query, i) => ({ query, text: "Offline search fixture.",
        citations: Array.from({ length: i === 0 ? 2 : 1 }, (_, n) => ({ title: "Source", url: `https://example.com/${i}/${n}` })),
        searchCalls: Array.from({ length: i === 0 ? 3 : 2 }, () => ({ actionType: "search" })),
      })),
      failures: error ? args.queries.map(query => ({ query, kind: "transport", message: "Fixture transport failure." })) : [],
      ...(error ? { failure: { kind: "transport", message: "Fixture transport failure." } } : {}),
    },
  };
}

const minimalPalette = { title: "D0D4D8", query: "A4ABB2", result: "929BA4", meta: "78838D", gray: "A4ADB6", green: "78D99A", accent: "91C5C7", mode: "A0A8B0", sources: "91B4D5" };
const accentPalette = { ...minimalPalette, title: "E0E3E6", query: "C1C7CE", result: "B9C2CB", meta: "929DA8", accent: "A6DADC", mode: "B8C0C8", sources: "A8CCEC" };
const fg = (hex: string, text: string) => `\x1b[38;2;${hex.match(/../g)!.map(v => parseInt(v, 16)).join(";")}m${text}\x1b[39m`;

function localTheme(theme: Theme, result: boolean, playback: SearchPlayback): Theme {
  const p = playback.style === "accent" ? accentPalette : minimalPalette;
  return new Proxy(theme, {
    get(target, property) {
      if (property === "fg") return (key: Parameters<Theme["fg"]>[0], text: string) => {
        if (result && /^ \[(responses|standalone)\//.test(text)) return "";
        if (key === "success") {
          const numeric = (value: string) => value.split(/(\d+)/).map(part => fg(/^\d+$/.test(part) ? p.title : p.result, part)).join("");
          const body = playback.style === "accent"
            ? text.split(/(\d+ sources?)/).map(part => /^\d+ sources?$/.test(part) ? fg(p.sources, part) : numeric(part)).join("")
            : numeric(text);
          return `${fg(p[playback.check], "✓")} ${body}`;
        }
        if (key === "warning" && text.startsWith("Searching")) {
          return fg(p.result, `${text} · ${Math.floor(playback.elapsedMs / 1000)}s${!playback.playing && !playback.done ? " · paused" : ""}`);
        }
        if (key === "accent") {
          if (text.startsWith("● ")) {
            const title = playback.style === "accent"
              ? text.slice(2).split(/(Web Search)/).map(part => fg(part === "Web Search" ? p.accent : p.title, part)).join("")
              : fg(p.title, text.slice(2));
            return fg(p.accent, `${playback.done ? "●" : playback.spinner} `) + title;
          }
          return fg(p.meta, text);
        }
        if (key === "dim") {
          const mode = text.match(/^(\s*)\[([^\]]+)\]$/);
          if (mode) return `${mode[1]}${fg(p.meta, "[")}${fg(p.mode, mode[2]!)}${fg(p.meta, "]")}`;
          return fg(p.query, text);
        }
        if (key === "muted") return fg(p.meta, text);
        if (key === "toolOutput" || key === "text") return fg(p.result, text);
        return target.fg(key, text);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function shell(content: Component, top: boolean): Component {
  const box = new Box(1, 0);
  if (top) box.addChild(new Spacer(1));
  box.addChild(content);
  if (!top) box.addChild(new Spacer(1));
  return box;
}

export function styleTool(base: ToolDefinition, playback: SearchPlayback): ToolDefinition {
  return {
    ...base, name: TOOL_NAME, renderShell: "self",
    async execute() { throw new Error("Search execution is disabled in this offline prototype."); },
    renderCall(args, theme, context) {
      return shell(base.renderCall!(args, localTheme(theme, false, playback), context), true);
    },
    renderResult(_result, options, theme, context) {
      // Only the named fixture boundary changes; the production partial/final renderer stays intact.
      const data = fixture(playback.scene === "error");
      data.details.elapsedMs = playback.elapsedMs;
      const snapshot = playback.done ? data : {
        content: [], details: { ...data.details, successes: [], failures: [], failedQueryCount: 0,
          completed: playback.completed, total: 2 },
      };
      return shell(base.renderResult!(snapshot, { ...options, isPartial: !playback.done }, localTheme(theme, true, playback), context), false);
    },
  };
}
