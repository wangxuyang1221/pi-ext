import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import type { McpDiagnostics } from "./diagnostics.js";
import type {
  McpConfig,
  McpConfigIssue,
  McpConfigLoadResult,
  McpDiagnosticsConfig,
  McpRetryConfig,
  McpServerConfig,
} from "./types.js";

const CONFIG_FILENAME = "mcp.json";

export interface McpConfigLoaderDependencies {
  env?: Readonly<Record<string, string | undefined>>;
  homeDir?: string;
  exists?: (path: string) => boolean;
  readFile?: (path: string) => string;
  allowProjectConfig?: boolean;
}

const LOGGING_LEVELS = new Set([
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
]);

export function loadMcpConfig(
  cwd: string,
  diagnostics?: McpDiagnostics,
  dependencies?: McpConfigLoaderDependencies,
): McpConfig | null {
  return loadMcpConfigResult(cwd, diagnostics, dependencies).config;
}

export function loadMcpConfigResult(
  cwd: string,
  diagnostics?: McpDiagnostics,
  dependencies: McpConfigLoaderDependencies = {},
): McpConfigLoadResult {
  const paths = configSearchPaths(cwd, dependencies);
  const exists = dependencies.exists ?? existsSync;
  const path = paths.find((candidate) => {
    try {
      return exists(candidate);
    } catch {
      return false;
    }
  });
  if (!path) {
    return {
      status: "missing",
      config: null,
      searchedPaths: paths,
      issues: [],
      invalidServers: {},
      disabledServers: [],
      configuredServerNames: [],
    };
  }

  try {
    const readFile = dependencies.readFile ?? ((filePath: string) => readFileSync(filePath, "utf8"));
    const raw = readFile(path);
    const parseErrors: ParseError[] = [];
    const parsed = parse(raw, parseErrors, { allowTrailingComma: true }) as unknown;
    if (parseErrors.length > 0) {
      const message = parseErrors
        .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
        .join(", ");
      diagnostics?.record({
        level: "error",
        message: "MCP config parsing failed",
        context: { path, parseErrors: message },
      });
      return invalidResult(path, paths, [{ code: "parse", message: `Invalid JSONC: ${message}` }]);
    }
    return validateConfig(parsed, path, paths, diagnostics);
  } catch (error) {
    diagnostics?.record({
      level: "error",
      message: "MCP config could not be read",
      context: { path },
      error,
    });
    return invalidResult(path, paths, [{ code: "read", message: "The config file could not be read" }]);
  }
}

export function configTemplatePath(cwd: string): string {
  return resolve(cwd, CONFIG_DIR_NAME, CONFIG_FILENAME);
}

function configSearchPaths(cwd: string, dependencies: McpConfigLoaderDependencies): string[] {
  const paths: string[] = [];
  const env = dependencies.env ?? process.env;
  const envPath = env.PI_MCP_CONFIG;
  if (envPath) paths.push(resolve(cwd, envPath));
  if (dependencies.allowProjectConfig !== false) {
    paths.push(resolve(cwd, CONFIG_DIR_NAME, CONFIG_FILENAME));
  }
  paths.push(resolve(dependencies.homeDir ?? homedir(), CONFIG_DIR_NAME, "agent", CONFIG_FILENAME));
  return [...new Set(paths)];
}

function validateConfig(
  value: unknown,
  path: string,
  searchedPaths: string[],
  diagnostics?: McpDiagnostics,
): McpConfigLoadResult {
  if (!isPlainRecord(value) || !isPlainRecord(value.mcpServers)) {
    const issue = { code: "mcpServers", message: "mcpServers must be an object" };
    diagnostics?.record({ level: "error", message: "MCP config is invalid", context: { path, issue: issue.message } });
    return invalidResult(path, searchedPaths, [issue]);
  }

  const configuredServerNames = Object.keys(value.mcpServers);
  const activeServers: Record<string, McpServerConfig> = {};
  const invalidServers: Record<string, string> = {};
  const disabledServers: string[] = [];
  const issues: McpConfigIssue[] = [];

  for (const [serverName, candidate] of Object.entries(value.mcpServers)) {
    if (!serverName.trim()) {
      issues.push({ code: "server-name", message: "Server names must not be empty" });
      continue;
    }
    if (!isPlainRecord(candidate)) {
      addServerIssue(serverName, "shape", "Server config must be an object", invalidServers, issues, diagnostics, path);
      continue;
    }
    if (candidate.disabled === true) {
      disabledServers.push(serverName);
      continue;
    }
    const validated = validateServerConfig(serverName, candidate);
    if (typeof validated === "string") {
      addServerIssue(serverName, "server-config", validated, invalidServers, issues, diagnostics, path);
      continue;
    }
    activeServers[serverName] = validated;
  }

  const diagnosticsConfig = validateDiagnosticsConfig(value.diagnostics, issues);
  const config: McpConfig = {
    mcpServers: activeServers,
    ...(diagnosticsConfig ? { diagnostics: diagnosticsConfig } : {}),
  };
  const activeCount = Object.keys(activeServers).length;
  const status = activeCount > 0
    ? "loaded"
    : configuredServerNames.length === disabledServers.length && issues.length === 0
      ? "empty"
      : issues.length > 0
        ? "invalid"
        : "empty";

  return {
    status,
    config: status === "invalid" && activeCount === 0 ? null : config,
    path,
    searchedPaths,
    issues,
    invalidServers,
    disabledServers,
    configuredServerNames,
  };
}

