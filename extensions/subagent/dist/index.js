import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getAgentDir, } from "@earendil-works/pi-coding-agent";
import { PI_SUBAGENT_LAUNCH, PI_SUBAGENT_PARENT, PI_SUBAGENT_STATE_ROOT, SubagentManager, } from "./manager.js";
import { SessionRuntimeHost } from "./runtime-host.js";
import { SessionStateStore, } from "./state-store.js";
import { TmuxRuntime } from "./tmux-runtime.js";
import { registerSubagentTools } from "./tools.js";
const PI_SUBAGENT_TMUX_PATH = "PI_SUBAGENT_TMUX_PATH";
const PI_SUBAGENT_PI_PATH = "PI_SUBAGENT_PI_PATH";
export default function subagentExtension(pi, options = {}) {
    const env = options.env ?? process.env;
    const agentDir = getAgentDir();
    const stateRoot = options.stateRoot
        ?? env[PI_SUBAGENT_STATE_ROOT]
        ?? join(agentDir, "subagents");
    const nativeSessionRoot = options.nativeSessionRoot
        ?? join(agentDir, "sessions", "subagents");
    const extensionPath = options.extensionPath ?? fileURLToPath(import.meta.url);
    const tmuxPath = options.tmuxPath ?? env[PI_SUBAGENT_TMUX_PATH] ?? "tmux";
    const piPath = options.piPath ?? env[PI_SUBAGENT_PI_PATH] ?? "pi";
    const tmuxSessionName = options.tmuxSessionName ?? defaultTmuxSessionName(stateRoot);
    const store = options.store ?? new SessionStateStore(stateRoot);
    const runtime = options.runtime ?? new TmuxRuntime({
        execute: async (command, args, execOptions) => pi.exec(command, args, execOptions),
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
        environment: childEnvironment(env),
        ...(options.createId ? { createId: options.createId } : {}),
        ...(options.now ? { now: options.now } : {}),
    });
    registerSubagentTools(pi, manager);
    pi.on("session_start", async (_event, ctx) => {
        const sessionFile = ctx.sessionManager.getSessionFile();
        if (!sessionFile)
            return;
        let tmux;
        if (parent) {
            const paneId = env.TMUX_PANE;
            if (!paneId || !runtime.locatePane) {
                throw new Error("Managed child could not locate its tmux pane");
            }
            tmux = await runtime.locatePane(paneId);
        }
        await host.startSession({
            sessionId: ctx.sessionManager.getSessionId(),
            cwd: ctx.cwd,
            sessionFile,
            leafId: ctx.sessionManager.getLeafId(),
            pid: process.pid,
            ...(tmux ? { tmux } : {}),
        });
    });
    pi.on("agent_start", async () => {
        await host.agentStarted();
    });
    pi.on("agent_settled", async (_event, ctx) => {
        await host.leafChanged(ctx.sessionManager.getLeafId());
        await host.agentSettled();
    });
    pi.on("session_tree", async (event) => {
        await host.leafChanged(event.newLeafId);
    });
    pi.on("session_shutdown", async () => {
        await host.shutdown();
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
    return {
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
function childEnvironment(env) {
    const allowed = /^(?:PATH|HOME|SHELL|TERM|COLORTERM|LANG|LC_[A-Z_]+|TMPDIR|XDG_[A-Z_]+|PI_PERMISSIONS_MODE)$/u;
    return Object.fromEntries(Object.entries(env).filter((entry) => entry[1] !== undefined && allowed.test(entry[0])));
}
function defaultTmuxSessionName(stateRoot) {
    const digest = createHash("sha256").update(stateRoot).digest("hex").slice(0, 12);
    return `pi-subagents-${digest}`;
}
//# sourceMappingURL=index.js.map