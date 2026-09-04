import type { McpNormalizedError, McpRetryConfig } from "./types.js";
export declare const DEFAULT_MCP_RETRY_MAX_ATTEMPTS = 3;
export declare const DEFAULT_MCP_RETRY_BASE_DELAY_MS = 500;
export declare const DEFAULT_MCP_RETRY_FACTOR = 2;
export declare const DEFAULT_MCP_RETRY_MAX_DELAY_MS = 5000;
export declare const MAX_MCP_RETRY_AFTER_MS: number;
export declare const DEFAULT_MCP_BACKGROUND_MAX_DELAY_MS: number;
export interface ResolvedMcpRetryConfig {
    enabled: boolean;
    maxAttempts: number;
    baseDelayMs: number;
    factor: number;
    maxDelayMs: number;
    retryAfterMaxMs: number;
    background: boolean;
    backgroundMaxDelayMs: number;
}
export interface McpRetryScheduler {
    now(): number;
    sleep(delayMs: number, signal?: AbortSignal): Promise<void>;
}
export interface McpRetryDecisionOptions {
    deadlineMs?: number;
    nowMs?: number;
    random?: () => number;
}
export type McpRetryDecision = {
    retry: true;
    delayMs: number;
} | {
    retry: false;
    reason: "disabled" | "not-retryable" | "attempts-exhausted" | "deadline-exceeded";
};
export interface ScheduleMcpRetryOptions {
    scheduler?: McpRetryScheduler;
    signal?: AbortSignal;
    deadlineMs?: number;
}
export declare const DEFAULT_MCP_RETRY_CONFIG: Readonly<ResolvedMcpRetryConfig>;
/** Resolves partial retry configuration to finite, stable runtime values. */
export declare function parseMcpRetryConfig(config: McpRetryConfig | undefined): ResolvedMcpRetryConfig;
/** Returns whether another attempt is allowed for a normalized error. */
export declare function shouldRetryMcpError(error: McpNormalizedError, failedAttempt: number, config?: McpRetryConfig | ResolvedMcpRetryConfig): boolean;
/** Calculates full-jitter delay after a one-based failed attempt. */
export declare function calculateMcpRetryDelay(error: McpNormalizedError, failedAttempt: number, config?: McpRetryConfig | ResolvedMcpRetryConfig, random?: () => number): number;
/** Parses an HTTP Retry-After delay-seconds or HTTP-date value in milliseconds. */
export declare function parseHttpRetryAfter(value: string | null | undefined, nowMs?: number, maxDelayMs?: number): number | undefined;
/** Decides whether to retry and verifies that its delay fits the total deadline. */
export declare function decideMcpRetry(error: McpNormalizedError, failedAttempt: number, config?: McpRetryConfig | ResolvedMcpRetryConfig, options?: McpRetryDecisionOptions): McpRetryDecision;
/** Returns true when sleeping still leaves time for the next attempt. */
export declare function canRetryBeforeDeadline(delayMs: number, deadlineMs: number | undefined, nowMs?: number): boolean;
/** Sleeps for a retry only when the delay fits the remaining deadline. */
export declare function scheduleMcpRetry(delayMs: number, options?: ScheduleMcpRetryOptions): Promise<boolean>;
export declare const defaultMcpRetryScheduler: McpRetryScheduler;
//# sourceMappingURL=retry.d.ts.map