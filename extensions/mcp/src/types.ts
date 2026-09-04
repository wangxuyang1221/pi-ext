import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";

export type McpTransportType = "stdio" | "sse" | "http" | "streamable-http";
export type McpToolReplayPolicy = "never" | "read-only";

export interface McpRetryConfig {
  enabled?: boolean;
  maxAttempts?: number;
  baseDelayMs?: number;
  factor?: number;
  maxDelayMs?: number;
  retryAfterMaxMs?: number;
  background?: boolean;
  backgroundMaxDelayMs?: number;
}

export interface McpFileLogConfig {
  enabled?: boolean;
  path?: string;
  maxBytes?: number;
}

export interface McpDiagnosticsConfig {
  file?: McpFileLogConfig;
}

export interface McpServerConfigBase {
  disabled?: boolean;
  /** Legacy fallback for connectTimeout and requestTimeout. */
  timeout?: number;
  connectTimeout?: number;
  requestTimeout?: number;
  maxRequestTimeout?: number;
  retry?: McpRetryConfig;
  toolReplay?: McpToolReplayPolicy;
  loggingLevel?: LoggingLevel;
}

export interface McpStdioServerConfig extends McpServerConfigBase {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: never;
  headers?: never;
}

export interface McpSseServerConfig extends McpServerConfigBase {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  command?: never;
  args?: never;
  env?: never;
  cwd?: never;
}

export interface McpHttpServerConfig extends McpServerConfigBase {
  type: "http" | "streamable-http";
  url: string;
  headers?: Record<string, string>;
  command?: never;
  args?: never;
  env?: never;
  cwd?: never;
}

export type McpServerConfig =
  | McpStdioServerConfig
  | McpSseServerConfig
  | McpHttpServerConfig;

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
  diagnostics?: McpDiagnosticsConfig;
}

export type McpConfigLoadStatus = "missing" | "invalid" | "empty" | "loaded";

export interface McpConfigIssue {
  code: string;
  message: string;
  serverName?: string;
}

export interface McpConfigLoadResult {
  status: McpConfigLoadStatus;
  config: McpConfig | null;
  path?: string;
  searchedPaths: string[];
  issues: McpConfigIssue[];
  invalidServers: Record<string, string>;
  disabledServers: string[];
  configuredServerNames: string[];
}

export type JsonPrimitive = string | number | boolean | null;

export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: JsonPrimitive[];
  const?: JsonPrimitive;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: McpToolAnnotations;
  title?: string;
}

export interface McpContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface McpToolResult {
  content: McpContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export type McpErrorCategory =
  | "cancelled"
  | "timeout"
  | "dns"
  | "connection"
  | "auth"
  | "rate-limit"
  | "session-expired"
  | "http-transient"
  | "protocol"
  | "config"
  | "server"
  | "unknown";

export interface McpErrorCause {
  name?: string;
  message: string;
  code?: string | number;
}

export interface McpNormalizedError {
  category: McpErrorCategory;
  message: string;
  retryable: boolean;
  code?: string | number;
  httpStatus?: number;
  retryAfterMs?: number;
  detail?: string;
  causeChain?: McpErrorCause[];
  truncated?: boolean;
  /** Exact source bytes when known, otherwise the observed lower bound before cancellation. */
  originalBytes?: number;
}

export type McpConnectionStatus =
  | "connecting"
  | "connected"
  | "degraded"
  | "retrying"
  | "offline"
  | "disabled";

export interface McpServerState {
  config: McpServerConfig;
  tools: McpTool[];
  connected: boolean;
  status: McpConnectionStatus;
  error?: string;
  lastError?: McpNormalizedError;
  attempt: number;
  lastAttemptAt?: number;
  nextRetryAt?: number;
  generation: number;
}

export interface McpConnection {
  client: Client;
  transport: Transport;
  pid?: number;
  generation: number;
  closing: boolean;
  closed: boolean;
  detachStderr?: () => void;
}

export type McpManagerEvent =
  | {
      type: "state";
      serverName: string;
      state: McpServerState;
      source: "initial" | "manual" | "background" | "lifecycle";
    }
  | {
      type: "tools";
      serverName: string;
      tools: McpTool[];
      source: "initial" | "manual" | "background";
    };
