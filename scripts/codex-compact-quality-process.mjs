// Cleanup for processes explicitly spawned as owned experiment groups.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

export async function stopProcessGroup(child, { graceMs = 2000, killWaitMs = 3000 } = {}) {
  assert.ok(Number.isSafeInteger(child.pid) && child.pid > 1, "Missing owned process group PID");
  assert.ok(Number.isFinite(graceMs) && graceMs >= 0 && Number.isFinite(killWaitMs) && killWaitMs > 0, "Invalid cleanup deadline");
  child.stdin?.end();
  const gracefulDeadline = performance.now() + graceMs;
  while (child.exitCode === null && child.signalCode === null && performance.now() < gracefulDeadline) await delay(20);
  let indeterminateError;
  try { process.kill(-child.pid, "SIGKILL"); } catch (error) {
    if (error.code !== "ESRCH" && error.code !== "EPERM") throw error;
    if (error.code === "EPERM") indeterminateError = error;
  }
  const killDeadline = performance.now() + killWaitMs;
  while (true) {
    try { process.kill(-child.pid, 0); }
    catch (error) {
      if (error.code === "ESRCH") return { pid: child.pid, groupStopped: true, exitCode: child.exitCode, signalCode: child.signalCode };
      if (error.code !== "EPERM") throw error;
      indeterminateError = error;
    }
    if (performance.now() >= killDeadline) throw new Error("Owned process group cleanup not verified", { cause: indeterminateError });
    await delay(20);
  }
}
