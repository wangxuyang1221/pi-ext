import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import {
  fitToWidth,
  normalizeWidth,
} from "./layout.js";

export type SubagentToolKind =
  | "spawn"
  | "prompt"
  | "list"
  | "read"
  | "wait"
  | "close";

export type SubagentStatus =
  | "starting"
  | "running"
  | "settled"
  | "closing"
  | "closed"
  | "interrupted"
  | "errored";

export interface AgentDisplay {
  agentId: string;
  name: string;
  status: SubagentStatus;
  generation: number;
  model?: string;
  thinkingLevel?: string;
  tmuxWindow?: string;
  sessionFile?: string;
}

export interface AssistantActivity {
  kind: "assistant";
  id: string;
  timestamp: string;
  text: string;
  stopReason: string;
}

export interface ToolActivity {
  kind: "tool";
  id: string;
  timestamp: string;
  toolName: string;
  summary: string;
  result: string;
  isError?: boolean;
}

export type ActivityDisplay = AssistantActivity | ToolActivity;

export interface SubagentUiDetails {
  operation: SubagentToolKind;
  ok: boolean;
  agent?: AgentDisplay;
  agents?: AgentDisplay[];
  affected?: AgentDisplay[];
  task?: string;
  prompt?: string;
  delivery?: "steer" | "follow_up";
  view?: "recent_activity" | "turns" | "all_entries";
  assistantCount?: number;
  toolCount?: number;
  cursor?: string;
  settledCursor?: string;
  outcome?: "settled" | "interrupted" | "closed" | "timeout";
  durationMs?: number;
  activity?: ActivityDisplay[];
  capacity?: {
    active: number;
    pending: number;
    limit: number;
    available: number;
  };
  relationshipRemoved?: boolean;
  extensionDataRemoved?: boolean;
  piSessionRetained?: boolean;
  message?: string;
}

interface RendererState {
  details?: SubagentUiDetails;
  isPartial?: boolean;
  isError?: boolean;
  callComponent?: ResponsiveLinesComponent;
}

interface RendererContext {
  state: unknown;
  lastComponent: Component | undefined;
  isPartial: boolean;
  isError: boolean;
}

type ToolArgs = Record<string, unknown>;

const OPERATION_LABELS: Record<
  SubagentToolKind,
  { pending: string; complete: string; failed: string }
> = {
  spawn: { pending: "Spawning", complete: "Spawned", failed: "Spawn failed" },
  prompt: { pending: "Sending input to", complete: "Sent input to", failed: "Send failed" },
  list: { pending: "Listing", complete: "Listed", failed: "List failed" },
  read: { pending: "Reading activity from", complete: "Read activity from", failed: "Read failed" },
  wait: { pending: "Waiting for", complete: "Finished waiting for", failed: "Wait failed" },
  close: { pending: "Closing", complete: "Closed", failed: "Close failed" },
};

class ResponsiveLinesComponent implements Component {
  private renderer: (width: number) => string[] = () => [];

  setRenderer(renderer: (width: number) => string[]): void {
    this.renderer = renderer;
  }

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];
    return this.renderer(safeWidth).map((line) => fitToWidth(line, safeWidth));
  }

  invalidate(): void {}
}

export function renderSubagentCall(
  kind: SubagentToolKind,
  args: ToolArgs,
  theme: Theme,
  context: RendererContext,
): Component {
  const state = context.state as RendererState;
  state.isPartial = context.isPartial;
  state.isError = context.isError;

  const component = getResponsiveComponent(context.lastComponent ?? state.callComponent);
  state.callComponent = component;
  component.setRenderer((width) => [renderTitle(kind, args, state, theme, width)]);
  return component;
}

