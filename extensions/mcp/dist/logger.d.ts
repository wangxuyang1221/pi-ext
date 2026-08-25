/** Supported structured log levels. */
export type LogLevel = "info" | "warn" | "error";
/** Additional structured context attached to a log event. */
export type LogContext = Record<string, unknown>;
/**
 * Writes one structured MCP extension log event.
 *
 * @param level - Severity used by the console sink.
 * @param message - Stable event description.
 * @param context - JSON-safe diagnostic fields.
 * @param error - Optional error whose name, message, and stack are preserved.
 */
export declare function logEvent(level: LogLevel, message: string, context?: LogContext, error?: unknown): void;
//# sourceMappingURL=logger.d.ts.map