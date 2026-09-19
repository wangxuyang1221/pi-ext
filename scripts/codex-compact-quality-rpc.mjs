import { createInterface } from "node:readline";

/** Stdio client used only by the pinned CLI comparison, never by the extension. */
export class LineRpc {
  constructor(child, { record = () => {}, maxBytes = 64 * 1024 * 1024, serverHandlers = {}, serverRequestTimeoutMs = 60_000 } = {}) {
    if (!Number.isFinite(serverRequestTimeoutMs) || serverRequestTimeoutMs <= 0) throw new Error("A finite positive server request timeout is required");
    if (Object.values(serverHandlers).some((handler) => typeof handler !== "function")) throw new Error("Invalid server request handler");
    this.serverRequestTimeoutMs = serverRequestTimeoutMs;
    this.serverTimers = new Set();
    this.child = child;
    this.record = record;
    this.maxBytes = maxBytes;
    this.serverHandlers = new Map(Object.entries(serverHandlers));
    this.serverAbort = new AbortController();
    this.serverQueue = Promise.resolve();
    this.serverRequestIds = new Set();
    this.bytes = 0;
    this.events = [];
    this.pending = new Map();
    this.waiters = new Set();
    this.nextId = 1;
    this.error = undefined;
    this.lines = createInterface({ input: child.stdout });
    this.onLine = (line) => {
      try {
        this.bytes += Buffer.byteLength(line);
        if (this.bytes > this.maxBytes) throw new Error("RPC capture limit exceeded");
        const row = JSON.parse(line);
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid RPC record");
        this.record({ direction: "receive", row });
        if (typeof row.method === "string") {
          this.events.push(row);
          if (row.id !== undefined) {
            this.handleServerRequest(row);
          }
          for (const wake of [...this.waiters]) wake();
        } else if (this.pending.has(row.id)) {
          const pending = this.pending.get(row.id);
          this.pending.delete(row.id);
          clearTimeout(pending.timer);
          if (row.error) pending.reject(new Error(`RPC ${pending.method}: ${JSON.stringify(row.error)}`));
          else if (Object.hasOwn(row, "result")) pending.resolve(row.result);
          else pending.reject(new Error("RPC reply has neither result nor error"));
        }
      } catch (error) { this.fail(error); }
    };
    this.onExit = (code, signal) => this.fail(new Error(`CLI exited: ${code ?? signal}`));
    this.onError = (error) => this.fail(error);
    this.lines.on("line", this.onLine);
    child.on("exit", this.onExit);
    child.on("error", this.onError);
    child.stdin.on("error", this.onError);
    child.stdout.on("error", this.onError);
  }

  handleServerRequest(row) {
    if (!(typeof row.id === "string" || Number.isSafeInteger(row.id))) throw new Error("Invalid server request ID");
    if (this.serverRequestIds.has(row.id)) throw new Error("Duplicate server request ID");
    this.serverRequestIds.add(row.id);
    const handler = this.serverHandlers.get(row.method);
    if (!handler) {
      this.send({ id: row.id, error: { code: -32601, message: "Interactive server requests are not permitted in this experiment" } });
      return;
    }
    const timer = setTimeout(() => this.fail(new Error(`Server request timed out: ${row.method}`)), this.serverRequestTimeoutMs);
    this.serverTimers.add(timer);
    this.serverQueue = this.serverQueue.then(async () => {
      if (this.error) return;
      const result = await handler(row.params, this.serverAbort.signal);
      if (!this.error) this.send({ id: row.id, result });
    }).catch((error) => this.fail(error)).finally(() => {
      clearTimeout(timer);
      this.serverTimers.delete(timer);
    });
  }

  send(row) {
    if (this.error) throw this.error;
    this.record({ direction: "send", row });
    this.child.stdin.write(JSON.stringify(row) + "\n");
  }

  request(method, params, timeout = 60_000) {
    if (!Number.isFinite(timeout) || timeout <= 0) return Promise.reject(new Error("A finite positive RPC timeout is required"));
    if (this.error) return Promise.reject(this.error);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC request timed out: ${method}`));
      }, timeout);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  waitFor(predicate, after = 0, timeout = 60_000) {
    if (!Number.isSafeInteger(after) || after < 0 || after > this.events.length || !Number.isFinite(timeout) || timeout <= 0) {
      return Promise.reject(new Error("Invalid notification cursor or timeout"));
    }
    return new Promise((resolve, reject) => {
      let cursor = after;
      const finish = (error, value) => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        error ? reject(error) : resolve(value);
      };
      const wake = () => {
        try {
          while (cursor < this.events.length) {
            const row = this.events[cursor++];
            if (predicate(row)) return finish(undefined, row);
          }
          if (this.error) finish(this.error);
        } catch (error) { finish(error); }
      };
      const timer = setTimeout(() => finish(new Error("RPC notification wait timed out; process state is unchanged")), timeout);
      this.waiters.add(wake);
      wake();
    });
  }

  fail(error) {
    if (this.error) return;
    this.error = error instanceof Error ? error : new Error(String(error));
    this.serverAbort.abort(this.error);
    for (const timer of this.serverTimers) clearTimeout(timer);
    this.serverTimers.clear();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(this.error); }
    this.pending.clear();
    for (const wake of [...this.waiters]) wake();
  }

  dispose() {
    this.fail(new Error("RPC client disposed"));
    this.lines.off("line", this.onLine);
    this.lines.close();
    this.child.off("exit", this.onExit);
    this.child.off("error", this.onError);
    this.child.stdin.off("error", this.onError);
    this.child.stdout.off("error", this.onError);
  }
}
