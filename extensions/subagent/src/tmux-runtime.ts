import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { TmuxLocator } from "./state-store.js";
import { currentOperation, withOperation } from "./operation.js";

export interface CommandExecutionResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandExecution = (
  command: string,
  args: string[],
  options?: { cwd?: string; signal?: AbortSignal; timeout?: number },
) => Promise<CommandExecutionResult>;

export interface TmuxRuntimeOptions {
  execute: CommandExecution;
  tmuxPath: string;
  sessionName: string;
  transferDirectory: string;
  sleep?: (milliseconds: number) => Promise<void>;
  nowMs?: () => number;
}

export type PromptDelivery = "steer" | "follow_up";

export interface RuntimeObservation {
  identity: "matched" | "mismatch" | "unknown";
  process: "alive" | "exited" | "unknown";
  terminal: "present" | "absent" | "unknown";
  promptReady: boolean;
  locator?: TmuxLocator;
  reason?: string;
}

export interface RuntimeQueryOptions { signal?: AbortSignal; timeout?: number }

export interface TmuxLaunchOptions {
  cwd: string;
  windowName: string;
  command: string;
  args: string[];
  environment: Record<string, string>;
}

const LOCATOR_FORMAT = "#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_pid}";
const OBSERVATION_FORMAT = "#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_dead}\t#{pane_pid}";
const IDENTITY_FORMAT = "#{pid}\t#{start_time}\t#{socket_path}\t#{@pi_subagent_instance}\t#{window_panes}\t#{pane_in_mode}";
const PROMPT_READY_FORMAT = "#{session_name}\t#{window_id}\t#{pane_id}\t#{window_panes}\t#{pane_dead}\t#{pane_pid}\t#{pane_in_mode}";

export class TmuxRuntime {
  private readonly execute: CommandExecution;
  private readonly cleanupExecute: CommandExecution;
  private readonly tmuxPath: string;
  private readonly sessionName: string;
  private readonly transferDirectory: string;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly nowMs: () => number;
  private readonly lastClearAtByPane = new Map<string, number>();

