import { StringDecoder } from "node:string_decoder";
import {
  Client,
  type ClientOptions,
} from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  FetchLike,
  Transport,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  ErrorCode,
  LoggingMessageNotificationSchema,
  type Tool as SdkTool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  DEFAULT_FIELD_BYTES,
  McpDiagnostics,
  normalizeMcpError,
  sanitizeDiagnosticText,
  summarizeHtml,
} from "./diagnostics.js";
import {
  calculateMcpRetryDelay,
  decideMcpRetry,
  defaultMcpRetryScheduler,
  parseHttpRetryAfter,
  parseMcpRetryConfig,
  scheduleMcpRetry,
  type McpRetryScheduler,
} from "./retry.js";
import type {
  McpConnection,
  McpConnectionStatus,
  McpManagerEvent,
  McpNormalizedError,
  McpServerConfig,
  McpServerState,
  McpTool,
  McpToolResult,
} from "./types.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const MAX_HTTP_ERROR_BODY_BYTES = DEFAULT_FIELD_BYTES;
const MAX_HTTP_OBSERVATIONS = 16;
const MAX_STDERR_PARTIAL_BYTES = DEFAULT_FIELD_BYTES * 2;
const HTTP_OBSERVATION_TOKEN_PATTERN = /__PI_MCP_HTTP_OBSERVATION_[0-9]+__/;

type ConnectionSource = "initial" | "manual" | "background";

export interface McpConnectOptions {
  source?: ConnectionSource;
  signal?: AbortSignal;
}

export interface McpReconnectOptions {
  source?: "manual";
  signal?: AbortSignal;
}

export interface McpCallOptions {
  signal?: AbortSignal;
}

export interface McpTransportFactoryContext {
  serverName: string;
  fetch: FetchLike;
}

export interface McpClientManagerOptions {
  diagnostics?: McpDiagnostics;
  scheduler?: McpRetryScheduler;
  random?: () => number;
  now?: () => number;
  fetch?: FetchLike;
  clientFactory?: (options: ClientOptions) => Client;
  transportFactory?: (
    config: McpServerConfig,
    context: McpTransportFactoryContext,
  ) => Transport;
}

interface HttpObservation {
  status: number;
  retryAfterMs?: number;
  detail?: string;
  truncated?: boolean;
  originalBytes?: number;
}

interface InternalConnection extends McpConnection {
  committed: boolean;
  ownedByClient: boolean;
  httpObservations: Map<string, HttpObservation>;
  clientClosePromise?: Promise<void>;
  closePromise?: Promise<void>;
}

interface ServerRuntime {
  name: string;
  config: McpServerConfig;
  state: McpServerState;
  generation: number;
  connection?: InternalConnection;
  pending?: InternalConnection;
  connectController?: AbortController;
  connectPromise?: Promise<McpServerState>;
  supervisorController?: AbortController;
  supervisorPromise?: Promise<void>;
}

interface ToolRoute {
  serverName: string;
  toolName: string;
}

interface DeadlineScope {
  signal: AbortSignal;
  expired: Promise<never>;
  deadlineExceeded: () => boolean;
  cleanup: () => void;
}

class McpDeadlineError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`MCP operation exceeded its ${timeoutMs}ms deadline`);
    this.name = "McpDeadlineError";
  }
}

/** A bounded, normalized connection failure suitable for user-facing surfaces. */
export class McpConnectionError extends Error {
  constructor(
    public readonly serverName: string,
    message: string,
    public readonly normalizedError?: McpNormalizedError,
    public readonly outcomeUnknown = false,
  ) {
    super(`[MCP:${sanitizeDiagnosticText(serverName, 512)}] ${sanitizeDiagnosticText(message, DEFAULT_FIELD_BYTES)}`);
    this.name = "McpConnectionError";
  }
}

/** A compatibility error class for callers that previously matched timeout failures. */
export class McpTimeoutError extends McpConnectionError {
  constructor(serverName: string, timeoutMs: number, normalizedError?: McpNormalizedError) {
    super(serverName, `Connection timed out after ${timeoutMs}ms`, normalizedError);
    this.name = "McpTimeoutError";
  }
}

/** A compatibility error class for callers that previously matched authentication failures. */
export class McpAuthError extends McpConnectionError {
  constructor(serverName: string, detail: string, normalizedError?: McpNormalizedError) {
    super(serverName, `Authentication failed: ${detail}`, normalizedError);
    this.name = "McpAuthError";
  }
}

/** A tool or routing error that did not require transport recovery. */
export class McpToolError extends Error {
  constructor(
    public readonly serverName: string,
    public readonly toolName: string,
    message: string,
    public readonly normalizedError?: McpNormalizedError,
  ) {
    super(`[MCP:${sanitizeDiagnosticText(serverName, 512)}/${sanitizeDiagnosticText(toolName, 512)}] ${sanitizeDiagnosticText(message, DEFAULT_FIELD_BYTES)}`);
    this.name = "McpToolError";
  }
}

/**
 * Owns MCP clients, transport lifecycles, bounded retries, and stable tool routes.
 * The class intentionally has no stdout or stderr sink.
 */
export class McpClientManager {
  readonly diagnostics: McpDiagnostics;

  private readonly scheduler: McpRetryScheduler;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly baseFetch: FetchLike;
  private readonly clientFactory: (options: ClientOptions) => Client;
  private readonly transportFactory?: McpClientManagerOptions["transportFactory"];
  private readonly runtimes = new Map<string, ServerRuntime>();
  private readonly listeners = new Set<(event: McpManagerEvent) => void>();
  private readonly toolRoutes = new Map<string, ToolRoute>();
  private readonly retiredToolRoutes = new Map<string, ToolRoute>();
  private readonly toolCache = new Map<string, McpTool>();
  private lifecycleGeneration = 0;
  private httpObservationSequence = 0;
  private selfHealAttempted = false;
  private disconnecting = false;

  constructor(options: McpClientManagerOptions = {}) {
    this.diagnostics = options.diagnostics ?? new McpDiagnostics();
    this.scheduler = options.scheduler ?? defaultMcpRetryScheduler;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? this.scheduler.now.bind(this.scheduler);
    this.baseFetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.clientFactory = options.clientFactory ?? ((clientOptions) => new Client(
      { name: "pi-mcp", version: "1.0.0" },
      clientOptions,
    ));
    this.transportFactory = options.transportFactory;
  }

