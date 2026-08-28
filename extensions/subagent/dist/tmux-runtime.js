import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
const LOCATOR_FORMAT = "#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_pid}";
const PROMPT_READY_FORMAT = "#{session_name}\t#{window_id}\t#{pane_id}\t#{window_panes}\t#{pane_dead}\t#{pane_pid}\t#{pane_in_mode}";
export class TmuxRuntime {
    execute;
    tmuxPath;
    sessionName;
    transferDirectory;
    sleep;
    nowMs;
    lastClearAtByPane = new Map();
    constructor(options) {
        this.execute = options.execute;
        this.tmuxPath = options.tmuxPath;
        this.sessionName = options.sessionName;
        this.transferDirectory = options.transferDirectory;
        this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolveDelay) => {
            setTimeout(resolveDelay, milliseconds);
        }));
        this.nowMs = options.nowMs ?? Date.now;
    }
    async launch(options) {
        const hasSessionArgs = ["has-session", "-t", `=${this.sessionName}`];
        const hasSession = await this.execute(this.tmuxPath, hasSessionArgs);
        const shellCommand = buildShellCommand(options.command, options.args, options.environment);
        const newWindowArgs = [
            "new-window",
            "-d",
            "-P",
            "-F",
            LOCATOR_FORMAT,
            "-t",
            `=${this.sessionName}`,
            "-n",
            options.windowName,
            "-c",
            options.cwd,
            shellCommand,
        ];
        if (hasSession.code === 0) {
            const result = await this.runRequired(newWindowArgs);
            return parseLocator(result.stdout);
        }
        const newSessionArgs = [
            "new-session",
            "-d",
            "-P",
            "-F",
            LOCATOR_FORMAT,
            "-s",
            this.sessionName,
            "-n",
            options.windowName,
            "-c",
            options.cwd,
            shellCommand,
        ];
        const created = await this.execute(this.tmuxPath, newSessionArgs);
        if (created.code === 0)
            return parseLocator(created.stdout);
        const concurrentlyCreated = await this.execute(this.tmuxPath, hasSessionArgs);
        if (concurrentlyCreated.code !== 0) {
            throw new Error(`tmux new-session failed: ${created.stderr.trim() || `exit ${created.code}`}`);
        }
        const result = await this.runRequired(newWindowArgs);
        return parseLocator(result.stdout);
    }
    async locatePane(paneId) {
        const result = await this.runRequired([
            "display-message",
            "-p",
            "-t",
            paneId,
            "#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_pid}\t#{window_name}",
        ]);
        const [sessionName, windowId, actualPaneId, panePidText, windowName, ...extra] = result.stdout
            .trim()
            .split("\t");
        const panePid = Number(panePidText);
        if (!sessionName
            || !windowId?.startsWith("@")
            || actualPaneId !== paneId
            || !Number.isSafeInteger(panePid)
            || panePid <= 0
            || extra.length > 0) {
            throw new Error("tmux returned an invalid current pane locator");
        }
        return {
            sessionName,
            windowId,
            paneId: actualPaneId,
            panePid,
            ...(windowName ? { windowName } : {}),
        };
    }
    async capturePane(locator) {
        const result = await this.runRequired([
            "capture-pane",
            "-p",
            "-J",
            "-t",
            locator.paneId,
        ]);
        return result.stdout;
    }
    async isAlive(locator) {
        const result = await this.execute(this.tmuxPath, [
            "display-message",
            "-p",
            "-t",
            locator.paneId,
            "#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_dead}\t#{pane_pid}",
        ]);
        if (result.code !== 0)
            return false;
        const [sessionName, windowId, paneId, paneDead, panePidText, ...extra] = result.stdout
            .trim()
            .split("\t");
        if (extra.length > 0)
            return false;
        return sessionName === locator.sessionName
            && windowId === locator.windowId
            && paneId === locator.paneId
            && paneDead === "0"
            && (locator.panePid === undefined || Number(panePidText) === locator.panePid);
    }
    async close(locator) {
        if (!await this.isAlive(locator))
            return;
        const result = await this.execute(this.tmuxPath, ["kill-window", "-t", locator.windowId]);
        if (result.code !== 0 && await this.isAlive(locator)) {
            throw new Error(`tmux kill-window failed: ${result.stderr.trim() || `exit ${result.code}`}`);
        }
    }
    async sendPrompt(locator, text, delivery) {
        if (text.length === 0)
            throw new Error("Cannot deliver an empty subagent prompt");
        await this.waitForClearCooldown(locator.paneId);
        await this.assertPromptReady(locator);
        await mkdir(this.transferDirectory, { recursive: true });
        const id = randomUUID();
        const path = join(this.transferDirectory, `prompt-${id}.txt`);
        const buffer = `subagent-${id.replaceAll("-", "")}`;
        let loaded = false;
        try {
            await writeFile(path, `${text} `, { encoding: "utf8", mode: 0o600 });
            await this.runRequired(["load-buffer", "-b", buffer, path]);
            loaded = true;
            try {
                await this.runRequired(["send-keys", "-H", "-t", locator.paneId, "03"]);
            }
            finally {
                this.lastClearAtByPane.set(locator.paneId, this.nowMs());
            }
            await this.sleep(100);
            await this.runRequired([
                "paste-buffer",
                "-b",
                buffer,
                "-t",
                locator.paneId,
                "-p",
                "-r",
                "-d",
            ]);
            await this.sleep(100);
            await this.runRequired([
                "send-keys",
                "-H",
                "-t",
                locator.paneId,
                ...(delivery === "follow_up" ? ["1b", "0d"] : ["0d"]),
            ]);
        }
        finally {
            await rm(path, { force: true });
            if (loaded) {
                await this.execute(this.tmuxPath, ["delete-buffer", "-b", buffer]).catch(() => undefined);
            }
        }
    }
    async waitForClearCooldown(paneId) {
        while (true) {
            const lastClearAt = this.lastClearAtByPane.get(paneId);
            if (lastClearAt === undefined)
                return;
            const remaining = 600 - (this.nowMs() - lastClearAt);
            if (remaining <= 0)
                return;
            await this.sleep(remaining);
        }
    }
    async assertPromptReady(locator) {
        if (locator.panePid === undefined) {
            throw new Error("tmux pane is not ready for prompt delivery");
        }
        const result = await this.runRequired([
            "display-message",
            "-p",
            "-t",
            locator.paneId,
            PROMPT_READY_FORMAT,
        ]);
        const [sessionName, windowId, paneId, windowPanes, paneDead, panePidText, paneInMode, ...extra] = result.stdout.trim().split("\t");
        if (sessionName !== locator.sessionName
            || windowId !== locator.windowId
            || paneId !== locator.paneId
            || windowPanes !== "1"
            || paneDead !== "0"
            || Number(panePidText) !== locator.panePid
            || paneInMode !== "0"
            || extra.length > 0) {
            throw new Error("tmux pane is not ready for prompt delivery");
        }
    }
    async runRequired(args) {
        const result = await this.execute(this.tmuxPath, args);
        if (result.code !== 0) {
            throw new Error(`tmux ${args[0]} failed: ${result.stderr.trim() || `exit ${result.code}`}`);
        }
        return result;
    }
}
function buildShellCommand(command, args, environment) {
    const assignments = Object.entries(environment)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
            throw new Error(`Invalid child environment key: ${key}`);
        }
        return quoteShellWord(`${key}=${value}`);
    });
    return [
        "exec",
        "/usr/bin/env",
        ...assignments,
        quoteShellWord(command),
        ...args.map(quoteShellWord),
    ].join(" ");
}
function quoteShellWord(value) {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}
function parseLocator(output) {
    const [sessionName, windowId, paneId, panePidText, ...extra] = output.trim().split("\t");
    const panePid = Number(panePidText);
    if (!sessionName
        || !windowId?.startsWith("@")
        || !paneId?.startsWith("%")
        || !Number.isSafeInteger(panePid)
        || panePid <= 0
        || extra.length > 0) {
        throw new Error("tmux returned an invalid child locator");
    }
    return { sessionName, windowId, paneId, panePid };
}
//# sourceMappingURL=tmux-runtime.js.map