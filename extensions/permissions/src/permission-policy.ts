import { createHash } from "node:crypto";
import { posix, win32, type PlatformPath } from "node:path";
import type { ThemeColor, ToolCallEventResult } from "@earendil-works/pi-coding-agent";

export const MODES = {
  DEFAULT: "default",
  FULL_ACCESS: "full-access",
} as const;

export type PermissionMode = (typeof MODES)[keyof typeof MODES];

export const MODE_LABELS: Readonly<Record<PermissionMode, string>> = Object.freeze({
  [MODES.DEFAULT]: "Default permissions",
  [MODES.FULL_ACCESS]: "Full access",
});

export const MODE_STATUS_LABELS: Readonly<Partial<Record<PermissionMode, string>>> = Object.freeze({
  [MODES.FULL_ACCESS]: "full access",
});

export const APPROVAL_CHOICES = Object.freeze({
  ALLOW_ONCE: "Allow once",
  ALLOW_THIS_SESSION: "Allow this session",
  DENY: "Deny",
  DENY_WITH_NOTE: "Deny with note",
  CANCEL: "Cancel",
});

export const FULL_ACCESS_CONFIRM_CHOICES = Object.freeze({
  CONTINUE: "Yes, continue anyway",
  CANCEL: "Cancel",
});

const MCP_TOOL_NAME_PATTERN = /^mcp__(.+)__([^_].*)$/;
const READ_ONLY_BUILTIN_TOOLS = new Set(["read", "grep", "find", "ls"]);
const ORCHESTRATION_TOOLS = new Set([
  "spawn_agent",
  "check_subagent",
  "wait_agent",
  "send_input",
  "close_agent",
  "subagent_spawn",
  "subagent_resume",
  "subagent_prompt",
  "subagent_list",
  "subagent_read",
  "subagent_wait",
  "subagent_close",
  "subagent_forget",
]);
const MAX_SESSION_ALLOW_ENTRIES = 512;
const MAX_DIGEST_NODES = 10_000;

/** Minimal tool call shape consumed by the permissions policy. */
export interface PermissionToolCall {
  toolName: string;
  input?: Record<string, unknown>;
}

interface PermissionUi {
  select(title: string, options: string[]): Promise<string | undefined>;
  editor(title: string, initialValue?: string): Promise<string | undefined>;
}

/** Minimal Pi context shape consumed by the permissions policy. */
export interface PermissionContext {
  hasUI: boolean;
  cwd?: string;
  env?: Record<string, string | undefined>;
  abort?: () => void;
  ui: PermissionUi;
}

/** Process-local permission mode and bounded session grants. */
export interface PermissionState {
  getMode(): PermissionMode;
  setMode(mode: PermissionMode): void;
  isSessionAllowed(key: string): boolean;
  allowForSession(key: string): void;
}

/**
 * Creates permission state for one Pi process. Session grants are never persisted.
 *
 * @param options - Initial mode or environment override.
 * @returns Mutable process-local permission state.
 */
export function createPermissionState(options: {
  initialMode?: string;
  env?: Record<string, string | undefined>;
} = {}): PermissionState {
  let mode = normalizeMode(
    options.initialMode ?? options.env?.PI_PERMISSIONS_MODE ?? MODES.FULL_ACCESS,
  );
  const sessionAllowList = new Set<string>();

  return {
    getMode: () => mode,
    setMode(nextMode) {
      if (!Object.values(MODES).includes(nextMode)) {
        throw new Error(`Unknown permissions mode: ${nextMode}`);
      }
      mode = nextMode;
    },
    isSessionAllowed: (key) => sessionAllowList.has(key),
    allowForSession(key) {
      if (sessionAllowList.has(key)) return;
      if (sessionAllowList.size >= MAX_SESSION_ALLOW_ENTRIES) {
        const oldestKey = sessionAllowList.values().next().value;
        if (oldestKey !== undefined) sessionAllowList.delete(oldestKey);
      }
      sessionAllowList.add(key);
    },
  };
}

function normalizeMode(value: string): PermissionMode {
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "default" || normalized === "default-permissions") {
    return MODES.DEFAULT;
  }
  if (normalized === "full" || normalized === "full-access") {
    return MODES.FULL_ACCESS;
  }
  throw new Error(`Unknown permissions mode: ${value}`);
}

/**
 * Computes the bounded session-grant key for a tool call.
 *
 * @param event - Tool name and validated input.
 * @param ctx - Current working directory, when available.
 * @returns Stable grant key scoped to the risky operation.
 */
