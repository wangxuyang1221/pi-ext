import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth, } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { McpClientManager, McpConnectionError, McpToolError } from "./client.js";
import { configTemplatePath, loadMcpConfigResult } from "./config.js";
import { DEFAULT_FIELD_BYTES, DEFAULT_USER_MESSAGE_WIDTH, McpDiagnostics, sanitizeDiagnosticText, truncateUtf8, } from "./diagnostics.js";
import { jsonSchemaToTypeBox } from "./schema.js";
const MAX_SERVER_NAME_WIDTH = 28;
const MAX_ARGUMENT_PREVIEW_WIDTH = 240;
const MAX_RESULT_PREVIEW_WIDTH = 240;
const MAX_PREVIEW_SOURCE_CHARS = 2048;
const MAX_SERIALIZED_BLOCKS = 24;
const MAX_LOG_LINES = 120;
const MCP_OUTPUT_TRUNCATION_NOTICE = `[MCP output truncated: limits are ${formatBytes(DEFAULT_MAX_BYTES)}, ${DEFAULT_MAX_LINES} lines, and ${MAX_SERIALIZED_BLOCKS} serialized non-text blocks.]`;
const MCP_OUTPUT_LIMIT_GUIDANCE = `MCP text output is limited to ${formatBytes(DEFAULT_MAX_BYTES)} and ${DEFAULT_MAX_LINES} lines; at most ${MAX_SERIALIZED_BLOCKS} non-text blocks are serialized, and structured details are limited to ${formatBytes(DEFAULT_MAX_BYTES)}. Request narrower results or use server pagination for complete data. Full truncated output is not persisted by this extension.`;
const MAX_MODEL_TEXT_BYTES = Math.max(1, DEFAULT_MAX_BYTES - Buffer.byteLength(MCP_OUTPUT_TRUNCATION_NOTICE, "utf8"));
const MAX_MODEL_TEXT_LINES = Math.max(1, DEFAULT_MAX_LINES - 1);
const SENSITIVE_ARGUMENT_KEY = /api[-_]?key|access[-_]?token|authorization|password|passwd|secret|cookie/i;
/** Registers the MCP integration for one Pi extension runtime. */
export default function registerMcpExtension(pi) {
    const diagnostics = new McpDiagnostics();
    const Manager = McpClientManager;
    const manager = new Manager({ diagnostics });
    const registeredTools = new Map();
    const availableTools = new Map();
    let lifecycleGeneration = 0;
    let activeSession;
    let unsubscribeManager;
    const isCurrent = (session) => activeSession === session && session.generation === lifecycleGeneration;
    const syncServerTools = (serverName, tools, session) => {
        if (!isCurrent(session))
            return;
        const nextTools = deduplicateTools(tools);
        const nextNames = new Set();
        for (const tool of nextTools) {
            const fullName = manager.mcpToolName(serverName, tool.name);
            nextNames.add(fullName);
            availableTools.set(fullName, tool);
            const signature = toolSignature(tool);
            const registered = registeredTools.get(fullName);
            if (registered?.signature === signature &&
                registered.serverName === serverName &&
                registered.toolName === tool.name)
                continue;
            registerMcpTool({
                pi,
                manager,
                diagnostics,
                serverName,
                tool,
                fullName,
                availableTools,
            });
            registeredTools.set(fullName, { serverName, toolName: tool.name, signature });
        }
        for (const [fullName, registered] of registeredTools) {
            if (registered.serverName === serverName && !nextNames.has(fullName)) {
                availableTools.delete(fullName);
            }
        }
    };
    const handleManagerEvent = (event, session) => {
        if (!isCurrent(session))
            return;
        if (event.type === "tools") {
            syncServerTools(event.serverName, event.tools, session);
        }
        updateFooter(session.ctx, manager, session.configResult);
        if (event.type === "state" &&
            event.source === "background" &&
            event.state.connected &&
            session.startupComplete &&
            !session.backgroundRecoveryNotified.has(event.serverName)) {
            session.backgroundRecoveryNotified.add(event.serverName);
            notifyForMode(session.ctx, `MCP server recovered: ${event.serverName}`, "info");
        }
    };
    pi.on("session_start", async (_event, ctx) => {
        lifecycleGeneration += 1;
        const generation = lifecycleGeneration;
        unsubscribeManager?.();
        const configResult = loadMcpConfigResult(ctx.cwd, diagnostics, {
            allowProjectConfig: ctx.isProjectTrusted(),
        });
        diagnostics.configureFileSink(configResult.config?.diagnostics?.file);
        const session = {
            generation,
            ctx,
            configResult,
            startupComplete: false,
            startupSummarySent: false,
            backgroundRecoveryNotified: new Set(),
        };
        activeSession = session;
        unsubscribeManager = manager.subscribe((event) => handleManagerEvent(event, session));
        for (const name of configResult.disabledServers) {
            manager.setUnavailableServer(name, "disabled");
        }
        for (const [name, error] of Object.entries(configResult.invalidServers)) {
            manager.setUnavailableServer(name, "offline", error);
        }
        updateFooter(ctx, manager, configResult);
        const startConnections = async () => {
            const entries = Object.entries(configResult.config?.mcpServers ?? {});
            const settled = await Promise.allSettled(entries.map(async ([serverName, config]) => {
                const state = await manager.connectServer(serverName, config, { source: "initial" });
                return { serverName, state };
            }));
            if (!isCurrent(session))
                return;
            for (let index = 0; index < settled.length; index += 1) {
                const result = settled[index];
                if (result.status === "rejected") {
                    const serverName = entries[index][0];
                    diagnostics.record({
                        level: "error",
                        message: "Initial MCP connection failed",
                        serverName,
                        error: result.reason,
                    });
                    manager.setUnavailableServer(serverName, "offline", boundedErrorMessage(result.reason));
                }
            }
            session.startupComplete = true;
            updateFooter(ctx, manager, configResult);
            if (!session.startupSummarySent) {
                session.startupSummarySent = true;
                const summary = formatStartupSummary(configResult, manager);
                notifyForMode(ctx, summary.message, summary.type);
            }
        };
        if (process.env.PI_SUBAGENT === "1") {
            void startConnections().catch((error) => {
                if (!isCurrent(session))
                    return;
                diagnostics.record({
                    level: "error",
                    message: "Background MCP startup failed",
                    error,
                });
                session.startupComplete = true;
                updateFooter(ctx, manager, configResult);
                if (!session.startupSummarySent) {
                    session.startupSummarySent = true;
                    notifyForMode(ctx, "MCP startup failed", "error");
                }
            });
            return;
        }
        await startConnections();
    });
    pi.on("session_shutdown", async () => {
        lifecycleGeneration += 1;
        activeSession = undefined;
        unsubscribeManager?.();
        unsubscribeManager = undefined;
        availableTools.clear();
        await shutdownManager(manager);
        await diagnostics.close();
    });
    pi.on("tool_result", (event) => {
        if (!registeredTools.has(event.toolName))
            return;
        const details = asRecord(event.details);
        if (details?.isError === true && !event.isError) {
            return { isError: true };
        }
    });
    pi.registerCommand("mcp", {
        description: "Manage MCP servers. Usage: /mcp status | reload | reconnect <server> | logs [server]",
        handler: async (rawArgs, ctx) => {
            const args = splitCommandArguments(rawArgs);
            const command = args[0] ?? "status";
            if (command === "status" && args.length <= 1) {
                const configResult = currentConfigResult(ctx, activeSession, diagnostics);
                updateFooter(ctx, manager, configResult);
                notifyStatusForMode(ctx, formatStatus(configResult, manager));
                return;
            }
            if (command === "reload" && args.length === 1) {
                await ctx.waitForIdle();
                await ctx.reload();
                return;
            }
            if (command === "reconnect" && args.length === 2) {
                await reconnectServer(args[1], ctx, manager, activeSession, isCurrent);
                return;
            }
            if (command === "logs" && args.length <= 2) {
                await showLogs(args[1], ctx, diagnostics);
                return;
            }
            notifyForMode(ctx, "Usage: /mcp status | /mcp reload | /mcp reconnect <server> | /mcp logs [server]", "warning");
        },
    });
    pi.registerCommand("mcp-init", {
        description: "Create a project MCP configuration template",
        handler: async (_args, ctx) => {
            if (!ctx.isProjectTrusted()) {
                notifyForMode(ctx, "MCP configuration was not created because this project is not trusted.", "warning");
                return;
            }
            const path = configTemplatePath(ctx.cwd);
            if (existsSync(path)) {
                if (!ctx.hasUI)
                    return;
                const overwrite = await ctx.ui.confirm("MCP configuration already exists", `Overwrite ${path}?`);
                if (!overwrite)
                    return;
            }
            const template = {
                mcpServers: {
                    filesystem: {
                        command: "pnpm",
                        args: ["dlx", "@modelcontextprotocol/server-filesystem", ctx.cwd],
                        env: {},
                    },
                },
            };
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, `${JSON.stringify(template, null, 2)}\n`, "utf8");
            notifyForMode(ctx, `Created MCP configuration: ${path}`, "info");
        },
    });
}
async function reconnectServer(serverName, ctx, manager, activeSession, isCurrent) {
    const state = manager.getServerState(serverName);
    if (!state || state.status === "disabled") {
        notifyForMode(ctx, `Unknown or disabled MCP server: ${serverName}`, "warning");
        return;
    }
    const session = activeSession;
    const result = await manager.reconnectServer(serverName, { source: "manual" });
    if (session && !isCurrent(session))
        return;
    if (session)
        updateFooter(ctx, manager, session.configResult);
    notifyForMode(ctx, result.connected
        ? `MCP server reconnected: ${serverName}`
        : `MCP server reconnect failed: ${serverName}${result.error ? ` (${result.error})` : ""}`, result.connected ? "info" : "error");
}
function registerMcpTool(options) {
    const { pi, manager, diagnostics, serverName, tool, fullName, availableTools } = options;
    let parameters;
    try {
        parameters = jsonSchemaToTypeBox(tool.inputSchema);
    }
    catch (error) {
        diagnostics.record({
            level: "error",
            message: "MCP tool schema conversion failed; using an unconstrained schema",
            serverName,
            context: { toolName: tool.name, fullToolName: fullName },
            error,
        });
        parameters = Type.Any();
    }
    const safeServerName = sanitizeDiagnosticText(serverName, 512);
    const safeToolName = sanitizeDiagnosticText(tool.name, 512);
    const safeFullName = sanitizeDiagnosticText(fullName, 1024);
    const baseDescription = sanitizeDiagnosticText(tool.description ?? `MCP tool ${safeToolName}`, DEFAULT_FIELD_BYTES);
    const description = `[MCP:${safeServerName}] ${baseDescription} ${MCP_OUTPUT_LIMIT_GUIDANCE}`;
    pi.registerTool({
        name: fullName,
        label: `MCP:${safeServerName}`,
        description,
        promptSnippet: description,
        promptGuidelines: [
            `Use ${safeFullName} to call the ${safeToolName} tool provided by the ${safeServerName} MCP server.`,
            MCP_OUTPUT_LIMIT_GUIDANCE,
        ],
        parameters,
        renderCall(args, theme, context) {
            return renderCompactText(formatMcpToolCallSummary(args, { serverName, toolName: tool.name, theme }), context.lastComponent);
        },
        async execute(_toolCallId, params, signal) {
            if (!availableTools.has(fullName)) {
                throw new Error(`MCP tool "${safeFullName}" is no longer available on server "${safeServerName}". Run /mcp reload or reconnect the server.`);
            }
            if (signal?.aborted) {
                throw new Error(`MCP tool "${safeFullName}" was cancelled.`);
            }
            try {
                const result = await manager.callTool(fullName, params, { signal });
                return {
                    content: toPiToolContent(result.content),
                    details: buildMcpToolDetails(serverName, tool.name, result.isError === true, result.structuredContent),
                };
            }
            catch (error) {
                if (error instanceof McpConnectionError) {
                    throw new Error(`MCP connection failed for "${safeServerName}": ${boundedErrorMessage(error)}`, {
                        cause: error,
                    });
                }
                if (error instanceof McpToolError) {
                    throw new Error(`MCP tool "${safeFullName}" failed: ${boundedErrorMessage(error)}`, {
                        cause: error,
                    });
                }
                throw new Error(`MCP tool "${safeFullName}" failed: ${boundedErrorMessage(error)}`, {
                    cause: error,
                });
            }
        },
        renderResult(result, renderOptions, theme, context) {
            return renderCompactText(formatMcpToolResultSummary(result, {
                isError: context.isError,
                isPartial: renderOptions.isPartial,
                theme,
            }), context.lastComponent);
        },
    });
}
function toPiToolContent(content) {
    const output = [];
    let remainingTextBytes = MAX_MODEL_TEXT_BYTES;
    let remainingTextLines = MAX_MODEL_TEXT_LINES;
    let serializedBlocks = 0;
    let acceptMoreText = true;
    let contentTruncated = false;
    const appendText = (text) => {
        if (!acceptMoreText) {
            contentTruncated = true;
            return;
        }
        const truncation = truncateHead(text, {
            maxBytes: remainingTextBytes,
            maxLines: remainingTextLines,
        });
        if (truncation.content.length > 0 || text.length === 0) {
            output.push({ type: "text", text: truncation.content });
        }
        remainingTextBytes = Math.max(0, remainingTextBytes - truncation.outputBytes);
        remainingTextLines = Math.max(0, remainingTextLines - truncation.outputLines);
        if (truncation.truncated || remainingTextBytes === 0 || remainingTextLines === 0) {
            acceptMoreText = false;
            contentTruncated ||= truncation.truncated;
        }
    };
    for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") {
            appendText(block.text);
            continue;
        }
        if (block.type === "image" &&
            typeof block.data === "string" &&
            typeof block.mimeType === "string") {
            output.push({ type: "image", data: block.data, mimeType: block.mimeType });
            continue;
        }
        if (serializedBlocks >= MAX_SERIALIZED_BLOCKS) {
            contentTruncated = true;
            continue;
        }
        serializedBlocks += 1;
        appendText(`MCP ${block.type || "unknown"} content: ${boundedJson(block, DEFAULT_FIELD_BYTES)}`);
    }
    if (contentTruncated) {
        output.push({ type: "text", text: MCP_OUTPUT_TRUNCATION_NOTICE });
    }
    if (output.length === 0) {
        output.push({ type: "text", text: "(No MCP content)" });
    }
    return output;
}
function buildMcpToolDetails(serverName, toolName, isError, structuredContent) {
    const base = {
        mcp: true,
        server: sanitizeDiagnosticText(serverName, DEFAULT_FIELD_BYTES),
        tool: sanitizeDiagnosticText(toolName, DEFAULT_FIELD_BYTES),
        isError,
    };
    if (structuredContent === undefined)
        return base;
    const direct = { ...base, structuredContent };
    const directBytes = serializedByteLength(direct);
    if (directBytes !== undefined && directBytes <= DEFAULT_MAX_BYTES)
        return direct;
    let serialized;
    try {
        serialized = JSON.stringify(structuredContent) ?? "[unserializable]";
    }
    catch {
        serialized = "[unserializable]";
    }
    const originalBytes = Buffer.byteLength(serialized, "utf8");
    const metadata = { truncated: true, originalBytes };
    let best = metadata;
    let low = 0;
    let high = originalBytes;
    while (low <= high) {
        const byteBudget = Math.floor((low + high) / 2);
        const prefix = utf8Prefix(serialized, byteBudget);
        const candidate = {
            ...metadata,
            ...(prefix ? { preview: `${prefix}…` } : {}),
        };
        const candidateDetails = { ...base, structuredContent: candidate };
        const candidateBytes = serializedByteLength(candidateDetails);
        if (candidateBytes !== undefined && candidateBytes <= DEFAULT_MAX_BYTES) {
            best = candidate;
            low = byteBudget + 1;
        }
        else {
            high = byteBudget - 1;
        }
    }
    const bounded = { ...base, structuredContent: best };
    return (serializedByteLength(bounded) ?? Number.POSITIVE_INFINITY) <= DEFAULT_MAX_BYTES
        ? bounded
        : base;
}
function serializedByteLength(value) {
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? undefined : Buffer.byteLength(serialized, "utf8");
    }
    catch {
        return undefined;
    }
}
function utf8Prefix(value, maxBytes) {
    let output = "";
    let bytes = 0;
    for (const character of value) {
        const characterBytes = Buffer.byteLength(character, "utf8");
        if (bytes + characterBytes > maxBytes)
            break;
        output += character;
        bytes += characterBytes;
    }
    return output;
}
function deduplicateTools(tools) {
    const byName = new Map();
    for (const tool of tools)
        byName.set(tool.name, tool);
    return [...byName.values()];
}
function toolSignature(tool) {
    return stableJson({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
        title: tool.title,
    });
}
function stableJson(value) {
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(",")}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "undefined";
}
function updateFooter(ctx, manager, configResult) {
    if (!ctx.hasUI)
        return;
    const metrics = getMetrics(configResult, manager);
    const footer = `MCP ${metrics.online}/${metrics.configured} online · ${metrics.tools} tools · ${metrics.retrying} retrying`;
    ctx.ui.setStatus("mcp", ctx.mode === "tui" ? ctx.ui.theme.fg(metrics.retrying > 0 ? "warning" : "dim", footer) : footer);
}
function getMetrics(configResult, manager) {
    const configuredNames = [...new Set(configResult.configuredServerNames)];
    let online = 0;
    let tools = 0;
    let retrying = 0;
    for (const name of configuredNames) {
        const state = manager.getServerState(name);
        if (!state)
            continue;
        if (state.connected) {
            online += 1;
            tools += deduplicateTools(state.tools).length;
        }
        if (state.status === "retrying")
            retrying += 1;
    }
    return { online, configured: configuredNames.length, tools, retrying };
}
function formatStartupSummary(configResult, manager) {
    const metrics = getMetrics(configResult, manager);
    if (configResult.status === "missing") {
        return {
            message: `MCP config not found. Create ${configTemplatePathFromResult(configResult)} to configure servers.`,
            type: "warning",
        };
    }
    if (configResult.status === "invalid" && metrics.configured === 0) {
        return { message: "MCP configuration is invalid.", type: "error" };
    }
    if (metrics.configured === 0) {
        return { message: "MCP is configured with no active servers.", type: "info" };
    }
    const failed = configResult.configuredServerNames.filter((name) => {
        const state = manager.getServerState(name);
        return !state?.connected && state?.status !== "retrying";
    });
    const message = [
        `MCP startup: ${metrics.online}/${metrics.configured} online, ${metrics.tools} tools, ${metrics.retrying} retrying.`,
        failed.length > 0 ? `Unavailable: ${failed.join(", ")}.` : undefined,
    ].filter((part) => part !== undefined).join(" ");
    return {
        message,
        type: failed.length > 0 || metrics.retrying > 0 ? "warning" : "info",
    };
}
function configTemplatePathFromResult(result) {
    return result.searchedPaths[0] ?? ".pi/mcp.json";
}
function formatStatus(configResult, manager) {
    const metrics = getMetrics(configResult, manager);
    const lines = [
        `MCP ${metrics.online}/${metrics.configured} online · ${metrics.tools} tools · ${metrics.retrying} retrying`,
    ];
    for (const name of [...new Set(configResult.configuredServerNames)]) {
        const state = manager.getServerState(name);
        const displayName = truncateToWidth(sanitizeDiagnosticText(name, DEFAULT_FIELD_BYTES), MAX_SERVER_NAME_WIDTH, "…");
        if (!state) {
            lines.push(`○ ${displayName} unknown`);
            continue;
        }
        const marker = state.connected ? "●" : state.status === "retrying" ? "◌" : "○";
        const details = [
            state.status,
            `${state.connected ? deduplicateTools(state.tools).length : 0} tools`,
            `attempt ${state.attempt}`,
            state.lastError?.category ? `error ${state.lastError.category}` : undefined,
            state.nextRetryAt !== undefined ? formatNextRetry(state.nextRetryAt) : undefined,
        ].filter((value) => value !== undefined);
        lines.push(`${marker} ${displayName} ${details.join(" · ")}`);
    }
    return lines.join("\n");
}
function formatNextRetry(nextRetryAt) {
    const remainingMs = Math.max(0, nextRetryAt - Date.now());
    if (remainingMs < 1000)
        return "retry due";
    return `retry in ${Math.ceil(remainingMs / 1000)}s`;
}
async function showLogs(serverName, ctx, diagnostics) {
    const lines = formatDiagnosticLines(diagnostics, serverName);
    if (ctx.mode === "tui") {
        await ctx.ui.custom((_tui, theme, _keybindings, done) => new McpLogsComponent(lines, theme, () => done(undefined)));
        return;
    }
    if (ctx.mode === "rpc" && ctx.hasUI) {
        notifyForMode(ctx, lines.join("\n"), "info");
    }
}
function formatDiagnosticLines(diagnostics, serverName) {
    const eventLines = diagnostics.getEvents(serverName).map((event) => {
        const repeat = event.repeats > 1 ? ` ×${event.repeats}` : "";
        const errorMetadata = [
            event.error?.category,
            event.error?.httpStatus !== undefined ? `HTTP ${event.error.httpStatus}` : undefined,
            event.error?.code !== undefined && event.error.code !== event.error.httpStatus
                ? `code ${event.error.code}`
                : undefined,
        ].filter((value) => value !== undefined).join("/");
        const details = [
            event.error?.message && event.error.message !== event.message
                ? event.error.message
                : undefined,
            Object.keys(event.context).length > 0
                ? `context=${boundedJson(event.context, DEFAULT_FIELD_BYTES)}`
                : undefined,
            event.timestamp,
        ].filter((value) => value !== undefined);
        return `[${event.level}] ${event.serverName}${errorMetadata ? ` ${errorMetadata}` : ""}: ${event.message}${repeat}${details.length > 0 ? ` · ${details.join(" · ")}` : ""}`;
    });
    const stderrLines = serverName
        ? diagnostics.getStderr(serverName).map((line) => `[stderr] ${serverName}: ${line}`)
        : [];
    const lines = [...eventLines, ...stderrLines].slice(-MAX_LOG_LINES);
    if (lines.length === 0) {
        return [serverName ? `No MCP diagnostics for ${serverName}.` : "No MCP diagnostics available."];
    }
    return lines;
}
/** Renders bounded diagnostics and closes on Escape or Enter. */
class McpLogsComponent {
    lines;
    theme;
    onClose;
    renderedWidth;
    renderedLines;
    closed = false;
    constructor(lines, theme, onClose) {
        this.lines = lines;
        this.theme = theme;
        this.onClose = onClose;
    }
    handleInput(data) {
        if (this.closed || (!matchesKey(data, "escape") && !matchesKey(data, "enter")))
            return;
        this.closed = true;
        this.onClose();
    }
    render(width) {
        if (width <= 0)
            return [];
        if (this.renderedWidth === width && this.renderedLines)
            return this.renderedLines;
        const output = [
            this.theme.fg("toolTitle", this.theme.bold("MCP diagnostics")),
            ...this.lines.map((line) => this.theme.fg("text", line)),
            this.theme.fg("dim", "Press Escape or Enter to close"),
        ].map((line) => truncateToWidth(line, width, "…"));
        this.renderedWidth = width;
        this.renderedLines = output;
        return output;
    }
    invalidate() {
        this.renderedWidth = undefined;
        this.renderedLines = undefined;
    }
}
class CompactTextComponent {
    text = new Text("", 0, 0);
    content = "";
    renderedWidth;
    setContent(content) {
        if (content === this.content)
            return;
        this.content = content;
        this.renderedWidth = undefined;
    }
    render(width) {
        if (width <= 0)
            return [];
        if (this.renderedWidth !== width) {
            const fitted = this.content
                .split("\n")
                .map((line) => truncateToWidth(line, width, "…"))
                .join("\n");
            this.text.setText(fitted);
            this.renderedWidth = width;
        }
        return this.text.render(width);
    }
    invalidate() {
        this.renderedWidth = undefined;
        this.text.invalidate();
    }
}
function renderCompactText(content, lastComponent) {
    const component = lastComponent instanceof CompactTextComponent
        ? lastComponent
        : new CompactTextComponent();
    component.setContent(content);
    return component;
}
function formatMcpToolCallSummary(args, options) {
    const safeServerName = sanitizeDiagnosticText(options.serverName, DEFAULT_FIELD_BYTES);
    const safeToolName = sanitizeDiagnosticText(options.toolName, DEFAULT_FIELD_BYTES);
    const title = options.theme.fg("toolTitle", options.theme.bold(`${safeServerName} / ${safeToolName}`));
    const argumentSummary = formatMcpToolArguments(args);
    return argumentSummary ? `${title}\n${options.theme.fg("dim", argumentSummary)}` : title;
}
function formatMcpToolArguments(args) {
    if (!isRecord(args))
        return "";
    const entries = ownEntries(args, 8);
    if (entries.length === 0)
        return "";
    const preferredString = entries.find(([key, value]) => !SENSITIVE_ARGUMENT_KEY.test(key) &&
        typeof value === "string" &&
        value.trim().length > 0)?.[1];
    if (typeof preferredString === "string") {
        return inlinePreview(preferredString, MAX_ARGUMENT_PREVIEW_WIDTH);
    }
    return inlinePreview(safeJson(summarizeArgumentValue(args, 0, new WeakSet())), MAX_ARGUMENT_PREVIEW_WIDTH);
}
function summarizeArgumentValue(value, depth, seen) {
    if (value === null || typeof value === "number" || typeof value === "boolean")
        return value;
    if (typeof value === "string")
        return inlinePreview(value, 120);
    if (typeof value === "bigint")
        return value.toString();
    if (typeof value !== "object")
        return String(value);
    if (seen.has(value))
        return "[circular]";
    if (depth >= 2)
        return Array.isArray(value) ? `[… +${value.length} items]` : "{…}";
    seen.add(value);
    if (Array.isArray(value)) {
        const items = value.slice(0, 3).map((item) => summarizeArgumentValue(item, depth + 1, seen));
        if (value.length > items.length)
            items.push(`… +${value.length - items.length} items`);
        seen.delete(value);
        return items;
    }
    const entries = ownEntries(value, 5);
    const result = {};
    for (const [key, item] of entries.slice(0, 4)) {
        result[key] = SENSITIVE_ARGUMENT_KEY.test(key)
            ? "[redacted]"
            : summarizeArgumentValue(item, depth + 1, seen);
    }
    if (entries.length > 4)
        result["…"] = "more fields";
    seen.delete(value);
    return result;
}
function formatMcpToolResultSummary(result, options) {
    const text = extractToolResultText(result);
    const rawSize = Buffer.byteLength(text, "utf8");
    const details = isRecord(result) ? asRecord(result.details) : undefined;
    const isError = options.isError || details?.isError === true;
    const marker = options.isPartial ? "…" : isError ? "✗" : "✓";
    const markerColor = options.isPartial ? "warning" : isError ? "error" : "success";
    const status = options.isPartial ? "running" : isError ? "failed" : "completed";
    const preview = inlinePreview(text, MAX_RESULT_PREVIEW_WIDTH) || "(empty MCP result)";
    return [
        `${options.theme.fg(markerColor, marker)} ${options.theme.fg("muted", `${status} · ${formatBytes(rawSize)}`)}`,
        options.theme.fg("toolOutput", preview),
    ].join("\n");
}
function extractToolResultText(result) {
    if (!isRecord(result) || !Array.isArray(result.content))
        return "";
    return result.content.map((item) => {
        if (isRecord(item) && item.type === "text" && typeof item.text === "string")
            return item.text;
        if (isRecord(item) && item.type === "image")
            return `[image: ${String(item.mimeType ?? "unknown")}]`;
        return boundedJson(item, DEFAULT_FIELD_BYTES);
    }).join("\n");
}
function notifyStatusForMode(ctx, message) {
    if (!ctx.hasUI)
        return;
    const boundedMessage = boundedUserMessage(message);
    if (ctx.mode !== "tui") {
        ctx.ui.notify(boundedMessage, "info");
        return;
    }
    const themedMessage = boundedMessage.split("\n").map((line, index) => {
        if (index === 0 || line.length === 0)
            return line;
        const marker = line[0];
        const markerColor = marker === "●"
            ? "success"
            : marker === "◌" || marker === "○"
                ? "warning"
                : undefined;
        return markerColor
            ? `${ctx.ui.theme.fg(markerColor, marker)}${line.slice(1)}`
            : line;
    }).join("\n");
    ctx.ui.notify(themedMessage, "info");
}
function notifyForMode(ctx, message, type) {
    if (!ctx.hasUI)
        return;
    ctx.ui.notify(boundedUserMessage(message), type);
}
function boundedUserMessage(message) {
    const boundedMessage = truncateToWidth(sanitizeDiagnosticText(message, DEFAULT_FIELD_BYTES), DEFAULT_USER_MESSAGE_WIDTH, "…");
    return sanitizeDiagnosticText(boundedMessage, DEFAULT_FIELD_BYTES);
}
function currentConfigResult(ctx, activeSession, diagnostics) {
    if (activeSession?.ctx.cwd === ctx.cwd)
        return activeSession.configResult;
    return loadMcpConfigResult(ctx.cwd, diagnostics, {
        allowProjectConfig: ctx.isProjectTrusted(),
    });
}
function splitCommandArguments(args) {
    return args?.trim() ? args.trim().split(/\s+/) : [];
}
function ownEntries(value, limit) {
    const entries = [];
    for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key))
            continue;
        entries.push([key, value[key]]);
        if (entries.length >= limit)
            break;
    }
    return entries;
}
function inlinePreview(text, maxWidth) {
    const boundedSource = text.slice(0, MAX_PREVIEW_SOURCE_CHARS);
    const safeText = sanitizeDiagnosticText(boundedSource, DEFAULT_FIELD_BYTES);
    return truncateToWidth(safeText.replace(/\s+/g, " ").trim(), maxWidth, "…");
}
function boundedJson(value, maxBytes) {
    return truncateUtf8(safeJson(value), maxBytes).value;
}
function safeJson(value) {
    try {
        return JSON.stringify(value) ?? String(value);
    }
    catch {
        return "[unserializable]";
    }
}
function boundedErrorMessage(error) {
    const message = error instanceof Error ? error.message : String(error);
    return sanitizeDiagnosticText(message, DEFAULT_USER_MESSAGE_WIDTH);
}
function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0)
        return "0 B";
    if (bytes < 1024)
        return `${bytes} B`;
    const kib = bytes / 1024;
    if (kib < 1024)
        return `${formatDecimal(kib)} KB`;
    return `${formatDecimal(kib / 1024)} MB`;
}
function formatDecimal(value) {
    return value >= 10 ? `${Math.round(value)}` : value.toFixed(1);
}
function asRecord(value) {
    return typeof value === "object" && value !== null
        ? value
        : undefined;
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
async function shutdownManager(manager) {
    if (typeof manager.shutdown === "function") {
        await manager.shutdown();
        return;
    }
    await manager.disconnectAll();
}
//# sourceMappingURL=index.js.map