import { markAgentSettled, markAgentStarted, markRuntimeStopped, } from "./lifecycle.js";
import { activateSession } from "./runtime-state.js";
export class SessionRuntimeHost {
    store;
    parent;
    launch;
    createEpoch;
    now;
    activeSessionId;
    constructor(options) {
        this.store = options.store;
        this.parent = options.parent;
        this.launch = options.launch;
        this.createEpoch = options.createEpoch;
        this.now = options.now ?? (() => new Date().toISOString());
    }
    getActiveSessionId() {
        return this.activeSessionId;
    }
    async startSession(options) {
        if (this.activeSessionId && this.activeSessionId !== options.sessionId) {
            await this.shutdown();
        }
        const existing = await this.store.load(options.sessionId);
        let state = activateSession(existing, {
            sessionId: options.sessionId,
            cwd: options.cwd,
            sessionFile: options.sessionFile,
            now: this.now(),
            ...(this.parent ? { parent: this.parent } : {}),
            ...(this.launch ? { launch: this.launch } : {}),
            ...(options.pid === undefined ? {} : { pid: options.pid }),
            ...(this.launch ? { processInstanceId: this.launch.processInstanceId } : {}),
            ...(options.tmux ? { tmux: options.tmux } : {}),
            createEpoch: this.createEpoch,
        });
        if (options.leafId !== null) {
            state = {
                ...state,
                runtime: { ...state.runtime, leafId: options.leafId },
            };
        }
        await this.store.save(state);
        this.activeSessionId = options.sessionId;
    }
    async agentStarted() {
        await this.updateActive((state) => markAgentStarted(state, this.now()));
    }
    async agentSettled() {
        await this.updateActive((state) => (markAgentSettled(state, this.now(), state.runtime.leafId)));
    }
    async leafChanged(leafId) {
        await this.updateActive((state) => {
            const { leafId: _oldLeafId, ...runtime } = state.runtime;
            return {
                ...state,
                runtime: {
                    ...runtime,
                    ...(leafId === null ? {} : { leafId }),
                    updatedAt: this.now(),
                },
            };
        });
    }
    async shutdown() {
        if (!this.activeSessionId)
            return;
        const sessionId = this.activeSessionId;
        await this.store.update(sessionId, (state) => (markRuntimeStopped(state, "closed", this.now())));
        this.activeSessionId = undefined;
    }
    async updateActive(updater) {
        if (!this.activeSessionId)
            return;
        await this.store.update(this.activeSessionId, updater);
    }
}
//# sourceMappingURL=runtime-host.js.map