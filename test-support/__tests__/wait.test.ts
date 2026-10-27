import { expect, test } from "vitest";
import { waitFor } from "../wait.js";

test("bounds a stalled readiness probe and cancels its owned work", async () => {
  let signal: AbortSignal | undefined;
  let guard: ReturnType<typeof setTimeout> | undefined;
  const waiting = waitFor(current => { signal = current; return new Promise<boolean>(() => {}); }, Boolean,
    { label: "fixture readiness", timeoutMs: 20 });
  try {
    await expect(Promise.race([waiting, new Promise((_, reject) => {
      guard = setTimeout(() => reject(new Error("Readiness probe remained pending")), 250);
    })])).rejects.toThrow("Timed out waiting for fixture readiness");
    expect(signal?.aborted).toBe(true);
  } finally { clearTimeout(guard); }
});
