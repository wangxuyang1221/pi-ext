import { randomUUID } from "node:crypto";
import { readFile, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
export const SESSION_STATE_SCHEMA_VERSION = 1;
export function createSessionState(options) {
    return {
        schemaVersion: SESSION_STATE_SCHEMA_VERSION,
        sessionId: options.sessionId,
        epoch: options.epoch,
        ...(options.parent ? { parent: options.parent } : {}),
        ...(options.launch ? { launch: options.launch } : {}),
        runtime: {
            status: "running",
            busy: false,
            generation: 0,
            settledGeneration: 0,
            cwd: options.cwd,
            sessionFile: options.sessionFile,
            ...(options.pid === undefined ? {} : { pid: options.pid }),
            ...(options.processInstanceId ? { processInstanceId: options.processInstanceId } : {}),
            ...(options.tmux ? { tmux: options.tmux } : {}),
            updatedAt: options.now,
        },
        children: [],
    };
}
export class SessionStateStore {
    root;
    updateQueues = new Map();
    constructor(root) {
        this.root = root;
    }
    statePath(sessionId) {
        assertSessionId(sessionId);
        return join(this.root, "sessions", sessionId, "state.json");
    }
    async load(sessionId) {
        const path = this.statePath(sessionId);
        try {
            const parsed = JSON.parse(await readFile(path, "utf8"));
            return parseSessionState(parsed, sessionId);
        }
        catch (error) {
            if (isNodeError(error) && error.code === "ENOENT")
                return undefined;
            throw error;
        }
    }
    async list() {
        const sessionsDirectory = join(this.root, "sessions");
        let entries;
        try {
            entries = await readdir(sessionsDirectory, { withFileTypes: true });
        }
        catch (error) {
            if (isNodeError(error) && error.code === "ENOENT")
                return [];
            throw error;
        }
        const states = await Promise.all(entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => this.load(entry.name)));
        return states
            .filter((state) => state !== undefined)
            .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
    }
    async delete(sessionId) {
        const previous = this.updateQueues.get(sessionId) ?? Promise.resolve();
        await previous.catch(() => undefined);
        await rm(dirname(this.statePath(sessionId)), { recursive: true, force: true });
    }
    async update(sessionId, updater) {
        const previous = this.updateQueues.get(sessionId) ?? Promise.resolve();
        const operation = previous
            .catch(() => undefined)
            .then(async () => {
            const state = await this.load(sessionId);
            if (!state)
                throw new Error(`Subagent state not found: ${sessionId}`);
            const updated = await updater(state);
            await this.save(updated);
            return updated;
        });
        const tail = operation.then(() => undefined, () => undefined);
        this.updateQueues.set(sessionId, tail);
        try {
            return await operation;
        }
        finally {
            if (this.updateQueues.get(sessionId) === tail) {
                this.updateQueues.delete(sessionId);
            }
        }
    }
    async save(state) {
        const path = this.statePath(state.sessionId);
        await mkdir(dirname(path), { recursive: true });
        const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
                encoding: "utf8",
                mode: 0o600,
            });
            await rename(temporaryPath, path);
        }
        finally {
            await rm(temporaryPath, { force: true });
        }
    }
}
function parseSessionState(value, expectedSessionId) {
    if (!isRecord(value))
        throw new Error("Invalid subagent state: expected an object");
    if (value.schemaVersion !== SESSION_STATE_SCHEMA_VERSION) {
        throw new Error(`Unsupported subagent state schema: ${String(value.schemaVersion)}`);
    }
    if (value.sessionId !== expectedSessionId) {
        throw new Error("Invalid subagent state: sessionId does not match its partition");
    }
    if (typeof value.epoch !== "string" || !isRecord(value.runtime) || !Array.isArray(value.children)) {
        throw new Error("Invalid subagent state: missing required fields");
    }
    return value;
}
function assertSessionId(sessionId) {
    if (!/^[A-Za-z0-9._-]+$/u.test(sessionId)) {
        throw new Error(`Invalid sessionId: ${sessionId}`);
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
//# sourceMappingURL=state-store.js.map