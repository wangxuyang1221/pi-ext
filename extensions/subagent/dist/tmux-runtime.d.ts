import type { TmuxLocator } from "./state-store.js";
export interface CommandExecutionResult {
    code: number;
    stdout: string;
    stderr: string;
}
export type CommandExecution = (command: string, args: string[], options?: {
    cwd?: string;
    signal?: AbortSignal;
    timeout?: number;
}) => Promise<CommandExecutionResult>;
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
export interface RuntimeQueryOptions {
    signal?: AbortSignal;
    timeout?: number;
}
export interface TmuxLaunchOptions {
    cwd: string;
    windowName: string;
    command: string;
    args: string[];
    environment: Record<string, string>;
}
export declare class TmuxRuntime {
    private readonly execute;
    private readonly cleanupExecute;
    private readonly tmuxPath;
    private readonly sessionName;
    private readonly transferDirectory;
    private readonly sleep;
    private readonly nowMs;
    private readonly lastClearAtByPane;
    constructor(options: TmuxRuntimeOptions);
    launch(options: TmuxLaunchOptions): Promise<TmuxLocator>;
    private bindLocator;
    private readIdentity;
    locatePane(paneId: string, instance?: string): Promise<TmuxLocator>;
    capturePane(locator: TmuxLocator): Promise<string>;
    observe(locator: TmuxLocator, options?: RuntimeQueryOptions): Promise<RuntimeObservation>;
    isAlive(locator: TmuxLocator, options?: RuntimeQueryOptions): Promise<boolean>;
    close(locator: TmuxLocator, options?: RuntimeQueryOptions): Promise<void>;
    sendPrompt(locator: TmuxLocator, text: string, delivery: PromptDelivery): Promise<void>;
    private deliverPrompt;
    private waitForClearCooldown;
    private assertPromptReady;
    private runRequired;
}
//# sourceMappingURL=tmux-runtime.d.ts.map