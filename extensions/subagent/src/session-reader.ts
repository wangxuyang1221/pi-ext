import { readFile } from "node:fs/promises";

import {
  type ActivityDetailSection,
  type ActivityView,
  decodeActivityCursor,
  decodeDetailCursor,
  encodeActivityCursor,
  encodeDetailCursor,
} from "./cursor.js";

export type { ActivityDetailSection } from "./cursor.js";

const ASSISTANT_TEXT_MAX_BYTES = 64 * 1024;
const DETAIL_PAGE_MAX_BYTES = 16 * 1024;
const ERROR_PREVIEW_MAX_BYTES = 512;
const RECENT_ACTIVITY_MAX_BYTES = 72 * 1024;
const SUMMARY_WARNING_LIMIT = 20;
const SUMMARY_WARNING_MAX_BYTES = 512;

export interface ActivityDetailRef {
  activityId: string;
  sections: ActivityDetailSection[];
}

export interface AssistantActivity {
  kind: "assistant";
  id: string;
  timestamp: string;
  text: string;
  stopReason: string;
  truncated: boolean;
  detailRef?: ActivityDetailRef;
}

export interface ToolActivity {
  kind: "tool";
  id: string;
  timestamp: string;
  toolName: string;
  outcome: "pending" | "succeeded" | "failed";
  detailRef: ActivityDetailRef;
  errorPreview?: string;
}

export type SessionActivity = AssistantActivity | ToolActivity;

interface RawAssistantActivity {
  kind: "assistant";
  id: string;
  timestamp: string;
  text: string;
  stopReason: string;
}

interface RawToolActivity {
  kind: "tool";
  id: string;
  timestamp: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  complete: boolean;
}

type RawSessionActivity = RawAssistantActivity | RawToolActivity;

export interface ReadSessionViewOptions {
  sessionFile: string;
  agentId: string;
  epoch: string;
  view: ActivityView | "activity_detail";
  assistantLimit?: number;
  toolLimit?: number;
  limit?: number;
  after?: string;
  activityId?: string;
  section?: ActivityDetailSection;
  detailCursor?: string;
  leafId?: string;
  maximumBytes?: number;
}

export interface RecentActivityViewResult {
  view: "recent_activity";
  activity: SessionActivity[];
  assistantCount: number;
  toolCount: number;
  omittedAssistant: number;
  omittedTools: number;
  hasMore: boolean;
  returnedBytes: number;
  warnings: string[];
  cursor: string;
  position: number;
}

export interface SessionTurn {
  id: string;
  user: {
    id: string;
    timestamp: string;
    text: string;
  };
  activity: SessionActivity[];
}

export interface TurnsViewResult {
  view: "turns";
  turns: SessionTurn[];
  warnings: string[];
  cursor: string;
  position: number;
}

export interface ActivityDetailViewResult {
  view: "activity_detail";
  activityId: string;
  section: ActivityDetailSection;
  content: string;
  originalBytes: number;
  returnedBytes: number;
  truncated: boolean;
  hasMore: boolean;
  nextDetailCursor?: string;
}

export type SessionViewResult =
  | RecentActivityViewResult
  | TurnsViewResult
  | ActivityDetailViewResult;

interface ParsedEntry {
  value: Record<string, unknown>;
  position: number;
}

interface OrderedActivity {
  activity: RawSessionActivity;
  order: number;
  activityPosition: number;
}

interface RecentActivityResultOptions {
  activity: SessionActivity[];
  totalAssistant: number;
  totalTools: number;
  warnings: string[];
  cursor: string;
  position: number;
  maximumBytes: number;
}

interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  timestamp: string;
  order: number;
  position: number;
}

interface ToolResultRecord {
  text: string;
  isError: boolean;
  position: number;
}

