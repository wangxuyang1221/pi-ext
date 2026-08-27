import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TmuxLocator } from "./state-store.js";

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
}

export type PromptDelivery = "steer" | "follow_up";

export interface TmuxLaunchOptions {
  cwd: string;
  windowName: string;
  command: string;
  args: string[];
  environment: Record<string, string>;
}

const LOCATOR_FORMAT = "#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_pid}";

export class TmuxRuntime {
  private readonly execute: CommandExecution;
  private readonly tmuxPath: string;
  private readonly sessionName: string;
  private readonly transferDirectory: string;

  constructor(options: TmuxRuntimeOptions) {
    this.execute = options.execute;
    this.tmuxPath = options.tmuxPath;
    this.sessionName = options.sessionName;
    this.transferDirectory = options.transferDirectory;
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
    if (created.code === 0) return parseLocator(created.stdout);

    const concurrentlyCreated = await this.execute(this.tmuxPath, hasSessionArgs);
    if (concurrentlyCreated.code !== 0) {
      throw new Error(
        `tmux new-session failed: ${created.stderr.trim() || `exit ${created.code}`}`,
      );
    }

    const result = await this.runRequired(newWindowArgs);
    return parseLocator(result.stdout);
  }

  async locatePane(paneId: string): Promise<TmuxLocator> {
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
    return {
      sessionName,
      windowId,
      paneId: actualPaneId,
      panePid,
      ...(windowName ? { windowName } : {}),
    };
  }

  async isAlive(locator: TmuxLocator): Promise<boolean> {
    const result = await this.execute(this.tmuxPath, [
      "display-message",
      "-p",
      "-t",
      locator.paneId,
      "#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_dead}\t#{pane_pid}",
    ]);
    if (result.code !== 0) return false;
    const [sessionName, windowId, paneId, paneDead, panePidText, ...extra] = result.stdout
      .trim()
      .split("\t");
    if (extra.length > 0) return false;
    return sessionName === locator.sessionName
      && windowId === locator.windowId
      && paneId === locator.paneId
      && paneDead === "0"
      && (locator.panePid === undefined || Number(panePidText) === locator.panePid);
  }

  async close(locator: TmuxLocator): Promise<void> {
    if (!await this.isAlive(locator)) return;
    const result = await this.execute(this.tmuxPath, ["kill-window", "-t", locator.windowId]);
    if (result.code !== 0 && await this.isAlive(locator)) {
      throw new Error(`tmux kill-window failed: ${result.stderr.trim() || `exit ${result.code}`}`);
    }
  }

  async sendPrompt(
    locator: TmuxLocator,
    text: string,
    delivery: PromptDelivery,
  ): Promise<void> {
    if (text.length === 0) throw new Error("Cannot deliver an empty subagent prompt");
    await mkdir(this.transferDirectory, { recursive: true });
    const id = randomUUID();
    const path = join(this.transferDirectory, `prompt-${id}.txt`);
    const buffer = `subagent-${id.replaceAll("-", "")}`;
    let loaded = false;

    try {
      await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
      await this.runRequired(["load-buffer", "-b", buffer, path]);
      loaded = true;
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
      await this.runRequired([
        "send-keys",
        "-t",
        locator.paneId,
        delivery === "follow_up" ? "M-Enter" : "Enter",
      ]);
    } finally {
      await rm(path, { force: true });
      if (loaded) {
        await this.execute(this.tmuxPath, ["delete-buffer", "-b", buffer]).catch(() => undefined);
      }
    }
  }

  private async runRequired(args: string[]): Promise<CommandExecutionResult> {
    const result = await this.execute(this.tmuxPath, args);
    if (result.code !== 0) {
      throw new Error(`tmux ${args[0]} failed: ${result.stderr.trim() || `exit ${result.code}`}`);
    }
    return result;
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
