import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { getAgentDir, } from "@earendil-works/pi-coding-agent";
import { PI_SUBAGENT_LAUNCH, PI_SUBAGENT_MAX_ACTIVE, PI_SUBAGENT_PARENT, PI_SUBAGENT_STATE_ROOT, SubagentManager, } from "./manager.js";
import { SessionRuntimeHost } from "./runtime-host.js";
import { DELIVERY_RECEIPT_TYPE } from "./delivery-receipt.js";
import { SessionStateStore, SESSION_STATE_SCHEMA_VERSION, } from "./state-store.js";
import { TmuxRuntime } from "./tmux-runtime.js";
import { executeCommand } from "./command-executor.js";
import { registerSubagentTools } from "./tools.js";
import { assignUsage, GOAL_TASK_EVENT, registerChildUsage, usageDirectory } from "./usage.js";
const PI_SUBAGENT_TMUX_PATH = "PI_SUBAGENT_TMUX_PATH";
const PI_SUBAGENT_PI_PATH = "PI_SUBAGENT_PI_PATH";
export default function subagentExtension(pi, options = {}) {
    const env = options.env ?? process.env;
    const configuredAgentDir = env.PI_CODING_AGENT_DIR ?? getAgentDir();
    const agentDir = resolve(configuredAgentDir === "~" ? (env.HOME ?? homedir())
        : configuredAgentDir.startsWith("~/") ? join(env.HOME ?? homedir(), configuredAgentDir.slice(2)) : configuredAgentDir);
    const stateRoot = resolve(options.stateRoot
        ?? env[PI_SUBAGENT_STATE_ROOT]
        ?? join(agentDir, "subagents"));
    const nativeSessionRoot = resolve(options.nativeSessionRoot
        ?? join(agentDir, "sessions", "subagents"));
    const extensionPath = resolve(options.extensionPath ?? fileURLToPath(import.meta.url));
    const tmuxPath = resolveProgramPath(options.tmuxPath ?? env[PI_SUBAGENT_TMUX_PATH] ?? "tmux");
    const piPath = resolveProgramPath(options.piPath ?? env[PI_SUBAGENT_PI_PATH] ?? "pi");
    const tmuxSessionName = options.tmuxSessionName ?? defaultTmuxSessionName(stateRoot);
    const store = options.store ?? new SessionStateStore(stateRoot);
    const runtime = options.runtime ?? new TmuxRuntime({
        execute: executeCommand,
        tmuxPath,
        sessionName: tmuxSessionName,
        transferDirectory: join(stateRoot, "tmp", "prompt-transfer"),
    });
    const parent = parseParentOwnership(env[PI_SUBAGENT_PARENT]);
    const launch = parseLaunchMetadata(env[PI_SUBAGENT_LAUNCH]);
    if ((parent === undefined) !== (launch === undefined)) {
        throw new Error("Managed child environment must include both parent and launch metadata");
    }
    const host = new SessionRuntimeHost({
        store,
        ...(parent ? { parent } : {}),
        ...(launch ? { launch } : {}),
        createEpoch: options.createId ?? randomUUID,
        ...(options.now ? { now: options.now } : {}),
    });
    const manager = new SubagentManager({
        store,
        runtime,
        stateRoot,
        nativeSessionRoot,
        extensionPath,
        piPath,
        environment: {
            ...childEnvironment(env),
            PI_CODING_AGENT_DIR: agentDir,
            [PI_SUBAGENT_TMUX_PATH]: tmuxPath,
            [PI_SUBAGENT_PI_PATH]: piPath,
        },
        beforePrompt: async (parentSessionId, child) => {
            const processId = child.launch?.processInstanceId;
            if (!processId)
                throw new Error("Managed child has no process identity.");
            const directory = usageDirectory(stateRoot, processId);
            const request = { parentSessionId, directory, promises: [] };
            pi.events.emit(GOAL_TASK_EVENT, request);
            const sources = await Promise.all(request.promises);
            if (sources.length > 1)
                throw new Error("Multiple goal accounting owners responded.");
            // Clear a previous assignment when no active goal owns this delivery.
            await assignUsage(directory, sources[0]);
        },
        maxActive: options.maxActive ?? parseMaxActive(env[PI_SUBAGENT_MAX_ACTIVE]),
        ...(options.createId ? { createId: options.createId } : {}),
        ...(options.now ? { now: options.now } : {}),
    });
    if (!parent) {
        registerSubagentTools(pi, manager);
    }
    else if (launch) {
        registerChildUsage(pi, usageDirectory(stateRoot, launch.processInstanceId));
    }
    let controlledSessionId;
    pi.on("session_start", async (_event, ctx) => {
        const sessionFile = ctx.sessionManager.getSessionFile();
        if (!sessionFile)
            return;
        if (!parent) {
            if (controlledSessionId && controlledSessionId !== ctx.sessionManager.getSessionId()) {
                try {
                    await host.shutdown();
                }
                finally {
                    await manager.releaseNamespace(controlledSessionId);
                    controlledSessionId = undefined;
                }
            }
            if (!await manager.claimNamespace(ctx.sessionManager.getSessionId(), false))
                return;
            controlledSessionId = ctx.sessionManager.getSessionId();
            host.setControllerGuard(await manager.controllerGuard(controlledSessionId));
        }
        let tmux;
        if (parent) {
            const paneId = env.TMUX_PANE;
            if (!paneId || !runtime.locatePane) {
                throw new Error("Managed child could not locate its tmux pane");
            }
            tmux = await runtime.locatePane(paneId, launch?.processInstanceId);
            if (tmux.processInstanceId && tmux.panePid !== process.pid)
                throw new Error("Child Pi process does not match its registered pane process");
            if (launch?.configuration && JSON.stringify(launch.configuration) !== JSON.stringify({
                protocolVersion: SESSION_STATE_SCHEMA_VERSION, agentDir, tmuxPath, piPath,
            }))
                throw new Error("Subagent launch configuration handshake failed");
        }
        await host.startSession({
            sessionId: ctx.sessionManager.getSessionId(),
            cwd: ctx.cwd,
            sessionFile,
            leafId: ctx.sessionManager.getLeafId(),
            leafPosition: ctx.sessionManager.getEntries().length,
            pid: process.pid,
            ...(tmux ? { tmux } : {}),
            ...(parent ? { configuration: { protocolVersion: SESSION_STATE_SCHEMA_VERSION, agentDir, tmuxPath, piPath } } : {}),
        });
        if (controlledSessionId)
            await manager.claimNamespace(controlledSessionId);
    });
    pi.on("agent_start", async () => {
        await host.agentStarted();
    });
    if (parent)
        pi.on("message_start", async (event) => {
            if (event.message.role !== "user")
                return;
            const content = event.message.content;
            const text = typeof content === "string" ? content : content
                .filter((part) => part.type === "text").map((part) => part.text).join("\n");
            const receipt = await host.consumePrompt(text);
            if (receipt)
                pi.appendEntry(DELIVERY_RECEIPT_TYPE, receipt);
        });
    pi.on("agent_settled", async (_event, ctx) => {
        await host.leafChanged(ctx.sessionManager.getLeafId(), false, ctx.sessionManager.getEntries().length);
        await host.agentSettled();
    });
    pi.on("session_tree", async (event, ctx) => {
        await host.leafChanged(event.newLeafId, true, ctx.sessionManager.getEntries().length);
    });
    pi.on("session_shutdown", async () => {
        try {
            await host.shutdown();
        }
        finally {
            if (controlledSessionId)
                await manager.releaseNamespace(controlledSessionId);
            controlledSessionId = undefined;
        }
    });
}
function parseParentOwnership(value) {
    if (value === undefined)
        return undefined;
    const parsed = parseJsonObject(value, PI_SUBAGENT_PARENT);
    if (typeof parsed.sessionId !== "string"
        || typeof parsed.epoch !== "string"
        || typeof parsed.registrationToken !== "string") {
        throw new Error(`Invalid ${PI_SUBAGENT_PARENT}`);
    }
    return {
        sessionId: parsed.sessionId,
        epoch: parsed.epoch,
        registrationToken: parsed.registrationToken,
    };
}
function parseLaunchMetadata(value) {
    if (value === undefined)
        return undefined;
    const parsed = parseJsonObject(value, PI_SUBAGENT_LAUNCH);
    if (typeof parsed.cwd !== "string"
        || typeof parsed.sessionDir !== "string"
        || typeof parsed.displayName !== "string"
        || typeof parsed.processInstanceId !== "string"
        || !(parsed.model === undefined || typeof parsed.model === "string")
        || !(parsed.thinkingLevel === undefined || typeof parsed.thinkingLevel === "string")) {
        throw new Error(`Invalid ${PI_SUBAGENT_LAUNCH}`);
    }
    if (parsed.configuration !== undefined) {
        const configuration = parsed.configuration;
        if (!configuration || configuration.protocolVersion !== SESSION_STATE_SCHEMA_VERSION
            || typeof configuration.agentDir !== "string" || typeof configuration.tmuxPath !== "string" || typeof configuration.piPath !== "string") {
            throw new Error("Invalid subagent launch configuration");
        }
    }
    return {
        ...(parsed.configuration ? { configuration: parsed.configuration } : {}),
        cwd: parsed.cwd,
        sessionDir: parsed.sessionDir,
        displayName: parsed.displayName,
        processInstanceId: parsed.processInstanceId,
        ...(typeof parsed.model === "string" ? { model: parsed.model } : {}),
        ...(typeof parsed.thinkingLevel === "string"
            ? { thinkingLevel: parsed.thinkingLevel }
            : {}),
    };
}
function parseJsonObject(value, name) {
    try {
        const parsed = JSON.parse(value);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("expected an object");
        }
        return parsed;
    }
    catch (error) {
        throw new Error(`Invalid ${name}`, { cause: error });
    }
}
function resolveProgramPath(path) {
    return path.includes("/") ? resolve(path) : path;
}
function childEnvironment(env) {
    const allowed = /^(?:PATH|HOME|SHELL|TERM|COLORTERM|LANG|LC_[A-Z_]+|TMPDIR|XDG_[A-Z_]+|PI_PERMISSIONS_MODE|PI_SUBAGENT_MAX_ACTIVE)$/u;
    return Object.fromEntries(Object.entries(env).filter((entry) => entry[1] !== undefined && allowed.test(entry[0])));
}
function parseMaxActive(value) {
    if (value === undefined)
        return 3;
    if (!/^[1-9]\d*$/u.test(value)) {
        throw new Error("Invalid PI_SUBAGENT_MAX_ACTIVE: expected a positive integer");
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        throw new Error("Invalid PI_SUBAGENT_MAX_ACTIVE: expected a positive integer");
    }
    return parsed;
}
function defaultTmuxSessionName(stateRoot) {
    const digest = createHash("sha256").update(stateRoot).digest("hex").slice(0, 12);
    return `pi-subagents-${digest}`;
}
//# sourceMappingURL=index.js.map