export async function readSessionView(
  options: ReadSessionViewOptions,
): Promise<SessionViewResult> {
  const { header, entries, warnings } = await readCompleteEntries(options.sessionFile);
  if (header.version !== 3) {
    throw new Error(`Unsupported Pi session version: ${String(header.version)}`);
  }
  if (header.id !== options.agentId) {
    throw new Error("Session header id does not match the requested agent");
  }

  const activeEntries = selectActiveBranch(entries, options.leafId);
  if (options.view === "activity_detail") {
    if (!options.activityId || !options.section) {
      throw new Error("Activity detail requires activityId and section");
    }
    return readActivityDetail({
      entries: activeEntries,
      agentId: options.agentId,
      epoch: options.epoch,
      activityId: options.activityId,
      section: options.section,
      detailCursor: options.detailCursor,
    });
  }

  const position = entries.length;
  const afterPosition = options.after
    ? decodeActivityCursor(options.after, {
        agentId: options.agentId,
        epoch: options.epoch,
        view: options.view,
      }).position
    : 0;
  if (afterPosition > position) {
    throw new Error("Activity cursor points beyond the current session");
  }

  const cursor = encodeActivityCursor({
    agentId: options.agentId,
    epoch: options.epoch,
    view: options.view,
    position,
  });

  if (options.view === "recent_activity") {
    const activity = projectActivity(activeEntries, afterPosition);
    const assistantLimit = options.assistantLimit ?? 1;
    const toolLimit = options.toolLimit ?? 1;
    const maximumBytes = Math.min(
      RECENT_ACTIVITY_MAX_BYTES,
      Math.max(0, options.maximumBytes ?? RECENT_ACTIVITY_MAX_BYTES),
    );
    const assistants = activity.filter((item) => (
      item.activity.kind === "assistant" && item.activity.text.trim().length > 0
    ));
    const tools = activity.filter((item) => item.activity.kind === "tool");
    const assistantCandidates = takeLast(assistants, assistantLimit);
    const toolCandidates = takeLast(tools, toolLimit);
    const priority = [
      ...assistantCandidates.slice(-1),
      ...toolCandidates.slice(-1),
      ...toolCandidates.slice(0, -1).reverse(),
      ...assistantCandidates.slice(0, -1).reverse(),
    ];
    const selected: OrderedActivity[] = [];

    for (const candidate of priority) {
      const trialItems = [...selected, candidate].sort((left, right) => left.order - right.order);
      const trial = finalizeRecentActivityResult({
        activity: trialItems.flatMap((item) => {
          const summary = summarizeActivity(item.activity);
          return summary ? [summary] : [];
        }),
        totalAssistant: assistants.length,
        totalTools: tools.length,
        warnings,
        cursor,
        position,
        maximumBytes,
      });
      if (trial.returnedBytes <= maximumBytes) selected.push(candidate);
    }

    return finalizeRecentActivityResult({
      activity: selected
        .sort((left, right) => left.order - right.order)
        .flatMap((item) => {
          const summary = summarizeActivity(item.activity);
          return summary ? [summary] : [];
        }),
      totalAssistant: assistants.length,
      totalTools: tools.length,
      warnings,
      cursor,
      position,
      maximumBytes,
    });
  }

  if (options.view === "turns") {
    const turns = projectTurns(activeEntries, afterPosition);
    const limit = options.limit ?? 20;
    return {
      view: "turns",
      turns: limit === 0 ? [] : turns.slice(-limit),
      warnings,
      cursor,
      position,
    };
  }
  throw new Error(`Unsupported session view: ${String(options.view)}`);
}