function validateServerConfig(serverName: string, value: Record<string, unknown>): McpServerConfig | string {
  const typeValue = value.type ?? "stdio";
  if (!isTransportType(typeValue)) return "type must be stdio, sse, http, or streamable-http";
  if (value.disabled !== undefined && typeof value.disabled !== "boolean") return "disabled must be a boolean";

  const timeoutError = validateTimeouts(value);
  if (timeoutError) return timeoutError;
  const retry = validateRetry(value.retry);
  if (typeof retry === "string") return retry;
  if (value.toolReplay !== undefined && value.toolReplay !== "never" && value.toolReplay !== "read-only") {
    return "toolReplay must be never or read-only";
  }
  if (value.loggingLevel !== undefined && (typeof value.loggingLevel !== "string" || !LOGGING_LEVELS.has(value.loggingLevel))) {
    return "loggingLevel is invalid";
  }

  const common = {
    ...(value.disabled !== undefined ? { disabled: value.disabled } : {}),
    ...copyNumber(value, "timeout"),
    ...copyNumber(value, "connectTimeout"),
    ...copyNumber(value, "requestTimeout"),
    ...copyNumber(value, "maxRequestTimeout"),
    ...(retry ? { retry } : {}),
    ...(value.toolReplay ? { toolReplay: value.toolReplay as "never" | "read-only" } : {}),
    ...(value.loggingLevel ? { loggingLevel: value.loggingLevel as LoggingLevel } : {}),
  };

  if (typeValue === "stdio") {
    if (typeof value.command !== "string" || value.command.trim() === "") return "command must be a non-empty string for stdio";
    if (value.args !== undefined && (!Array.isArray(value.args) || value.args.some((item) => typeof item !== "string"))) {
      return "args must be an array of strings";
    }
    const env = validateStringRecord(value.env, "env");
    if (typeof env === "string") return env;
    if (value.cwd !== undefined && (typeof value.cwd !== "string" || value.cwd.trim() === "")) return "cwd must be a non-empty string";
    return {
      ...common,
      type: value.type === undefined ? undefined : "stdio",
      command: value.command,
      ...(value.args ? { args: [...value.args] as string[] } : {}),
      ...(env ? { env } : {}),
      ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}),
    };
  }

  if (typeof value.url !== "string" || value.url.trim() === "") return "url must be a non-empty string for HTTP/SSE";
  try {
    const parsed = new URL(value.url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "url must use http or https";
  } catch {
    return "url must be a valid HTTP or HTTPS URL";
  }
  const headers = validateStringRecord(value.headers, "headers");
  if (typeof headers === "string") return headers;

  return {
    ...common,
    type: typeValue,
    url: value.url,
    ...(headers ? { headers } : {}),
  } as McpServerConfig;
}

function validateTimeouts(value: Record<string, unknown>): string | undefined {
  for (const field of ["timeout", "connectTimeout", "requestTimeout", "maxRequestTimeout"] as const) {
    const candidate = value[field];
    if (candidate !== undefined && !isPositiveInteger(candidate)) return `${field} must be a positive integer`;
  }
  const requestTimeout = numberValue(value.requestTimeout) ?? numberValue(value.timeout);
  const maxRequestTimeout = numberValue(value.maxRequestTimeout);
  if (requestTimeout !== undefined && maxRequestTimeout !== undefined && maxRequestTimeout < requestTimeout) {
    return "maxRequestTimeout must be greater than or equal to requestTimeout";
  }
  return undefined;
}