export function sessionAllowKey(
  event: PermissionToolCall,
  ctx: Pick<PermissionContext, "cwd"> = {},
): string {
  const input = event.input ?? {};
  const mcpMatch = event.toolName.match(MCP_TOOL_NAME_PATTERN);
  if (mcpMatch) {
    return `mcp:${mcpMatch[1]}|tool:${mcpMatch[2]}`;
  }

  if (event.toolName === "bash" && typeof input.command === "string") {
    return `tool:bash|cwd:${normalizeCwd(ctx.cwd)}|command-sha256:${digestText(input.command)}`;
  }

  if ((event.toolName === "write" || event.toolName === "edit") && typeof input.path === "string") {
    return `tool:${event.toolName}|path:${normalizeToolPath(input.path, ctx.cwd)}`;
  }

  return `tool:${event.toolName}|input-sha256:${stableInputDigest(input)}`;
}

/** Returns whether Default permissions requires approval for the tool. */
export function requiresApproval(event: Pick<PermissionToolCall, "toolName">): boolean {
  return !READ_ONLY_BUILTIN_TOOLS.has(event.toolName)
    && !ORCHESTRATION_TOOLS.has(event.toolName);
}

/** Parses the optional `/permissions` mode argument. */
export function parseModeArg(args: string): PermissionMode | undefined {
  const value = args.trim().toLowerCase();
  if (value === "default" || value === "default permissions") return MODES.DEFAULT;
  if (value === "full" || value === "full access") return MODES.FULL_ACCESS;
  return undefined;
}

/**
 * Changes permission mode. Entering Full access always requires interactive confirmation.
 */
export async function applyModeChange(
  state: PermissionState,
  nextMode: PermissionMode,
  ctx: Pick<PermissionContext, "hasUI" | "ui">,
): Promise<{ changed: boolean; reason?: string }> {
  if (state.getMode() === nextMode) return { changed: false };

  if (nextMode === MODES.FULL_ACCESS) {
    if (!ctx.hasUI) {
      return { changed: false, reason: "Full access requires interactive confirmation." };
    }

    const choice = await ctx.ui.select(formatFullAccessConfirmationPrompt(), [
      FULL_ACCESS_CONFIRM_CHOICES.CONTINUE,
      FULL_ACCESS_CONFIRM_CHOICES.CANCEL,
    ]);
    if (choice !== FULL_ACCESS_CONFIRM_CHOICES.CONTINUE) return { changed: false };
  }

  state.setMode(nextMode);
  return { changed: true };
}

/** Applies the current permission policy to one Pi `tool_call` event. */
export async function handleToolCall(
  event: PermissionToolCall,
  ctx: PermissionContext,
  state: PermissionState,
): Promise<ToolCallEventResult | undefined> {
  if (state.getMode() === MODES.FULL_ACCESS || !requiresApproval(event)) return undefined;

  const allowKey = sessionAllowKey(event, ctx);
  if (state.isSessionAllowed(allowKey)) return undefined;

  if (!ctx.hasUI) {
    return {
      block: true,
      reason: `Default permissions requires approval for ${event.toolName}, but no UI is available.`,
    };
  }

  const choice = await ctx.ui.select(formatApprovalPrompt(event, ctx.cwd, ctx), [
    APPROVAL_CHOICES.ALLOW_ONCE,
    APPROVAL_CHOICES.ALLOW_THIS_SESSION,
    APPROVAL_CHOICES.DENY,
    APPROVAL_CHOICES.DENY_WITH_NOTE,
    APPROVAL_CHOICES.CANCEL,
  ]);

  if (choice === APPROVAL_CHOICES.ALLOW_ONCE) return undefined;
  if (choice === APPROVAL_CHOICES.ALLOW_THIS_SESSION) {
    state.allowForSession(allowKey);
    return undefined;
  }

  if (choice === APPROVAL_CHOICES.DENY_WITH_NOTE) {
    const note = await ctx.ui.editor("Add guidance for Pi", "");
    const trimmedNote = note?.trim();
    return {
      block: true,
      reason: trimmedNote
        ? `Tool call denied by user. User guidance: ${trimmedNote}`
        : "Blocked by user",
    };
  }

  if (choice === APPROVAL_CHOICES.CANCEL) {
    ctx.abort?.();
    return { block: true, reason: "Cancelled by user" };
  }

  return { block: true, reason: "Blocked by user" };
}

/** Builds a bounded approval summary for the interactive prompt. */
export function formatApprovalPrompt(
  event: PermissionToolCall,
  cwd?: string,
  options: Pick<PermissionContext, "env"> = {},
): string {
  const lines = [`Allow Pi to run ${event.toolName}?`];
  if (cwd) lines.push(`cwd: ${cwd}`);

  const subagentId = options.env?.PI_SUBAGENT_ID ?? process.env.PI_SUBAGENT_ID;
  if (subagentId) lines.push(`subagent: ${subagentId}`);

  const summary = summarizeInput(event);
  if (summary) lines.push("", summary);
  lines.push("", formatSessionAllowScopeHint(event, subagentId));
  return lines.join("\n");
}

