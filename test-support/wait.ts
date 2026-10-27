import { setTimeout as delay } from "node:timers/promises";

/** Bound the entire readiness check, including a stalled asynchronous probe. */
export async function waitFor<T>(read: (signal: AbortSignal) => T | Promise<T>, accept: (value: T) => boolean,
  { label, timeoutMs = 10_000, intervalMs = 20 }: { label: string; timeoutMs?: number; intervalMs?: number }): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("Readiness deadlines and intervals must be finite and positive");
  }
  const controller = new AbortController();
  const error = new Error(`Timed out waiting for ${label}`);
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(error); reject(error); }, timeoutMs);
  });
  const poll = async () => {
    while (true) {
      controller.signal.throwIfAborted();
      const value = await read(controller.signal);
      controller.signal.throwIfAborted();
      if (accept(value)) return value;
      await delay(intervalMs, undefined, { signal: controller.signal });
    }
  };
  try { return await Promise.race([poll(), timeout]); }
  finally { clearTimeout(timer!); }
}