  /** Subscribes to immutable state and tool-catalog events. */
  subscribe(listener: (event: McpManagerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Connects one server with a single total deadline and bounded retries. */
  async connectServer(
    name: string,
    config: McpServerConfig,
    options: McpConnectOptions = {},
  ): Promise<McpServerState> {
    const source = options.source ?? "initial";
    let runtime = this.runtimes.get(name);
    if (runtime?.connectPromise) return runtime.connectPromise;

    this.disconnecting = false;
    if (!runtime) {
      runtime = this.createRuntime(name, config);
      this.runtimes.set(name, runtime);
    } else {
      runtime.config = config;
      runtime.state.config = config;
    }

    if (config.disabled) {
      await this.stopRuntimeWork(runtime, false);
      runtime.generation += 1;
      runtime.state = {
        ...runtime.state,
        config,
        connected: false,
        status: "disabled",
        attempt: 0,
        generation: runtime.generation,
        error: undefined,
        lastError: undefined,
        nextRetryAt: undefined,
      };
      this.publishState(runtime, "lifecycle");
      return this.snapshot(runtime.state);
    }

    await this.stopRuntimeWork(runtime, true);
    const generation = ++runtime.generation;
    const controller = new AbortController();
    const detachCaller = forwardAbort(options.signal, controller);
    runtime.connectController = controller;
    const promise = this.runForegroundConnect(runtime, generation, source, controller.signal)
      .finally(() => {
        detachCaller();
        if (runtime!.connectPromise === promise) runtime!.connectPromise = undefined;
        if (runtime!.connectController === controller) runtime!.connectController = undefined;
      });
    runtime.connectPromise = promise;
    return promise;
  }

  /** Reconnects a configured server immediately and wakes any background supervisor. */
  async reconnectServer(
    name: string,
    options: McpReconnectOptions = {},
  ): Promise<McpServerState> {
    const runtime = this.runtimes.get(name);
    if (!runtime) {
      return this.unavailableState(
        name,
        "offline",
        `No cached configuration exists for MCP server \"${name}\"`,
      );
    }
    return this.connectServer(name, runtime.config, {
      source: options.source ?? "manual",
      signal: options.signal,
    });
  }

  /** Records a disabled or invalid configured server without attempting a connection. */
  setUnavailableServer(
    name: string,
    status: Extract<McpConnectionStatus, "offline" | "disabled">,
    error?: string,
  ): McpServerState {
    const existing = this.runtimes.get(name);
    const config = existing?.config ?? ({ command: "unavailable", disabled: status === "disabled" } as McpServerConfig);
    const normalized = error
      ? normalizeMcpError(new TypeError(error))
      : undefined;
    const runtime = existing ?? this.createRuntime(name, config);
    if (!existing) this.runtimes.set(name, runtime);
    runtime.generation += 1;
    runtime.state = {
      ...runtime.state,
      config,
      connected: false,
      status,
      attempt: 0,
      generation: runtime.generation,
      ...(error ? { error: sanitizeDiagnosticText(error, 1024) } : { error: undefined }),
      ...(normalized ? { lastError: normalized } : { lastError: undefined }),
      nextRetryAt: undefined,
    };
    this.publishState(runtime, "lifecycle");
    return this.snapshot(runtime.state);
  }

  /** Executes one tool call and applies the configured safe replay policy. */
  async callTool(
    fullToolName: string,
    args: Record<string, unknown>,
    options: McpCallOptions = {},
  ): Promise<McpToolResult> {
    if (options.signal?.aborted) throw abortReason(options.signal);
    const route = this.toolRoutes.get(fullToolName) ?? this.retiredToolRoutes.get(fullToolName);
    if (!route) {
      throw new McpToolError("unknown", fullToolName, "The MCP tool route is not registered");
    }

    const runtime = this.runtimes.get(route.serverName);
    const currentTool = runtime?.state.tools.find((tool) => tool.name === route.toolName);
    if (!runtime || !currentTool || this.toolRoutes.get(fullToolName)?.serverName !== route.serverName) {
      throw new McpToolError(
        route.serverName,
        route.toolName,
        "This MCP tool is no longer available in the current server catalog. Run /reload to refresh the session.",
      );
    }

    let connection = runtime.connection;
    if (!connection || connection.closed) {
      const rebuilt = await this.reconnectServer(runtime.name, { signal: options.signal });
      if (!rebuilt.connected || !runtime.connection) {
        throw connectionErrorFromState(runtime, "The MCP server is offline and reconnection failed");
      }
      connection = runtime.connection;
    }

    try {
      return await this.invokeTool(runtime, connection, route.toolName, args, options.signal);
    } catch (error) {
      const normalized = this.normalizeToolFailure(error, options.signal, connection);
      const isConnectionLoss = normalized.category === "connection" || normalized.category === "session-expired";
      this.diagnostics.record({
        level: "error",
        message: "MCP tool request failed",
        serverName: runtime.name,
        context: { toolName: route.toolName, phase: "call-tool" },
        normalizedError: normalized,
      });

      if (normalized.category === "cancelled" || normalized.category === "timeout") {
        if (runtime.connection === connection) {
          await this.dropConnection(runtime, connection, normalized);
          if (!options.signal?.aborted && normalized.retryable) {
            this.startSupervisor(runtime, runtime.generation);
          }
        } else {
          await this.closeConnectionHandle(connection);
        }
        throw new McpToolError(runtime.name, route.toolName, normalized.message, normalized);
      }

      if (!isConnectionLoss) {
        throw new McpToolError(runtime.name, route.toolName, normalized.message, normalized);
      }

      await this.dropConnection(runtime, connection, normalized);
      const rebuilt = await this.connectServer(runtime.name, runtime.config, {
        source: "manual",
        signal: options.signal,
      });
      if (options.signal?.aborted) {
        const cancelled = normalizeMcpError(abortReason(options.signal), { signalAborted: true });
        throw new McpConnectionError(
          runtime.name,
          `${cancelled.message}; the original tool outcome is unknown and reconnect was cancelled.`,
          cancelled,
          true,
        );
      }

      const replayTool = runtime.state.tools.find((tool) => tool.name === route.toolName);
      const replayRoute = this.toolRoutes.get(fullToolName);
      const replayAllowed = runtime.config.toolReplay === "read-only" &&
        replayTool?.annotations?.readOnlyHint === true &&
        replayRoute?.serverName === route.serverName &&
        replayRoute.toolName === route.toolName;

      if (rebuilt.connected && replayAllowed && runtime.connection) {
        const replayConnection = runtime.connection;
        try {
          return await this.invokeTool(
            runtime,
            replayConnection,
            route.toolName,
            args,
            options.signal,
          );
        } catch (replayError) {
          const replayNormalized = this.normalizeToolFailure(
            replayError,
            options.signal,
            replayConnection,
          );
          this.diagnostics.record({
            level: "error",
            message: "Read-only MCP tool replay failed",
            serverName: runtime.name,
            context: { toolName: route.toolName, phase: "call-tool-replay" },
            normalizedError: replayNormalized,
          });
          const replayLostConnection = replayNormalized.category === "connection" ||
            replayNormalized.category === "session-expired";
          if (replayLostConnection) {
            if (runtime.connection === replayConnection) {
              await this.dropConnection(runtime, replayConnection, replayNormalized);
            } else {
              await this.closeConnectionHandle(replayConnection);
            }
            if (!options.signal?.aborted && replayNormalized.retryable) {
              this.startSupervisor(runtime, runtime.generation);
            }
            throw new McpConnectionError(
              runtime.name,
              `${replayNormalized.message}; the replay outcome is unknown and the call will not be replayed again.`,
              replayNormalized,
              true,
            );
          }
          if (replayNormalized.category === "cancelled" || replayNormalized.category === "timeout") {
            if (runtime.connection === replayConnection) {
              await this.dropConnection(runtime, replayConnection, replayNormalized);
              if (!options.signal?.aborted && replayNormalized.retryable) {
                this.startSupervisor(runtime, runtime.generation);
              }
            } else {
              await this.closeConnectionHandle(replayConnection);
            }
          }
          throw new McpToolError(runtime.name, route.toolName, replayNormalized.message, replayNormalized);
        }
      }

      const rebuildMessage = rebuilt.connected
        ? "The connection was rebuilt"
        : "The connection could not be rebuilt";
      throw new McpConnectionError(
        runtime.name,
        `${normalized.message}. ${rebuildMessage}; the original tool outcome is unknown and the call was not replayed.`,
        normalized,
        true,
      );
    }
  }

  /** Disconnects one server while retaining its catalog for future recovery. */
  async disconnectServer(name: string): Promise<void> {
    const runtime = this.runtimes.get(name);
    if (!runtime) return;
    runtime.generation += 1;
    await this.stopRuntimeWork(runtime, true);
    runtime.state = {
      ...runtime.state,
      connected: false,
      status: runtime.config.disabled ? "disabled" : "offline",
      attempt: 0,
      generation: runtime.generation,
      nextRetryAt: undefined,
    };
    this.publishState(runtime, "lifecycle");
  }

  /** Cancels all work, closes all clients once, and clears session-owned state. */
  async disconnectAll(): Promise<void> {
    this.disconnecting = true;
    this.lifecycleGeneration += 1;
    const runtimes = [...this.runtimes.values()];
    for (const runtime of runtimes) {
      runtime.generation += 1;
      runtime.connectController?.abort(new DOMException("MCP manager is shutting down", "AbortError"));
      runtime.supervisorController?.abort(new DOMException("MCP manager is shutting down", "AbortError"));
    }

    await Promise.allSettled(runtimes.map((runtime) => this.stopRuntimeWork(runtime, true)));
    const pendingTasks: Promise<unknown>[] = [];
    for (const runtime of runtimes) {
      if (runtime.connectPromise) pendingTasks.push(runtime.connectPromise);
      if (runtime.supervisorPromise) pendingTasks.push(runtime.supervisorPromise);
    }
    await Promise.allSettled(pendingTasks);

    this.runtimes.clear();
    this.toolRoutes.clear();
    this.retiredToolRoutes.clear();
    this.toolCache.clear();
    this.selfHealAttempted = false;
  }

  /** Lifecycle alias used by the extension shutdown hook. */
  async shutdown(): Promise<void> {
    await this.disconnectAll();
  }

  /** Compatibility helper that reconnects every missing configured server once. */
  async selfHeal(config: Record<string, McpServerConfig>): Promise<number> {
    if (this.selfHealAttempted) return this.getConnectionCount();
    this.selfHealAttempted = true;
    for (const [name, serverConfig] of Object.entries(config)) {
      if (!this.isServerConnected(name)) {
        await this.connectServer(name, serverConfig, { source: "manual" });
      }
    }
    return this.getConnectionCount();
  }

  resetSelfHeal(): void {
    this.selfHealAttempted = false;
  }

  isSelfHealAttempted(): boolean {
    return this.selfHealAttempted;
  }

  getAllTools(): Map<string, McpTool> {
    return new Map([...this.toolCache].map(([name, tool]) => [name, cloneTool(tool)]));
  }

  getServerState(name: string): McpServerState | undefined {
    const state = this.runtimes.get(name)?.state;
    return state ? this.snapshot(state) : undefined;
  }

  getServerSnapshot(name: string): McpServerState | undefined {
    return this.getServerState(name);
  }

  getAllServerStates(): McpServerState[] {
    return [...this.runtimes.values()].map((runtime) => this.snapshot(runtime.state));
  }

  getSnapshots(): McpServerState[] {
    return this.getAllServerStates();
  }

  getConnectionCount(): number {
    let count = 0;
    for (const runtime of this.runtimes.values()) {
      if (runtime.connection && !runtime.connection.closed) count += 1;
    }
    return count;
  }

  isServerConnected(name: string): boolean {
    const connection = this.runtimes.get(name)?.connection;
    return Boolean(connection && !connection.closed);
  }

  hasConnections(): boolean {
    return this.getConnectionCount() > 0;
  }

  mcpToolName(server: string, tool: string): string {
    return `mcp__${server}__${tool}`;
  }

  getAllConnectionPids(): number[] {
    const pids = new Set<number>();
    for (const runtime of this.runtimes.values()) {
      for (const connection of [runtime.connection, runtime.pending]) {
        if (connection?.pid !== undefined) pids.add(connection.pid);
      }
    }
    return [...pids];
  }

  private createRuntime(name: string, config: McpServerConfig): ServerRuntime {
    const state: McpServerState = {
      config,
      tools: [],
      connected: false,
      status: config.disabled ? "disabled" : "offline",
      attempt: 0,
      generation: 0,
    };
    return { name, config, state, generation: 0 };
  }

  private async runForegroundConnect(
    runtime: ServerRuntime,
    generation: number,
    source: ConnectionSource,
    signal: AbortSignal,
  ): Promise<McpServerState> {
    const retry = parseMcpRetryConfig(runtime.config.retry);
    const timeoutMs = connectTimeout(runtime.config);
    const deadlineMs = this.now() + timeoutMs;
    let finalError: McpNormalizedError | undefined;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      if (!this.isCurrent(runtime, generation) || signal.aborted) break;
      this.updateState(runtime, {
        status: attempt === 1 ? "connecting" : "retrying",
        connected: false,
        attempt,
        lastAttemptAt: this.now(),
        nextRetryAt: undefined,
        error: undefined,
        generation,
      }, source);

      try {
        const connection = await this.performConnectionAttempt(
          runtime,
          generation,
          deadlineMs,
          signal,
        );
        if (!this.isCurrent(runtime, generation) || signal.aborted || connection.closed) {
          await this.closeConnectionHandle(connection);
          break;
        }
        await this.commitConnection(runtime, connection, source);
        return this.snapshot(runtime.state);
      } catch (error) {
        finalError = this.normalizeConnectFailure(error, signal, deadlineMs);
        this.recordConnectFailure(runtime, attempt, finalError);
        if (!this.isCurrent(runtime, generation) || signal.aborted) break;
        const decision = decideMcpRetry(finalError, attempt, retry, {
          deadlineMs,
          nowMs: this.now(),
          random: this.random,
        });
        if (!decision.retry) break;
        this.updateState(runtime, {
          status: "retrying",
          connected: false,
          attempt,
          lastError: finalError,
          error: finalError.message,
          nextRetryAt: this.now() + decision.delayMs,
          generation,
        }, source);
        try {
          const slept = await scheduleMcpRetry(decision.delayMs, {
            scheduler: this.scheduler,
            signal,
            deadlineMs,
          });
          if (!slept) break;
        } catch {
          break;
        }
      }
    }

    if (this.isCurrent(runtime, generation)) {
      const normalized = signal.aborted
        ? normalizeMcpError(abortReason(signal), { signalAborted: true })
        : finalError ?? normalizeMcpError(new McpDeadlineError(timeoutMs), { deadlineExceeded: true });
      this.updateState(runtime, {
        status: runtime.config.disabled ? "disabled" : "offline",
        connected: false,
        lastError: normalized,
        error: normalized.message,
        nextRetryAt: undefined,
        generation,
      }, source);
      if (!signal.aborted && !this.disconnecting && normalized.retryable) {
        this.startSupervisor(runtime, generation);
      }
    }
    return this.snapshot(runtime.state);
  }

  private async performConnectionAttempt(
    runtime: ServerRuntime,
    generation: number,
    deadlineMs: number,
    parentSignal: AbortSignal,
  ): Promise<InternalConnection> {
    const observations = new Map<string, HttpObservation>();
    const boundedFetch = this.createBoundedFetch(observations);
    let transport: Transport | undefined;
    let connection: InternalConnection | undefined;
    const scope = createDeadlineScope(parentSignal, deadlineMs, this.now);

    try {
      transport = this.createTransport(runtime.name, runtime.config, boundedFetch);
      let connectionRef: InternalConnection | undefined;
      const client = this.clientFactory({
        capabilities: {},
        listChanged: {
          tools: {
            debounceMs: 0,
            onChanged: (error, tools) => {
              const current = connectionRef;
              if (!current || !current.committed || current.closed || current.closing) return;
              if (!this.isCurrent(runtime, generation) || runtime.connection !== current) return;
              if (error || !tools) {
                if (error) this.handleOutOfBandError(runtime, current, error);
                return;
              }
              this.replaceToolCatalog(runtime, tools.map(mapSdkTool));
              this.emitToolCatalogs("manual");
            },
          },
        },
      });
      connection = {
        client,
        transport,
        generation,
        closing: false,
        closed: false,
        committed: false,
        ownedByClient: false,
        httpObservations: observations,
      };
      installIdempotentClientClose(connection);
      connectionRef = connection;
      runtime.pending = connection;
      connection.detachStderr = this.attachStderr(runtime.name, transport);
      this.attachClientHandlers(runtime, connection);
      this.attachLoggingHandler(runtime.name, client);

      connection.ownedByClient = true;
      await raceOperation(
        client.connect(transport, requestOptionsFor(deadlineMs, this.now(), scope.signal)),
        scope.expired,
      );
      connection.pid = getTransportPid(transport);

      if (runtime.config.loggingLevel && client.getServerCapabilities?.()?.logging) {
        await raceOperation(
          client.setLoggingLevel(
            runtime.config.loggingLevel,
            requestOptionsFor(deadlineMs, this.now(), scope.signal),
          ),
          scope.expired,
        );
      }

      const tools = await this.listAllTools(client, deadlineMs, scope);
      if (connection.closed) {
        throw new McpConnectionError(runtime.name, "The connection closed during tool discovery");
      }
      this.replaceToolCatalog(runtime, tools);
      if (runtime.pending === connection) runtime.pending = undefined;
      return connection;
    } catch (error) {
      if (connection) {
        if (runtime.pending === connection) runtime.pending = undefined;
        await this.closeConnectionHandle(connection);
      } else if (transport) {
        try {
          await transport.close();
        } catch (closeError) {
          this.diagnostics.record({
            level: "warn",
            message: "MCP transport cleanup failed before Client ownership",
            serverName: runtime.name,
            context: { phase: "connect-cleanup" },
            error: closeError,
          });
        }
      }
      if (error instanceof McpDeadlineError || scope.deadlineExceeded()) {
        throw new McpDeadlineError(connectTimeout(runtime.config));
      }
      const observation = takeHttpObservation(error, observations);
      throw observation ? attachHttpObservation(error, observation) : error;
    } finally {
      scope.cleanup();
      if (connection && runtime.pending === connection) runtime.pending = undefined;
    }
  }

  private async listAllTools(
    client: Client,
    deadlineMs: number,
    scope: DeadlineScope,
  ): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const response = await raceOperation(
        client.listTools(
          cursor ? { cursor } : undefined,
          requestOptionsFor(deadlineMs, this.now(), scope.signal),
        ),
        scope.expired,
      );
      tools.push(...response.tools.map(mapSdkTool));
      cursor = response.nextCursor;
    } while (cursor);
    return tools;
  }

  private async commitConnection(
    runtime: ServerRuntime,
    connection: InternalConnection,
    source: ConnectionSource,
  ): Promise<void> {
    const previous = runtime.connection;
    runtime.connection = connection;
    connection.committed = true;
    if (previous && previous !== connection) await this.closeConnectionHandle(previous);
    this.rebuildToolRoutes();
    this.updateState(runtime, {
      tools: runtime.state.tools.map(cloneTool),
      connected: true,
      status: "connected",
      error: undefined,
      lastError: undefined,
      nextRetryAt: undefined,
      generation: runtime.generation,
    }, source);
    this.emitToolCatalogs(source);
  }

  private replaceToolCatalog(runtime: ServerRuntime, tools: McpTool[]): void {
    const byName = new Map<string, McpTool>();
    for (const tool of tools) {
      if (!byName.has(tool.name)) byName.set(tool.name, cloneTool(tool));
      else {
        this.diagnostics.record({
          level: "warn",
          message: "Duplicate MCP tool name ignored",
          serverName: runtime.name,
          context: { toolName: tool.name },
        });
      }
    }
    runtime.state = { ...runtime.state, tools: [...byName.values()] };
    this.rebuildToolRoutes();
  }

  private rebuildToolRoutes(): void {
    for (const [name, route] of this.toolRoutes) this.retiredToolRoutes.set(name, route);
    this.toolRoutes.clear();
    this.toolCache.clear();

    const candidates = [...this.runtimes.values()]
      .flatMap((runtime) => runtime.state.tools.map((tool) => ({ runtime, tool })))
      .sort((left, right) => {
        const serverOrder = left.runtime.name.localeCompare(right.runtime.name);
        return serverOrder !== 0 ? serverOrder : left.tool.name.localeCompare(right.tool.name);
      });
    for (const { runtime, tool } of candidates) {
      const fullName = this.mcpToolName(runtime.name, tool.name);
      const existing = this.toolRoutes.get(fullName);
      if (existing) {
        this.diagnostics.record({
          level: "warn",
          message: "Colliding MCP tool name ignored",
          serverName: runtime.name,
          context: { toolName: tool.name, owner: existing.serverName },
        });
        continue;
      }
      const route = { serverName: runtime.name, toolName: tool.name };
      this.toolRoutes.set(fullName, route);
      this.retiredToolRoutes.set(fullName, route);
      this.toolCache.set(fullName, cloneTool(tool));
    }
  }

  private emitToolCatalogs(source: ConnectionSource): void {
    for (const runtime of [...this.runtimes.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      if (!runtime.connection || runtime.connection.closed) continue;
      const tools = runtime.state.tools.filter((tool) => {
        const route = this.toolRoutes.get(this.mcpToolName(runtime.name, tool.name));
        return route?.serverName === runtime.name && route.toolName === tool.name;
      });
      this.emit({
        type: "tools",
        serverName: runtime.name,
        tools: tools.map(cloneTool),
        source,
      });
    }
  }

  private attachClientHandlers(runtime: ServerRuntime, connection: InternalConnection): void {
    connection.client.onerror = (error) => this.handleOutOfBandError(runtime, connection, error);
    connection.client.onclose = () => {
      connection.closed = true;
      connection.detachStderr?.();
      connection.detachStderr = undefined;
      if (connection.closing || !connection.committed) return;
      if (!this.isCurrent(runtime, connection.generation) || runtime.connection !== connection) return;
      runtime.connection = undefined;
      const normalized = normalizeMcpError(
        Object.assign(new Error("Connection closed"), { code: ErrorCode.ConnectionClosed }),
      );
      this.diagnostics.record({
        level: "warn",
        message: "MCP connection closed unexpectedly",
        serverName: runtime.name,
        context: { phase: "connection-close" },
        normalizedError: normalized,
      });
      this.updateState(runtime, {
        connected: false,
        status: "offline",
        error: normalized.message,
        lastError: normalized,
        nextRetryAt: undefined,
      }, "lifecycle");
      if (!this.disconnecting) this.startSupervisor(runtime, runtime.generation);
    };
  }

  private attachLoggingHandler(serverName: string, client: Client): void {
    const target = client as Client & {
      setNotificationHandler?: (
        schema: typeof LoggingMessageNotificationSchema,
        handler: (notification: { params: { level: string; logger?: string; data: unknown } }) => void,
      ) => void;
    };
    if (typeof target.setNotificationHandler !== "function") return;
    target.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      const level = notification.params.level;
      this.diagnostics.record({
        level: level === "debug" ? "debug" : level === "info" || level === "notice" ? "info" : level === "warning" ? "warn" : "error",
        message: "MCP server log notification",
        serverName,
        context: {
          level,
          ...(notification.params.logger ? { logger: notification.params.logger } : {}),
          data: notification.params.data,
        },
      });
    });
  }

  private handleOutOfBandError(
    runtime: ServerRuntime,
    connection: InternalConnection,
    error: unknown,
  ): void {
    const normalized = normalizeMcpError(error);
    this.diagnostics.record({
      level: "warn",
      message: "MCP client reported an out-of-band error",
      serverName: runtime.name,
      context: { phase: "client-error" },
      normalizedError: normalized,
    });
    if (!connection.committed || connection.closing || connection.closed) return;
    if (!this.isCurrent(runtime, connection.generation) || runtime.connection !== connection) return;
    this.updateState(runtime, {
      status: "degraded",
      lastError: normalized,
      error: normalized.message,
    }, "lifecycle");

    const transportType = runtime.config.type;
    const isStreamableHttp = transportType === "http" || transportType === "streamable-http";
    if (
      !isStreamableHttp ||
      !/maximum reconnection attempts(?:\s*\([^)]*\))? exceeded/i.test(normalized.detail ?? normalized.message)
    ) {
      return;
    }
    void this.dropConnection(runtime, connection, normalized)
      .then(() => {
        if (!this.disconnecting && normalized.retryable) {
          this.startSupervisor(runtime, runtime.generation);
        }
      })
      .catch((closeError: unknown) => {
        this.diagnostics.record({
          level: "error",
          message: "MCP terminal SSE recovery cleanup failed",
          serverName: runtime.name,
          context: { phase: "sse-recovery" },
          error: closeError,
        });
      });
  }

  private attachStderr(serverName: string, transport: Transport): (() => void) | undefined {
    const stream = (transport as Transport & {
      stderr?: {
        on?: (event: string, listener: (chunk: unknown) => void) => unknown;
        off?: (event: string, listener: (chunk: unknown) => void) => unknown;
        removeListener?: (event: string, listener: (chunk: unknown) => void) => unknown;
      } | null;
    }).stderr;
    if (!stream?.on) return undefined;

    const decoder = new StringDecoder("utf8");
    let partial = "";
    let detached = false;
    const emitCompleteLines = () => {
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) this.diagnostics.recordStderr(serverName, line);
      while (Buffer.byteLength(partial, "utf8") > MAX_STDERR_PARTIAL_BYTES) {
        const bounded = Buffer.from(partial, "utf8").subarray(0, DEFAULT_FIELD_BYTES).toString("utf8");
        this.diagnostics.recordStderr(serverName, bounded);
        partial = Buffer.from(partial, "utf8").subarray(DEFAULT_FIELD_BYTES).toString("utf8");
      }
    };
    const onData = (chunk: unknown) => {
      try {
        partial += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        emitCompleteLines();
      } catch {
        // Stderr diagnostics must not affect the child transport.
      }
    };
    stream.on("data", onData);

    return () => {
      if (detached) return;
      detached = true;
      try {
        partial += decoder.end();
        emitCompleteLines();
        if (partial) this.diagnostics.recordStderr(serverName, partial);
      } catch {
        // Listener cleanup is best effort.
      }
      stream.off?.("data", onData);
      stream.removeListener?.("data", onData);
      partial = "";
    };
  }

  private createTransport(
    serverName: string,
    config: McpServerConfig,
    boundedFetch: FetchLike,
  ): Transport {
    if (this.transportFactory) {
      return this.transportFactory(config, { serverName, fetch: boundedFetch });
    }
    const type = config.type ?? "stdio";
    if (type === "http" || type === "streamable-http") {
      return new StreamableHTTPClientTransport(new URL(config.url!), {
        ...(config.headers ? { requestInit: { headers: config.headers } } : {}),
        fetch: boundedFetch,
      });
    }
    if (type === "sse") {
      return new SSEClientTransport(new URL(config.url!), {
        ...(config.headers ? { requestInit: { headers: config.headers } } : {}),
        fetch: boundedFetch,
      });
    }
    if (type === "stdio") {
      if (!config.command) throw new TypeError("A non-empty command is required for stdio MCP servers");
      return new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: config.env,
        cwd: config.cwd,
        stderr: "pipe",
      });
    }
    throw new TypeError(`Unsupported MCP transport type: ${String(type)}`);
  }

  private createBoundedFetch(observations: Map<string, HttpObservation>): FetchLike {
    return async (url, init) => {
      const response = await this.baseFetch(url, init);
      if (response.ok) return response;

      const body = await readBoundedResponseBody(response, MAX_HTTP_ERROR_BODY_BYTES);
      const summarized = sanitizeDiagnosticText(
        summarizeHtml(body.text, response.status),
        MAX_HTTP_ERROR_BODY_BYTES,
      );
      this.httpObservationSequence += 1;
      const token = `__PI_MCP_HTTP_OBSERVATION_${this.httpObservationSequence}__`;
      if (observations.size >= MAX_HTTP_OBSERVATIONS) {
        const oldestToken = observations.keys().next().value;
        if (oldestToken !== undefined) observations.delete(oldestToken);
      }
      observations.set(token, {
        status: response.status,
        retryAfterMs: parseHttpRetryAfter(
          response.headers.get("retry-after"),
          this.now(),
        ),
        detail: summarized,
        truncated: body.truncated,
        originalBytes: body.originalBytes,
      });

      const headers = new Headers(response.headers);
      headers.delete("content-length");
      headers.delete("content-encoding");
      return new Response(`${token}\n${summarized}`, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };
  }

  private async invokeTool(
    runtime: ServerRuntime,
    connection: InternalConnection,
    toolName: string,
    args: Record<string, unknown>,
    callerSignal?: AbortSignal,
  ): Promise<McpToolResult> {
    if (callerSignal?.aborted) throw abortReason(callerSignal);
    const requestTimeoutMs = runtime.config.requestTimeout ?? runtime.config.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const maxRequestTimeoutMs = runtime.config.maxRequestTimeout ?? requestTimeoutMs;
    const deadlineMs = this.now() + maxRequestTimeoutMs;
    const scope = createDeadlineScope(callerSignal, deadlineMs, this.now);
    try {
      const result = await raceOperation(
        connection.client.callTool(
          { name: toolName, arguments: args },
          undefined,
          {
            signal: scope.signal,
            timeout: requestTimeoutMs,
            maxTotalTimeout: maxRequestTimeoutMs,
            resetTimeoutOnProgress: maxRequestTimeoutMs > requestTimeoutMs,
          },
        ),
        scope.expired,
      );
      const raw = result as unknown as {
        content?: McpToolResult["content"];
        structuredContent?: Record<string, unknown>;
        isError?: boolean;
        toolResult?: {
          content?: McpToolResult["content"];
          structuredContent?: Record<string, unknown>;
          isError?: boolean;
        };
      };
      if (raw.toolResult) {
        return {
          content: raw.toolResult.content ?? [],
          structuredContent: raw.toolResult.structuredContent,
          isError: typeof raw.toolResult.isError === "boolean" ? raw.toolResult.isError : undefined,
        };
      }
      return {
        content: raw.content ?? [],
        structuredContent: raw.structuredContent,
        isError: typeof raw.isError === "boolean" ? raw.isError : undefined,
      };
    } catch (error) {
      if (scope.deadlineExceeded()) throw new McpDeadlineError(maxRequestTimeoutMs);
      throw error;
    } finally {
      scope.cleanup();
    }
  }

  private normalizeConnectFailure(
    error: unknown,
    signal: AbortSignal,
    deadlineMs: number,
  ): McpNormalizedError {
    const observation = readAttachedHttpObservation(error);
    return normalizeMcpError(error, {
      signalAborted: signal.aborted,
      deadlineExceeded: error instanceof McpDeadlineError || (!signal.aborted && this.now() >= deadlineMs),
      httpStatus: observation?.status,
      retryAfterMs: observation?.retryAfterMs,
      responseDetail: observation?.detail,
      responseTruncated: observation?.truncated,
      responseOriginalBytes: observation?.originalBytes,
    });
  }

  private normalizeToolFailure(
    error: unknown,
    callerSignal: AbortSignal | undefined,
    connection: InternalConnection,
  ): McpNormalizedError {
    const observation = takeHttpObservation(error, connection.httpObservations);
    const sessionId = (connection.transport as Transport & { sessionId?: string }).sessionId;
    return normalizeMcpError(error, {
      signalAborted: callerSignal?.aborted,
      deadlineExceeded: error instanceof McpDeadlineError,
      httpStatus: observation?.status,
      retryAfterMs: observation?.retryAfterMs,
      responseDetail: observation?.detail,
      responseTruncated: observation?.truncated,
      responseOriginalBytes: observation?.originalBytes,
      sessionExpired: observation?.status === 404 && typeof sessionId === "string" && sessionId !== "",
    });
  }

  private recordConnectFailure(
    runtime: ServerRuntime,
    attempt: number,
    error: McpNormalizedError,
  ): void {
    const stderrTail = this.diagnostics.getStderrTail(runtime.name, 5);
    this.diagnostics.record({
      level: "error",
      message: "MCP connection attempt failed",
      serverName: runtime.name,
      context: {
        phase: "connect",
        attempt,
        ...(stderrTail.length > 0 ? { stderrTail } : {}),
      },
      normalizedError: error,
    });
  }

  private async dropConnection(
    runtime: ServerRuntime,
    connection: InternalConnection,
    error: McpNormalizedError,
  ): Promise<void> {
    const ownedCurrentConnection = runtime.connection === connection;
    const generation = connection.generation;
    if (ownedCurrentConnection) runtime.connection = undefined;
    await this.closeConnectionHandle(connection);
    if (
      !ownedCurrentConnection ||
      !this.isCurrent(runtime, generation) ||
      runtime.connection !== undefined
    ) return;
    this.updateState(runtime, {
      connected: false,
      status: "offline",
      error: error.message,
      lastError: error,
      nextRetryAt: undefined,
    }, "lifecycle");
  }

  private startSupervisor(runtime: ServerRuntime, generation: number): void {
    const retry = parseMcpRetryConfig(runtime.config.retry);
    if (!retry.background || runtime.config.disabled || this.disconnecting) return;
    if (!this.isCurrent(runtime, generation) || runtime.supervisorPromise) return;

    const controller = new AbortController();
    runtime.supervisorController = controller;
    const lifecycleGeneration = this.lifecycleGeneration;
    const promise = (async () => {
      let failedAttempt = Math.max(1, runtime.state.attempt);
      while (
        !controller.signal.aborted &&
        !this.disconnecting &&
        lifecycleGeneration === this.lifecycleGeneration &&
        this.isCurrent(runtime, generation) &&
        !runtime.connection
      ) {
        const delayMs = Math.min(
          retry.backgroundMaxDelayMs,
          calculateMcpRetryDelay(
            runtime.state.lastError ?? normalizeMcpError(new Error("Connection unavailable")),
            failedAttempt,
            { ...retry, maxAttempts: Number.MAX_SAFE_INTEGER },
            this.random,
          ),
        );
        this.updateState(runtime, {
          status: "retrying",
          connected: false,
          attempt: failedAttempt,
          nextRetryAt: this.now() + delayMs,
          generation,
        }, "background");
        try {
          await this.scheduler.sleep(delayMs, controller.signal);
        } catch {
          break;
        }
        if (controller.signal.aborted || !this.isCurrent(runtime, generation)) break;

        const deadlineMs = this.now() + connectTimeout(runtime.config);
        this.updateState(runtime, {
          status: "connecting",
          connected: false,
          attempt: failedAttempt + 1,
          lastAttemptAt: this.now(),
          nextRetryAt: undefined,
          generation,
        }, "background");
        try {
          const connection = await this.performConnectionAttempt(
            runtime,
            generation,
            deadlineMs,
            controller.signal,
          );
          if (controller.signal.aborted || !this.isCurrent(runtime, generation)) {
            await this.closeConnectionHandle(connection);
            break;
          }
          await this.commitConnection(runtime, connection, "background");
          break;
        } catch (error) {
          const normalized = this.normalizeConnectFailure(error, controller.signal, deadlineMs);
          failedAttempt += 1;
          this.recordConnectFailure(runtime, failedAttempt, normalized);
          this.updateState(runtime, {
            status: "offline",
            connected: false,
            attempt: failedAttempt,
            error: normalized.message,
            lastError: normalized,
            nextRetryAt: undefined,
            generation,
          }, "background");
          if (!normalized.retryable) break;
        }
      }
    })().catch((error) => {
      if (!controller.signal.aborted) {
        this.diagnostics.record({
          level: "error",
          message: "MCP background recovery stopped unexpectedly",
          serverName: runtime.name,
          context: { phase: "background-recovery" },
          error,
        });
      }
    }).finally(() => {
      if (runtime.supervisorPromise === promise) runtime.supervisorPromise = undefined;
      if (runtime.supervisorController === controller) runtime.supervisorController = undefined;
    });
    runtime.supervisorPromise = promise;
  }

  private async stopRuntimeWork(runtime: ServerRuntime, closeActive: boolean): Promise<void> {
    runtime.connectController?.abort(new DOMException("MCP connection superseded", "AbortError"));
    runtime.supervisorController?.abort(new DOMException("MCP recovery superseded", "AbortError"));
    const handles = new Set<InternalConnection>();
    if (runtime.pending) handles.add(runtime.pending);
    if (closeActive && runtime.connection) handles.add(runtime.connection);
    if (closeActive) runtime.connection = undefined;
    runtime.pending = undefined;
    await Promise.allSettled([...handles].map((connection) => this.closeConnectionHandle(connection)));
  }

  private closeConnectionHandle(connection: InternalConnection): Promise<void> {
    if (connection.closePromise) return connection.closePromise;
    connection.closing = true;
    connection.detachStderr?.();
    connection.detachStderr = undefined;
    const closePromise = (async () => {
      try {
        if (connection.ownedByClient) {
          await connection.client.close();
        } else {
          await connection.transport.close();
        }
      } catch (error) {
        this.diagnostics.record({
          level: "warn",
          message: "MCP Client close failed; transport fallback started",
          context: { pid: connection.pid, phase: "close" },
          error,
        });
        if (connection.ownedByClient) {
          try {
            await connection.transport.close();
          } catch (fallbackError) {
            this.diagnostics.record({
              level: "warn",
              message: "MCP transport close fallback failed",
              context: { pid: connection.pid, phase: "close-fallback" },
              error: fallbackError,
            });
          }
        }
      } finally {
        connection.closed = true;
      }
    })();
    connection.closePromise = closePromise;
    return closePromise;
  }

  private updateState(
    runtime: ServerRuntime,
    patch: Partial<McpServerState>,
    source: McpManagerEvent extends infer _Event ? "initial" | "manual" | "background" | "lifecycle" : never,
  ): void {
    runtime.state = { ...runtime.state, ...patch };
    this.publishState(runtime, source);
  }

  private publishState(
    runtime: ServerRuntime,
    source: "initial" | "manual" | "background" | "lifecycle",
  ): void {
    this.emit({
      type: "state",
      serverName: runtime.name,
      state: this.snapshot(runtime.state),
      source,
    });
  }

  private emit(event: McpManagerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.diagnostics.record({
          level: "warn",
          message: "MCP manager event listener failed",
          context: { eventType: event.type },
          error,
        });
      }
    }
  }

  private snapshot(state: McpServerState): McpServerState {
    return {
      ...state,
      config: cloneConfig(state.config),
      tools: state.tools.map(cloneTool),
      ...(state.lastError ? { lastError: structuredCloneSafe(state.lastError) } : {}),
    };
  }

  private isCurrent(runtime: ServerRuntime, generation: number): boolean {
    return !this.disconnecting && runtime.generation === generation;
  }

  private unavailableState(
    name: string,
    status: Extract<McpConnectionStatus, "offline" | "disabled">,
    error: string,
  ): McpServerState {
    const config = { command: "unavailable", disabled: status === "disabled" } as McpServerConfig;
    return {
      config,
      tools: [],
      connected: false,
      status,
      error,
      lastError: normalizeMcpError(new TypeError(error)),
      attempt: 0,
      generation: 0,
    };
  }
}

