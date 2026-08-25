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
export function logEvent(
  level: LogLevel,
  message: string,
  context: LogContext = {},
  error?: unknown,
): void {
  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message,
    ...context,
  };

  if (error !== undefined) {
    payload.error = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) };
  }

  console[level](JSON.stringify(payload));
}
