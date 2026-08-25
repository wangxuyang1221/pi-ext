import type { ThemeColor, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
export declare const MODES: {
    readonly DEFAULT: "default";
    readonly FULL_ACCESS: "full-access";
};
export type PermissionMode = (typeof MODES)[keyof typeof MODES];
export declare const MODE_LABELS: Readonly<Record<PermissionMode, string>>;
export declare const MODE_STATUS_LABELS: Readonly<Partial<Record<PermissionMode, string>>>;
export declare const APPROVAL_CHOICES: Readonly<{
    ALLOW_ONCE: "Allow once";
    ALLOW_THIS_SESSION: "Allow this session";
    DENY: "Deny";
    DENY_WITH_NOTE: "Deny with note";
    CANCEL: "Cancel";
}>;
export declare const FULL_ACCESS_CONFIRM_CHOICES: Readonly<{
    CONTINUE: "Yes, continue anyway";
    CANCEL: "Cancel";
}>;
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
export declare function createPermissionState(options?: {
    initialMode?: string;
    env?: Record<string, string | undefined>;
}): PermissionState;
/**
 * Computes the bounded session-grant key for a tool call.
 *
 * @param event - Tool name and validated input.
 * @param ctx - Current working directory, when available.
 * @returns Stable grant key scoped to the risky operation.
 */
export declare function sessionAllowKey(event: PermissionToolCall, ctx?: Pick<PermissionContext, "cwd">): string;
/** Returns whether Default permissions requires approval for the tool. */
export declare function requiresApproval(event: Pick<PermissionToolCall, "toolName">): boolean;
/** Parses the optional `/permissions` mode argument. */
export declare function parseModeArg(args: string): PermissionMode | undefined;
/**
 * Changes permission mode. Entering Full access always requires interactive confirmation.
 */
export declare function applyModeChange(state: PermissionState, nextMode: PermissionMode, ctx: Pick<PermissionContext, "hasUI" | "ui">): Promise<{
    changed: boolean;
    reason?: string;
}>;
/** Applies the current permission policy to one Pi `tool_call` event. */
export declare function handleToolCall(event: PermissionToolCall, ctx: PermissionContext, state: PermissionState): Promise<ToolCallEventResult | undefined>;
/** Builds a bounded approval summary for the interactive prompt. */
export declare function formatApprovalPrompt(event: PermissionToolCall, cwd?: string, options?: Pick<PermissionContext, "env">): string;
/** Returns the warning shown before enabling Full access. */
export declare function formatFullAccessConfirmationPrompt(): string;
/** Returns the plain footer status for a permission mode. */
export declare function formatStatusText(mode: PermissionMode): string | undefined;
/** Returns a theme-aware, low-noise footer status for a permission mode. */
export declare function formatStatusTextForTheme(mode: PermissionMode, theme?: {
    fg?: (color: ThemeColor, text: string) => string;
}): string | undefined;
export {};
//# sourceMappingURL=permission-policy.d.ts.map