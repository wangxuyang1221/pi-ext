import { AsyncLocalStorage } from "node:async_hooks";
const scope = new AsyncLocalStorage();
export const currentOperation = () => scope.getStore();
export async function withOperation(timeoutMs, signal, work) {
    if (currentOperation())
        return work();
    const operation = new Operation(timeoutMs, signal);
    let result;
    const failures = [];
    try {
        result = await scope.run(operation, () => operation.run(work));
    }
    catch (error) {
        failures.push(error);
    }
    finally {
        operation.dispose();
        try {
            await operation.drainResources();
        }
        catch (error) {
            failures.push(error);
        }
    }
    if (failures.length === 1)
        throw failures[0];
    if (failures.length > 1)
        throw new AggregateError(failures, `${String(failures[0])}; cleanup also failed`, { cause: failures[0] });
    return result;
}
export class DeadlineExceeded extends Error {
    constructor() { super("Subagent operation timed out; mutation outcome may be unknown"); }
}
/** Owns one deadline and propagates cancellation to every underlying operation. */
export class Operation {
    timeoutMs;
    parent;
    signal;
    assertAuthorized;
    interruptionError;
    resources = new Set();
    cleanupErrors = [];
    reportCleanupError(error) { this.cleanupErrors.push(error); }
    trackResource(promise) {
        this.resources.add(promise);
        void promise.then(() => this.resources.delete(promise), () => this.resources.delete(promise));
        return promise;
    }
    async drainResources() {
        let timer;
        try {
            await Promise.race([
                Promise.allSettled([...this.resources]),
                new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Subagent command cleanup could not be confirmed")), 750); }),
            ]);
        }
        finally {
            clearTimeout(timer);
        }
        if (this.cleanupErrors.length)
            throw new AggregateError(this.cleanupErrors, "Subagent cleanup failed");
    }
    controller = new AbortController();
    timer;
    startedAt = performance.now();
    abort = () => this.controller.abort(this.parent?.reason);
    constructor(timeoutMs, parent) {
        this.timeoutMs = timeoutMs;
        this.parent = parent;
        this.signal = this.controller.signal;
        this.timer = setTimeout(() => this.controller.abort(new DeadlineExceeded()), timeoutMs);
        parent?.addEventListener("abort", this.abort, { once: true });
        if (parent?.aborted)
            this.abort();
    }
    get remainingMs() { return Math.max(0, this.timeoutMs - (performance.now() - this.startedAt)); }
    async run(work) {
        this.signal.throwIfAborted();
        return new Promise((resolve, reject) => {
            const abort = () => reject(this.interruptionError?.(this.signal.reason) ?? this.signal.reason);
            this.signal.addEventListener("abort", abort, { once: true });
            Promise.resolve().then(() => {
                this.signal.throwIfAborted();
                return work(this.signal);
            }).then(resolve, reject).finally(() => this.signal.removeEventListener("abort", abort));
        });
    }
    dispose() {
        clearTimeout(this.timer);
        this.parent?.removeEventListener("abort", this.abort);
    }
}
//# sourceMappingURL=operation.js.map