export function renderSubagentResult(
  kind: SubagentToolKind,
  args: ToolArgs,
  result: AgentToolResult<SubagentUiDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  context: RendererContext,
): Component {
  const state = context.state as RendererState;
  state.details = result.details;
  state.isPartial = options.isPartial;
  state.isError = context.isError || result.details?.ok === false;

  const component = getResponsiveComponent(context.lastComponent);
  component.setRenderer((width) => renderResultLines(
    kind,
    args,
    result,
    options,
    theme,
    state,
    width,
  ));
  return component;
}

function getResponsiveComponent(previous: Component | undefined): ResponsiveLinesComponent {
  return previous instanceof ResponsiveLinesComponent
    ? previous
    : new ResponsiveLinesComponent();
}

function renderTitle(
  kind: SubagentToolKind,
  args: ToolArgs,
  state: RendererState,
  theme: Theme,
  width: number,
): string {
  const presentation = OPERATION_LABELS[kind];
  const action = state.isError
    ? presentation.failed
    : state.isPartial
      ? presentation.pending
      : presentation.complete;
  const target = getTitleTarget(kind, args, state.details);
  const suffix = getTitleSuffix(kind, args, state.details);

  const parts = [
    theme.fg("dim", "•"),
    theme.fg("toolTitle", theme.bold(action)),
  ];
  if (target) parts.push(theme.fg("accent", theme.bold(target)));
  if (suffix) parts.push(theme.fg("dim", suffix));

  return fitToWidth(parts.join(" "), width, { ellipsis: "…" });
}

function getTitleTarget(
  kind: SubagentToolKind,
  args: ToolArgs,
  details: SubagentUiDetails | undefined,
): string {
  if (kind === "list") {
    const count = details?.agents?.length;
    return count === undefined ? "subagents" : `${count} ${count === 1 ? "subagent" : "subagents"}`;
  }

  if (kind === "close") {
    const target = stringArg(args, "target");
    if (target === "all") return "all subagents";
  }

  return details?.agent?.name
    ?? stringArg(args, "name")
    ?? shortAgentId(stringArg(args, "agentId") ?? stringArg(args, "target"))
    ?? (kind === "spawn" ? "child" : "subagent");
}

function getTitleSuffix(
  kind: SubagentToolKind,
  args: ToolArgs,
  details: SubagentUiDetails | undefined,
): string {
  if (kind === "spawn") {
    const model = stringArg(args, "model") ?? details?.agent?.model;
    const thinking = stringArg(args, "thinkingLevel") ?? details?.agent?.thinkingLevel;
    const values = [model, thinking].filter((value): value is string => Boolean(value));
    return values.length > 0 ? `(${values.join(" · ")})` : "";
  }
  if (kind === "prompt") {
    return `(${stringArg(args, "delivery") ?? details?.delivery ?? "steer"})`;
  }
  if (kind === "read") {
    return `(${stringArg(args, "view") ?? details?.view ?? "recent_activity"})`;
  }
  if (kind === "wait") {
    const timeoutMs = numberArg(args, "timeoutMs");
    return timeoutMs === undefined ? "" : `(${formatDuration(timeoutMs)} timeout)`;
  }
  return "";
}

function renderResultLines(
  kind: SubagentToolKind,
  args: ToolArgs,
  result: AgentToolResult<SubagentUiDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
  state: RendererState,
  width: number,
): string[] {
  if (options.isPartial) return [];

  const details = state.details;
  if (state.isError || !details?.ok) {
    return prefixDetails([
      theme.fg("error", details?.message ?? extractResultText(result) ?? `${OPERATION_LABELS[kind].failed}.`),
    ], theme, width);
  }

  const lines = (() => {
    switch (kind) {
      case "spawn":
        return renderSpawn(details, options.expanded, theme);
      case "prompt":
        return renderPrompt(details, args, options.expanded, theme);
      case "list":
        return renderList(details, options.expanded, theme);
      case "read":
        return renderRead(details, options.expanded, theme);
      case "wait":
        return renderWait(details, options.expanded, theme);
      case "close":
        return renderClose(details, options.expanded, theme);
    }
  })();

  return prefixDetails(lines, theme, width);
}

