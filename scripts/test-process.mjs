import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// These are cleanup bounds, not test or production-operation deadlines.
const graceMs = 2000;
const killWaitMs = 3000;

function groupExists(pid) {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}
function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
}
async function waitForGroup(pid, milliseconds) {
  const deadline = performance.now() + milliseconds;
  while (groupExists(pid)) {
    if (performance.now() >= deadline) return false;
    await delay(20);
  }
  return true;
}
async function stopGroup(pid, signal) {
  if (!groupExists(pid)) return;
  signalGroup(pid, signal);
  if (await waitForGroup(pid, graceMs)) return;
  signalGroup(pid, "SIGKILL");
  if (!(await waitForGroup(pid, killWaitMs))) throw new Error(`Owned test process group ${pid} did not stop`);
}

/** Own a command and its temporary directory until cleanup has been verified. */
export async function runTestProcess(command, args, { env, directory }) {
  const windows = process.platform === "win32";
  let child, interrupted, requestStop;
  const cancelled = new Promise(resolve => { requestStop = resolve; });
  const cancelFile = join(directory, "cancel");
  const onSignal = signal => {
    if (interrupted) return;
    interrupted = signal;
    if (windows) {
      try { writeFileSync(cancelFile, signal); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    requestStop();
  };
  const interrupt = () => onSignal("SIGINT"), terminate = () => onSignal("SIGTERM");
  process.on("SIGINT", interrupt); process.on("SIGTERM", terminate);
  let safeToRemove = false;
  try {
    if (windows) {
      const configuration = join(directory, "command.json");
      writeFileSync(configuration, JSON.stringify({ command, args, ownerPid: process.pid, directory, cancelFile,
        node: process.execPath, bootstrap: fileURLToPath(new URL("./test-process-child.mjs", import.meta.url)),
        resultFile: join(directory, "result.json") }));
      const powershell = join(process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      child = spawn(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
        fileURLToPath(new URL("./test-process-windows.ps1", import.meta.url)), configuration], { env, stdio: "inherit", windowsHide: true });
    } else {
      child = spawn(command, args, { env, stdio: "inherit", detached: true });
    }
    const exited = once(child, "exit");
    // A spawn failure is observed even if cancellation wins the race.
    void exited.catch(() => {});
    let outcome;
    try {
      outcome = await Promise.race([exited, cancelled]);
    } finally {
      if (windows) {
        // The helper owns a Windows Job Object and also watches this process's handle.
        // Never kill only pnpm and then attempt taskkill against its vanished PID.
        await exited;
        safeToRemove = !existsSync(directory);
        if (!safeToRemove) throw new Error("Windows test job cleanup was not verified");
      } else {
        if (child.pid) await stopGroup(child.pid, interrupted ?? "SIGTERM");
        safeToRemove = true;
      }
    }
    return interrupted ? (interrupted === "SIGINT" ? 130 : 143) : (outcome?.[0] ?? 1);
  } catch (error) {
    if (!child?.pid) safeToRemove = true;
    if (!safeToRemove) console.error(`Test cleanup failed; retained diagnostics at ${directory}`);
    throw error;
  } finally {
    process.off("SIGINT", interrupt); process.off("SIGTERM", terminate);
    if (safeToRemove) rmSync(directory, { recursive: true, force: true });
  }
}
