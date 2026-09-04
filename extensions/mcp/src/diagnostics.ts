import { createHash } from "node:crypto";
import { appendFile, chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type {
  McpErrorCategory,
  McpFileLogConfig,
  McpNormalizedError,
} from "./types.js";

export const DEFAULT_DIAGNOSTIC_EVENTS = 100;
export const DEFAULT_DIAGNOSTIC_BYTES = 64 * 1024;
export const DEFAULT_STDERR_LINES = 100;
export const DEFAULT_STDERR_BYTES = 64 * 1024;
export const DEFAULT_FIELD_BYTES = 4 * 1024;
export const DEFAULT_USER_MESSAGE_WIDTH = 300;
export const DEFAULT_FILE_LOG_BYTES = 1024 * 1024;
export const DEFAULT_DIAGNOSTIC_CLOSE_TIMEOUT_MS = 1_000;
export const MIN_DIAGNOSTIC_BUFFER_BYTES = 512;

export type McpDiagnosticLevel = "debug" | "info" | "warn" | "error";

export interface McpDiagnosticEvent {
  timestamp: string;
  timestampMs: number;
  serverName: string;
  level: McpDiagnosticLevel;
  message: string;
  context: Record<string, unknown>;
  error?: McpNormalizedError;
  fingerprint: string;
  repeats: number;
  lastSeenAt: number;
}

export interface McpDiagnosticRecord {
  level: McpDiagnosticLevel;
  message: string;
  serverName?: string;
  context?: Record<string, unknown>;
  error?: unknown;
  normalizedError?: McpNormalizedError;
}

export interface McpDiagnosticsFileSystem {
  appendFile(path: string, data: string, options: { encoding: "utf8"; mode: number }): Promise<unknown>;
  chmod(path: string, mode: number): Promise<unknown>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  rename(oldPath: string, newPath: string): Promise<unknown>;
  rm(path: string, options: { force: true }): Promise<unknown>;
  stat(path: string): Promise<{ size: number }>;
}

export interface McpDiagnosticsOptions {
  now?: () => number;
  eventLimit?: number;
  byteLimit?: number;
  stderrLineLimit?: number;
  stderrByteLimit?: number;
  fieldByteLimit?: number;
  dedupeWindowMs?: number;
  file?: McpFileLogConfig;
  fileSystem?: Partial<McpDiagnosticsFileSystem>;
}

export interface McpDiagnosticsCloseOptions {
  timeoutMs?: number;
}

export interface NormalizeMcpErrorOptions {
  timeoutMs?: number;
  deadlineExceeded?: boolean;
  signalAborted?: boolean;
  httpStatus?: number;
  retryAfterMs?: number;
  responseDetail?: string;
  responseTruncated?: boolean;
  responseOriginalBytes?: number;
  sessionExpired?: boolean;
}

interface ServerBuffer {
  events: McpDiagnosticEvent[];
  eventBytes: number;
  stderr: string[];
  stderrBytes: number;
}

interface FileSinkState {
  enabled: boolean;
  path?: string;
  maxBytes: number;
  failed?: string;
}

const INTERNAL_HTTP_OBSERVATION_PATTERN = /__PI_MCP_HTTP_OBSERVATION_[0-9]+__(?:\r?\n)?/g;
const SENSITIVE_KEY = /(?:^|[-_.])(?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|token|access[-_]?token|refresh[-_]?token|password|passwd|secret|client[-_]?secret|private[-_]?key)(?:$|[-_.])/i;
const SENSITIVE_CONTAINER_KEY = /^(?:env|headers)$/i;
const TEMPORARY_DNS_CODES = new Set(["EAI_AGAIN", "ENOTFOUND"]);
const CONNECTION_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_SSL_PROTOCOL_ERROR",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);
const AUTH_STATUSES = new Set([401, 403]);
const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_FILE_SYSTEM: McpDiagnosticsFileSystem = {
  appendFile,
  chmod,
  mkdir,
  rename,
  rm,
  stat,
};

export class McpDiagnostics {
  private readonly now: () => number;
  private readonly eventLimit: number;
  private readonly byteLimit: number;
  private readonly stderrLineLimit: number;
  private readonly stderrByteLimit: number;
  private readonly fieldByteLimit: number;
  private readonly dedupeWindowMs: number;
  private readonly fileSystem: McpDiagnosticsFileSystem;
  private readonly buffers = new Map<string, ServerBuffer>();
  private fileSink: FileSinkState = {
    enabled: false,
    maxBytes: DEFAULT_FILE_LOG_BYTES,
  };
  private fileQueue: Promise<void> = Promise.resolve();
  private fileSinkGeneration = 0;
  private acceptingFileWrites = true;
  private recordingFileFailure = false;

  constructor(options: McpDiagnosticsOptions = {}) {
    this.now = options.now ?? Date.now;
    this.eventLimit = positiveInteger(options.eventLimit, DEFAULT_DIAGNOSTIC_EVENTS);
    this.byteLimit = Math.max(
      MIN_DIAGNOSTIC_BUFFER_BYTES,
      positiveInteger(options.byteLimit, DEFAULT_DIAGNOSTIC_BYTES),
    );
    this.stderrLineLimit = positiveInteger(options.stderrLineLimit, DEFAULT_STDERR_LINES);
    this.stderrByteLimit = positiveInteger(options.stderrByteLimit, DEFAULT_STDERR_BYTES);
    this.fieldByteLimit = positiveInteger(options.fieldByteLimit, DEFAULT_FIELD_BYTES);
    this.dedupeWindowMs = positiveInteger(options.dedupeWindowMs, 5_000);
    this.fileSystem = { ...DEFAULT_FILE_SYSTEM, ...options.fileSystem };
    if (options.file) this.configureFileSink(options.file);
  }

  configureFileSink(config: McpFileLogConfig | undefined): void {
    try {
      this.fileSinkGeneration += 1;
      this.acceptingFileWrites = true;
      this.fileSink = {
        enabled: config?.enabled === true && typeof config.path === "string" && config.path.trim() !== "",
        path: typeof config?.path === "string" ? config.path : undefined,
        maxBytes: positiveInteger(config?.maxBytes, DEFAULT_FILE_LOG_BYTES),
      };
      if (config?.enabled === true && !this.fileSink.path) {
        this.fileSink.failed = "File logging requires a path";
      }
    } catch {
      this.fileSink = { enabled: false, maxBytes: DEFAULT_FILE_LOG_BYTES, failed: "Invalid file log configuration" };
    }
  }

  record(input: McpDiagnosticRecord): { event: McpDiagnosticEvent; duplicate: boolean } {
    try {
      const timestampMs = this.now();
      const serverName = cleanIdentifier(input.serverName ?? "global");
      const normalizedError = input.normalizedError ??
        (input.error === undefined ? undefined : normalizeMcpError(input.error));
      const message = truncateUtf8(
        redactString(sanitizeControls(input.message)),
        this.fieldByteLimit,
      ).value;
      const context = sanitizeValue(input.context ?? {}, this.fieldByteLimit) as Record<string, unknown>;
      const safeError = normalizedError ? sanitizeNormalizedError(normalizedError, this.fieldByteLimit) : undefined;
      const fingerprint = eventFingerprint(serverName, input.level, message, safeError);
      const buffer = this.getBuffer(serverName);
      const previous = buffer.events.at(-1);

      if (
        previous?.fingerprint === fingerprint &&
        timestampMs - previous.lastSeenAt <= this.dedupeWindowMs
      ) {
        previous.repeats += 1;
        previous.lastSeenAt = timestampMs;
        const boundedPrevious = fitDiagnosticEventToBytes(previous, this.byteLimit);
        buffer.events[buffer.events.length - 1] = boundedPrevious;
        this.recalculateEventBytes(buffer);
        return { event: cloneEvent(boundedPrevious), duplicate: true };
      }

      const event = fitDiagnosticEventToBytes({
        timestamp: new Date(timestampMs).toISOString(),
        timestampMs,
        serverName,
        level: input.level,
        message,
        context,
        ...(safeError ? { error: safeError } : {}),
        fingerprint,
        repeats: 1,
        lastSeenAt: timestampMs,
      }, this.byteLimit);
      buffer.events.push(event);
      buffer.eventBytes += serializedBytes(event);
      this.trimEvents(buffer);
      this.enqueueFileWrite(event);
      return { event: cloneEvent(event), duplicate: false };
    } catch {
      const fallback: McpDiagnosticEvent = {
        timestamp: new Date(0).toISOString(),
        timestampMs: 0,
        serverName: "global",
        level: "error",
        message: "Diagnostic event could not be recorded",
        context: {},
        fingerprint: "diagnostic-fallback",
        repeats: 1,
        lastSeenAt: 0,
      };
      return { event: fallback, duplicate: false };
    }
  }

  recordStderr(serverName: string, line: string): void {
    try {
      const safeLine = truncateUtf8(
        redactString(sanitizeControls(line)).replace(/[\r\n]+/g, " "),
        this.fieldByteLimit,
      ).value;
      if (!safeLine) return;
      const buffer = this.getBuffer(cleanIdentifier(serverName));
      buffer.stderr.push(safeLine);
      buffer.stderrBytes += Buffer.byteLength(safeLine, "utf8");
      while (
        buffer.stderr.length > this.stderrLineLimit ||
        buffer.stderrBytes > this.stderrByteLimit
      ) {
        const removed = buffer.stderr.shift();
        if (removed !== undefined) {
          buffer.stderrBytes -= Buffer.byteLength(removed, "utf8");
        }
      }
    } catch {
      // Diagnostics must never affect the transport path.
    }
  }

  getEvents(serverName?: string): McpDiagnosticEvent[] {
    try {
      if (serverName !== undefined) {
        return (this.buffers.get(cleanIdentifier(serverName))?.events ?? []).map(cloneEvent);
      }
      return [...this.buffers.values()]
        .flatMap((buffer) => buffer.events)
        .sort((left, right) => left.timestampMs - right.timestampMs)
        .map(cloneEvent);
    } catch {
      return [];
    }
  }

  getStderr(serverName: string): string[] {
    try {
      return [...(this.buffers.get(cleanIdentifier(serverName))?.stderr ?? [])];
    } catch {
      return [];
    }
  }

  getStderrTail(serverName: string, count = 5): string[] {
    const safeCount = positiveInteger(count, 5);
    return this.getStderr(serverName).slice(-safeCount);
  }

  clear(serverName?: string): void {
    try {
      if (serverName === undefined) this.buffers.clear();
      else this.buffers.delete(cleanIdentifier(serverName));
    } catch {
      // Clearing diagnostics is best effort.
    }
  }

  getFileSinkStatus(): Readonly<FileSinkState> {
    return { ...this.fileSink };
  }

  async flush(): Promise<void> {
    try {
      await this.fileQueue;
    } catch {
      // A failed sink is already disabled and reported in memory.
    }
  }

  async close(options: McpDiagnosticsCloseOptions = {}): Promise<void> {
    try {
      this.acceptingFileWrites = false;
      const timeoutMs = nonNegativeInteger(
        options.timeoutMs,
        DEFAULT_DIAGNOSTIC_CLOSE_TIMEOUT_MS,
      );
      const completed = await settleWithin(this.fileQueue, timeoutMs);
      if (!completed && !this.fileSink.failed) {
        this.fileSink.failed = `Diagnostic file flush exceeded ${timeoutMs}ms`;
      }
    } catch {
      // Closing diagnostics must never affect extension shutdown.
    } finally {
      this.fileSink.enabled = false;
    }
  }

  private getBuffer(serverName: string): ServerBuffer {
    const existing = this.buffers.get(serverName);
    if (existing) return existing;
    const created: ServerBuffer = { events: [], eventBytes: 0, stderr: [], stderrBytes: 0 };
    this.buffers.set(serverName, created);
    return created;
  }

  private trimEvents(buffer: ServerBuffer): void {
    while (buffer.events.length > this.eventLimit || buffer.eventBytes > this.byteLimit) {
      const removed = buffer.events.shift();
      if (removed) buffer.eventBytes -= serializedBytes(removed);
    }
  }

  private recalculateEventBytes(buffer: ServerBuffer): void {
    buffer.eventBytes = buffer.events.reduce((total, event) => total + serializedBytes(event), 0);
    this.trimEvents(buffer);
  }

  private enqueueFileWrite(event: McpDiagnosticEvent): void {
    if (
      !this.acceptingFileWrites ||
      this.recordingFileFailure ||
      !this.fileSink.enabled ||
      !this.fileSink.path
    ) return;

    const sink = { ...this.fileSink };
    const generation = this.fileSinkGeneration;
    const line = serializeBoundedFileEvent(event, sink.maxBytes);
    if (!line) return;

    this.fileQueue = this.fileQueue
      .then(async () => {
        if (
          !this.fileSink.enabled ||
          this.fileSink.path !== sink.path ||
          this.fileSinkGeneration !== generation
        ) return;

        const path = sink.path!;
        const backupPath = `${path}.1`;
        await this.fileSystem.mkdir(dirname(path), { recursive: true });

        let currentBytes = 0;
        try {
          currentBytes = (await this.fileSystem.stat(path)).size;
          await this.bestEffortChmod(path);
        } catch {
          currentBytes = 0;
        }

        if (currentBytes > sink.maxBytes) {
          await this.fileSystem.rm(path, { force: true });
          currentBytes = 0;
        } else if (currentBytes > 0 && currentBytes + Buffer.byteLength(line, "utf8") > sink.maxBytes) {
          await this.fileSystem.rm(backupPath, { force: true });
          await this.fileSystem.rename(path, backupPath);
          await this.bestEffortChmod(backupPath);
          currentBytes = 0;
        }

        if (currentBytes + Buffer.byteLength(line, "utf8") <= sink.maxBytes) {
          await this.fileSystem.appendFile(path, line, { encoding: "utf8", mode: 0o600 });
          await this.bestEffortChmod(path);
        }
      })
      .catch((error: unknown) => {
        const reason = toBoundedMessage(error, this.fieldByteLimit);
        if (this.fileSinkGeneration === generation) {
          this.fileSink.enabled = false;
          this.fileSink.failed = reason;
        }
        if (this.recordingFileFailure) return;
        this.recordingFileFailure = true;
        try {
          this.record({
            level: "error",
            message: "MCP diagnostic file logging disabled after a write failure",
            context: { reason },
          });
        } finally {
          this.recordingFileFailure = false;
        }
      });
  }

  private async bestEffortChmod(path: string): Promise<void> {
    try {
      await this.fileSystem.chmod(path, 0o600);
    } catch {
      // File permissions are tightened when supported by the host filesystem.
    }
  }
}

export function normalizeMcpError(
  error: unknown,
  options: NormalizeMcpErrorOptions = {},
): McpNormalizedError {
  try {
    const causes = collectCauseChain(error);
    const root = causes[0];
    const sourceMessage = options.responseDetail ?? root?.message ?? safeString(error);
    const originalBytes = options.responseOriginalBytes ?? Buffer.byteLength(sourceMessage, "utf8");
    const codes = causes.flatMap((cause) => cause.code === undefined ? [] : [cause.code]);
    const primaryCode = codes[0];
    const httpStatus = options.httpStatus ?? findHttpStatus(error, sourceMessage, codes);
    const lower = sourceMessage.toLowerCase();
    let category: McpErrorCategory = "unknown";
    let retryable = false;

    if (options.deadlineExceeded) {
      category = "timeout";
      retryable = true;
    } else if (options.signalAborted || root?.name === "AbortError" || lower.includes("aborted")) {
      category = "cancelled";
    } else if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
      category = "timeout";
      retryable = true;
    } else if (error instanceof McpError && error.code === ErrorCode.ConnectionClosed) {
      category = "connection";
      retryable = true;
    } else if (options.sessionExpired) {
      category = "session-expired";
      retryable = true;
    } else if (httpStatus !== undefined && AUTH_STATUSES.has(httpStatus)) {
      category = "auth";
    } else if (httpStatus === 429) {
      category = "rate-limit";
      retryable = true;
    } else if (httpStatus !== undefined && isTransientHttpStatus(httpStatus)) {
      category = "http-transient";
      retryable = true;
    } else if (codes.some((code) => TEMPORARY_DNS_CODES.has(String(code).toUpperCase()))) {
      category = "dns";
      retryable = true;
    } else if (codes.some((code) => CONNECTION_CODES.has(String(code).toUpperCase()))) {
      category = "connection";
      retryable = true;
    } else if (codes.some((code) => TLS_CODES.has(String(code).toUpperCase()))) {
      category = "connection";
    } else if (primaryCode === -1 && /content[- ]type|protocol|response/.test(lower)) {
      category = "protocol";
    } else if (/session(?: id)? (?:expired|not found|invalid)|session.*404/.test(lower)) {
      category = "session-expired";
      retryable = true;
    } else if (/timed? out|timeout/.test(lower)) {
      category = "timeout";
      retryable = true;
    } else if (/fetch failed|not connected|connection closed|transport closed|broken pipe|socket hang up|connection reset|maximum reconnection attempts(?:\s*\([^)]*\))? exceeded/.test(lower)) {
      category = "connection";
      retryable = true;
    } else if (/unauthorized|forbidden|authentication|invalid token/.test(lower)) {
      category = "auth";
    } else if (isConfigError(error, lower, primaryCode)) {
      category = "config";
    } else if (error instanceof McpError) {
      category = error.code === ErrorCode.ParseError || error.code === ErrorCode.InvalidRequest || error.code === ErrorCode.InvalidParams
        ? "protocol"
        : "server";
    } else if (/protocol|invalid initialize|invalid json|parse error/.test(lower)) {
      category = "protocol";
    }

    const detailSource = options.responseDetail ?? sourceMessage;
    const detail = truncateUtf8(
      redactString(sanitizeControls(summarizeHtml(detailSource, httpStatus))),
      DEFAULT_FIELD_BYTES,
    );
    const message = buildUserMessage(category, detail.value, httpStatus, primaryCode);

    return {
      category,
      message,
      retryable,
      ...(primaryCode !== undefined ? { code: primaryCode } : {}),
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      ...(options.retryAfterMs !== undefined ? { retryAfterMs: options.retryAfterMs } : {}),
      ...(detail.value ? { detail: detail.value } : {}),
      ...(causes.length > 0 ? { causeChain: causes.map((cause) => ({
        ...cause,
        message: truncateUtf8(redactString(sanitizeControls(cause.message)), DEFAULT_FIELD_BYTES).value,
      })) } : {}),
      ...((options.responseTruncated || detail.truncated || originalBytes > DEFAULT_FIELD_BYTES)
        ? { truncated: true, originalBytes }
        : {}),
    };
  } catch {
    return {
      category: "unknown",
      message: "Unknown MCP error",
      retryable: false,
    };
  }
}