function connectTimeout(config: McpServerConfig): number {
  return config.connectTimeout ?? config.timeout ?? DEFAULT_CONNECT_TIMEOUT_MS;
}

function requestOptionsFor(
  deadlineMs: number,
  nowMs: number,
  signal: AbortSignal,
): { signal: AbortSignal; timeout: number; maxTotalTimeout: number } {
  const remaining = Math.max(1, Math.floor(deadlineMs - nowMs));
  return { signal, timeout: remaining, maxTotalTimeout: remaining };
}

function createDeadlineScope(
  parentSignal: AbortSignal | undefined,
  deadlineMs: number,
  now: () => number,
): DeadlineScope {
  const controller = new AbortController();
  let deadlineExceeded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectExpired!: (reason: unknown) => void;
  const expired = new Promise<never>((_resolve, reject) => {
    rejectExpired = reject;
  });
  const onParentAbort = () => {
    const reason = abortReason(parentSignal);
    controller.abort(reason);
    rejectExpired(reason);
  };
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  const remaining = Math.max(0, deadlineMs - now());
  const deadlineError = new McpDeadlineError(Math.max(0, Math.floor(remaining)));
  const onDeadline = () => {
    deadlineExceeded = true;
    controller.abort(deadlineError);
    rejectExpired(deadlineError);
  };
  if (parentSignal?.aborted) {
    onParentAbort();
  } else if (remaining <= 0) {
    onDeadline();
  } else {
    timer = setTimeout(onDeadline, remaining);
    timer.unref?.();
  }

  return {
    signal: controller.signal,
    expired,
    deadlineExceeded: () => deadlineExceeded,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

async function raceOperation<T>(operation: Promise<T>, expiry: Promise<never>): Promise<T> {
  operation.catch(() => undefined);
  return Promise.race([operation, expiry]);
}

function forwardAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => undefined;
  const onAbort = () => target.abort(abortReason(source));
  source.addEventListener("abort", onAbort, { once: true });
  if (source.aborted) onAbort();
  return () => source.removeEventListener("abort", onAbort);
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function mapSdkTool(tool: SdkTool): McpTool {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: tool.inputSchema as McpTool["inputSchema"],
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema as McpTool["outputSchema"] } : {}),
    ...(tool.annotations ? { annotations: { ...tool.annotations } } : {}),
  };
}