function renderSpawn(
  details: SubagentUiDetails,
  expanded: boolean,
  theme: Theme,
): string[] {
  const lines = [theme.fg("toolOutput", preview(details.task ?? "Initial task submitted.", 160))];
  if (expanded && details.agent) {
    lines.push(renderAgentMetadata(details.agent, theme));
  }
  return lines;
}

function renderPrompt(
  details: SubagentUiDetails,
  args: ToolArgs,
  expanded: boolean,
  theme: Theme,
): string[] {
  const prompt = details.prompt ?? stringArg(args, "text") ?? "Prompt delivered.";
  const lines = [theme.fg("toolOutput", preview(prompt, 160))];
  if (expanded) {
    lines.push(theme.fg("dim", `Delivery accepted as ${details.delivery ?? "steer"}; completion not implied.`));
  }
  return lines;
}

function renderList(
  details: SubagentUiDetails,
  expanded: boolean,
  theme: Theme,
): string[] {
  const agents = details.agents ?? [];
  const capacity = details.capacity
    ? theme.fg(
      "dim",
      `${details.capacity.active} active · ${details.capacity.pending} pending · limit ${details.capacity.limit} · ${details.capacity.available} available`,
    )
    : undefined;
  if (agents.length === 0) {
    return [capacity ?? theme.fg("dim", "No managed subagents")];
  }
  if (!expanded) {
    return [[renderStatusCounts(agents, theme), capacity].filter(Boolean).join(theme.fg("dim", " · "))];
  }
  return [...(capacity ? [capacity] : []), ...agents.map((agent) => renderAgentLine(agent, theme))];
}

function renderRead(
  details: SubagentUiDetails,
  expanded: boolean,
  theme: Theme,
): string[] {
  const assistantCount = details.assistantCount ?? countActivity(details.activity, "assistant");
  const toolCount = details.toolCount ?? countActivity(details.activity, "tool");
  const cursor = details.cursor ? ` · cursor ${shortCursor(details.cursor)}` : "";
  const summary = theme.fg(
    "muted",
    `${assistantCount} assistant · ${toolCount} ${toolCount === 1 ? "tool" : "tools"}${cursor}`,
  );
  if (!expanded || !details.activity?.length) return [summary];
  return [summary, ...details.activity.map((activity) => renderActivity(activity, theme))];
}

function renderWait(
  details: SubagentUiDetails,
  expanded: boolean,
  theme: Theme,
): string[] {
  const agent = details.agent;
  const generation = agent ? ` · generation ${agent.generation}` : "";
  const duration = details.durationMs === undefined ? "" : ` · ${formatDuration(details.durationMs)}`;
  const outcome = details.outcome ?? "settled";
  const lines = [
    `${renderOutcome(outcome, theme)}${theme.fg("dim", `${generation}${duration}`)}`,
  ];
  if (expanded && details.activity?.length) {
    lines.push(...details.activity.map((activity) => renderActivity(activity, theme)));
  }
  if (expanded && details.settledCursor) {
    lines.push(theme.fg("dim", `Settled cursor ${shortCursor(details.settledCursor)}`));
  }
  return lines;
}

function renderClose(
  details: SubagentUiDetails,
  expanded: boolean,
  theme: Theme,
): string[] {
  const count = details.affected?.length ?? (details.agent ? 1 : 0);
  const summary = count === 1
    ? `${theme.fg("success", "Process stopped")}${theme.fg("dim", " · relationship removed · Extension data deleted · Pi session retained")}`
    : `${theme.fg("success", `${count} processes stopped`)}${theme.fg("dim", " · relationships removed · Extension data deleted · Pi sessions retained")}`;
  const lines = [summary];
  if (expanded && details.affected?.length) {
    lines.push(...details.affected.map((agent) => renderAgentLine(agent, theme)));
  }
  return lines;
}