  constructor(options: TmuxRuntimeOptions) {
    this.cleanupExecute = options.execute;
    this.execute = async (command, args, execOptions) => {
      const operation = currentOperation();
      operation?.signal.throwIfAborted();
      await operation?.assertAuthorized?.();
      const pending = options.execute(command, args, {
        ...execOptions,
        signal: execOptions?.signal ?? operation?.signal,
        timeout: Math.min(execOptions?.timeout ?? 5_000, operation?.remainingMs ?? 5_000),
      });
      return operation ? operation.trackResource(pending) : pending;
    };
    this.tmuxPath = options.tmuxPath;
    this.sessionName = options.sessionName;
    this.transferDirectory = options.transferDirectory;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolveDelay) => {
      setTimeout(resolveDelay, milliseconds);
    }));
    this.nowMs = options.nowMs ?? Date.now;
  }

  async launch(options: TmuxLaunchOptions): Promise<TmuxLocator> {
    const hasSessionArgs = ["has-session", "-t", `=${this.sessionName}`];
    const hasSession = await this.execute(this.tmuxPath, hasSessionArgs);
    const shellCommand = buildShellCommand(
      options.command,
      options.args,
      options.environment,
    );
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
      return this.bindLocator(parseLocator(result.stdout), options.environment.PI_SUBAGENT_ID);
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
    if (created.code === 0) return this.bindLocator(parseLocator(created.stdout), options.environment.PI_SUBAGENT_ID);

    const concurrentlyCreated = await this.execute(this.tmuxPath, hasSessionArgs);
    if (concurrentlyCreated.code !== 0) {
      throw new Error(
        `tmux new-session failed: ${created.stderr.trim() || `exit ${created.code}`}`,
      );
    }

    const result = await this.runRequired(newWindowArgs);
    return this.bindLocator(parseLocator(result.stdout), options.environment.PI_SUBAGENT_ID);
  }

  private async bindLocator(locator: TmuxLocator, instance?: string): Promise<TmuxLocator> {
    if (!instance) return locator;
    await this.runRequired(["set-option", "-p", "-t", locator.paneId, "@pi_subagent_instance", instance]);
    return this.readIdentity(locator, instance);
  }

  private async readIdentity(locator: TmuxLocator, instance: string, waitForInstallation = false): Promise<TmuxLocator> {
    let expectedServer: string | undefined;
    while (true) {
      const result = await this.runRequired(["display-message", "-p", "-t", locator.paneId, `${IDENTITY_FORMAT}\t#{pane_id}\t#{pane_pid}`]);
      const [serverPid, serverStartedAt, socketPath, processInstanceId, _panes, _mode, paneId, panePid, ...extra] = result.stdout.replace(/\r?\n$/u, "").split("\t");
      if (!Number.isSafeInteger(Number(serverPid)) || Number(serverPid) <= 0 || !serverStartedAt || !socketPath
        || paneId !== locator.paneId || Number(panePid) !== locator.panePid || extra.length) {
        throw new Error("Subagent pane identity handshake failed");
      }
      const server = `${serverPid}\t${serverStartedAt}\t${socketPath}`;
      expectedServer ??= server;
      if (server !== expectedServer) throw new Error("Subagent server changed during identity handshake");
      if (processInstanceId === instance) return { ...locator, serverPid: Number(serverPid), serverStartedAt, socketPath, processInstanceId };
      if (!waitForInstallation || processInstanceId !== "") throw new Error("Subagent pane identity handshake failed");
      // A missing marker is transitional; every retry shares the original lookup deadline.
      const operation = currentOperation()!;
      await delay(Math.min(25, operation.remainingMs), undefined, { signal: operation.signal });
    }
  }

  async locatePane(paneId: string, instance?: string, options?: RuntimeQueryOptions): Promise<TmuxLocator> {
    return withOperation(options?.timeout ?? 5_000, options?.signal, () => this.locatePaneInternal(paneId, instance));
  }

  private async locatePaneInternal(paneId: string, instance?: string): Promise<TmuxLocator> {
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
    if (
      !sessionName
      || !windowId?.startsWith("@")
      || actualPaneId !== paneId
      || !Number.isSafeInteger(panePid)
      || panePid <= 0
      || extra.length > 0
    ) {
      throw new Error("tmux returned an invalid current pane locator");
    }
    const locator = { sessionName, windowId, paneId: actualPaneId, panePid, ...(windowName ? { windowName } : {}) };
    return instance ? this.readIdentity(locator, instance, true) : locator;
  }

  async capturePane(locator: TmuxLocator): Promise<string> {
    const result = await this.runRequired([
      "capture-pane",
      "-p",
      "-J",
      "-t",
      locator.paneId,
    ]);
    return result.stdout;
  }

  async observe(locator: TmuxLocator, options?: RuntimeQueryOptions): Promise<RuntimeObservation> {
    let result: CommandExecutionResult;
    try { result = await this.execute(this.tmuxPath, [
      "display-message",
      "-p",
      "-t",
      locator.paneId,
      locator.processInstanceId ? `${OBSERVATION_FORMAT}\t${IDENTITY_FORMAT}` : OBSERVATION_FORMAT,
    ], options); } catch (error) {
      options?.signal?.throwIfAborted();
      return { identity: "unknown", process: "unknown", terminal: "unknown", promptReady: false, reason: String(error) };
    }
    if (result.code !== 0) {
      const absent = /^(?:can't find (?:pane|window|session):|no server running on |error connecting to .+ \(No such file or directory\))/u.test(result.stderr.trim());
      let processExited = false;
      if (absent && locator.panePid !== undefined) {
        try { process.kill(locator.panePid, 0); }
        catch (error) { processExited = (error as NodeJS.ErrnoException).code === "ESRCH"; }
      }
      let terminalAbsent = false;
      if (absent && locator.serverPid !== undefined) {
        try { process.kill(locator.serverPid, 0); }
        catch (error) { terminalAbsent = (error as NodeJS.ErrnoException).code === "ESRCH"; }
        if (!terminalAbsent && result.stderr.trim().startsWith("can't find ")) {
          const server = await this.execute(this.tmuxPath, ["display-message", "-p", "#{pid}\t#{start_time}\t#{socket_path}"], options);
          terminalAbsent = server.code === 0 && server.stdout.trim() === `${locator.serverPid}\t${locator.serverStartedAt}\t${locator.socketPath}`;
        }
      }
      return {
        identity: "unknown", process: processExited ? "exited" : "unknown",
        terminal: terminalAbsent ? "absent" : "unknown", promptReady: false,
        reason: `tmux display-message failed: ${result.stderr.trim() || `exit ${result.code}`}`,
      };
    }
    const [sessionName, windowId, paneId, paneDead, panePidText, ...extra] = result.stdout
      .replace(/\r?\n$/u, "")
      .split("\t");
    const [serverPid, serverStartedAt, socketPath, instance, windowPanes, paneInMode] = extra;
    const sameServer = locator.processInstanceId !== undefined && extra.length === 6
      && Number(serverPid) === locator.serverPid && serverStartedAt === locator.serverStartedAt && socketPath === locator.socketPath;
    const stableIdentity = sameServer && instance === locator.processInstanceId;
    // display-message may fall back to the active pane after its target disappears.
    // Verify absence on the same server rather than mistaking that fallback for a replacement.
    if (sameServer && paneId !== locator.paneId) {
      const panes = await this.execute(this.tmuxPath, ["list-panes", "-a", "-F", "#{pane_id}"], options);
      if (panes.code === 0 && !panes.stdout.trim().split("\n").includes(locator.paneId)) {
        let exited = false;
        if (locator.panePid) {
          try { process.kill(locator.panePid, 0); }
          catch (error) { exited = (error as NodeJS.ErrnoException).code === "ESRCH"; }
        }
        return { identity: "unknown", process: exited ? "exited" : "unknown", terminal: "absent", promptReady: false,
          ...(exited ? {} : { reason: "Owned pane is absent; process exit is not yet confirmed" }) };
      }
    }
    if ((locator.processInstanceId ? !stableIdentity : extra.length > 0 || sessionName !== locator.sessionName || windowId !== locator.windowId)
      || paneId !== locator.paneId || (locator.panePid !== undefined && Number(panePidText) !== locator.panePid)) {
      return { identity: "mismatch", process: "unknown", terminal: "present", promptReady: false,
        reason: "Subagent runtime identity mismatch; management and capacity are retained" };
    }
    if (paneDead !== "0" && paneDead !== "1") {
      return { identity: "unknown", process: "unknown", terminal: "present", promptReady: false, reason: "Invalid tmux process observation" };
    }
    return { identity: "matched", process: paneDead === "0" ? "alive" : "exited", terminal: "present",
      promptReady: stableIdentity && paneDead === "0" && windowPanes === "1" && paneInMode === "0",
      locator: { ...locator, sessionName: sessionName!, windowId: windowId! },
      ...(stableIdentity && windowPanes !== "1" ? { reason: "Managed window contains unowned panes" } : {}),
    };
  }

  async isAlive(locator: TmuxLocator, options?: RuntimeQueryOptions): Promise<boolean> {
    const observed = await this.observe(locator, options);
    if (observed.identity === "mismatch" || observed.process === "unknown") throw new Error(observed.reason ?? "Subagent runtime state is unknown");
    return observed.process === "alive";
  }

  async close(locator: TmuxLocator, options?: RuntimeQueryOptions): Promise<void> {
    const observed = await this.observe(locator, options);
    if (observed.process === "exited" && observed.terminal === "absent") return;
    if (observed.identity !== "matched" || observed.terminal !== "present") {
      throw new Error(observed.reason ?? "Cannot close an unidentified subagent runtime");
    }
    if (observed.reason) throw new Error(observed.reason);
    const result = await this.execute(this.tmuxPath, ["kill-window", "-t", observed.locator!.windowId], options);
    assertCommandSucceeded(["kill-window"], result);
  }

  async sendPrompt(locator: TmuxLocator, text: string, delivery: PromptDelivery): Promise<void> {
    const pending = this.deliverPrompt(locator, text, delivery);
    return currentOperation()?.trackResource(pending) ?? pending;
  }

  private async deliverPrompt(
    locator: TmuxLocator,
    text: string,
    delivery: PromptDelivery,
  ): Promise<void> {
    if (text.length === 0) throw new Error("Cannot deliver an empty subagent prompt");
    await this.waitForClearCooldown(locator.paneId);
    await this.assertPromptReady(locator);
    await mkdir(this.transferDirectory, { recursive: true });
    const id = randomUUID();
    const path = join(this.transferDirectory, `prompt-${id}.txt`);
    const buffer = `subagent-${id.replaceAll("-", "")}`;
    let bufferAttempted = false;
    const failures: unknown[] = [];
    const cleanupFailed = (error: unknown) => {
      failures.push(error);
      const operation = currentOperation();
      if (operation?.signal.aborted) operation.reportCleanupError(error);
    };

    try {
      await writeFile(path, `${text} `, { encoding: "utf8", mode: 0o600 });
      bufferAttempted = true;
      await this.runRequired(["load-buffer", "-b", buffer, path]);
      try {
        await this.runRequired(["send-keys", "-H", "-t", locator.paneId, "03"]);
      } finally {
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
    } catch (error) { failures.push(error); }
    finally {
      await rm(path, { force: true }).catch(cleanupFailed);
      if (bufferAttempted) {
        // Cleanup owns only this UUID buffer, not the child. It must outlive caller cancellation.
        try {
          const result = await this.cleanupExecute(this.tmuxPath, ["delete-buffer", "-b", buffer], {
            signal: AbortSignal.timeout(200), timeout: 200,
          });
          if (result.code !== 0 && !/no buffer|unknown buffer|can't find buffer/u.test(result.stderr)) {
            assertCommandSucceeded(["delete-buffer"], result);
          }
        } catch (error) { cleanupFailed(error); }
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Prompt delivery failed; cleanup also failed", { cause: failures[0] });
  }

  private async waitForClearCooldown(paneId: string): Promise<void> {
    while (true) {
      const lastClearAt = this.lastClearAtByPane.get(paneId);
      if (lastClearAt === undefined) return;
      const remaining = 600 - (this.nowMs() - lastClearAt);
      if (remaining <= 0) return;
      await this.sleep(remaining);
    }
  }

  private async assertPromptReady(locator: TmuxLocator): Promise<void> {
    if (locator.panePid === undefined) {
      throw new Error("tmux pane is not ready for prompt delivery");
    }
    if (locator.processInstanceId) {
      const observed = await this.observe(locator);
      if (!observed.promptReady) throw new Error(observed.reason ?? "tmux pane is not ready for prompt delivery");
      return;
    }
    const result = await this.runRequired([
      "display-message",
      "-p",
      "-t",
      locator.paneId,
      PROMPT_READY_FORMAT,
    ]);
    const [
      sessionName,
      windowId,
      paneId,
      windowPanes,
      paneDead,
      panePidText,
      paneInMode,
      ...extra
    ] = result.stdout.trim().split("\t");
    if (
      sessionName !== locator.sessionName
      || windowId !== locator.windowId
      || paneId !== locator.paneId
      || windowPanes !== "1"
      || paneDead !== "0"
      || Number(panePidText) !== locator.panePid
      || paneInMode !== "0"
      || extra.length > 0
    ) {
      throw new Error("tmux pane is not ready for prompt delivery");
    }
  }

  private async runRequired(args: string[]): Promise<CommandExecutionResult> {
    const result = await this.execute(this.tmuxPath, args);
    assertCommandSucceeded(args, result);
    return result;
  }
}

function assertCommandSucceeded(args: string[], result: CommandExecutionResult): void {
  if (result.code !== 0) {
    throw new Error(`tmux ${args[0]} failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
}

function buildShellCommand(
  command: string,
  args: string[],
  environment: Record<string, string>,
): string {
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
    "-i",
    'TMUX="${TMUX-}"',
    'TMUX_PANE="${TMUX_PANE-}"',
    ...assignments,
    quoteShellWord(command),
    ...args.map(quoteShellWord),
  ].join(" ");
}

function quoteShellWord(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function parseLocator(output: string): TmuxLocator {
  const [sessionName, windowId, paneId, panePidText, ...extra] = output.trim().split("\t");
  const panePid = Number(panePidText);
  if (
    !sessionName
    || !windowId?.startsWith("@")
    || !paneId?.startsWith("%")
    || !Number.isSafeInteger(panePid)
    || panePid <= 0
    || extra.length > 0
  ) {
    throw new Error("tmux returned an invalid child locator");
  }
  return { sessionName, windowId, paneId, panePid };
}