/** Returns the warning shown before enabling Full access. */
export function formatFullAccessConfirmationPrompt(): string {
  return [
    "Enable Full access?",
    "",
    "Pi will run tools without asking for approval. This can edit files and invoke MCP tools freely.",
    "Use this only when you trust the current task and workspace.",
  ].join("\n");
}

/** Returns the plain footer status for a permission mode. */
export function formatStatusText(mode: PermissionMode): string | undefined {
  return MODE_STATUS_LABELS[mode];
}

/** Returns a theme-aware, low-noise footer status for a permission mode. */
export function formatStatusTextForTheme(
  mode: PermissionMode,
  theme?: { fg?: (color: ThemeColor, text: string) => string },
): string | undefined {
  const text = formatStatusText(mode);
  if (text === undefined) return undefined;

  const plainText = `· ${text}`;
  return theme?.fg ? theme.fg("dim", plainText) : plainText;
}

function summarizeInput(event: PermissionToolCall): string {
  const input = event.input ?? {};
  if (event.toolName === "bash" && typeof input.command === "string") {
    return truncate(`command: ${input.command}`);
  }
  if ((event.toolName === "write" || event.toolName === "edit") && typeof input.path === "string") {
    return truncate(`path: ${input.path}`);
  }
  return truncate(`input: ${safeJsonStringify(input)}`);
}

function truncate(value: string, maxLength = 1_200): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}\n... truncated ...`;
}

function normalizeCwd(cwd?: string): string {
  return cwd ? normalizeToolPath(".", cwd) : "<unknown>";
}

function normalizeToolPath(value: string, cwd?: string): string {
  const pathApi = selectPathApi(value, cwd);
  const base = cwd && pathApi.isAbsolute(cwd) ? cwd : pathApi.resolve(pathApi.sep, cwd ?? ".");
  const normalized = pathApi.resolve(base, value).replaceAll("\\", "/");
  return normalized.replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);
}

function selectPathApi(value: string, cwd?: string): PlatformPath {
  return hasWindowsAbsoluteSyntax(value) || (cwd !== undefined && hasWindowsAbsoluteSyntax(cwd))
    ? win32
    : posix;
}

function hasWindowsAbsoluteSyntax(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^(?:\\\\|\/\/)[^\\/]/.test(value);
}

function stableInputDigest(value: unknown): string {
  const hash = createHash("sha256");
  const seen = new WeakSet<object>();
  let visitedNodes = 0;

  const visit = (item: unknown): void => {
    visitedNodes += 1;
    if (visitedNodes > MAX_DIGEST_NODES) {
      hash.update("[node-limit]");
      return;
    }
    if (item === null || typeof item !== "object") {
      hash.update(`${typeof item}:${String(item)};`);
      return;
    }
    if (seen.has(item)) {
      hash.update("[circular]");
      return;
    }

    seen.add(item);
    if (Array.isArray(item)) {
      hash.update("[");
      for (const entry of item) {
        if (visitedNodes >= MAX_DIGEST_NODES) break;
        visit(entry);
      }
      hash.update("]");
    } else {
      hash.update("{");
      for (const key of Object.keys(item).sort()) {
        if (visitedNodes >= MAX_DIGEST_NODES) break;
        hash.update(`${key}:`);
        visit((item as Record<string, unknown>)[key]);
      }
      hash.update("}");
    }
    seen.delete(item);
  };

  visit(value);
  return hash.digest("hex");
}

function digestText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString();
    if (typeof item !== "object" || item === null) return item;
    if (seen.has(item)) return "[circular]";
    seen.add(item);
    return item;
  }) ?? "undefined";
}

function formatSessionAllowScopeHint(event: PermissionToolCall, subagentId?: string): string {
  const processScope = subagentId ? `subagent ${subagentId}` : "this Pi process";
  if (event.toolName === "bash") {
    return `Allow this session applies only to the exact bash command in ${processScope} and only this Pi process.`;
  }
  if (event.toolName === "write" || event.toolName === "edit") {
    return `Allow this session applies only to this ${event.toolName} target path in ${processScope} and only this Pi process.`;
  }

  const mcpMatch = event.toolName.match(MCP_TOOL_NAME_PATTERN);
  if (mcpMatch) {
    return `Allow this session applies only to MCP ${mcpMatch[1]}/${mcpMatch[2]} in ${processScope} and only this Pi process.`;
  }
  return `Allow this session applies only to this permission policy key in ${processScope} and only this Pi process.`;
}