function cloneTool(tool: McpTool): McpTool {
  return structuredCloneSafe(tool);
}

function cloneConfig(config: McpServerConfig): McpServerConfig {
  return structuredCloneSafe(config);
}

function structuredCloneSafe<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

function getTransportPid(transport: Transport): number | undefined {
  const pid = (transport as Transport & { readonly pid?: number | null }).pid;
  return typeof pid === "number" ? pid : undefined;
}

function connectionErrorFromState(runtime: ServerRuntime, fallback: string): McpConnectionError {
  const normalized = runtime.state.lastError;
  if (normalized?.category === "auth") {
    return new McpAuthError(runtime.name, normalized.message, normalized);
  }
  if (normalized?.category === "timeout") {
    return new McpTimeoutError(runtime.name, connectTimeout(runtime.config), normalized);
  }
  return new McpConnectionError(runtime.name, normalized?.message ?? fallback, normalized);
}

function installIdempotentClientClose(connection: InternalConnection): void {
  const client = connection.client as Client & { close: () => Promise<void> };
  const originalClose = client.close.bind(client);
  client.close = () => {
    if (!connection.clientClosePromise) {
      const closePromise = Promise.resolve().then(() => originalClose());
      closePromise.catch(() => undefined);
      connection.clientClosePromise = closePromise;
    }
    return connection.clientClosePromise;
  };
}

