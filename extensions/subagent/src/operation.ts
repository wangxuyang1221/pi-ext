import { AsyncLocalStorage } from "node:async_hooks";

const scope = new AsyncLocalStorage<Operation>();
export const currentOperation = (): Operation | undefined => scope.getStore();

export async function withOperation<T>(timeoutMs: number, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  if (currentOperation()) return work();
  const operation = new Operation(timeoutMs, signal);
  let result: T | undefined;
  const failures: unknown[] = [];
  try { result = await scope.run(operation, () => operation.run(work)); }
  catch (error) { failures.push(error); }
  finally {
    operation.dispose();
    try { await operation.drainResources(); }
    catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, `${String(failures[0])}; cleanup also failed`, { cause: failures[0] });
  return result as T;
}

export class DeadlineExceeded extends Error {
  constructor() { super("Subagent operation timed out; mutation outcome may be unknown"); }
}

/** Owns one deadline and propagates cancellation to every underlying operation. */
export class Operation {
  readonly signal: AbortSignal;
  assertAuthorized?: () => Promise<void>;
  interruptionError?: (reason: unknown) => Error;
  private readonly resources = new Set<Promise<unknown>>();
  private readonly cleanupErrors: unknown[] = [];

  reportCleanupError(error: unknown): void { this.cleanupErrors.push(error); }

  trackResource<T>(promise: Promise<T>): Promise<T> {
    this.resources.add(promise);
    void promise.then(() => this.resources.delete(promise), () => this.resources.delete(promise));
    return promise;
  }

  async drainResources(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...this.resources]),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Subagent command cleanup could not be confirmed")), 750); }),
      ]);
    } finally { clearTimeout(timer); }
    if (this.cleanupErrors.length) throw new AggregateError(this.cleanupErrors, "Subagent cleanup failed");
  }
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly startedAt = performance.now();
  private readonly abort = () => this.controller.abort(this.parent?.reason);

  constructor(readonly timeoutMs: number, private readonly parent?: AbortSignal) {
    this.signal = this.controller.signal;
    this.timer = setTimeout(() => this.controller.abort(new DeadlineExceeded()), timeoutMs);
    parent?.addEventListener("abort", this.abort, { once: true });
    if (parent?.aborted) this.abort();
  }

  get remainingMs(): number { return Math.max(0, this.timeoutMs - (performance.now() - this.startedAt)); }

  async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(this.interruptionError?.(this.signal.reason) ?? this.signal.reason);
      this.signal.addEventListener("abort", abort, { once: true });
      Promise.resolve().then(() => {
        this.signal.throwIfAborted();
        return work(this.signal);
      }).then(resolve, reject).finally(() => this.signal.removeEventListener("abort", abort));
    });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.parent?.removeEventListener("abort", this.abort);
  }
}