function validateRetry(value: unknown): McpRetryConfig | string | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) return "retry must be an object";
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") return "retry.enabled must be a boolean";
  if (value.background !== undefined && typeof value.background !== "boolean") return "retry.background must be a boolean";
  const ranges: Array<[keyof McpRetryConfig, number, number]> = [
    ["maxAttempts", 1, 10],
    ["baseDelayMs", 1, 300_000],
    ["factor", 1, 10],
    ["maxDelayMs", 1, 300_000],
    ["retryAfterMaxMs", 1, 300_000],
    ["backgroundMaxDelayMs", 1, 300_000],
  ];
  const output: McpRetryConfig = {};
  for (const [field, minimum, maximum] of ranges) {
    const candidate = value[field];
    if (candidate === undefined) continue;
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < minimum || candidate > maximum) {
      return `retry.${field} must be between ${minimum} and ${maximum}`;
    }
    if (field === "maxAttempts" && !Number.isInteger(candidate)) return "retry.maxAttempts must be an integer";
    (output as Record<string, unknown>)[field] = candidate;
  }
  if (typeof value.enabled === "boolean") output.enabled = value.enabled;
  if (typeof value.background === "boolean") output.background = value.background;
  if (output.baseDelayMs !== undefined && output.maxDelayMs !== undefined && output.maxDelayMs < output.baseDelayMs) {
    return "retry.maxDelayMs must be greater than or equal to retry.baseDelayMs";
  }
  return output;
}

function validateDiagnosticsConfig(value: unknown, issues: McpConfigIssue[]): McpDiagnosticsConfig | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    issues.push({ code: "diagnostics", message: "diagnostics must be an object" });
    return undefined;
  }
  if (value.file === undefined) return {};
  if (!isPlainRecord(value.file)) {
    issues.push({ code: "diagnostics-file", message: "diagnostics.file must be an object" });
    return undefined;
  }
  if (value.file.enabled !== undefined && typeof value.file.enabled !== "boolean") {
    issues.push({ code: "diagnostics-file-enabled", message: "diagnostics.file.enabled must be a boolean" });
    return undefined;
  }
  if (value.file.enabled === true && (typeof value.file.path !== "string" || value.file.path.trim() === "")) {
    issues.push({ code: "diagnostics-file-path", message: "diagnostics.file.path is required when file logging is enabled" });
    return undefined;
  }
  if (value.file.maxBytes !== undefined && !isPositiveInteger(value.file.maxBytes)) {
    issues.push({ code: "diagnostics-file-size", message: "diagnostics.file.maxBytes must be a positive integer" });
    return undefined;
  }
  return {
    file: {
      ...(typeof value.file.enabled === "boolean" ? { enabled: value.file.enabled } : {}),
      ...(typeof value.file.path === "string" ? { path: value.file.path } : {}),
      ...(typeof value.file.maxBytes === "number" ? { maxBytes: value.file.maxBytes } : {}),
    },
  };
}

function validateStringRecord(value: unknown, field: string): Record<string, string> | string | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) return `${field} must be an object with string values`;
  const output: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate !== "string") return `${field} must contain only string values`;
    output[key] = candidate;
  }
  return output;
}

function addServerIssue(
  serverName: string,
  code: string,
  message: string,
  invalidServers: Record<string, string>,
  issues: McpConfigIssue[],
  diagnostics: McpDiagnostics | undefined,
  path: string,
): void {
  invalidServers[serverName] = message;
  issues.push({ code, message, serverName });
  diagnostics?.record({
    level: "warn",
    message: "Invalid MCP server config skipped",
    serverName,
    context: { path, issue: message },
  });
}

function invalidResult(path: string, searchedPaths: string[], issues: McpConfigIssue[]): McpConfigLoadResult {
  return {
    status: "invalid",
    config: null,
    path,
    searchedPaths,
    issues,
    invalidServers: {},
    disabledServers: [],
    configuredServerNames: [],
  };
}

function copyNumber(value: Record<string, unknown>, field: string): Record<string, number> {
  return typeof value[field] === "number" ? { [field]: value[field] } as Record<string, number> : {};
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isTransportType(value: unknown): value is "stdio" | "sse" | "http" | "streamable-http" {
  return value === "stdio" || value === "sse" || value === "http" || value === "streamable-http";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