function takeHttpObservation(
  error: unknown,
  observations: Map<string, HttpObservation>,
): HttpObservation | undefined {
  const seen = new WeakSet<object>();
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current !== undefined && current !== null; depth += 1) {
    if (typeof current === "object") {
      if (seen.has(current)) break;
      seen.add(current);
    }
    const record = typeof current === "object" && current !== null
      ? current as { message?: unknown; cause?: unknown }
      : undefined;
    const message = current instanceof Error
      ? current.message
      : typeof record?.message === "string"
        ? record.message
        : typeof current === "string"
          ? current
          : "";
    const token = message.match(HTTP_OBSERVATION_TOKEN_PATTERN)?.[0];
    if (token) {
      const observation = observations.get(token);
      if (observation) {
        observations.delete(token);
        return observation;
      }
    }
    current = record?.cause;
  }
  return undefined;
}

function attachHttpObservation(error: unknown, observation: HttpObservation): unknown {
  if (typeof error === "object" && error !== null) {
    try {
      Object.defineProperty(error, "__piMcpHttpObservation", {
        value: { ...observation },
        enumerable: false,
        configurable: true,
      });
      return error;
    } catch {
      // Fall through to a wrapped error when the SDK error is not extensible.
    }
  }
  return Object.assign(new Error(error instanceof Error ? error.message : String(error), {
    cause: error,
  }), { __piMcpHttpObservation: { ...observation } });
}