function prefixDetails(lines: string[], theme: Theme, width: number): string[] {
  return lines.map((line, index) => {
    const prefix = theme.fg("dim", index === 0 ? "  └ " : "    ");
    return fitToWidth(`${prefix}${line}`, width, { ellipsis: "…" });
  });
}

function renderAgentLine(agent: AgentDisplay, theme: Theme): string {
  return [
    theme.fg("accent", theme.bold(agent.name)),
    theme.fg("dim", " ["),
    renderStatus(agent.status, theme),
    theme.fg("dim", `] · generation ${agent.generation}`),
  ].join("");
}

function renderAgentMetadata(agent: AgentDisplay, theme: Theme): string {
  const values = [
    theme.fg("dim", shortAgentId(agent.agentId) ?? agent.agentId),
    renderStatus(agent.status, theme),
    theme.fg("dim", `generation ${agent.generation}`),
  ];
  if (agent.tmuxWindow) values.push(theme.fg("dim", agent.tmuxWindow));
  return values.join(theme.fg("dim", " · "));
}

function renderStatusCounts(agents: AgentDisplay[], theme: Theme): string {
  const statuses: SubagentStatus[] = ["starting", "running", "settled", "closing", "closed", "interrupted", "errored"];
  const parts = statuses.flatMap((status) => {
    const count = agents.filter((agent) => agent.status === status).length;
    if (count === 0) return [];
    return [`${theme.fg(statusColor(status), String(count))} ${theme.fg("muted", status)}`];
  });
  return parts.join(theme.fg("dim", " · "));
}

function renderStatus(status: SubagentStatus, theme: Theme): string {
  const label = status[0]?.toUpperCase() + status.slice(1);
  const styled = theme.fg(statusColor(status), label);
  return status === "running" ? theme.bold(styled) : styled;
}

function renderOutcome(
  outcome: NonNullable<SubagentUiDetails["outcome"]>,
  theme: Theme,
): string {
  const label = outcome === "settled"
    ? "Settled"
    : outcome === "timeout"
      ? "Timed out"
      : outcome[0]?.toUpperCase() + outcome.slice(1);
  const color = outcome === "settled"
    ? "success"
    : outcome === "closed"
      ? "dim"
      : outcome === "timeout" || outcome === "interrupted"
        ? "warning"
        : "error";
  return theme.fg(color, label);
}

function renderActivity(activity: ActivityDisplay, theme: Theme): string {
  if (activity.kind === "assistant") {
    return `${theme.fg("muted", "assistant")}  ${theme.fg("toolOutput", preview(activity.text, 120))}`;
  }
  const arrow = theme.fg("dim", " → ");
  const result = theme.fg(activity.isError ? "error" : "toolOutput", preview(activity.result, 90));
  return `${theme.fg("muted", activity.toolName)}  ${theme.fg("dim", preview(activity.summary, 48))}${arrow}${result}`;
}

function statusColor(status: SubagentStatus): "accent" | "success" | "dim" | "warning" | "error" {
  switch (status) {
    case "starting":
    case "running":
      return "accent";
    case "settled":
      return "success";
    case "closing":
      return "warning";
    case "closed":
      return "dim";
    case "interrupted":
      return "warning";
    case "errored":
      return "error";
  }
}

function countActivity(
  activity: ActivityDisplay[] | undefined,
  kind: ActivityDisplay["kind"],
): number {
  return activity?.filter((item) => item.kind === kind).length ?? 0;
}

function stringArg(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberArg(args: ToolArgs, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function shortAgentId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function shortCursor(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function preview(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > maximum ? `${normalized.slice(0, maximum - 1)}…` : normalized;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds % 1000 === 0 ? 0 : 1)}s`;
}

function extractResultText(result: AgentToolResult<SubagentUiDetails>): string | undefined {
  const item = result.content.find((content) => content.type === "text");
  return item?.type === "text" ? item.text.split("\n", 1)[0] : undefined;
}
