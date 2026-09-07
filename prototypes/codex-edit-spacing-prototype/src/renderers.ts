// PROTOTYPE: Decorate production components without changing diff parsing or syntax colors.
import type { EditToolDetails, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, stripTerminalSequences, visibleWidth, type Component } from "@earendil-works/pi-tui";

export type Variant = 1 | 2 | 3;
export interface LabState {
  variant: Variant;
  invalidators: Map<string, () => void>;
}

class DecoratedComponent implements Component {
  constructor(readonly inner: Component, private paint: (lines: string[], width: number) => string[]) {}
  render(width: number): string[] { return this.paint(this.inner.render(width), width); }
  invalidate(): void { this.inner.invalidate(); }
}

export function wrapEditTool(tool: ToolDefinition, lab: LabState): ToolDefinition {
  const states = new WeakMap<object, { hasDiff: boolean }>();
  const stateFor = (state: object) => {
    let value = states.get(state);
    if (!value) { value = { hasDiff: false }; states.set(state, value); }
    return value;
  };
  const innerOf = (component: Component | undefined) => component instanceof DecoratedComponent ? component.inner : component;
  return {
    ...tool,
    async execute() { throw new Error("Tool execution is disabled in this UI prototype."); },
    renderCall(args, theme, context) {
      const state = stateFor(context.state);
      lab.invalidators.set(context.toolCallId, context.invalidate);
      const inner = tool.renderCall!(args, theme, { ...context, lastComponent: innerOf(context.lastComponent) });
      return new DecoratedComponent(inner, (original, width) => {
        if (!state.hasDiff) return original;
        // Keep alternatives independent after the underlined style ships in production.
        const lines = original.map(line => line.replace(/\x1b\[(?:4|24)m/gu, ""));
        if (lab.variant === 1) return lines.map(line => theme.bg("customMessageBg", line + " ".repeat(Math.max(0, width - visibleWidth(line)))));
        if (lab.variant === 2) return lines.map(line => theme.underline(line));
        return lines;
      });
    },
    renderResult(result, options, theme, context) {
      const state = stateFor(context.state);
      const details = result.details as EditToolDetails | undefined;
      state.hasDiff = !options.isPartial && !context.isError && Boolean(details?.patch || details?.diff);
      lab.invalidators.set(context.toolCallId, context.invalidate);
      const inner = tool.renderResult!(result, options, theme, { ...context, lastComponent: innerOf(context.lastComponent) });
      return new DecoratedComponent(inner, (original, width) => {
        if (!state.hasDiff) return original;
        // Remove only the production header gap, not the truncation-footer gap.
        const lines = stripTerminalSequences(original[0] ?? "").trim() === "" ? original.slice(1) : original;
        if (lab.variant !== 3 || width < 4) return lines;
        // Use the existing four-cell indent so line numbers and source stay aligned.
        return lines.map(line => stripTerminalSequences(line).trim()
          ? sliceByColumn(line, 0, 2) + theme.fg("borderMuted", "│") + sliceByColumn(line, 3, width)
          : line);
      });
    },
  };
}