function readActivityDetail(options: {
  entries: ParsedEntry[];
  agentId: string;
  epoch: string;
  activityId: string;
  section: ActivityDetailSection;
  detailCursor?: string;
}): ActivityDetailViewResult {
  const activity = projectActivity(options.entries, 0)
    .find((item) => item.activity.id === options.activityId)
    ?.activity;
  if (!activity) throw new Error(`Activity not found: ${options.activityId}`);

  let detail: string;
  if (options.section === "assistant_text") {
    if (activity.kind !== "assistant") {
      throw new Error("assistant_text is only available for assistant activity");
    }
    detail = activity.text;
  } else {
    if (activity.kind !== "tool") {
      throw new Error(`${options.section} is only available for tool activity`);
    }
    if (options.section === "tool_arguments") {
      detail = JSON.stringify(activity.arguments);
    } else {
      if (!activity.complete || activity.result === undefined) {
        throw new Error("tool_result is not available for pending tool activity");
      }
      detail = activity.result;
    }
  }

  const start = options.detailCursor
    ? decodeDetailCursor(options.detailCursor, {
        agentId: options.agentId,
        epoch: options.epoch,
        activityId: options.activityId,
        section: options.section,
      }).bytePosition
    : 0;
  const bytes = Buffer.from(detail, "utf8");
  if (start > bytes.length) throw new Error("Detail cursor points beyond the activity detail");
  if (start < bytes.length && (bytes[start] & 0xc0) === 0x80) {
    throw new Error("Detail cursor points inside a UTF-8 sequence");
  }

  let end = Math.min(start + DETAIL_PAGE_MAX_BYTES, bytes.length);
  if (end < bytes.length) {
    while (end > start && (bytes[end] & 0xc0) === 0x80) end -= 1;
  }
  const content = bytes.subarray(start, end).toString("utf8");
  const hasMore = end < bytes.length;

  return {
    view: "activity_detail",
    activityId: options.activityId,
    section: options.section,
    content,
    originalBytes: bytes.length,
    returnedBytes: end - start,
    truncated: start > 0 || hasMore,
    hasMore,
    ...(hasMore
      ? {
          nextDetailCursor: encodeDetailCursor({
            agentId: options.agentId,
            epoch: options.epoch,
            activityId: options.activityId,
            section: options.section,
            bytePosition: end,
          }),
        }
      : {}),
  };
}

async function readCompleteEntries(sessionFile: string): Promise<{
  header: Record<string, unknown>;
  entries: ParsedEntry[];
  warnings: string[];
}> {
  const content = await readFile(sessionFile, "utf8");
  const segments = content.split("\n");
  if (!content.endsWith("\n")) segments.pop();
  const lines = segments.filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error("Pi session has no complete header");

  const values = lines.map((line, index) => {
    try {
      const value: unknown = JSON.parse(line);
      if (!isRecord(value)) throw new Error("entry is not an object");
      return value;
    } catch (error) {
      throw new Error(`Invalid Pi session JSONL at complete line ${index + 1}`, { cause: error });
    }
  });
  const header = values[0];
  if (header.type !== "session" || typeof header.id !== "string") {
    throw new Error("Invalid Pi session header");
  }

  const warnings: string[] = [];
  const entries = values.slice(1).map((value, index) => {
    if (!isKnownEntryType(value.type)) {
      warnings.push(`Unknown Pi session entry type: ${String(value.type)}`);
    }
    validateEntryBase(value, index + 1);
    return { value, position: index + 1 };
  });
  return { header, entries, warnings };
}

function selectActiveBranch(entries: ParsedEntry[], leafId?: string): ParsedEntry[] {
  if (entries.length === 0) return [];
  const byId = new Map(entries.map((entry) => [String(entry.value.id), entry]));
  const selectedLeafId = leafId ?? String(entries.at(-1)?.value.id);
  const branch: ParsedEntry[] = [];
  const visited = new Set<string>();
  let currentId: string | null = selectedLeafId;

  while (currentId !== null) {
    if (visited.has(currentId)) throw new Error("Invalid Pi session tree: parent cycle detected");
    visited.add(currentId);
    const entry = byId.get(currentId);
    if (!entry) throw new Error(`Invalid Pi session tree: entry not found: ${currentId}`);
    branch.push(entry);
    const parentId = entry.value.parentId;
    currentId = typeof parentId === "string" ? parentId : null;
  }
  return branch.reverse();
}

function projectTurns(entries: ParsedEntry[], afterPosition: number): SessionTurn[] {
  const starts = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      const message = entry.value.message;
      return entry.value.type === "message" && isRecord(message) && message.role === "user";
    });

  return starts.flatMap(({ entry, index }, turnIndex) => {
    const message = entry.value.message;
    if (!isRecord(message)) throw new Error(`Invalid user message entry: ${String(entry.value.id)}`);
    const nextStart = starts[turnIndex + 1]?.index ?? entries.length;
    const turnEntries = entries.slice(index, nextStart);
    if (!turnEntries.some((candidate) => candidate.position > afterPosition)) return [];

    return [{
      id: String(entry.value.id),
      user: {
        id: String(entry.value.id),
        timestamp: String(entry.value.timestamp),
        text: extractUserText(message.content, String(entry.value.id)),
      },
      activity: projectActivity(turnEntries, afterPosition)
        .sort((left, right) => left.order - right.order)
        .flatMap((item) => {
          const summary = summarizeActivity(item.activity);
          return summary ? [summary] : [];
        }),
    }];
  });
}