export function sanitizeDiagnosticValue(value: unknown, maxBytes = DEFAULT_FIELD_BYTES): unknown {
  try {
    return sanitizeValue(value, positiveInteger(maxBytes, DEFAULT_FIELD_BYTES));
  } catch {
    return "[unavailable]";
  }
}

export function sanitizeDiagnosticText(value: string, maxBytes = DEFAULT_FIELD_BYTES): string {
  try {
    return truncateUtf8(
      redactString(sanitizeControls(value)),
      positiveInteger(maxBytes, DEFAULT_FIELD_BYTES),
    ).value;
  } catch {
    return "[unavailable]";
  }
}

export function summarizeHtml(value: string, httpStatus?: number): string {
  if (!/<(?:!doctype\s+html|html|head|body|title)\b/i.test(value)) return value;
  const titleMatch = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const readableText = decodeBasicHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  const rayMatch = readableText.match(/(?:cloudflare\s+ray\s+id|ray\s+id)\s*[:#]?\s*([a-z0-9-]{6,64})/i);
  const title = titleMatch
    ? decodeBasicHtml(titleMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    : "HTML error response";
  const prefix = httpStatus === undefined ? "HTTP error" : `HTTP ${httpStatus}`;
  return rayMatch
    ? `${prefix}: ${title} (Cloudflare Ray ID ${rayMatch[1]})`
    : `${prefix}: ${title}`;
}

export function truncateUtf8(
  value: string,
  maxBytes: number,
): { value: string; truncated: boolean; originalBytes: number } {
  const limit = Math.max(1, Math.floor(maxBytes));
  const originalBytes = Buffer.byteLength(value, "utf8");
  if (originalBytes <= limit) return { value, truncated: false, originalBytes };
  const suffix = `… [truncated; originalBytes=${originalBytes}]`;
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const decoration = suffixBytes <= limit ? suffix : "";
  const target = Math.max(0, limit - Buffer.byteLength(decoration, "utf8"));
  let output = "";
  let bytes = 0;
  for (const character of value) {
    const nextBytes = Buffer.byteLength(character, "utf8");
    if (bytes + nextBytes > target) break;
    output += character;
    bytes += nextBytes;
  }
  return {
    value: `${output}${decoration}`,
    truncated: true,
    originalBytes,
  };
}

function sanitizeValue(value: unknown, maxBytes: number, depth = 0, seen = new WeakSet<object>(), key?: string): unknown {
  if (key && SENSITIVE_CONTAINER_KEY.test(key)) return sanitizeSensitiveContainer(value);
  if (key && SENSITIVE_KEY.test(key)) return "[redacted]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return truncateUtf8(redactString(sanitizeControls(value)), maxBytes).value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return undefined;
  if (typeof value !== "object") return truncateUtf8(safeString(value), maxBytes).value;
  if (depth >= 6) return "[depth-limited]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const output = value.slice(0, 50).map((item) => sanitizeValue(item, maxBytes, depth + 1, seen));
      if (value.length > 50) output.push(`[${value.length - 50} more items]`);
      return output;
    }
    const output: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [entryKey, entryValue] of entries.slice(0, 50)) {
      output[cleanIdentifier(entryKey)] = sanitizeValue(entryValue, maxBytes, depth + 1, seen, entryKey);
    }
    if (entries.length > 50) output.truncatedKeys = entries.length - 50;
    return output;
  } finally {
    seen.delete(value);
  }
}

