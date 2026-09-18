import { spawn } from "node:child_process";
const TERMINATE_GRACE_MS = 100;
const REAP_GRACE_MS = 500;
const MAX_OUTPUT_BYTES = 1024 * 1024;
/** Executes an owned command group with bounded cancellation and output. */
export const executeCommand = async (command, args, options = {}) => {
    options.signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: options.cwd, shell: false,
            detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
        const stdout = [], stderr = [];
        let bytes = 0, finished = false, closed = false;
        let exitCode = null;
        let failure;
        let escalation;
        let reap;
        let poll;
        const timeout = setTimeout(() => stop(new Error("Subagent command timed out; its server-side outcome may be unknown")), options.timeout ?? 5000);
        const groupExists = () => {
            if (!child.pid)
                return false;
            if (process.platform === "win32")
                return !closed;
            try {
                process.kill(-child.pid, 0);
                return true;
            }
            catch (error) {
                return error.code !== "ESRCH";
            }
        };
        const signalGroup = (signal) => {
            if (!child.pid)
                return;
            try {
                if (process.platform === "win32")
                    child.kill(signal);
                else
                    process.kill(-child.pid, signal);
            }
            catch (error) {
                if (error.code !== "ESRCH")
                    failure ??= error;
            }
        };
        const finish = () => {
            if (finished)
                return;
            finished = true;
            clearTimeout(timeout);
            clearTimeout(escalation);
            clearTimeout(reap);
            clearTimeout(poll);
            options.signal?.removeEventListener("abort", abort);
            child.stdout.destroy();
            child.stderr.destroy();
            if (failure)
                reject(failure);
            else
                resolve({ code: exitCode ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
        };
        const checkReaped = () => {
            if (finished)
                return;
            if (closed && !groupExists()) {
                finish();
                return;
            }
            poll = setTimeout(checkReaped, 5);
        };
        const stop = (error) => {
            if (failure || finished)
                return;
            failure = error;
            signalGroup("SIGTERM");
            escalation = setTimeout(() => {
                signalGroup("SIGKILL");
                reap = setTimeout(() => {
                    failure = new AggregateError([error], "Command cleanup could not confirm exit; outcome is unknown");
                    finish();
                }, REAP_GRACE_MS);
            }, TERMINATE_GRACE_MS);
            checkReaped();
        };
        const abort = () => stop(options.signal?.reason instanceof Error ? options.signal.reason : new Error("Subagent operation aborted"));
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted)
            abort();
        const collect = (data, output) => {
            bytes += data.length;
            if (bytes > MAX_OUTPUT_BYTES) {
                stop(new Error("Subagent command output exceeds its limit"));
                return;
            }
            output.push(data);
        };
        child.stdout.on("data", data => collect(data, stdout));
        child.stderr.on("data", data => collect(data, stderr));
        child.once("error", error => { failure ??= error; if (!child.pid)
            finish(); });
        child.once("close", code => { closed = true; exitCode = code; if (!failure)
            finish(); });
    });
};
//# sourceMappingURL=command-executor.js.map