function projectActivity(entries: ParsedEntry[], afterPosition: number): OrderedActivity[] {
  const toolCalls = new Map<string, ToolCallRecord>();
  const toolResults = new Map<string, ToolResultRecord>();
  const assistants: OrderedActivity[] = [];

  for (const entry of entries) {
    if (entry.value.type !== "message") continue;
    const message = entry.value.message;
    if (!isRecord(message) || typeof message.role !== "string") {
      throw new Error(`Invalid core message entry: ${String(entry.value.id)}`);
    }

    if (message.role === "assistant") {
      if (!Array.isArray(message.content) || typeof message.stopReason !== "string") {
        throw new Error(`Invalid assistant message entry: ${String(entry.value.id)}`);
      }
      const textParts: string[] = [];
      message.content.forEach((part, blockIndex) => {
        if (!isRecord(part) || typeof part.type !== "string") {
          throw new Error(`Invalid assistant content block: ${String(entry.value.id)}`);
        }
        if (part.type === "text") {
          if (typeof part.text !== "string") {
            throw new Error(`Invalid assistant text block: ${String(entry.value.id)}`);
          }
          textParts.push(part.text);
        } else if (part.type === "toolCall") {
          if (
            typeof part.id !== "string"
            || typeof part.name !== "string"
            || !isRecord(part.arguments)
          ) {
            throw new Error(`Invalid assistant tool call: ${String(entry.value.id)}`);
          }
          toolCalls.set(part.id, {
            id: part.id,
            name: part.name,
            arguments: part.arguments,
            timestamp: String(entry.value.timestamp),
            order: entry.position * 1_000 + blockIndex + 1,
            position: entry.position,
          });
        }
      });
      if (entry.position > afterPosition) {
        assistants.push({
          activity: {
            kind: "assistant",
            id: String(entry.value.id),
            timestamp: String(entry.value.timestamp),
            text: textParts.join("\n"),
            stopReason: message.stopReason,
          },
          order: entry.position * 1_000,
          activityPosition: entry.position,
        });
      }
    } else if (message.role === "toolResult") {
      if (
        typeof message.toolCallId !== "string"
        || typeof message.toolName !== "string"
        || !Array.isArray(message.content)
        || typeof message.isError !== "boolean"
      ) {
        throw new Error(`Invalid tool result message entry: ${String(entry.value.id)}`);
      }
      toolResults.set(message.toolCallId, {
        text: extractTextContent(message.content),
        isError: message.isError,
        position: entry.position,
      });
    }
  }

  const tools: OrderedActivity[] = [];
  for (const call of toolCalls.values()) {
    const result = toolResults.get(call.id);
    const activityPosition = result ? Math.max(call.position, result.position) : call.position;
    if (activityPosition <= afterPosition) continue;
    tools.push({
      activity: {
        kind: "tool",
        id: call.id,
        timestamp: call.timestamp,
        toolName: call.name,
        arguments: call.arguments,
        ...(result ? { result: result.text, isError: result.isError } : {}),
        complete: result !== undefined,
      },
      order: call.order,
      activityPosition,
    });
  }
  return [...assistants, ...tools];
}

function takeLast<T>(items: T[], limit: number): T[] {
  return limit <= 0 ? [] : items.slice(-limit);
}

function finalizeRecentActivityResult(
  options: RecentActivityResultOptions,
): RecentActivityViewResult {
  const maximumWarnings = Math.min(options.warnings.length, SUMMARY_WARNING_LIMIT);
  for (let count = maximumWarnings; count >= 0; count -= 1) {
    const warnings = options.warnings
      .slice(0, count)
      .map((warning) => truncateUtf8(warning, SUMMARY_WARNING_MAX_BYTES).text);
    const omittedWarnings = options.warnings.length - count;
    if (omittedWarnings > 0) {
      warnings.push(`${omittedWarnings} additional warnings omitted`);
    }
    const result = buildRecentActivityResult(options, warnings);
    if (result.returnedBytes <= options.maximumBytes) return result;
  }

  return buildRecentActivityResult(options, []);
}

