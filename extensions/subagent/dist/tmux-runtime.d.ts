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
}
export type PromptDelivery = "steer" | "follow_up";
export interface TmuxLaunchOptions {
    cwd: string;
    windowName: string;
    command: string;
    args: string[];
    environment: Record<string, string>;
}
export declare class TmuxRuntime {
    private readonly execute;
    private readonly tmuxPath;
    private readonly sessionName;
    private readonly transferDirectory;
    constructor(options: TmuxRuntimeOptions);
    launch(options: TmuxLaunchOptions): Promise<TmuxLocator>;
    locatePane(paneId: string): Promise<TmuxLocator>;
    isAlive(locator: TmuxLocator): Promise<boolean>;
    close(locator: TmuxLocator): Promise<void>;
    sendPrompt(locator: TmuxLocator, text: string, delivery: PromptDelivery): Promise<void>;
    private runRequired;
}
//# sourceMappingURL=tmux-runtime.d.ts.map