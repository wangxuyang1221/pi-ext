import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  registerTools,
  type ToolLayout,
  type ToolFactories,
  type ToolRenderServices,
  getDisplayLineNumberWidth,
} from "../../../shared/ui/native-tools.js";
import {
  renderClaudeReadGroup,
  renderClaudeBashGroup,
  claudeCallHeading,
  renderClaudeConnectorLine,
  renderClaudeMutationSummary,
  renderClaudeDiff,
  renderClaudeDiffTruncation,
} from "./claude-tools.js";

export const claudeTools: ToolLayout = {
  read: renderClaudeReadGroup,
  bash: renderClaudeBashGroup,
  editHeading(state, path, theme, width, started) {
    return claudeCallHeading(theme, state.settledStatus ?? (started ? "running" : "pending"), "Update", path || "(unknown)", width);
  },
  writeHeading(state, path, theme, width, started) {
    return claudeCallHeading(theme, state.settledStatus ?? (started ? "running" : "pending"), "Write", path || "(unknown)", width);
  },
  notice: renderClaudeConnectorLine,
  applied: (theme, width) => renderClaudeConnectorLine("Updated file", "muted", theme, width),
  writeSummary: (path, added, theme, width) => renderClaudeMutationSummary("write", path, { added, removed: 0 }, true, theme, width),
  collapsedLines: (tool, pureAddition) => tool === "write" && pureAddition ? 10 : 14,
  diff({ tool, path, visible, highlighted, stats, pureAddition, remaining, theme, width, expandKeys }) {
    const lines = [
      renderClaudeMutationSummary(tool, path, stats, pureAddition, theme, width),
      ...renderClaudeDiff(visible, theme, width, path, getDisplayLineNumberWidth(visible), tool === "write" && pureAddition, highlighted),
    ];
    if (remaining > 0) lines.push(renderClaudeDiffTruncation(remaining, theme, width, expandKeys));
    return lines;
  },
};

export function registerClaudeTools(pi: ExtensionAPI, factories?: ToolFactories, services?: ToolRenderServices) {
  return registerTools(claudeTools, pi, factories, services);
}