function buildRecentActivityResult(
  options: RecentActivityResultOptions,
  warnings: string[],
): RecentActivityViewResult {
  const assistantCount = options.activity.filter((item) => item.kind === "assistant").length;
  const toolCount = options.activity.filter((item) => item.kind === "tool").length;
  let returnedBytes = 0;
  let result: RecentActivityViewResult;

  do {
    result = {
      view: "recent_activity",
      activity: options.activity,
      assistantCount,
      toolCount,
      omittedAssistant: options.totalAssistant - assistantCount,
      omittedTools: options.totalTools - toolCount,
      hasMore: assistantCount < options.totalAssistant || toolCount < options.totalTools,
      returnedBytes,
      warnings,
      cursor: options.cursor,
      position: options.position,
    };
    const serializedBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    if (serializedBytes === returnedBytes) return result;
    returnedBytes = serializedBytes;
  } while (true);
}

function summarizeActivity(activity: RawSessionActivity): SessionActivity | undefined {
  if (activity.kind === "assistant") {
    if (activity.text.trim().length === 0) return undefined;
    const text = truncateUtf8(activity.text, ASSISTANT_TEXT_MAX_BYTES);
    return {
      kind: "assistant",
      id: activity.id,
      timestamp: activity.timestamp,
      text: text.text,
      stopReason: activity.stopReason,
      truncated: text.truncated,
      ...(text.truncated
        ? {
            detailRef: {
              activityId: activity.id,
              sections: ["assistant_text"],
            },
          }
        : {}),
    };
  }

  return {
    kind: "tool",
    id: activity.id,
    timestamp: activity.timestamp,
    toolName: activity.toolName,
    outcome: activity.complete
      ? activity.isError ? "failed" : "succeeded"
      : "pending",
    detailRef: {
      activityId: activity.id,
      sections: [
        "tool_arguments",
        ...(activity.complete ? ["tool_result" as const] : []),
      ],
    },
    ...(activity.complete && activity.isError && activity.result
      ? { errorPreview: truncateUtf8(activity.result, ERROR_PREVIEW_MAX_BYTES).text }
      : {}),
  };
}

function truncateUtf8(value: string, maximumBytes: number): {
  text: string;
  truncated: boolean;
} {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maximumBytes) return { text: value, truncated: false };

  const suffix = "…";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  let end = Math.max(0, maximumBytes - suffixBytes);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return {
    text: `${bytes.subarray(0, end).toString("utf8")}${suffix}`,
    truncated: true,
  };
}

function extractUserText(content: unknown, entryId: string): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new Error(`Invalid user message entry: ${entryId}`);
  return content
    .filter((part): part is Record<string, unknown> => isRecord(part) && part.type === "text")
    .map((part) => {
      if (typeof part.text !== "string") throw new Error(`Invalid user text block: ${entryId}`);
      return part.text;
    })
    .join("\n");
}

function extractTextContent(content: unknown[]): string {
  return content
    .filter((part): part is Record<string, unknown> => isRecord(part) && part.type === "text")
    .map((part) => {
      if (typeof part.text !== "string") throw new Error("Invalid tool result text block");
      return part.text;
    })
    .join("\n");
}

function validateEntryBase(value: Record<string, unknown>, position: number): void {
  if (
    typeof value.id !== "string"
    || !(typeof value.parentId === "string" || value.parentId === null)
    || typeof value.timestamp !== "string"
  ) {
    throw new Error(`Invalid Pi session entry at position ${position}`);
  }
}

function isKnownEntryType(value: unknown): boolean {
  return value === "message"
    || value === "thinking_level_change"
    || value === "model_change"
    || value === "compaction"
    || value === "branch_summary"
    || value === "custom"
    || value === "custom_message"
    || value === "label"
    || value === "session_info";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