function sanitizeNormalizedError(error: McpNormalizedError, maxBytes: number): McpNormalizedError {
  const value = sanitizeValue(error, maxBytes) as McpNormalizedError;
  value.message = truncatePlainVisible(
    String(value.message ?? "Unknown MCP error").replace(/\s+/g, " "),
    DEFAULT_USER_MESSAGE_WIDTH,
  );
  return value;
}

function sanitizeControls(value: string): string {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}

function redactString(value: string): string {
  let output = value.replace(INTERNAL_HTTP_OBSERVATION_PATTERN, "");
  output = output.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]");
  output = output.replace(/\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*[^\n]+/gi, "$1: [redacted]");
  output = output.replace(/([?&](?:api[-_]?key|token|access[-_]?token|refresh[-_]?token|password|passwd|secret|client[-_]?secret)=)[^&#\s]*/gi, "$1[redacted]");
  output = output.replace(/(["']?(?:api[-_]?key|token|access[-_]?token|refresh[-_]?token|password|passwd|secret|client[-_]?secret)["']?\s*[:=]\s*["']?)[^\s,"';&}]+/gi, "$1[redacted]");
  output = output.replace(/\b(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, "$1[redacted]:[redacted]@");
  return output;
}

function sanitizeSensitiveContainer(value: unknown): unknown {
  if (!isPlainObject(value)) return "[redacted]";
  const output: Record<string, string> = {};
  try {
    for (const key of Object.keys(value).slice(0, 50)) {
      output[cleanIdentifier(key)] = "[redacted]";
    }
    return output;
  } catch {
    return "[redacted]";
  }
}

function collectCauseChain(error: unknown): Array<{ name?: string; message: string; code?: string | number }> {
  const output: Array<{ name?: string; message: string; code?: string | number }> = [];
  const seen = new WeakSet<object>();
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current !== undefined && current !== null; depth++) {
    if (typeof current === "object") {
      if (seen.has(current)) break;
      seen.add(current);
    }
    const record = asRecord(current);
    const message = current instanceof Error ? current.message :
      typeof record?.message === "string" ? record.message : safeString(current);
    const name = current instanceof Error ? current.name :
      typeof record?.name === "string" ? record.name : undefined;
    const code = validCode(record?.code);
    output.push({ ...(name ? { name } : {}), message, ...(code !== undefined ? { code } : {}) });
    current = record?.cause;
  }
  return output;
}

function findHttpStatus(error: unknown, message: string, codes: Array<string | number>): number | undefined {
  const record = asRecord(error);
  const candidates = [record?.status, record?.statusCode, ...codes];
  for (const candidate of candidates) {
    const numeric = typeof candidate === "string" ? Number(candidate) : candidate;
    if (typeof numeric === "number" && Number.isInteger(numeric) && numeric >= 100 && numeric <= 599) {
      return numeric;
    }
  }
  const match = message.match(/(?:HTTP(?: status)?|Streamable HTTP error:|status(?: code)?)[^0-9]{0,20}([1-5][0-9]{2})/i);
  return match ? Number(match[1]) : undefined;
}

function isTransientHttpStatus(status: number): boolean {
  return TRANSIENT_HTTP_STATUSES.has(status) || (status >= 520 && status <= 527);
}

function isConfigError(error: unknown, lower: string, code: string | number | undefined): boolean {
  if (String(code).toUpperCase() === "ENOENT") return true;
  return error instanceof TypeError && /invalid url|failed to parse url/.test(lower) ||
    /invalid mcp server configuration|command is required|url is required/.test(lower);
}

function buildUserMessage(
  category: McpErrorCategory,
  detail: string,
  httpStatus?: number,
  code?: string | number,
): string {
  const safeDetail = truncatePlainVisible(detail.replace(/\s+/g, " ").trim(), 220);
  let prefix: string;
  switch (category) {
    case "cancelled": prefix = "Request cancelled"; break;
    case "timeout": prefix = "Connection timed out"; break;
    case "dns": prefix = "DNS lookup failed"; break;
    case "connection": prefix = "Connection failed"; break;
    case "auth": prefix = "Authentication failed"; break;
    case "rate-limit": prefix = "MCP server rate limited the request"; break;
    case "session-expired": prefix = "MCP session expired"; break;
    case "http-transient": prefix = "MCP server is temporarily unavailable"; break;
    case "protocol": prefix = "MCP protocol error"; break;
    case "config": prefix = "Invalid MCP configuration"; break;
    case "server": prefix = "MCP server error"; break;
    default: prefix = "MCP request failed";
  }
  const qualifiers = [
    httpStatus !== undefined ? `HTTP ${httpStatus}` : undefined,
    code !== undefined && !(typeof code === "number" && code === httpStatus) ? String(code) : undefined,
  ].filter((item): item is string => Boolean(item));
  const qualifier = qualifiers.length > 0 ? ` (${qualifiers.join(", ")})` : "";
  const withDetail = safeDetail && !safeDetail.toLowerCase().startsWith(prefix.toLowerCase())
    ? `${prefix}${qualifier}: ${safeDetail}`
    : `${prefix}${qualifier}`;
  return truncatePlainVisible(withDetail, DEFAULT_USER_MESSAGE_WIDTH);
}

function truncatePlainVisible(value: string, maxWidth: number): string {
  return sanitizeControls(truncateToWidth(sanitizeControls(value), maxWidth, "…"));
}

function eventFingerprint(
  serverName: string,
  level: McpDiagnosticLevel,
  message: string,
  error?: McpNormalizedError,
): string {
  return createHash("sha256")
    .update(JSON.stringify([serverName, level, message, error?.category, error?.code, error?.httpStatus, error?.message]))
    .digest("hex")
    .slice(0, 20);
}

function cloneEvent(event: McpDiagnosticEvent): McpDiagnosticEvent {
  try {
    return structuredClone(event);
  } catch {
    return { ...event, context: { ...event.context }, ...(event.error ? { error: { ...event.error } } : {}) };
  }
}

function fitDiagnosticEventToBytes(
  event: McpDiagnosticEvent,
  maxBytes: number,
): McpDiagnosticEvent {
  const originalBytes = serializedBytes(event);
  if (originalBytes <= maxBytes) return event;

  const compactError = event.error ? {
    category: event.error.category,
    message: truncateUtf8(event.error.message, 96).value,
    retryable: event.error.retryable,
    ...(event.error.code !== undefined ? { code: event.error.code } : {}),
    ...(event.error.httpStatus !== undefined ? { httpStatus: event.error.httpStatus } : {}),
    truncated: true,
    originalBytes: event.error.originalBytes ?? originalBytes,
  } satisfies McpNormalizedError : undefined;

  const base = {
    ...event,
    serverName: truncateUtf8(event.serverName, 64).value,
    message: truncateUtf8(event.message, 128).value,
    context: { truncated: true, originalBytes },
  };
  const candidates: McpDiagnosticEvent[] = [
    { ...base, ...(compactError ? { error: compactError } : {}) },
    { ...base, error: undefined },
    {
      ...base,
      message: "Diagnostic event truncated",
      context: { truncated: true, originalBytes },
      error: undefined,
    },
  ];

  return candidates.find((candidate) => serializedBytes(candidate) <= maxBytes) ?? candidates.at(-1)!;
}

function serializeBoundedFileEvent(event: McpDiagnosticEvent, maxBytes: number): string {
  const limit = positiveInteger(maxBytes, DEFAULT_FILE_LOG_BYTES);
  const serialized = JSON.stringify(event);
  const originalBytes = Buffer.byteLength(serialized, "utf8");
  const candidates: unknown[] = [
    event,
    {
      timestamp: event.timestamp,
      serverName: truncateUtf8(event.serverName, 48).value,
      level: event.level,
      message: truncateUtf8(event.message, 96).value,
      truncated: true,
      originalBytes,
    },
    { level: event.level, truncated: true, originalBytes },
    { truncated: true },
    {},
  ];
  for (const candidate of candidates) {
    const line = `${JSON.stringify(candidate)}\n`;
    if (Buffer.byteLength(line, "utf8") <= limit) return line;
  }
  return "";
}

async function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return false;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(completed);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    void promise.then(() => finish(true), () => finish(true));
  });
}

function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

function decodeBasicHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function cleanIdentifier(value: string): string {
  return redactString(sanitizeControls(value)).replace(/[\r\n]/g, " ").slice(0, 200) || "global";
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function validCode(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "Unknown error";
  }
}

function toBoundedMessage(value: unknown, maxBytes: number): string {
  const message = value instanceof Error ? value.message : safeString(value);
  return truncateUtf8(redactString(sanitizeControls(message)), maxBytes).value;
}