function readAttachedHttpObservation(error: unknown): HttpObservation | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as { __piMcpHttpObservation?: unknown }).__piMcpHttpObservation;
  return typeof value === "object" && value !== null ? value as HttpObservation : undefined;
}

async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean; originalBytes: number }> {
  const contentLengthHeader = response.headers.get("content-length");
  const parsedContentLength = contentLengthHeader === null ? Number.NaN : Number(contentLengthHeader);
  const contentLength = Number.isFinite(parsedContentLength) && parsedContentLength >= 0
    ? parsedContentLength
    : undefined;
  if (!response.body) return { text: "", truncated: false, originalBytes: contentLength ?? 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let captured = 0;
  let observed = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      observed += value.byteLength;
      if (captured < maxBytes) {
        const remaining = maxBytes - captured;
        const slice = value.byteLength <= remaining ? value : value.subarray(0, remaining);
        chunks.push(slice);
        captured += slice.byteLength;
      }
      if (observed > maxBytes || captured >= maxBytes) {
        truncated = observed > maxBytes || contentLength === undefined || contentLength !== observed;
        void reader.cancel().catch(() => undefined);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const output = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const knownOriginal = contentLength ?? observed;
  return {
    text: new TextDecoder().decode(output),
    truncated: truncated || knownOriginal > captured,
    originalBytes: Math.max(knownOriginal, observed),
  };
}
